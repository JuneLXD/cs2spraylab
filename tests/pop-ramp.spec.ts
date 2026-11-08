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
type Ramp = {shape: string; angle: number; length: number; width: number; facing: string; start: number; platform: number};
const standing = (page: Page) => page.evaluate(() => {
  const engine = (window as any).rampEngine, sim = engine.sim, mesh = engine.pop.getObjectByName('pop-ramp');
  const box = mesh?.geometry.boundingBox;
  return {feet: sim.feet as number, eye: sim.position.y as number, x: sim.position.x as number, z: sim.position.z as number, grounded: sim.grounded as boolean,
    ramp: sim.pop.config.ramp as Ramp | undefined, solids: sim.environment.solids.map((solid: {id: string}) => solid.id) as string[],
    box: box ? {minX: box.min.x as number, maxX: box.max.x as number, minZ: box.min.z as number, maxZ: box.max.z as number, maxY: box.max.y as number} : undefined,
    meshes: engine.pop.children.filter((child: {name: string}) => child.name === 'pop-ramp').length as number};
});
const EYE = 64 * .0254, R = 16 * .0254, tan = (degrees: number) => Math.tan(degrees * Math.PI / 180);
/** Waits until the engine's ramp config passes `check` (the function runs in the page, so it cannot use anything from here). */
const configured = (page: Page, check: (ramp: Ramp) => boolean) => page.waitForFunction(`(() => {const ramp = window.rampEngine.sim.pop.config.ramp; return !!ramp && (${check.toString()})(ramp);})()`);

