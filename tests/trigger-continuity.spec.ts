import {expect, test} from '@playwright/test';

test('range mouse bind keeps held fire through reload/deploy and drops a released early tap', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'ak47', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).triggerEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).triggerEngine?.renderer.domElement);
  await page.evaluate(() => {
    const e = (window as any).triggerEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.yaw = Math.PI; e.sim.reloadState.ammo = 5;
  });
  await page.mouse.down(); await page.keyboard.press('r');
  const reload = await page.evaluate(() => {
    const s = (window as any).triggerEngine.sim;
    // Key-up changes held state; consume it before reading a forecast deadline.
    s.step(0);
    return {due: s.reloadState.until, ammo: s.loadedAmmo, active: s.reloadState.active};
  });
  expect(reload).toMatchObject({ammo: 4, active: true});
  const advanceTo = async (until: number) => page.evaluate(until => {
    const e = (window as any).triggerEngine, s = e.sim;
    while (s.time + s.accumulator < until - 1e-9) s.advance(Math.min(.125, until - s.time - s.accumulator));
    e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
    return {ammo: s.loadedAmmo, lastShotAt: s.lastShotAt, nextShot: s.nextShot};
  }, until);
  const reloaded = await advanceTo(Math.ceil(reload.due * 64) / 64);
  expect(reloaded.ammo).toBe(29); expect(reloaded.lastShotAt).toBeCloseTo(reload.due, 7);
  await page.keyboard.press('2'); await page.keyboard.press('1');
  const deploy = await page.evaluate(() => (window as any).triggerEngine.sim.equipReadyAt);
  const deployed = await advanceTo(Math.ceil(deploy * 64) / 64);
  expect(deployed.ammo).toBe(28); expect(deployed.lastShotAt).toBeCloseTo(deploy, 7);
  await page.mouse.up(); await page.keyboard.press('r');
  await page.mouse.down(); await page.mouse.up();
  const releasedDue = await page.evaluate(() => {
    const s = (window as any).triggerEngine.sim; s.step(0); return s.reloadState.until;
  });
  const released = await advanceTo(Math.ceil(releasedDue * 64) / 64 + .125);
  expect(released.ammo).toBe(30); expect(released.lastShotAt).toBeCloseTo(deploy, 7);
  expect(errors).toEqual([]);
});

test('loaded Nova reload respects its initial attack lock and fires a ready mouse tap immediately', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'nova', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).shellEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).shellEngine?.renderer.domElement);
  await page.evaluate(() => {
    const e = (window as any).shellEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.yaw = Math.PI; e.sim.reloadState.ammo = 2;
  });
  const advanceTo = async (at: number) => page.evaluate(at => {
    const s = (window as any).shellEngine.sim;
    while (s.time < at - 1e-10) s.step(Math.min(1 / 128, at - s.time));
    return {time: s.time, ammo: s.loadedAmmo, reloading: s.reloadState.active, lastShotAt: s.lastShotAt};
  }, at);
  await page.keyboard.press('r');
  const start = await page.evaluate(() => {
    const s = (window as any).shellEngine.sim; s.step(0);
    return {time: s.time, ready: s.reloadState.attackReadyAt, phase: s.reloadState.phase};
  });
  expect(start.phase).toBe('start'); expect(start.ready - start.time).toBeCloseTo(.466667, 6);
  await advanceTo(start.time + .05); await page.mouse.down();
  const locked = await advanceTo(start.ready - .001);
  expect(locked.ammo).toBe(2); expect(locked.reloading).toBe(true);
  const shot = await advanceTo(Math.ceil(start.ready * 64) / 64);
  expect(shot.ammo).toBe(1); expect(shot.reloading).toBe(false);
  expect(shot.lastShotAt).toBeCloseTo(start.ready, 6);
  await page.mouse.up();

  // Let the preceding pump/fire cooldown finish, then exercise an actual tap
  // after the new reload's attack lock. There must be no queued outro delay.
  await advanceTo(shot.time + 1);
  await page.keyboard.press('r');
  const ready = await page.evaluate(() => {
    const s = (window as any).shellEngine.sim; s.step(0); return s.reloadState.attackReadyAt;
  });
  const before = await advanceTo(ready + .01);
  expect(before.reloading).toBe(true); expect(before.ammo).toBe(1);
  await page.mouse.down(); await page.mouse.up();
  const tapped = await page.evaluate(() => {
    const e = (window as any).shellEngine, s = e.sim;
    e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
    return {ammo: s.loadedAmmo, reloading: s.reloadState.active, lastShotAt: s.lastShotAt};
  });
  expect(tapped.ammo).toBe(0); expect(tapped.reloading).toBe(false);
  expect(tapped.lastShotAt).toBeCloseTo(before.time, 7);
  expect(errors).toEqual([]);
});
