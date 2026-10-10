import {expect, test} from '@playwright/test';

for (const held of [false, true]) test(`Deagle browser reload uses current ${held ? 'held' : 'normal'} sound markers`, async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided',
    weapon: 'deagle', quality: 'performance', volume: .1, autoFullscreen: false, protectShortcuts: false, burst: 0})));
  await page.goto('/'); await expect(page.locator('canvas[data-range]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/range/engine.ts')!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).deagleEngine = this; return tick.call(this, time);};
  });
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await expect(enter).toBeEnabled(); await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).deagleEngine?.renderer.domElement);
  await page.waitForFunction(() => (window as any).deagleEngine?.audio.status === 'ready');
  const initial = await page.evaluate(() => {
    const e = (window as any).deagleEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.accumulator = 0; e.sim.yaw = Math.PI;
    const play = e.audio.playEvent; (window as any).deagleCues = [];
    e.audio.playEvent = function(key: string, ...args: unknown[]) {
      (window as any).deagleCues.push({source: e.audio.events[key]?.source, at: e.sim.time});
      return play.call(this, key, ...args);
    };
    return e.sim.time;
  });
  const advanceTo = async (at: number) => {
    const state = await page.evaluate(at => {
    const e = (window as any).deagleEngine, s = e.sim;
    while (s.time < at - 1e-10) s.step(Math.min(1 / 128, at - s.time));
    // Each sample must render even when consecutive protocol calls are closer
    // than the performance preset's 60 FPS frame interval.
    const frameAt = e.previous + 1000;
    e.tick(frameAt); cancelAnimationFrame(e.frame);
    return {at: s.time, startedAt: s.reloadState.startedAt, silent: s.reloadState.silent,
      rendered: e.previous === frameAt, work: s.reloadState.progress * s.reloadState.phaseDuration,
      ammo: s.loadedAmmo, cues: (window as any).deagleCues.filter((c: {source: string}) => c.source === 'Weapon_DEagle.Clipout')};
    }, at);
    expect(state.rendered).toBe(true);
    return state;
  };
  await page.mouse.down(); await page.mouse.up();
  await advanceTo(initial + .25); await page.keyboard.down('r');
  const started = await advanceTo(initial + .25);
  expect(started.ammo).toBe(6);
  if (!held) await page.keyboard.up('r');
  expect((await advanceTo(started.startedAt + .16)).cues).toEqual([]);
  const atCue = await advanceTo(started.startedAt + .34);
  if (held) {
    expect(atCue.silent).toBe(true); expect(atCue.cues).toEqual([]);
    expect((await advanceTo(started.startedAt + 3.1)).silent).toBe(true);
    const finishedSilence = await advanceTo(started.startedAt + 3.15);
    expect(finishedSilence.silent).toBe(false); expect(finishedSilence.cues).toEqual([]);
    await page.keyboard.up('r');
  } else {
    expect(atCue.cues, JSON.stringify(atCue)).toHaveLength(1);
    expect(atCue.cues[0].at - started.startedAt).toBeGreaterThanOrEqual(10 / 30);
    expect(atCue.cues[0].at - started.startedAt).toBeLessThan(.35);
  }
  expect(errors).toEqual([]);
});
