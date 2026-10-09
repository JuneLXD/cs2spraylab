import {expect, test, type Page} from '@playwright/test';

/** Exposes the running DuelEngine as window.dmEngine once it is a deathmatch session. */
async function exposeEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).dmEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).dmEngine?.sim?.deathmatch === true);
}

test('deathmatch on aim_redline: sides, a kill without a round end, and respawns on your own side', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop deathmatch smoke test');
  // The map and its bots take a while under software WebGL.
  test.setTimeout(240000);
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
    localStorage.setItem('spraylab.deathmatch.v1', JSON.stringify({botCount: 2, skill: 1, respawnSeconds: 1}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('deathmatch');
  const setup = page.getByRole('complementary', {name: 'Duel settings'});
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('MAP BY BOT REED');
  await expect(setup).toContainText('Deathmatch');
  await expect(page.getByLabel('Number of bots', {exact: true})).toHaveValue('2');
  await expect(page.getByLabel('Bot skill level', {exact: true})).toHaveValue('1');
  await expect(page.getByLabel('Respawn delay', {exact: true})).toHaveValue('1');
  await expect(page.getByLabel('Map layout')).toHaveCount(0);
  await expect(page.locator('canvas[data-duel]')).toHaveAttribute('aria-label', 'aim_redline');
  await expect(page.locator('.duel-topline')).toContainText('DEATHMATCH');
  await expect(page.getByRole('button', {name: 'Enter deathmatch'})).toBeVisible({timeout: 120000});
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  // You start on a T spawn; the bots on CT spawns on the far side.
  expect(await page.evaluate(() => {
    const sim = (window as any).dmEngine.sim;
    return [sim.actors[0].position.x < 8, sim.actors.length, sim.actors.slice(1).every((bot: any) => bot.position.x > 15)];
  })).toEqual([true, 3, true]);
  await page.getByRole('button', {name: 'Enter deathmatch'}).click();
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  await page.waitForFunction(() => (window as any).dmEngine.models.size === 2, undefined, {timeout: 60000});
  // Stand a bot on a floor spot you can see, aim at its head with spread off, and fire.
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/geometry.ts'))!.name;
    const {traceSolid} = await import(/* @vite-ignore */ url);
    const sim = (window as any).dmEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
    const sees = (from: any, to: any) => {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
      return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, sim.arena, length - .05).distance);
    };
    const spot = sim.arena.workshop.spots.find(([x, feet, z]: number[]) => feet < .05 &&
      Math.hypot(x - eye.x, z - eye.z) > 4 && Math.hypot(x - eye.x, z - eye.z) < 10 && sees(eye, {x, y: feet + 1.6256, z}));
    Object.assign(bot, {position: {x: spot[0], y: spot[1] + 1.6256, z: spot[2]}, feet: spot[1], grounded: true, velocity: {x: 0, z: 0}});
    // Take the bot over so it stands still, and remove spread from your shot.
    sim.command(1, {forward: 0, side: 0, fireHeld: false});
    sim.actors[0].weapon.options = {...sim.actors[0].weapon.options, spread: false};
  });
  // Player shots trace the last displayed pose: let the renderer draw the moved bot first.
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const sim = (window as any).dmEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    // Hold the trigger: a few body hits kill as surely as a headshot and do not depend on the displayed pose.
    sim.command(0, {firePressed: true, fireHeld: true}); sim.stepEarly();
  });
  await expect(page.locator('.duel-round')).toContainText('1 KILLS', {timeout: 15000});
  await page.evaluate(() => (window as any).dmEngine.sim.command(0, {fireHeld: false}));
  // No round ends: the bot is back on the CT side after the delay with a new life.
  await expect.poll(() => page.evaluate(() => {const bot = (window as any).dmEngine.sim.actors[1]; return [bot.alive, bot.generation, bot.position.x > 15, (window as any).dmEngine.sim.phase];}),
    {timeout: 8000}).toEqual([true, 2, true, 'fighting']);
  await expect(page.locator('.duel-result')).toHaveCount(0);
  // Your own death shows the respawn countdown, then you return on the T side with full health.
  await page.evaluate(() => {const player = (window as any).dmEngine.sim.actors[0]; player.alive = false; player.health = 0;});
  await expect(page.locator('.duel-result')).toContainText('Respawning in');
  await expect.poll(() => page.evaluate(() => {const player = (window as any).dmEngine.sim.actors[0]; return [player.alive, player.generation, player.position.x < 8, player.health];}),
    {timeout: 8000}).toEqual([true, 2, true, 100]);
  await expect(page.locator('.duel-result')).toHaveCount(0);
  await expect(page.locator('.duel-round')).toContainText('1 KILLS');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume deathmatch'})).toBeVisible();
  expect(errors).toEqual([]);
});
