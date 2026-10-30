import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

/** Exposes the running engine of `file` as window.aimEngine once `ready` holds for it. */
async function exposeEngine(page: Page, file: '/range/engine.ts' | '/duel/DuelEngine.ts', className: 'RangeEngine' | 'DuelEngine') {
  await page.evaluate(async ({file, className}) => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(file))!.name;
    const Engine = (await import(/* @vite-ignore */ url))[className], tick = Engine.prototype.tick;
    Engine.prototype.tick = function(time: number) {(window as any).aimEngine = this; return tick.call(this, time);};
  }, {file, className});
}
const reports = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.aim.reports.v1') || '[]'));

test('aim report: a Pop session shows up in the Aim tab after a pause', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop range smoke test');
  test.setTimeout(240000);
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'pop', weapon: 'ak47', quality: 'auto', autoFullscreen: false, spread: false, popCount: 3, popSize: 40, popDistance: 10}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'pop');
  await page.getByRole('button', {name: 'Aim', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No report yet'})).toBeVisible();
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await exposeEngine(page, '/range/engine.ts', 'RangeEngine');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!(window as any).aimEngine?.sim?.pop);
  // Headless pointer lock is unreliable on this host ("Mouse capture blocked"); the simulation runs either way.
  await page.evaluate(() => {(window as any).aimEngine.sim.active = true;});
  // A real mouse movement goes through the recorder; then two taps at two balls with spread off.
  await page.mouse.move(700, 500); await page.mouse.move(760, 520);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const sim = (window as any).aimEngine.sim, ball = sim.pop.balls[0];
      const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    });
    // Let the simulation record the new view first: a view set by script, not the mouse, would otherwise look like a target
    // crossing the crosshair. The first frames after entering can take seconds under software rendering.
    const at = await page.evaluate(() => (window as any).aimEngine.sim.time);
    await page.waitForFunction(at => (window as any).aimEngine.sim.time > at + .1, at, {timeout: 30000});
    await page.evaluate(() => {const sim = (window as any).aimEngine.sim; sim.start(); sim.release('mouse');});
    await page.waitForTimeout(400);
  }
  await expect.poll(() => page.evaluate(() => (window as any).aimEngine.sim.pop.pops)).toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeVisible();
  const saved = await reports(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({mode: 'pop', label: 'Pop', weapon: 'ak47', shots: 2, hits: 2, cleared: 2});
  await page.getByRole('button', {name: 'Aim', exact: true}).click();
  const tab = page.getByRole('region', {name: 'Aim report'});
  await expect(tab.getByRole('heading', {name: 'Pop', exact: true})).toBeVisible();
  await expect(tab.locator('.sl-result-tile').first()).toContainText('100%');
  await expect(tab.locator('.sl-result-tile').first()).toContainText('2/2 shots');
  await expect(tab.getByText('Shooting while moving', {exact: true})).toBeVisible();
  // Both clicks came with the crosshair resting on the ball.
  await expect(tab.getByRole('row', {name: /^Settled/})).toContainText('2');
  await tab.screenshot({path: `test-results/${info.project.name}-aim-report-pop.png`});
  expect(errors).toEqual([]);
});

test('aim report: an Aim Botz kill shows up in the Aim tab after a pause', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Aim Botz smoke test');
  test.setTimeout(240000);
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto', autoFullscreen: false}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'botz');
  await page.getByLabel('Number of bots').press('Home');
  await expect(page.locator('.duel-topline')).toContainText('1 BOT UP');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page, '/duel/DuelEngine.ts', 'DuelEngine');
  await page.waitForFunction(() => !!(window as any).aimEngine?.sim?.botz);
  await page.getByRole('button', {name: 'Start Aim Botz'}).click();
  // Headless pointer lock is unreliable on this host: try Resume again when the capture was blocked.
  for (let attempt = 0; attempt < 3 && !await page.getByRole('button', {name: 'Pause Aim Botz'}).isVisible({timeout: 8000}).catch(() => false); attempt++)
    await page.getByRole('button', {name: 'Resume Aim Botz'}).click().catch(() => undefined);
  await expect(page.getByRole('button', {name: 'Pause Aim Botz'})).toBeVisible();
  await page.waitForFunction(() => (window as any).aimEngine.models.size === 1, undefined, {timeout: 45000});
  await page.evaluate(() => {
    const sim = (window as any).aimEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  });
  await page.waitForTimeout(300);
  await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
  await expect(page.locator('.duel-round')).toContainText('1 KILLS');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await reports(page)).length).toBe(1);
  expect((await reports(page))[0]).toMatchObject({mode: 'botz', label: 'Aim Botz', hits: 1, heads: 1, cleared: 1});
  await page.getByRole('button', {name: 'Aim', exact: true}).click();
  const tab = page.getByRole('region', {name: 'Aim report'});
  await expect(tab.getByRole('heading', {name: 'Aim Botz'})).toBeVisible();
  await expect(tab).toContainText('THIS MODE');
  await expect(tab.locator('.sl-result-tile').first()).toContainText('heads');
  await tab.screenshot({path: `test-results/${info.project.name}-aim-report-botz.png`});
  expect(errors).toEqual([]);
});
