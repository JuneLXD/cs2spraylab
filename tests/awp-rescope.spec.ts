import {expect, test} from '@playwright/test';

test('AWP mouse input keeps queued scope clocks aligned and renders rescope from its processing time', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'awp', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).awpEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).awpEngine?.renderer.domElement);
  const first = await page.evaluate(() => {
    const e = (window as any).awpEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.accumulator = 0; e.sim.yaw = Math.PI;
    return Math.ceil(e.sim.time) + 1.003;
  });
  const advanceTo = (at: number, singleStep = false) => page.evaluate(({at, singleStep}) => {
    const e = (window as any).awpEngine, s = e.sim;
    while (s.time < at - 1e-10) s.step(singleStep ? at - s.time : Math.min(s.untilEvent(), at - s.time));
    const frameAt = e.previous + 1000; e.tick(frameAt); cancelAnimationFrame(e.frame);
    if (e.previous !== frameAt) throw Error('Expected rendered frame was skipped');
    return {at: s.time, ammo: s.loadedAmmo, lastShotAt: s.lastShotAt, zoom: s.actions.zoom,
      pending: s.actions.pendingZoom, secondary: s.actions.secondaryReadyAt, resume: s.actions.nextEventAt,
      fov: s.actions.fovAt(s.time), cameraFov: e.camera.fov, scopeHidden: e.scope.element.hidden};
  }, {at, singleStep});
  await advanceTo(first - .5); await page.mouse.click(0, 0, {button: 'right'});
  await advanceTo(first); await page.mouse.down(); await page.mouse.up();
  const ready = first + 1.455, processed = Math.ceil(ready * 64) / 64;
  await advanceTo(ready - .02); await page.mouse.down();
  const held = await advanceTo(processed); await page.mouse.up();
  expect(held.ammo).toBe(3);
  expect(held.lastShotAt).toBeCloseTo(ready, 8);
  expect(held.secondary).toBeCloseTo(ready + 1.455, 8);
  expect(held.resume).toBeCloseTo(ready + 1.455, 8);
  const late = await advanceTo(ready + 1.455 + .025, true);
  expect(late).toMatchObject({zoom: 1, pending: false, fov: 90, scopeHidden: false});
  expect(late.cameraFov).toBeCloseTo(73.739795, 5);
  const transition = await advanceTo(late.at + .025);
  expect(transition.fov).toBeCloseTo(82.1875, 6);
  expect(transition.cameraFov).toBeLessThan(late.cameraFov);
  await advanceTo(late.at + .2);
  await page.evaluate(() => {
    const s = (window as any).awpEngine.sim;
    s.reloadState.ammo = 1; s.reloadState.reserve = 0;
  });
  await page.mouse.down(); await page.mouse.up();
  const empty = await advanceTo(late.at + .2 + 1.455);
  expect(empty).toMatchObject({ammo: 0, zoom: 0, pending: false, scopeHidden: true, fov: 90});
  expect(errors).toEqual([]);
});
