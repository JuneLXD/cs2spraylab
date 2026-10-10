import {expect, test} from '@playwright/test';
import native from '../src/range/native-scoped-command-fixture.json' with {type: 'json'};

const start = native.cases.find(c => c.zoomLevel === 1 && c.stance === 'walk' &&
  c.initial.velocity.every(v => v === 0) && c.rows[0].side === 1 && c.rows[0].forward === 0)!;

for (const mode of ['guided', 'duel'] as const) {
  test(`${mode}: first AWP scope and real walk keys use native walking acceleration`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'awp', quality: 'performance',
        frameLimit: 0, volume: 0, autoFullscreen: false, protectShortcuts: false, burst: 0}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
    }, mode);
    await page.goto('/');
    await expect(page.locator(mode === 'duel' ? 'canvas[data-duel]' : 'canvas[data-range]')).toBeVisible();
    await page.evaluate(async mode => {
      const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)!.name;
      const module = await import(/* @vite-ignore */ url);
      const prototype = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = prototype.tick;
      prototype.tick = function(time: number) {(window as any).scopedMovementEngine = this; return tick.call(this, time);};
    }, mode);
    const enter = page.getByRole('button', {name: mode === 'duel' ? 'Enter duel' : 'Enter range', exact: true});
    await expect(enter).toBeEnabled(); await enter.click();
    await page.waitForFunction(() => document.pointerLockElement === (window as any).scopedMovementEngine?.renderer.domElement);
    await page.evaluate(mode => {
      const e = (window as any).scopedMovementEngine, s = e.sim;
      cancelAnimationFrame(e.frame); e.inputClock.advance = () => {}; s.accumulator = 0; s.time = 1;
      const actor = mode === 'duel' ? s.actors[0] : s;
      Object.assign(actor, {yaw: 0, velocity: {x: 0, z: 0}, movementTime: 1, friction: undefined,
        grounded: true, verticalVelocity: 0, duckAmount: 0, duckFlag: false, crouchHeld: false});
      if (mode === 'duel') s.actors[1].weapon.ammo = s.actors[1].weapon.reserve = 0;
    }, mode);
    // Keep the cardinal-axis fixture: click(x,y) would also move a locked pointer.
    await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'});
    await page.keyboard.down('Shift'); await page.keyboard.down('d');
    const moved = await page.evaluate(({mode, dt}) => {
      const e = (window as any).scopedMovementEngine, s = e.sim, actor = mode === 'duel' ? s.actors[0] : s;
      const actions = mode === 'duel' ? actor.weapon.actions : s.actions;
      const input = mode === 'duel' ? actor.command : s.input;
      const before = {...actor.position};
      s.accumulator = dt;
      const prediction = mode === 'duel' ? s.renderSnapshot()[0].position : s.renderPosition();
      s.accumulator = 0;
      if (mode === 'duel') s.step(dt, true); else s.step(dt);
      return {zoom: actions.zoom, speed: actions.stats.speed, walk: input.walk, side: input.side, yaw: actor.yaw,
        velocity: {x: actor.velocity.x / .0254, z: actor.velocity.z / .0254},
        displacement: {x: (actor.position.x - before.x) / .0254, z: (actor.position.z - before.z) / .0254},
        predictedDisplacement: {x: (prediction.x - before.x) / .0254, z: (prediction.z - before.z) / .0254}};
    }, {mode, dt: start.rows[0].time - start.origin});
    expect(moved).toMatchObject({zoom: 1, speed: 100, walk: true, side: 1, yaw: 0});
    expect(moved.velocity.x).toBeCloseTo(start.rows[0].velocity.x, 7);
    expect(moved.velocity.z).toBeCloseTo(start.rows[0].velocity.z, 7);
    expect(moved.displacement.x).toBeCloseTo(start.rows[0].position.x, 6);
    expect(moved.displacement.z).toBeCloseTo(start.rows[0].position.z, 6);
    expect(moved.predictedDisplacement.x).toBeCloseTo(start.rows[0].position.x, 6);
    expect(moved.predictedDisplacement.z).toBeCloseTo(start.rows[0].position.z, 6);
    await page.keyboard.up('d'); await page.keyboard.up('Shift');
    expect(errors).toEqual([]);
  });
}
