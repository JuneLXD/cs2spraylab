import {expect, test} from '@playwright/test';

for (const mode of ['duel', 'guided'] as const) {
  test(`${mode}: native scope camera, quickscope input and automatic rescope stay synchronized`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'awp', quality: 'performance',
        frameLimit: 0, volume: 0, sensitivity: 1, dpi: 800, resolution: '1920x1440', protectShortcuts: false}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
    }, mode);
    await page.goto('/');
    const canvas = page.locator(mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]');
    await expect(canvas).toBeVisible();
    await page.evaluate(async mode => {
      const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)!.name;
      const module = await import(/* @vite-ignore */ url);
      const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = prototype.tick;
      prototype.tick = function(time: number) {(window as any).scopeEngine = this; return tick.call(this, time);};
    }, mode);
    await page.waitForFunction(mode => {
      const e = (window as any).scopeEngine;
      return e && (mode === 'duel' ? e.motionReady && e.worldLoading.size === 0 && e.viewRoot.children.length
        : e.loadedTarget && e.modelCache.has('awp'));
    }, mode);
    await page.evaluate(mode => {
      const e = (window as any).scopeEngine;
      cancelAnimationFrame(e.frame);
      // Drive simulation time explicitly so software WebGL cannot turn this
      // into a frame-rate benchmark. Buttons still use the real DOM bind path.
      e.inputClock.advance = () => {};
      if (mode === 'duel') {
        e.sim.start(); e.paused = false;
        e.sim.actors[1].weapon.ammo = 0; e.sim.actors[1].weapon.reserve = 0;
        e.sim.actors[0].yaw = Math.PI; e.report();
      } else {e.sim.active = true; e.sim.yaw = Math.PI;}
      e.renderer.domElement.focus();
    }, mode);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {button: 'right'});
    const mid = await page.evaluate(mode => {
      const e = (window as any).scopeEngine;
      e.sim.advance(.025); e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
      return {fov: e.camera.fov, scope: !e.scope.element.hidden};
    }, mode);
    const vertical = 2 * Math.atan(Math.tan(65 * Math.PI / 360) / (4 / 3)) * 180 / Math.PI;
    expect(mid.fov).toBeCloseTo(vertical, 5); expect(mid.scope).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const shot = await page.evaluate(mode => {
      const e = (window as any).scopeEngine, weapon = mode === 'duel' ? e.sim.actors[0].weapon : null;
      return {ammo: weapon ? weapon.ammo : e.sim.loadedAmmo, pending: (weapon ? weapon.actions : e.sim.actions).pendingZoom};
    }, mode);
    expect(shot).toEqual({ammo: 4, pending: true});
    const resumed = await page.evaluate(mode => {
      const e = (window as any).scopeEngine;
      let left = 1.455 + .05;
      while (left > 1e-9) {const dt = Math.min(.25, left); e.sim.advance(dt); left -= dt;}
      e.tick(performance.now() + 2000); cancelAnimationFrame(e.frame);
      return {fov: e.camera.fov, scope: !e.scope.element.hidden};
    }, mode);
    expect(resumed.fov).toBeCloseTo(vertical, 5); expect(resumed.scope).toBe(true);
    expect(errors).toEqual([]);
  });
}
