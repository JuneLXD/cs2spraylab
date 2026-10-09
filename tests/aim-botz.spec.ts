import {selectDrill} from './menu-helpers';
import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

/** Exposes the running DuelEngine as window.botzEngine. */
async function exposeEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).botzEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).botzEngine?.sim?.botz);
}

/** Points the player's view at bot 1's head. */
const aimAtBot = (page: Page) => page.evaluate(() => {
  const sim = (window as any).botzEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
  const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
  sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
});

test('Aim Botz: shoot a bot, it respawns, and the stats count it', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Aim Botz smoke test');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'botz');
  await expect(page.getByRole('complementary', {name: 'Aim Botz settings'})).toBeVisible();
  await expect(page.locator('.duel-topline')).toContainText('10 BOTS UP');
  const canvas = page.locator('canvas[data-duel]');
  await expect(canvas).toHaveAttribute('aria-label', 'Aim Botz yard');
  await page.getByLabel('Number of bots').press('Home');
  await expect(page.locator('.duel-topline')).toContainText('1 BOT UP');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  await page.getByRole('button', {name: 'Start Aim Botz'}).click();
  await expect(page.getByRole('button', {name: 'Pause Aim Botz'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.matches('canvas[data-duel]'))).toBe(true);
  await page.waitForFunction(() => (window as any).botzEngine.models.size === 1, undefined, {timeout: 45000});
  await aimAtBot(page);
  await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
  await expect(page.locator('.duel-round')).toContainText('1 KILLS');
  await expect(page.locator('.duel-round')).toContainText('100% HEADSHOTS');
  await expect(page.locator('.duel-health')).toContainText('1 / 1 hits');
  expect(await page.evaluate(() => (window as any).botzEngine.sim.actors[1].alive)).toBe(false);
  // Respawn after the 1 s default delay, with a fresh model holding its weapon.
  await expect.poll(() => page.evaluate(() => {
    const engine = (window as any).botzEngine;
    return [engine.sim.actors[1].alive, engine.sim.actors[1].generation, engine.generations.get(1), engine.heldWeapons.get(1)?.visible, engine.deaths.has(1)];
  }), {timeout: 5000}).toEqual([true, 2, 2, true, false]);
  await page.waitForTimeout(300);
  const stats = await sharp(await canvas.screenshot({path: `test-results/${info.project.name}-aim-botz.png`})).stats();
  expect(stats.channels.slice(0, 3).every(channel => channel.stdev > 12)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Resume Aim Botz'})).toBeVisible();
  await page.getByRole('tab', {name: 'Stats'}).click();
  await expect(page.getByRole('region', {name: 'Aim Botz stats'})).toContainText('Headshot kills');
  expect(errors).toEqual([]);
});

test('Aim Botz: a timed session ends, is saved, and New session starts the next', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Aim Botz session test');
  await page.goto('/');
  await selectDrill(page, 'botz');
  await page.getByLabel('Session length').selectOption('30');
  await page.getByLabel('Headshot only').check();
  await page.getByLabel('Number of bots').press('Home');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  await page.getByRole('button', {name: 'Start Aim Botz'}).click();
  await expect(page.locator('.duel-round')).toContainText(/30|29/);
  await page.waitForFunction(() => (window as any).botzEngine.models.size === 1, undefined, {timeout: 45000});
  // One body shot registers without damage in headshot-only mode.
  await page.evaluate(() => {
    const sim = (window as any).botzEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.2 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.command(0, {firePressed: true});
  });
  await expect(page.locator('.duel-health')).toContainText('1 / 1 hits');
  expect(await page.evaluate(() => (window as any).botzEngine.sim.actors[1].health)).toBe(100);
  await page.evaluate(() => {const sim = (window as any).botzEngine.sim; for (let i = 0; i < 124; i++) sim.advance(.25);});
  await expect(page.locator('.duel-result')).toContainText('Session complete');
  await expect(page.getByRole('button', {name: 'New session'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.botz.history.v1') || '[]'));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({kills: 0, accuracy: 100, headshotOnly: true, distance: 'mixed'});
  await page.getByRole('button', {name: 'New session'}).click();
  await expect(page.getByRole('button', {name: 'Pause Aim Botz'})).toBeVisible();
  await expect(page.locator('.duel-result')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', {name: 'Stats'}).click();
  await expect(page.getByRole('region', {name: 'Aim Botz stats'}).locator('ol li')).toHaveCount(1);
});

test('Aim Botz settings persist, and AI Duel is unchanged', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Aim Botz persistence test');
  await page.goto('/');
  await selectDrill(page, 'botz');
  await page.getByLabel('Number of bots').press('End');
  await page.getByLabel('Bot movement').selectOption('strafe');
  await expect(page.locator('.duel-topline')).toContainText('16 BOTS UP');
  await page.reload();
  await expect(page.getByLabel('Training mode')).toHaveValue('botz');
  await expect(page.getByLabel('Number of bots')).toHaveValue('16');
  await expect(page.getByLabel('Bot movement')).toHaveValue('strafe');
  await selectDrill(page, 'duel');
  await expect(page.getByRole('complementary', {name: 'Duel settings'})).toBeVisible();
  await expect(page.getByLabel('Number of bots')).toHaveAttribute('max', '5');
  await expect(page.locator('canvas[data-duel]')).toHaveAttribute('aria-label', 'AI Duel arena');
});
