import {expect, test} from '@playwright/test';

test('Glock mouse input fires immediately after switching and retries held secondary after burst recovery', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'glock', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).glockEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).glockEngine?.renderer.domElement);
  const initial = await page.evaluate(() => {
    const e = (window as any).glockEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.accumulator = 0; e.sim.yaw = Math.PI;
    return {at: e.sim.time, equipped: e.sim.equipped, ammo: e.sim.loadedAmmo};
  });
  expect(initial).toMatchObject({equipped: 'glock', ammo: 20});
  const snapshot = () => page.evaluate(() => {
    const s = (window as any).glockEngine.sim;
    return {ammo: s.loadedAmmo, burst: s.actions.burst, secondaryReadyAt: s.actions.secondaryReadyAt,
      readyAt: s.actions.readyAt, lastShotAt: s.lastShotAt};
  });
  const advanceTo = async (at: number) => {
    await page.evaluate(at => {
      const e = (window as any).glockEngine, s = e.sim;
      while (s.time < at - 1e-10) s.step(Math.min(1 / 128, at - s.time));
      e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
    }, at);
    return snapshot();
  };
  await page.mouse.click(0, 0, {button: 'right'});
  await page.mouse.down(); await page.mouse.up();
  const immediate = await snapshot();
  expect(immediate).toMatchObject({ammo: 19, burst: true, readyAt: 0});
  expect(immediate.lastShotAt).toBeCloseTo(initial.at, 7);
  await advanceTo(initial.at + 1 / 32); await page.mouse.down({button: 'right'});
  const complete = await advanceTo(initial.at + .125);
  expect(complete).toMatchObject({ammo: 17, burst: true});
  expect(complete.secondaryReadyAt).toBeCloseTo(initial.at + .8, 7);
  expect((await advanceTo(initial.at + .799)).burst).toBe(true);
  expect((await advanceTo(initial.at + .8)).burst).toBe(false);
  await page.mouse.up({button: 'right'});
  expect(errors).toEqual([]);
});
