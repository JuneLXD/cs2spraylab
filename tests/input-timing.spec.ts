import {expect, test} from '@playwright/test';

for (const mode of ['duel', 'guided'] as const) {
  test(`${mode}: input responds between rendered frames without future simulation debt`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium', 'Chrome event-delivery regression');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'ak47', quality: 'performance',
        frameLimit: 30, volume: 0, sensitivity: 1, dpi: 800, resolution: '1920x1440', protectShortcuts: false}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
    }, mode);
    await page.goto('/');
    const selector = mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]';
    await expect(page.locator(selector)).toBeVisible();
    await page.evaluate(async mode => {
      const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)!.name;
      const module = await import(/* @vite-ignore */ url);
      const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = prototype.tick;
      prototype.tick = function(time: number) {(window as any).timingEngine = this; return tick.call(this, time);};
    }, mode);
    await page.waitForFunction(mode => {
      const e = (window as any).timingEngine;
      return e && (mode === 'duel' ? e.motionReady && e.worldLoading.size === 0 && e.viewRoot.children.length
        : e.loadedTarget && e.modelCache.has('ak47'));
    }, mode);
    await page.evaluate(mode => {
      const e = (window as any).timingEngine;
      cancelAnimationFrame(e.frame);
      if (mode === 'duel') {
        e.sim.start(); e.paused = false; e.sim.command(1, {});
        e.sim.actors[0].yaw = Math.PI;
        e.report();
      } else {e.sim.active = true; e.sim.yaw = Math.PI;}
      e.inputClock.reset(performance.now());
      e.renderer.domElement.focus();
    }, mode);
    if (mode === 'duel') await expect(page.getByRole('button', {name: 'Enter duel', exact: true})).toBeHidden();
    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const fired = await page.evaluate(mode => {
      const e = (window as any).timingEngine;
      return {ammo: mode === 'duel' ? e.sim.actors[0].weapon.ammo : e.sim.loadedAmmo,
        time: e.sim.time, accumulator: e.sim.accumulator};
    }, mode);
    expect(fired.ammo).toBe(29);
    expect(fired.accumulator).toBeGreaterThanOrEqual(0);
    const before = await page.evaluate(mode => {
      const e = (window as any).timingEngine;
      return (mode === 'duel' ? e.sim.actors[0] : e.sim).position.z;
    }, mode);
    await page.keyboard.down('w');
    await page.waitForTimeout(25);
    await page.keyboard.up('w');
    const after = await page.evaluate(mode => {
      const e = (window as any).timingEngine, actor = mode === 'duel' ? e.sim.actors[0] : e.sim;
      return {z: actor.position.z, forward: mode === 'duel' ? actor.command.forward : actor.input.forward,
        ammo: mode === 'duel' ? actor.weapon.ammo : e.sim.loadedAmmo};
    }, mode);
    expect(after.z).toBeGreaterThan(before);
    expect(after.forward).toBe(0); expect(after.ammo).toBe(29);
    expect(errors).toEqual([]);
  });
}
