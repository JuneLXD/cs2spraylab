import {expect, test} from '@playwright/test';

for (const mode of ['guided', 'duel'] as const) {
  test(`${mode}: delayed model attachment preserves the ordinary AK draw rate`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium'); test.setTimeout(180000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'ak47', quality: 'performance',
        autoFullscreen: false, volume: 0, frameLimit: 0, protectShortcuts: false}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
    }, mode);
    await page.goto('/');
    await expect(page.locator(mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]')).toBeVisible();
    await page.evaluate(async mode => {
      const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)!.name;
      const module = await import(/* @vite-ignore */ url);
      const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = prototype.tick;
      prototype.tick = function(time: number) {(window as any).drawEngine = this; return tick.call(this, time);};
    }, mode);
    await page.waitForFunction(mode => {
      const e = (window as any).drawEngine;
      return e && (mode === 'duel' ? e.motionReady && e.worldLoading.size === 0 && e.viewRoot.children.length
        : e.loadedTarget && e.modelCache.has('ak47'));
    }, mode);
    const result = await page.evaluate(async mode => {
      const e = (window as any).drawEngine;
      cancelAnimationFrame(e.frame); e.inputClock.advance = () => {}; e.pacer.ready = () => true;
      e.sim.time = 10; e.sim.accumulator = 0;
      if (mode === 'guided') {
        e.sim.active = true; e.sim.equip(2);
        const prepare = e.setWeapon.bind(e);
        e.setWeapon = async (id: string) => {await prepare(id); e.sim.time = 10.25;};
        await e.equip(1); e.setWeapon = prepare;
      } else {
        e.paused = false; e.sim.phase = 'fighting'; e.sim.actors[0].equipReadyAt = 11;
        e.sim.actors[1].weapon.ammo = e.sim.actors[1].weapon.reserve = 0;
        const prepare = e.viewModel.bind(e);
        e.viewModel = async (id: string) => {const model = await prepare(id); e.sim.time = 10.25; return model;};
        e.pickupDrawing = false; await e.loadViewModel('ak47'); e.viewModel = prepare;
        e.viewAnimationElapsed = 0;
      }
      const animation = mode === 'duel' ? e.viewAnimation : e.viewAnimations.get('ak47');
      const actor = mode === 'duel' ? e.sim.actors[0] : e.sim;
      const readyAt = actor.equipReadyAt, attachedAt = e.sim.time;
      const scene = (mode === 'duel' ? e.viewRoot : e.weaponRoot).children[0];
      const hand = scene.getObjectByName('hand_L');
      const handPose = () => {
        scene.updateMatrixWorld(true);
        return hand.getWorldPosition(hand.position.clone()).toArray();
      };
      const initialPose = handPose();
      let timestamp = performance.now();
      if (mode === 'duel') e.last = timestamp; else e.previous = timestamp;
      const samples: any[] = [];
      for (let i = 0; i < 6; i++) {
        timestamp += 125; e.sim.time += .125;
        e.tick(timestamp); cancelAnimationFrame(e.frame);
        samples.push({action: animation.activeAction, clipTime: animation.actions.get('draw').time,
          pose: handPose(), readyAt: actor.equipReadyAt,
          ammo: mode === 'duel' ? actor.weapon.ammo : actor.loadedAmmo});
      }
      return {attachedAt, readyAt, initialPose, samples};
    }, mode);
    expect(result.attachedAt).toBe(10.25); expect(result.readyAt).toBe(11);
    for (let i = 0; i < 5; i++) {
      expect(result.samples[i].action).toBe('draw');
      expect(result.samples[i].clipTime).toBeCloseTo((i + 1) * .125, 7);
    }
    expect(result.samples[0].pose).not.toEqual(result.initialPose);
    expect(result.samples[5].action).toBe('idle');
    expect(result.samples.every(sample => sample.readyAt === 11 && sample.ammo === 30)).toBe(true);
    expect(errors).toEqual([]);
  });
}
