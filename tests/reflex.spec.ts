import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

/** Exposes the running DuelEngine as window.reflexEngine. */
async function exposeEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).reflexEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).reflexEngine?.sim?.botz);
}

test('Fast Aim / Reflex: stand on the island, shoot an incoming bot, and see one that reaches you counted', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop reflex smoke test');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('reflex');
  const setup = page.getByRole('complementary', {name: 'Reflex settings'});
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('heading', {name: 'Fast Aim / Reflex'})).toBeVisible();
  await expect(page.locator('.duel-topline')).toContainText('FAST AIM / REFLEX');
  await expect(page.locator('.duel-topline')).toContainText('5 BOTS UP');
  const canvas = page.locator('canvas[data-duel]');
  await expect(canvas).toHaveAttribute('aria-label', 'Reflex island');
  // The defaults: knife bots that strafe A-D and spam crouch, and no reloading. Ledges are an Aim Botz option.
  await expect(page.getByLabel('Bot weapon')).toHaveValue('knife');
  await expect(page.getByLabel('Bot movement')).toHaveValue('strafe');
  await expect(page.getByLabel('Bot crouch')).toHaveValue('some');
  await expect(page.getByLabel('Bot crouch').locator('option[value="some"]')).toHaveText('Spam crouch');
  await expect(page.getByLabel('Infinite ammo')).toHaveValue('magazine');
  await expect(page.getByLabel('Bot approach')).toHaveValue('around');
  await expect(page.getByLabel('Spawn on ledges')).toHaveCount(0);
  await page.getByLabel('Number of bots').press('Home');
  await page.getByLabel('Bot movement').selectOption('static');
  await page.getByLabel('Bot crouch').selectOption('never');
  await expect(page.locator('.duel-topline')).toContainText('1 BOT UP');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  await page.getByRole('button', {name: 'Start reflex training'}).click();
  await expect(page.getByRole('button', {name: 'Pause reflex training'})).toBeVisible();
  await page.waitForFunction(() => (window as any).reflexEngine.models.size === 1, undefined, {timeout: 45000});
  // You start on the island, at ground level.
  expect(await page.evaluate(() => (window as any).reflexEngine.sim.actors[0].feet)).toBe(0);
  // Step the bot through its gap (polling frames could miss it under software rendering), then put the crosshair on
  // its head and fire, all in one go. The drill runs in real time while the models load, so a bot may already have
  // reached you by now: count from here.
  const before = await page.evaluate(() => {
    const sim = (window as any).reflexEngine.sim, inside = () => {
      const bot = sim.actors[1];
      return Math.max(Math.abs(bot.position.x), Math.abs(bot.position.z + 6)) < 8;
    };
    for (let tick = 0; tick < 128 * 20 && !inside(); tick++) sim.step();
    const eye = sim.actors[0].position, bot = sim.actors[1];
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    const reached = sim.botzStats.leaks, generation = bot.generation;
    sim.command(0, {firePressed: true}); sim.stepEarly();
    return {reached, generation};
  });
  await expect(page.locator('.duel-round')).toContainText('1 KILLS');
  await expect(page.locator('.duel-round')).toContainText(`${before.reached} REACHED YOU`);
  await expect(page.locator('.duel-health')).toContainText('1 / 1 hits');
  // It comes back after the delay with a fresh model, out of sight behind the walls.
  await expect.poll(() => page.evaluate(() => {
    const engine = (window as any).reflexEngine;
    return [engine.sim.actors[1].alive, engine.sim.actors[1].generation, engine.generations.get(1), engine.deaths.has(1)];
  }), {timeout: 5000}).toEqual([true, before.generation + 1, before.generation + 1, false]);
  // Leave it: when it reaches the island it is counted, captioned and starts again.
  await expect(page.locator('.duel-caption')).toHaveText('BOT REACHED YOU', {timeout: 20000});
  await expect(page.locator('.duel-round')).toContainText(`${before.reached + 1} REACHED YOU`);
  expect(await page.evaluate(() => (window as any).reflexEngine.sim.actors[1].generation)).toBeGreaterThanOrEqual(before.generation + 2);
  expect(await page.evaluate(() => (window as any).reflexEngine.sim.actors[0].health)).toBe(100);
  const stats = await sharp(await canvas.screenshot({path: `test-results/${info.project.name}-reflex.png`})).stats();
  expect(stats.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume reflex training'})).toBeVisible();
  await page.getByRole('tab', {name: 'Stats'}).click();
  await expect(page.getByRole('region', {name: 'Reflex stats'})).toContainText('Reached you');
  expect(errors).toEqual([]);
});

test('Fast Aim / Reflex keeps its own settings and history apart from Aim Botz', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop reflex persistence test');
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('reflex');
  await page.getByLabel('Bot approach').selectOption('front');
  await page.getByLabel('Number of bots').press('End');
  await page.getByLabel('Session length').selectOption('30');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await expect(page.locator('.duel-topline')).toContainText('16 BOTS UP');
  await exposeEngine(page);
  await page.getByRole('button', {name: 'Start reflex training'}).click();
  await page.waitForFunction(() => (window as any).reflexEngine.models.size === 16, undefined, {timeout: 45000});
  await page.evaluate(() => {
    const sim = (window as any).reflexEngine.sim;
    sim.command(0, {firePressed: true}); sim.stepEarly();
    for (let i = 0; i < 124; i++) sim.advance(.25);
  });
  await expect(page.locator('.duel-result')).toContainText('Session complete');
  await expect(page.locator('.duel-result')).toContainText('reached you');
  const saved = await page.evaluate(() => ({
    reflex: JSON.parse(localStorage.getItem('spraylab.reflex.history.v1') || '[]'),
    botz: JSON.parse(localStorage.getItem('spraylab.botz.history.v1') || '[]'),
    config: JSON.parse(localStorage.getItem('spraylab.reflex.v1') || '{}'),
  }));
  expect(saved.reflex).toHaveLength(1);
  expect(saved.reflex[0].leaks).toBeGreaterThan(5);
  expect(saved.botz).toHaveLength(0);
  expect(saved.config).toMatchObject({map: 'island', approach: 'front', botCount: 16});
  await page.reload();
  await expect(page.getByLabel('Training mode')).toHaveValue('reflex');
  await expect(page.getByLabel('Bot approach')).toHaveValue('front');
  await expect(page.getByLabel('Number of bots')).toHaveValue('16');
  await page.getByLabel('Training mode').selectOption('botz');
  await expect(page.getByRole('complementary', {name: 'Aim Botz settings'})).toBeVisible();
  await expect(page.getByLabel('Number of bots')).toHaveValue('10');
  await expect(page.getByLabel('Bot approach')).toHaveCount(0);
  await expect(page.locator('canvas[data-duel]')).toHaveAttribute('aria-label', 'Aim Botz yard');
});
