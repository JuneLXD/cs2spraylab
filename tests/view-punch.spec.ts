import {expect, test} from '@playwright/test';

for (const mode of ['duel', 'guided'] as const) {
  test(`${mode}: native camera kick responds on the first rendered frame and decays between ticks`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'ak47', quality: 'performance',
        autoFullscreen: false, follow: true, frameLimit: 0, volume: 0, sensitivity: 1, dpi: 800, resolution: '1920x1440', protectShortcuts: false}));
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
      prototype.tick = function(time: number) {(window as any).punchEngine = this; return tick.call(this, time);};
    }, mode);
    await page.waitForFunction(mode => {
      const e = (window as any).punchEngine;
      return e && (mode === 'duel' ? e.motionReady && e.worldLoading.size === 0 && e.viewRoot.children.length
        : e.loadedTarget && e.modelCache.has('ak47'));
    }, mode);
    const enter = page.getByRole('button', {name: mode === 'duel' ? 'Enter duel' : 'Enter range', exact: true});
    await expect(enter).toBeEnabled(); await enter.click();
    await page.waitForFunction(() => document.pointerLockElement === (window as any).punchEngine.renderer.domElement);
    await expect(enter).toBeHidden();
    await page.evaluate(mode => {
      const e = (window as any).punchEngine;
      cancelAnimationFrame(e.frame);
      // Drive simulation time explicitly so software WebGL cannot turn this
      // into a frame-rate benchmark. Buttons still use the real DOM bind path.
      e.inputClock.advance = () => {};
      e.sim.accumulator = 0;
      if (mode === 'duel') {
        e.sim.actors[1].weapon.ammo = 0; e.sim.actors[1].weapon.reserve = 0;
        const actor = e.sim.actors[0];
        actor.yaw = Math.PI; actor.pitch = 0;
        actor.command.yawDelta = actor.command.pitchDelta = 0;
        e.report();
      } else {e.sim.yaw = Math.PI; e.sim.pitch = 0;}
      e.renderer.domElement.focus();
    }, mode);
    // Pointer lock is already active: moving to coordinates would also turn aim.
    await page.mouse.down(); await page.mouse.up();
    const sample = async (elapsed: number) => page.evaluate(async ({mode, elapsed}) => {
      const e = (window as any).punchEngine;
      const path = '/src/range/crosshair-follow.ts';
      const {followCrosshairDirection, followCrosshairOffset} = await import(/* @vite-ignore */ path);
      e.sim.advance(elapsed); e.tick(performance.now() + 1000); cancelAnimationFrame(e.frame);
      const actor = mode === 'duel' ? e.sim.actors[0] : e.sim;
      const recovery = mode === 'duel' ? actor.weapon.recovery : actor.recovery;
      const recoil = recovery.predict(e.sim.accumulator), degrees = 180 / Math.PI;
      const expectedTransform = (shown: any) => {
        const point = e.camera.position.clone().copy(followCrosshairDirection(actor.yaw, actor.pitch, shown))
          .multiplyScalar(10).add(e.camera.position).project(e.camera);
        const offset = followCrosshairOffset(point, e.width, e.height);
        return `translate(${offset.x}px, ${offset.y}px)`;
      };
      return {kickPitch: (e.camera.rotation.x - actor.pitch) * degrees - recoil.pitch * .45,
        kickYaw: (actor.yaw - e.camera.rotation.y) * degrees - recoil.yaw * .45,
        crosshair: e.crosshair.style.transform, expectedCrosshair: expectedTransform(recoil), staleCrosshair: expectedTransform(recovery.recoil),
        pitch: actor.pitch, yaw: actor.yaw,
        ammo: mode === 'duel' ? actor.weapon.ammo : actor.loadedAmmo};
    }, {mode, elapsed});
    const first = await sample(0);
    // First native AK impulse: 0.055 times its recoil magnitude, before trig.
    expect(first.kickPitch).toBeCloseTo(1.0993632078, 6);
    expect(first.kickYaw).toBeCloseTo(.5681607127, 6);
    expect(first.pitch).toBe(0); expect(first.yaw).toBe(Math.PI); expect(first.ammo).toBe(29);
    expect(first.crosshair).toBe(first.expectedCrosshair);
    for (const elapsed of [.004, .046]) {
      const current = await sample(elapsed), age = elapsed === .004 ? .004 : .05;
      expect(current.kickPitch).toBeCloseTo(first.kickPitch * Math.exp(-18 * age), 6);
      expect(current.kickYaw).toBeCloseTo(first.kickYaw * Math.exp(-18 * age), 6);
      expect(current.pitch).toBe(0); expect(current.yaw).toBe(Math.PI); expect(current.ammo).toBe(29);
      expect(current.crosshair).toBe(current.expectedCrosshair);
      if (elapsed === .004) expect(current.crosshair).not.toBe(current.staleCrosshair);
    }
    const landing = await page.evaluate(mode => {
      const e = (window as any).punchEngine, sim = e.sim;
      for (let i = 0; i < 8; i++) sim.advance(.25);
      const actor = mode === 'duel' ? sim.actors[0] : sim;
      actor.feet = .015; actor.position.y = .015 + 64 * .0254;
      actor.verticalVelocity = -302 * .0254; actor.grounded = false;
      sim.advance(1 / 128); e.tick(performance.now() + 2000); cancelAnimationFrame(e.frame);
      const recovery = mode === 'duel' ? actor.weapon.recovery : actor.recovery;
      const recoil = recovery.predict(sim.accumulator);
      return {pitch: actor.pitch, kick: (e.camera.rotation.x - actor.pitch) * 180 / Math.PI - recoil.pitch * .45,
        age: sim.time + sim.accumulator - actor.landedAt, grounded: actor.grounded};
    }, mode);
    expect(landing.grounded).toBe(true); expect(landing.pitch).toBe(0);
    expect(landing.kick).toBeCloseTo(-.75 * Math.exp(-18 * landing.age), 6);
    if (mode === 'duel') {
      const damage = await page.evaluate(async () => {
        const e = (window as any).punchEngine, actor = e.sim.actors[0];
        const path = '/src/range/crosshair-follow.ts';
        const {followCrosshairDirection, followCrosshairOffset} = await import(/* @vite-ignore */ path);
        actor.viewPunch.reset(); actor.weapon.recovery.advance(3);
        actor.punch.angle = {pitch: 3, yaw: -1, roll: 2};
        e.sim.accumulator = 0;
        e.tick(performance.now() + 3000); cancelAnimationFrame(e.frame);
        const point = e.camera.position.clone().copy(followCrosshairDirection(actor.yaw, actor.pitch, actor.weapon.recovery.predict(0)))
          .multiplyScalar(10).add(e.camera.position).project(e.camera);
        const offset = followCrosshairOffset(point, e.width, e.height);
        return {pitch: (e.camera.rotation.x - actor.pitch) * 180 / Math.PI,
          yaw: (actor.yaw - e.camera.rotation.y) * 180 / Math.PI,
          roll: e.camera.rotation.z * 180 / Math.PI, shot: actor.punch.shot,
          crosshair: e.crosshair.style.transform, expectedCrosshair: `translate(${offset.x}px, ${offset.y}px)`};
      });
      expect(damage.pitch).toBeCloseTo(2.7, 7); expect(damage.yaw).toBeCloseTo(-.9, 7);
      expect(damage.roll).toBeCloseTo(1.8, 7);
      expect(damage.shot).toEqual({pitch: 6, yaw: -2, roll: 4});
      expect(damage.crosshair).toBe(damage.expectedCrosshair);
    }
    expect(errors).toEqual([]);
  });
}
