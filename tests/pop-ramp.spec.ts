import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

/** Exposes the running RangeEngine as window.rampEngine once Pop is the active drill. */
async function rampEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).rampEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).rampEngine?.sim?.pop);
}
const standing = (page: Page) => page.evaluate(() => {
  const engine = (window as any).rampEngine, sim = engine.sim, mesh = engine.pop.getObjectByName('pop-ramp');
  const box = mesh?.geometry.boundingBox;
  return {feet: sim.feet as number, eye: sim.position.y as number, x: sim.position.x as number, z: sim.position.z as number, grounded: sim.grounded as boolean,
    ramp: sim.pop.config.ramp as {angle: number; length: number; width: number; facing: string; start: number} | undefined,
    axis: sim.pop.ramp?.solid.traversal.axis as string | undefined, solids: sim.environment.solids.map((solid: {id: string}) => solid.id) as string[],
    meshTop: box ? box.max.y as number : undefined, meshes: engine.pop.children.filter((child: {name: string}) => child.name === 'pop-ramp').length as number};
});
const EYE = 64 * .0254, R = 16 * .0254, tan = (degrees: number) => Math.tan(degrees * Math.PI / 180);

test('pop: the ramp switches on from the settings, is tuned there, carries you and your shots, and stays after a reload', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL check'); test.setTimeout(240000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
      autoFullscreen: false, protectShortcuts: false, volume: 0, popCount: 4, popSize: 40, popSpacing: 1, popDistance: 10,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  await rampEngine(page);

  // Off by default: no controls, no ramp in the scene or the terrain, you stand on the floor at the usual spot.
  await expect(page.getByLabel('Ramp', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Ramp angle', {exact: true})).toHaveCount(0);
  expect(await standing(page)).toMatchObject({feet: 0, z: 2, ramp: undefined, meshes: 0});
  expect((await standing(page)).solids).not.toContain('pop-ramp');

  // Switch it on: the defaults show, you start halfway up a 20 degree ramp, and it is part of the terrain and the scene.
  await page.getByLabel('Ramp', {exact: true}).check();
  await expect(page.getByLabel('Ramp angle', {exact: true})).toHaveValue('20');
  await expect(page.getByLabel('Ramp length', {exact: true})).toHaveValue('6');
  await expect(page.getByLabel('Ramp width', {exact: true})).toHaveValue('6');
  await expect(page.getByLabel('Ramp direction', {exact: true})).toHaveValue('wall');
  await expect(page.getByLabel('Start on the ramp', {exact: true})).toHaveValue('50');
  await page.waitForFunction(() => !!(window as any).rampEngine.pop.getObjectByName('pop-ramp'));
  let now = await standing(page);
  expect(now.ramp).toEqual({angle: 20, length: 6, width: 6, facing: 'wall', start: .5});
  expect(now.feet).toBeCloseTo((3 + R) * tan(20), 4); expect(now.eye).toBeCloseTo(now.feet + EYE, 6);
  expect(now).toMatchObject({x: 0, z: 2, grounded: true, axis: 'z', meshes: 1}); expect(now.solids).toContain('pop-ramp');
  expect(now.meshTop!).toBeCloseTo(6 * tan(20) + .008, 3);

  // Tune it. Every change rebuilds the ramp and puts you back at its start.
  await page.getByLabel('Ramp angle', {exact: true}).fill('40');
  await page.waitForFunction(() => (window as any).rampEngine.sim.pop.config.ramp?.angle === 40);
  now = await standing(page);
  expect(now.feet).toBeCloseTo((3 + R) * tan(40), 4); expect(now.meshTop!).toBeCloseTo(6 * tan(40) + .008, 3); expect(now.meshes).toBe(1);
  await page.getByLabel('Ramp direction', {exact: true}).selectOption('right');
  await page.getByLabel('Start on the ramp', {exact: true}).fill('0');
  await page.waitForFunction(() => {const ramp = (window as any).rampEngine.sim.pop.config.ramp; return ramp?.facing === 'right' && ramp.start === 0;});
  now = await standing(page);
  expect(now.axis).toBe('x'); expect(now.x).toBeCloseTo(-3); expect(now.z).toBeCloseTo(2); expect(now.feet).toBeCloseTo(R * tan(40), 4);
  await page.getByLabel('Ramp direction', {exact: true}).selectOption('wall');
  await page.getByLabel('Start on the ramp', {exact: true}).fill('50');
  await page.getByLabel('Ramp width', {exact: true}).fill('10');
  await page.getByLabel('Ramp length', {exact: true}).fill('8');
  await page.waitForFunction(() => {const ramp = (window as any).rampEngine.sim.pop.config.ramp; return ramp?.width === 10 && ramp.length === 8 && ramp.facing === 'wall';});
  now = await standing(page);
  expect(now.z).toBeCloseTo(1); expect(now.feet).toBeCloseTo((4 + R) * tan(40), 4); expect(now.meshes).toBe(1);

  // At 40 degrees the far edge of the hill stands well above your eyes, so it hides every ball behind it: bullets cannot go through the ramp.
  const hidden = await page.evaluate(() => {
    const sim = (window as any).rampEngine.sim, eye = {...sim.position};
    return sim.pop.balls.map((ball: {x: number; y: number; z: number}) => {
      const dx = ball.x - eye.x, dy = ball.y - eye.y, dz = ball.z - eye.z, length = Math.hypot(dx, dy, dz);
      return !!sim.pop.rampHit(eye, {x: dx / length, y: dy / length, z: dz / length}, length);
    });
  });
  expect(hidden).toHaveLength(4); expect(hidden.every(Boolean)).toBe(true);

  // Downhill toward the balls there is nothing in the way: you are on the ramp, level with the balls, and a shot pops one.
  await page.getByLabel('Ramp angle', {exact: true}).fill('20');
  await page.getByLabel('Ramp direction', {exact: true}).selectOption('away');
  await page.waitForFunction(() => {const ramp = (window as any).rampEngine.sim.pop.config.ramp; return ramp?.angle === 20 && ramp.facing === 'away';});
  now = await standing(page);
  expect(now.z).toBeCloseTo(1); expect(now.feet).toBeCloseTo((4 + R) * tan(20), 4); expect(now.axis).toBe('z');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.evaluate(() => {(window as any).rampEngine.sim.active = true;});
  await page.waitForFunction(() => (window as any).rampEngine.sim.time > .3);
  const view = await page.evaluate(() => {
    const engine = (window as any).rampEngine, sim = engine.sim;
    return {eye: sim.position.y as number, camera: engine.camera.position.y as number, field: sim.pop.region.y as number, grounded: sim.grounded as boolean,
      distance: (sim.position.z - sim.pop.balls[0].z) as number};
  });
  expect(view.camera).toBeCloseTo(view.eye, 4); expect(view.field).toBeCloseTo(view.eye, 4); expect(view.grounded).toBe(true); expect(view.distance).toBeCloseTo(10, 4);
  await page.screenshot({path: info.outputPath('ramp-start.png')});
  await page.evaluate(() => {
    const sim = (window as any).rampEngine.sim, ball = sim.pop.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
  });
  await expect(page.locator('.hit-caption')).toHaveText('POP');
  expect(await page.evaluate(() => (window as any).rampEngine.sim.pop.pops)).toBe(1);
  // A shot into the slope under you is stopped by it: no pop, a plain miss.
  await page.waitForTimeout(500);
  await page.evaluate(() => {const sim = (window as any).rampEngine.sim; sim.yaw = 0; sim.pitch = -1.1; sim.start(); sim.release('mouse');});
  await expect(page.locator('.hit-caption')).toHaveText('MISS');
  expect(await page.evaluate(() => (window as any).rampEngine.sim.pop.pops)).toBe(1);
  await page.screenshot({path: info.outputPath('ramp-shot-into-slope.png')});

  // The ramp is a setting like any other: it is saved, and a reload brings it back with its values.
  await page.keyboard.press('Escape');
  await page.reload(); await selectDrill(page, 'pop'); await rampEngine(page);
  await expect(page.getByLabel('Ramp', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Ramp angle', {exact: true})).toHaveValue('20');
  await expect(page.getByLabel('Ramp length', {exact: true})).toHaveValue('8');
  await expect(page.getByLabel('Ramp direction', {exact: true})).toHaveValue('away');
  await expect(page.getByLabel('Ramp width', {exact: true})).toHaveValue('10');
  now = await standing(page);
  expect(now.ramp).toEqual({angle: 20, length: 8, width: 10, facing: 'away', start: .5}); expect(now.meshes).toBe(1);

  // Switching it off takes the ramp away and puts you back on the floor at the usual spot.
  await page.getByLabel('Ramp', {exact: true}).uncheck();
  await page.waitForFunction(() => !(window as any).rampEngine.pop.getObjectByName('pop-ramp'));
  now = await standing(page);
  expect(now).toMatchObject({feet: 0, z: 2, x: 0, ramp: undefined, meshes: 0}); expect(now.solids).not.toContain('pop-ramp');
  await expect(page.getByLabel('Ramp angle', {exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
