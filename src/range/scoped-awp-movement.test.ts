import {describe, expect, it, vi} from 'vitest';
import native from './native-scoped-command-fixture.json';
import halfNative from './native-scoped-awp-fixture.json';
import {advanceActor, idleInput, UNIT, type ActorKinematics} from './actor-physics';
import {defaults} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';
import {WeaponActions} from './weapon-actions';

describe('retained native scoped half-segment arithmetic', () => {
  for (const sample of halfNative.cases) it(sample.id, () => {
    const seed = sample.initial, crouch = sample.stance === 'crouch';
    let actor: ActorKinematics = {position: {x: 0, y: (crouch ? 46 : 64) * UNIT, z: 0},
      velocity: {x: seed.velocity[0] * UNIT, z: seed.velocity[1] * UNIT}, yaw: 0, feet: 0, verticalVelocity: 0,
      eyeHeight: (crouch ? 46 : 64) * UNIT, jumpHeld: false, grounded: true, movementTime: sample.origin,
      duckAmount: crouch ? 1 : 0, duckFlag: crouch, crouchHeld: crouch,
      friction: {command: 0, state: {active: seed.active, savedFraction: seed.savedFraction,
        storedSpeed: seed.storedSpeed, commandMarked: seed.commandMarked,
        previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}}};
    for (const row of sample.rows) {
      actor = advanceActor(actor, {...idleInput(), side: row.side, forward: row.forward,
        walk: sample.stance === 'walk', crouch, scopedSlow: true}, sample.weaponSpeed * UNIT, row.time - actor.movementTime!);
      expect(actor.velocity.x / UNIT).toBeCloseTo(row.velocity.x, 8);
      expect(actor.velocity.z / UNIT).toBeCloseTo(row.velocity.z, 8);
      expect(actor.position.x / UNIT).toBeCloseTo(row.position.x, 7);
      expect(actor.position.z / UNIT).toBeCloseTo(row.position.z, 7);
      expect(JSON.parse(JSON.stringify(actor.friction?.state))).toEqual(row.friction);
    }
  });
});

describe('native scoped AWP movement through real weapon callers', () => {
  it.each(['aug', 'sg553'] as const)('keeps the single-scope %s on its ordinary walking branch', weapon => {
    const actions = new WeaponActions(weapon); actions.secondary(0);
    expect(actions.zoom).toBe(1);
    expect(actions.stats.speed * .52).toBeLessThan(110);
    expect(actions.scopedSlowMovement).toBe(false);
  });
  for (const sample of native.cases) for (const engine of ['range', 'duel'] as const) {
    it(`${engine}: ${sample.id}`, () => {
      const seed = sample.initial;
      const initial = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: seed.velocity[0] * UNIT, z: seed.velocity[1] * UNIT},
        yaw: 0, pitch: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true,
        movementTime: sample.origin, velocityModifier: 1,
        duckAmount: sample.stance === 'crouch' ? 1 : 0, duckFlag: sample.stance === 'crouch', crouchHeld: sample.stance === 'crouch',
        friction: {command: 0, state: {active: seed.active, savedFraction: seed.savedFraction, storedSpeed: seed.storedSpeed,
          commandMarked: seed.commandMarked, previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}}};
      const range = engine === 'range' ? new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: false}) : undefined;
      const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
      const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp') : undefined;
      const sim = range ?? duel!, actor = range ?? duel!.actors[0];
      if (range) range.active = true;
      if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
      sim.time = sample.origin; Object.assign(actor, initial);
      const actions = range?.actions ?? duel!.actors[0].weapon.actions;
      actions.zoom = sample.zoomLevel;
      expect(actions.stats.speed).toBe(sample.weaponSpeed);
      for (const row of sample.rows) {
        const command = {...idleInput(), side: row.side, forward: row.forward,
          crouch: sample.stance === 'crouch', walk: sample.stance === 'walk'};
        if (range) range.input = command; else duel!.command(0, command);
        const dt = row.time - sim.time;
        sim.accumulator = dt;
        const frozen = JSON.stringify({position: actor.position, velocity: actor.velocity, friction: actor.friction, time: sim.time});
        const predicted = range ? range.renderPosition() : duel!.renderSnapshot()[0].position;
        expect(JSON.stringify({position: actor.position, velocity: actor.velocity, friction: actor.friction, time: sim.time})).toBe(frozen);
        expect(predicted.x / UNIT).toBeCloseTo(row.position.x, 7);
        expect(predicted.z / UNIT).toBeCloseTo(row.position.z, 7);
        sim.accumulator = 0;
        sim.step(dt / 2); sim.step(dt / 2);
        expect(actor.velocity.x / UNIT).toBeCloseTo(row.velocity.x, 8);
        expect(actor.velocity.z / UNIT).toBeCloseTo(row.velocity.z, 8);
        expect(actor.position.x / UNIT).toBeCloseTo(row.position.x, 7);
        expect(actor.position.z / UNIT).toBeCloseTo(row.position.z, 7);
        // JSON canonicalization treats signed zero as the native numeric zero.
        expect(JSON.parse(JSON.stringify(actor.friction?.state))).toEqual(row.friction);
      }
    });
  }
});

