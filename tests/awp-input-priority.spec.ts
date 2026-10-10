import {expect, test} from '@playwright/test';

for (const mode of ['guided', 'duel'] as const) {
  test(`${mode}: held AWP primary blocks repeat zoom until release`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'awp', quality: 'performance',
        frameLimit: 0, volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0,
        keyboard: {zoomRepeat: true}}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
    }, mode);
    await page.goto('/');
    await expect(page.locator(mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]')).toBeVisible();
    await page.evaluate(async mode => {
      const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)!.name;
      const module = await import(/* @vite-ignore */ url);
      const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = prototype.tick;
      prototype.tick = function(time: number) {(window as any).priorityEngine = this; return tick.call(this, time);};
    }, mode);
    const enter = page.getByRole('button', {name: mode === 'duel' ? 'Enter duel' : 'Enter range', exact: true});
    await expect(enter).toBeEnabled(); await enter.click();
    await page.waitForFunction(() => document.pointerLockElement === (window as any).priorityEngine?.renderer.domElement);
    const first = await page.evaluate(mode => {
      const e = (window as any).priorityEngine; cancelAnimationFrame(e.frame);
      // Exact simulation/frame fixtures; the buttons still traverse actual DOM binds.
      e.inputClock.advance = () => {}; e.sim.accumulator = 0;
      if (mode === 'duel') {
        e.sim.actors[0].yaw = Math.PI;
        e.sim.actors[1].weapon.ammo = e.sim.actors[1].weapon.reserve = 0;
      } else e.sim.yaw = Math.PI;
      return Math.ceil(e.sim.time) + 1;
    }, mode);
    const advanceTo = (at: number) => page.evaluate(({mode, at}) => {
      const e = (window as any).priorityEngine, s = e.sim;
      while (s.time < at - 1e-10) {
        const dt = Math.min(s.untilEvent(), at - s.time);
        if (mode === 'duel') s.step(dt, true); else s.step(dt);
      }
      const clock = mode === 'duel' ? 'last' : 'previous', frameAt = e[clock] + 1000;
      e.tick(frameAt); cancelAnimationFrame(e.frame);
      if (e[clock] !== frameAt) throw Error('Expected rendered frame was skipped');
      // Duel queues repeatZoom for the next simulation update; flush at this time.
      if (mode === 'duel') s.processInput();
      const w = mode === 'duel' ? s.actors[0].weapon : s;
      return {zoom: w.actions.zoom, pending: w.actions.pendingZoom,
        ammo: mode === 'duel' ? w.ammo : s.loadedAmmo,
        primaryHeld: e.binds.isHeld('attack'), secondaryHeld: e.binds.isHeld('attack2'),
        repeat: (mode === 'duel' ? e.settings : s.settings).keyboard.zoomRepeat};
    }, {mode, at});
    await advanceTo(first - .5); await page.mouse.click(0, 0, {button: 'right'});
    expect((await advanceTo(first)).zoom).toBe(1);
    await page.mouse.down();
    await advanceTo(first + .03); await page.mouse.down({button: 'right'});
    const held = await advanceTo(first + 1.455 + .02);
    expect(held).toEqual({zoom: 1, pending: false, ammo: 4, primaryHeld: true, secondaryHeld: true, repeat: true});
    await page.mouse.up();
    const released = await advanceTo(first + 1.455 + .02);
    expect(released).toEqual({zoom: 2, pending: false, ammo: 4, primaryHeld: false, secondaryHeld: true, repeat: true});
    await page.mouse.up({button: 'right'});
    expect(errors).toEqual([]);
  });
}