test('pop: the ramps switch on from the settings as a platform with four ramps, are tuned there, carry you and your shots, and stay after a reload', async ({page}, info) => {
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
  const label = (name: string) => page.getByLabel(name, {exact: true});

  // Off by default: no controls, no ramps in the scene or the terrain, you stand on the floor at the usual spot.
  await expect(label('Ramp')).not.toBeChecked();
  await expect(label('Ramp layout')).toHaveCount(0); await expect(label('Ramp angle')).toHaveCount(0);
  expect(await standing(page)).toMatchObject({feet: 0, z: 2, ramp: undefined, meshes: 0});
  expect((await standing(page)).solids.filter(id => id.startsWith('pop-'))).toEqual([]);

  // Switch it on: a platform with four ramps, with its own controls. You start in the middle of it, on its top, and it is part
  // of the terrain and the scene.
  await label('Ramp').check();
  await expect(label('Ramp layout')).toHaveValue('platform');
  await expect(label('Ramp angle')).toHaveValue('20'); await expect(label('Ramp length')).toHaveValue('4'); await expect(label('Platform size')).toHaveValue('3');
  for (const name of ['Ramp width', 'Ramp direction', 'Start on the ramp']) await expect(label(name)).toHaveCount(0);
  await page.waitForFunction(() => !!(window as any).rampEngine.pop.getObjectByName('pop-ramp'));
  let rise = 4 * tan(20), now = await standing(page);
  expect(now.ramp).toEqual({shape: 'platform', angle: 20, length: 4, width: 6, facing: 'wall', start: .5, platform: 3});
  expect(now).toMatchObject({x: 0, z: -.5, grounded: true, meshes: 1});
  expect(now.feet).toBeCloseTo(rise, 6); expect(now.eye).toBeCloseTo(rise + EYE, 6);
  expect(now.solids).toEqual(expect.arrayContaining(['pop-platform', 'pop-ramp-front', 'pop-ramp-back', 'pop-ramp-left', 'pop-ramp-right']));
  // The mesh is the five solids: 11 m across, 11 m deep, back against the near wall, as high as the platform and no higher.
  expect(now.box!.minX).toBeCloseTo(-5.5, 4); expect(now.box!.maxX).toBeCloseTo(5.5, 4);
  expect(now.box!.minZ).toBeCloseTo(-6, 4); expect(now.box!.maxZ).toBeCloseTo(5, 4); expect(now.box!.maxY).toBeCloseTo(rise, 4);

  // Tune it. Every change rebuilds the ramps and puts you back in the middle of the platform.
  await label('Platform size').fill('4');
  await configured(page, ramp => ramp.platform === 4);
  now = await standing(page);
  expect(now.z).toBeCloseTo(-1); expect(now.feet).toBeCloseTo(rise, 6); expect(now.meshes).toBe(1);
  await label('Ramp angle').fill('30'); await label('Ramp length').fill('3');
  await configured(page, ramp => ramp.angle === 30 && ramp.length === 3);
  rise = 3 * tan(30); now = await standing(page);
  expect(now.z).toBeCloseTo(0); expect(now.feet).toBeCloseTo(rise, 6); expect(now.eye).toBeCloseTo(rise + EYE, 6); expect(now.meshes).toBe(1);
  expect(now.box!.maxY).toBeCloseTo(rise, 4); expect(now.box!.minX).toBeCloseTo(-5, 4);

  // One ramp is still there under Ramp layout, with its own controls. A 40 degree one rising toward the balls, started at its
  // foot, has its far edge well above your eyes, so it hides every ball behind it: bullets cannot go through a ramp.
  await label('Ramp layout').selectOption('ramp');
  for (const name of ['Ramp width', 'Ramp direction', 'Start on the ramp']) await expect(label(name)).toBeVisible();
  await expect(label('Platform size')).toHaveCount(0);
  await label('Ramp angle').fill('40'); await label('Ramp length').fill('6'); await label('Start on the ramp').fill('0');
  await configured(page, ramp => ramp.shape === 'ramp' && ramp.angle === 40 && ramp.length === 6 && ramp.start === 0);
  now = await standing(page);
  expect(now.solids).toContain('pop-ramp'); expect(now.solids).not.toContain('pop-platform'); expect(now.meshes).toBe(1);
  expect(now.z).toBeCloseTo(5); expect(now.feet).toBeCloseTo(R * tan(40), 4);
  const hidden = await page.evaluate(() => {
    const sim = (window as any).rampEngine.sim, eye = {...sim.position};
    return sim.pop.balls.map((ball: {x: number; y: number; z: number}) => {
      const dx = ball.x - eye.x, dy = ball.y - eye.y, dz = ball.z - eye.z, length = Math.hypot(dx, dy, dz);
      return !!sim.pop.rampHit(eye, {x: dx / length, y: dy / length, z: dz / length}, length);
    });
  });
  expect(hidden).toHaveLength(4); expect(hidden.every(Boolean)).toBe(true);

  // Back to the platform, with values of its own: you stand on its top, level with the balls, and a shot pops one.
  await label('Ramp layout').selectOption('platform');
  await label('Ramp angle').fill('25'); await label('Ramp length').fill('3.5'); await label('Platform size').fill('4.5');
  await configured(page, ramp => ramp.shape === 'platform' && ramp.angle === 25 && ramp.length === 3.5 && ramp.platform === 4.5);
  rise = 3.5 * tan(25); now = await standing(page);
  expect(now).toMatchObject({x: 0, meshes: 1}); expect(now.z).toBeCloseTo(5 - 2.25 - 3.5); expect(now.feet).toBeCloseTo(rise, 6); expect(now.solids).toContain('pop-platform');
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
  expect(view.eye).toBeCloseTo(rise + EYE, 4);
  await page.screenshot({path: info.outputPath('platform-start.png')});
  await page.evaluate(() => {
    const sim = (window as any).rampEngine.sim, ball = sim.pop.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
  });
  await expect(page.locator('.hit-caption')).toHaveText('POP');
  expect(await page.evaluate(() => (window as any).rampEngine.sim.pop.pops)).toBe(1);
  // A shot into the platform under you is stopped by it: no pop, a plain miss.
  await page.waitForTimeout(500);
  await page.evaluate(() => {const sim = (window as any).rampEngine.sim; sim.yaw = 0; sim.pitch = -1.1; sim.start(); sim.release('mouse');});
  await expect(page.locator('.hit-caption')).toHaveText('MISS');
  expect(await page.evaluate(() => (window as any).rampEngine.sim.pop.pops)).toBe(1);
  await page.screenshot({path: info.outputPath('platform-shot-into-platform.png')});

  // The ramps are settings like any other: they are saved, and a reload brings them back with their values.
  await page.keyboard.press('Escape');
  await page.reload(); await selectDrill(page, 'pop'); await rampEngine(page);
  await expect(label('Ramp')).toBeChecked(); await expect(label('Ramp layout')).toHaveValue('platform');
  await expect(label('Ramp angle')).toHaveValue('25'); await expect(label('Ramp length')).toHaveValue('3.5'); await expect(label('Platform size')).toHaveValue('4.5');
  now = await standing(page);
  // (The one-ramp start stays at the 0 % chosen for the hill: only the platform's own values were changed since.)
  expect(now.ramp).toEqual({shape: 'platform', angle: 25, length: 3.5, width: 6, facing: 'wall', start: 0, platform: 4.5}); expect(now.meshes).toBe(1);
  expect(now.feet).toBeCloseTo(3.5 * tan(25), 6); expect(now.z).toBeCloseTo(5 - 2.25 - 3.5);

  // Switching it off takes everything away and puts you back on the floor at the usual spot.
  await label('Ramp').uncheck();
  await page.waitForFunction(() => !(window as any).rampEngine.pop.getObjectByName('pop-ramp'));
  now = await standing(page);
  expect(now).toMatchObject({feet: 0, z: 2, x: 0, ramp: undefined, meshes: 0}); expect(now.solids.filter(id => id.startsWith('pop-'))).toEqual([]);
  await expect(label('Ramp layout')).toHaveCount(0); await expect(label('Ramp angle')).toHaveCount(0);
  expect(errors).toEqual([]);
});