describe('scoped AWP shots consume the movement result', () => {
  for (const zoom of [1, 2]) for (const walk of [false, true]) for (const exact of [false, true]) {
    it(`keeps moving shots consistent between engines when zoom ${zoom} recovers (walk=${walk}, exact=${exact})`, () => {
      const results: {speed: number; ratio: number; position: number}[] = [];
      for (const engine of ['range', 'duel'] as const) {
        const range = engine === 'range' ? new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: true}) : undefined;
        const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
        const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp') : undefined;
        const sim = range ?? duel!, actor = range ?? duel!.actors[0];
        if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
        sim.time = 1;
        Object.assign(actor, {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
          feet: 0, grounded: true, verticalVelocity: 0, movementTime: 1, friction: undefined});
        const actions = range?.actions ?? duel!.actors[0].weapon.actions;
        actions.zoom = zoom;
        const shoot = () => {
          if (range) {range.pressTrigger(); range.release('mouse');}
          else {duel!.command(0, {fireHeld: true, firePressed: true}); duel!.step(0);
            duel!.command(0, {fireHeld: false, firePressed: false});}
        };
        shoot();
        expect(actions.pendingZoom).toBe(true);
        const deadline = actions.nextEventAt;
        const arrival = exact ? deadline : Math.ceil(deadline * 128) / 128;
        const command = {...idleInput(), side: 1, walk};
        if (range) range.input = command; else duel!.command(0, command);
        while (sim.time + 1 / 128 < deadline - 1e-10) sim.step(1 / 128);
        sim.step(arrival - sim.time);
        expect(actions.zoom).toBe(zoom);
        const speed = actor.velocity.x / UNIT, position = actor.position.x;
        const recovery = range?.recovery ?? duel!.actors[0].weapon.recovery;
        const observed = vi.spyOn(recovery, 'inaccuracy');
        const ammo = range?.loadedAmmo ?? duel!.actors[0].weapon.ammo;
        shoot();
        expect(observed).toHaveBeenCalledTimes(1);
        expect(range?.loadedAmmo ?? duel!.actors[0].weapon.ammo).toBe(ammo - 1);
        const ratio = observed.mock.calls[0][0];
        expect(speed).toBeGreaterThan(90);
        expect(ratio).toBeGreaterThan(.9);
        expect(actor.velocity.x / UNIT).toBe(speed);
        results.push({speed, ratio, position});
        observed.mockRestore();
      }
      expect(results[0]).toEqual(results[1]);
    });
  }

  for (const zoom of [1, 2]) for (const engine of ['range', 'duel'] as const) for (const after of [false, true]) {
    it(`${engine}: zoom ${zoom}, ${after ? 'above' : 'below'} the movement threshold`, () => {
      const sample = native.cases.find(c => c.id === `awp-zoom${zoom}-walk-start`)!;
      const boundary = sample.rows.findIndex(row => Math.hypot(row.velocity.x, row.velocity.z) > Math.fround(Math.fround(.34) * 100));
      expect(boundary).toBeGreaterThan(0);
      const last = boundary - (after ? 0 : 1);
      const range = engine === 'range' ? new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: true}) : undefined;
      const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
      const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp') : undefined;
      const sim = range ?? duel!, actor = range ?? duel!.actors[0];
      if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
      Object.assign(actor, {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
        feet: 0, grounded: true, verticalVelocity: 0, movementTime: 0, friction: undefined});
      (range?.actions ?? duel!.actors[0].weapon.actions).zoom = zoom;
      const command = {...idleInput(), walk: true, side: 1};
      if (range) range.input = command; else duel!.command(0, command);
      for (const row of sample.rows.slice(0, last + 1)) sim.step(row.time - sim.time);
      const expected = sample.rows[last].velocity;
      expect(actor.velocity.x / UNIT).toBeCloseTo(expected.x, 8);
      expect(actor.velocity.z / UNIT).toBeCloseTo(expected.z, 8);
      const recovery = range?.recovery ?? duel!.actors[0].weapon.recovery;
      const original = recovery.inaccuracy.bind(recovery);
      const observed: {ratio: number; penalty: number; cone: number}[] = [];
      const spy = vi.spyOn(recovery, 'inaccuracy').mockImplementation((...args) => {
        const cone = original(...args); observed.push({ratio: args[0], penalty: recovery.penalty, cone}); return cone;
      });
      const ammo = range?.loadedAmmo ?? duel!.actors[0].weapon.ammo;
      if (range) range.pressTrigger(); else {duel!.command(0, {fireHeld: true, firePressed: true}); duel!.step(0);}
      expect(observed).toHaveLength(1);
      expect(observed[0].ratio).toBeCloseTo(Math.hypot(expected.x, expected.z) / sample.weaponSpeed, 10);
      if (after) expect(observed[0].cone).toBeGreaterThan(observed[0].penalty);
      else expect(observed[0].cone).toBe(observed[0].penalty);
      expect(range?.loadedAmmo ?? duel!.actors[0].weapon.ammo).toBe(ammo - 1);
      spy.mockRestore();
    });
  }
});
