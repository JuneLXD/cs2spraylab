import {expect, test} from '@playwright/test';

test('AWP keyboard reload rejects an early tap and retries a held key after the shot cycle', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'awp', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).reloadEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).reloadEngine?.renderer.domElement);
  const initial = await page.evaluate(() => {
    const e = (window as any).reloadEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.accumulator = 0; e.sim.yaw = Math.PI;
    return {at: e.sim.time, cycle: e.sim.stats.cycle};
  });
  const advanceTo = async (at: number) => page.evaluate(at => {
    const e = (window as any).reloadEngine, s = e.sim;
    while (s.time < at - 1e-10) s.step(Math.min(1 / 128, at - s.time));
    e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
    return {ammo: s.loadedAmmo, active: s.reloadState.active, startedAt: s.reloadState.startedAt, lastShotAt: s.lastShotAt};
  }, at);
  await page.mouse.down(); await page.mouse.up();
  await advanceTo(initial.at + 1 / 32); await page.keyboard.press('r');
  const tapped = await advanceTo(initial.at + .5);
  expect(tapped).toMatchObject({ammo: 4, active: false});
  expect(tapped.lastShotAt).toBeCloseTo(initial.at, 7);
  await page.keyboard.down('r');
  expect((await advanceTo(initial.at + initial.cycle - .001)).active).toBe(false);
  const held = await advanceTo(initial.at + initial.cycle);
  expect(held).toMatchObject({ammo: 4, active: true});
  expect(held.startedAt).toBeCloseTo(initial.at + initial.cycle, 7);
  await page.keyboard.up('r');
  expect(errors).toEqual([]);
});
