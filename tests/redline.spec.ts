import {selectDrill} from './menu-helpers';
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

test('a first visit opens aim_redline with the AWP and its defaults', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop defaults check');
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.getByLabel('Training mode')).toHaveValue('redline');
  await expect(page.locator('.sl-loadout-chips')).toContainText('AWP');
  await expect(page.getByRole('complementary', {name: 'aim_redline settings'})).toBeVisible();
  for (const [label, value] of [['Number of bots', '3'], ['Bot distance', 'far'], ['Bot movement', 'close'], ['Bot crouch', 'never'],
    ['Respawn delay', '0'], ['Session length', '0'], ['Infinite ammo', 'magazine'], ['Bot weapon', 'ak47'], ['Bot health', '100']])
    await expect(page.getByLabel(label, {exact: true})).toHaveValue(value);
  for (const [label, checked] of [['Spawn on ledges', false], ['Headshot only', false], ['Bot armor', true], ['Bot helmet', false],
    ['Protect Ctrl+W', true]] as const) await expect(page.getByLabel(label, {exact: true})).toBeChecked({checked});
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Video', exact: true}).click();
  await expect(page.getByLabel('Render quality', {exact: true})).toHaveValue('high');
  await expect(page.getByLabel('Frame limit', {exact: true})).toHaveValue('0');
  for (const [label, checked] of [['Low-latency rendering', true], ['Show FPS counter', true], ['Protect range Ctrl+W', false]] as const)
    await expect(page.getByLabel(label, {exact: true})).toBeChecked({checked});
  // Low-latency rendering is on, but software WebGL (SwiftShader here) gets a normal canvas.
  expect(await page.locator('canvas[data-duel]').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('webgl2')?.getContextAttributes()?.desynchronized)).toBe(false);
});

test('aim_redline: the warehouse loads, bots stand around it, and a headshot counts', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop aim_redline smoke test');
  // The map and its bots take a while under software WebGL.
  test.setTimeout(180000);
  // The AK-47 at Auto quality, and bots standing still at close range, so one aimed shot is a headshot.
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
    localStorage.setItem('spraylab.redline.v1', JSON.stringify({distance: 'near', movement: 'static'}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'redline');
  const setup = page.getByRole('complementary', {name: 'aim_redline settings'});
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('MAP BY BOT REED');
  await expect(page.getByLabel('Spawn on ledges')).not.toBeChecked();
  await expect(setup).toContainText('Spawn on crates and catwalk');
  const canvas = page.locator('canvas[data-duel]');
  await expect(canvas).toHaveAttribute('aria-label', 'aim_redline');
  // Start waits for the map model.
  await expect(page.getByRole('button', {name: 'Start aim_redline'})).toBeVisible({timeout: 120000});
  await expect(page.locator('.duel-topline')).toContainText('3 BOTS UP');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page);
  expect(await page.evaluate(() => (window as any).redlineEngine.workshopModel.children.length)).toBeGreaterThan(0);
  // You start at the north end of the hall, looking down it.
  expect(await page.evaluate(() => {const p = (window as any).redlineEngine.sim.actors[0]; return [Math.round(p.position.x), Math.round(p.position.z), p.yaw];}))
    .toEqual([11, -28, Math.PI]);
  await page.getByRole('button', {name: 'Start aim_redline'}).click();
  await expect(page.getByRole('button', {name: 'Pause aim_redline'})).toBeVisible();
  await page.waitForFunction(() => (window as any).redlineEngine.models.size === 3, undefined, {timeout: 60000});
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
  // The bot comes back on another spot at once: aim_redline respawns instantly by default.
  await expect.poll(() => page.evaluate(() => {const sim = (window as any).redlineEngine.sim; const bot = sim.actors[(window as any).target]; return [bot.alive, bot.generation];}),
    {timeout: 5000}).toEqual([true, 2]);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', {name: 'Stats'}).click();
  await expect(page.getByRole('region', {name: 'aim_redline stats'})).toContainText('Headshot kills');
  expect(errors).toEqual([]);
});
