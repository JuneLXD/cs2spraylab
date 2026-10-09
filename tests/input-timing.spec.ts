import {expect, test} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

for (const mode of ['duel', 'guided'] as const) {
  test(`${mode}: input responds between rendered frames without future simulation debt`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium', 'Chrome event-delivery regression');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'ak47', quality: 'performance',
        autoFullscreen: false, frameLimit: 0, volume: 0, sensitivity: 1, dpi: 800, resolution: '1920x1440', protectShortcuts: false}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
      window.addEventListener('pointerdown', event => {
        const probe = (window as any).responseProbe;
        if (probe && event.button === 0 && !probe.inputAt) {
          probe.inputAt = performance.now(); probe.eventTimestamp = event.timeStamp;
          // One real rAF after this real DOM input; no synthetic frame clock.
          requestAnimationFrame(time => {
            const e = (window as any).timingEngine;
            e.tick(time); cancelAnimationFrame(e.frame);
          });
        }
      }, {capture: true});
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
    const enter = page.getByRole('button', {name: mode === 'duel' ? 'Enter duel' : 'Enter range', exact: true});
    await expect(enter).toBeEnabled(); await enter.click();
    await page.waitForFunction(() => document.pointerLockElement === (window as any).timingEngine.renderer.domElement);
    await expect(enter).toBeHidden();
    await page.evaluate(mode => {
      const e = (window as any).timingEngine;
      cancelAnimationFrame(e.frame);
      if (mode === 'duel') {
        e.sim.actors[1].weapon.ammo = e.sim.actors[1].weapon.reserve = 0;
        e.sim.actors[0].yaw = Math.PI;
      } else e.sim.yaw = Math.PI;
      const probe = (window as any).responseProbe = {renderer: e.renderer.getContext().getParameter(e.renderer.getContext().RENDERER)};
      if (mode === 'duel') {
        const weapon = e.sim.actors[0].weapon, advance = weapon.advance;
        weapon.advance = function(...args: any[]) {
          const shot = advance.apply(this, args);
          if (shot && probe.inputAt && !probe.effectAt) {probe.effectAt = performance.now(); probe.effectSimTime = e.sim.time;}
          return shot;
        };
      } else {
        const shot = e.sim.onShot;
        e.sim.onShot = (event: any) => {
          if (probe.inputAt && !probe.effectAt) {probe.effectAt = performance.now(); probe.effectSimTime = e.sim.time;}
          shot(event);
        };
      }
      const render = e.renderer.render;
      e.renderer.render = function(scene: any, camera: any) {
        if (scene === e.scene && probe.effectAt && !probe.renderAt) {
          probe.renderAt = performance.now(); probe.cameraPitch = camera.rotation.x;
          const result = render.call(this, scene, camera);
          probe.submittedAt = performance.now(); return result;
        }
        return render.call(this, scene, camera);
      };
      e.inputClock.reset(performance.now());
      e.renderer.domElement.focus();
    }, mode);
    await page.mouse.down(); await page.mouse.up();
    const fired = await page.evaluate(mode => {
      const e = (window as any).timingEngine;
      return {ammo: mode === 'duel' ? e.sim.actors[0].weapon.ammo : e.sim.loadedAmmo,
        time: e.sim.time, accumulator: e.sim.accumulator};
    }, mode);
    expect(fired.ammo).toBe(29);
    expect(fired.accumulator).toBeGreaterThanOrEqual(0);
    await page.waitForFunction(() => (window as any).responseProbe.submittedAt > 0);
    const response = await page.evaluate(() => {
      const p = (window as any).responseProbe;
      return {inputToEffectMs: p.effectAt - p.inputAt, inputToRenderStartMs: p.renderAt - p.inputAt,
        inputToRenderSubmittedMs: p.submittedAt - p.inputAt, eventDispatchMs: p.inputAt - p.eventTimestamp,
        cameraPitch: p.cameraPitch, renderer: p.renderer};
    });
    expect(response.inputToEffectMs).toBeGreaterThanOrEqual(0);
    expect(response.inputToRenderStartMs).toBeGreaterThanOrEqual(response.inputToEffectMs);
    expect(response.cameraPitch).toBeGreaterThan(0);
    // CPU event/render submission timings only: compositor/display latency is outside this harness.
    const dir = resolve('../native-audit/reports/feel-response');
    await mkdir(dir, {recursive: true});
    await writeFile(resolve(dir, `${mode}.json`), JSON.stringify(response, null, 2) + '\n');
    await info.attach(`${mode}-response`, {body: JSON.stringify(response), contentType: 'application/json'});
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
