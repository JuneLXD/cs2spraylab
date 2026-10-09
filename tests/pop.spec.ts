import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

/** Exposes the running RangeEngine as window.popEngine once Pop is the active drill. */
async function popEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).popEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).popEngine?.sim?.pop);
}

test('pop: the balls follow the setup, a shot pops the ball it crosses and a new one takes its place', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop range smoke test');
  test.setTimeout(180000);
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'pop', weapon: 'ak47', quality: 'auto', spread: false,
      popCount: 4, popSize: 40, popSpacing: 1, popDistance: 10}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'pop');
  await expect(page.getByLabel('Ball size')).toHaveValue('40');
  await expect(page.getByLabel('Balls at once')).toHaveValue('4');
  await expect(page.getByLabel('Distance to the balls')).toHaveValue('10');
  await page.getByRole('button', {name: 'Cyan balls'}).click();
  await expect(page.getByLabel('Ball color', {exact: true})).toHaveValue('#4df3ff');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await popEngine(page);
  const before = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, balls = sim.pop.balls as {id: number; x: number; y: number; z: number}[];
    return {ids: balls.map(ball => ball.id), count: balls.length, distance: sim.position.z - balls[0].z, color: engine.popMaterial.color.getHexString(),
      spaced: balls.every((a, i) => balls.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.4 - 1e-6)),
      meshes: engine.pop.children.filter((child: {name: string}) => child.name.startsWith('pop-ball-')).length};
  });
  expect(before.count).toBe(4); expect(before.distance).toBeCloseTo(10, 5); expect(before.spaced).toBe(true);
  expect(before.color).toBe('4df3ff'); expect(before.meshes).toBe(4);
  // Aim at the first ball's centre and tap once with spread off.
  await page.evaluate(() => {
    const sim = (window as any).popEngine.sim, ball = sim.pop.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
  });
  await expect(page.getByTestId('accuracy')).toHaveText('100%', {timeout: 10000});
  const after = await page.evaluate(() => {
    const sim = (window as any).popEngine.sim;
    return {pops: sim.pop.pops, shots: sim.pop.shots, count: sim.pop.balls.length, ids: sim.pop.balls.map((ball: {id: number}) => ball.id)};
  });
  expect(after).toMatchObject({pops: 1, shots: 1, count: 4});
  expect(after.ids).not.toContain(before.ids[0]);
  await expect(page.locator('.hit-caption')).toHaveText('POP');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeVisible();
  expect(errors).toEqual([]);
});
