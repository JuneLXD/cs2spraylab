import {expect, test} from '@playwright/test';
import native from '../src/range/native-ground-command-fixture.json' with {type: 'json'};

const reference = native.cases.find(c => c.id === 'm4a4-stand-0-axis')!;

test('M4 keyboard release and mouse shot use the native stopping accuracy boundary', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'spray',
    weapon: 'm4a4', quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/');
  await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).stoppingEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).stoppingEngine?.renderer.domElement);
  await page.evaluate(() => {
    const e = (window as any).stoppingEngine, s = e.sim;
    cancelAnimationFrame(e.frame); e.inputClock.advance = () => {};
    s.time = s.movementTime = 1; s.accumulator = 0; s.yaw = 0;
    s.velocity = {x: 0, z: 0}; s.friction = undefined;
  });
  await page.keyboard.down('d');
  const moving = await page.evaluate(() => {
    const s = (window as any).stoppingEngine.sim;
    const origin = s.position.x;
    s.step(1 / 128); s.step(1 / 128);
    const first = {speed: s.velocity.x / .0254, distance: (s.position.x - origin) / .0254};
    for (let i = 2; i < 128; i++) s.step(1 / 128);
    return {side: s.input.side, speed: Math.hypot(s.velocity.x, s.velocity.z) / .0254, first};
  });
  expect(moving.side).toBe(1); expect(moving.speed).toBeCloseTo(225, 3);
  expect(moving.first.speed).toBeCloseTo(reference.rows[0][3], 7);
  expect(moving.first.distance).toBeCloseTo(reference.rows[0][5], 7);
  await page.keyboard.up('d');
  const boundary = await page.evaluate(() => {
    const s = (window as any).stoppingEngine.sim;
    const accuracy = () => {
      const ratio = Math.hypot(s.velocity.x, s.velocity.z) / (s.stats.speed * .0254);
      return {ratio, penalty: s.recovery.penalty, cone: s.recovery.inaccuracy(ratio, false, false)};
    };
    for (let i = 0; i < 25; i++) s.step(1 / 128);
    const before = accuracy(); s.step(1 / 128); const after = accuracy();
    const original = s.recovery.inaccuracy.bind(s.recovery);
    (window as any).stoppingShots = [];
    s.recovery.inaccuracy = (...args: any[]) => {
      const cone = original(...args);
      (window as any).stoppingShots.push({ratio: args[0], penalty: s.recovery.penalty, cone});
      return cone;
    };
    return {before, after, side: s.input.side, ammo: s.loadedAmmo, time: s.time};
  });
  expect(boundary.side).toBe(0);
  expect(boundary.before.cone).toBeGreaterThan(boundary.before.penalty);
  expect(boundary.after.cone).toBe(boundary.after.penalty);
  // A real DOM mouse bind fires at the frozen simulated time. This checks
  // input-to-simulation integration, not physical mouse-to-photon latency.
  await page.mouse.click(720, 500);
  const shot = await page.evaluate(() => {
    const s = (window as any).stoppingEngine.sim;
    return {ammo: s.loadedAmmo, at: s.lastShotAt, calls: (window as any).stoppingShots};
  });
  expect(shot.ammo).toBe(boundary.ammo - 1); expect(shot.at).toBe(boundary.time);
  expect(shot.calls).toHaveLength(1);
  expect(shot.calls[0].ratio).toBe(boundary.after.ratio);
  expect(shot.calls[0].cone).toBe(shot.calls[0].penalty);
  const stoppedAt = await page.evaluate(() => {
    const s = (window as any).stoppingEngine.sim;
    for (let half = 27; half <= 64; half++) {
      s.step(1 / 128);
      if (half % 2 === 0 && Math.hypot(s.velocity.x, s.velocity.z) === 0) return half / 128;
    }
    return null;
  });
  expect(stoppedAt).toBe(reference.rows.find(row => row[0] > 1 && row[3] === 0 && row[4] === 0)![0] - 1);
  expect(errors).toEqual([]);
});
