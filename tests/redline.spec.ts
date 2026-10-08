import {expect, test, type Page} from '@playwright/test';

/** Exposes the running DuelEngine as window.redlineEngine. */
async function exposeEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).redlineEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).redlineEngine?.sim?.botz);
}

test('aim_redline: the warehouse loads, bots stand around it, and a headshot counts', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop aim_redline smoke test');
  // The map and its ten bots take a while under software WebGL.
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('redline');
  const setup = page.getByRole('complementary', {name: 'aim_redline settings'});
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('MAP BY BOT REED');
  await expect(page.getByLabel('Spawn on ledges')).toBeChecked();
  await expect(setup).toContainText('Spawn on crates and catwalk');
  const canvas = page.locator('canvas[data-duel]');
  await expect(canvas).toHaveAttribute('aria-label', 'aim_redline');
  // Start waits for the map model.
  await expect(page.getByRole('button', {name: 'Start aim_redline'})).toBeVisible({timeout: 120000});
  await expect(page.locator('.duel-topline')).toContainText('10 BOTS UP');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  expect(await page.evaluate(() => (window as any).redlineEngine.workshopModel.children.length)).toBeGreaterThan(0);
  // You start at the north end of the hall, looking down it.
  expect(await page.evaluate(() => {const p = (window as any).redlineEngine.sim.actors[0]; return [Math.round(p.position.x), Math.round(p.position.z), p.yaw];}))
    .toEqual([11, -28, Math.PI]);
  await page.getByRole('button', {name: 'Start aim_redline'}).click();
  await expect(page.getByRole('button', {name: 'Pause aim_redline'})).toBeVisible();
  await page.waitForFunction(() => (window as any).redlineEngine.models.size === 10, undefined, {timeout: 60000});
  // Put the crosshair on the nearest bot's head and fire.
  await page.evaluate(() => {
    const sim = (window as any).redlineEngine.sim, eye = sim.actors[0].position;
    const bot = sim.actors.slice(1).sort((a: any, b: any) => Math.hypot(a.position.x - eye.x, a.position.z - eye.z) - Math.hypot(b.position.x - eye.x, b.position.z - eye.z))[0];
    (window as any).target = bot.id;
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.command(0, {firePressed: true}); sim.stepEarly();
  });
  await expect(page.locator('.duel-round')).toContainText('1 KILLS');
  await expect(page.locator('.duel-health')).toContainText('1 / 1 hits');
  // The bot comes back on another spot after the 1 s default delay.
  await expect.poll(() => page.evaluate(() => {const sim = (window as any).redlineEngine.sim; const bot = sim.actors[(window as any).target]; return [bot.alive, bot.generation];}),
    {timeout: 5000}).toEqual([true, 2]);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', {name: 'Stats'}).click();
  await expect(page.getByRole('region', {name: 'aim_redline stats'})).toContainText('Headshot kills');
  expect(errors).toEqual([]);
});
