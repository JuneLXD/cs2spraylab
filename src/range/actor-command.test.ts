import {describe, expect, it} from 'vitest';
import native from './native-ground-command-fixture.json';
import {advanceActor, idleInput, resetActorMovementHistory, UNIT, type ActorKinematics} from './actor-physics';
import {advanceActorCommand} from './actor-command';
import {defaults, type Weapon} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';

const seed = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
  feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true, movementTime: 0});
const right = {...idleInput(), side: 1};

describe('native ground command timing', () => {
  for (const sample of native.cases) for (const engine of ['actor', 'range', 'duel'] as const) {
    it(`${engine}: ${sample.id} matches native startup, release, restart and reversal at 128 Hz`, () => {
      const range = engine === 'range' ? new Simulation({...defaults, weapon: sample.weapon as Weapon, mode: 'spray'}) : undefined;
      const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
      const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, sample.weapon as Weapon) : undefined;
      if (range) range.active = true;
      if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
      let actor = range ?? duel?.actors[0] ?? seed();
      const crouch = sample.stance === 'crouch';
      Object.assign(actor, seed(), {duckAmount: crouch ? 1 : 0, duckFlag: crouch, crouchHeld: crouch,
        eyeHeight: (crouch ? 46 : 64) * UNIT, position: {x: 0, y: (crouch ? 46 : 64) * UNIT, z: 0}});
      const sim = range ?? duel;
      for (const [time, side, forward, vx, vz, x, z] of sample.rows) {
        const input = {...idleInput(), side, forward, crouch, walk: sample.stance === 'walk'};
        if (range) range.input = input; else if (duel) duel.command(0, input);
        for (let part = 0; part < 2; part++) {
          if (sim) sim.step(1 / 128);
          else actor = advanceActorCommand(actor, input, sample.speed * UNIT, 1 / 128);
        }
        expect(actor.movementTime).toBeCloseTo(time, 10);
        expect(actor.velocity.x / UNIT).toBeCloseTo(vx, 8);
        expect(actor.velocity.z / UNIT).toBeCloseTo(vz, 8);
        expect(actor.position.x / UNIT).toBeCloseTo(x, 7);
        expect(actor.position.z / UNIT).toBeCloseTo(z, 7);
      }
    });
  }

  it('preserves native endpoints with uneven frame partitions and read-only previews', () => {
    let whole = seed(), divided = seed();
    for (let command = 0; command < 128; command++) {
      const input = command < 64 ? right : idleInput();
      whole = advanceActor(whole, input, 215 * UNIT, 1 / 64);
      for (const dt of [1 / 1024, 3 / 1024, 5 / 1024, 7 / 1024]) {
        const frozen = JSON.stringify(divided);
        advanceActorCommand(divided, input, 215 * UNIT, dt / 2);
        expect(JSON.stringify(divided)).toBe(frozen);
        divided = advanceActorCommand(divided, input, 215 * UNIT, dt);
      }
      expect(divided.velocity).toEqual(whole.velocity);
      expect(divided.position).toEqual(whole.position);
      expect(divided.groundCommand).toBeUndefined();
    }
  });

  it.each([1 / 256, 1 / 128, 3 / 256])('closes a segment at a real key edge at %s seconds', edge => {
    const origin = {...seed(), velocity: {x: 215 * UNIT, z: 0}};
    const reverse = {...right, side: -1};
    const expected = advanceActor(advanceActor(origin, right, 215 * UNIT, edge), reverse, 215 * UNIT, 1 / 64 - edge);
    let divided = advanceActorCommand(origin, right, 215 * UNIT, edge / 2);
    divided = advanceActorCommand(divided, right, 215 * UNIT, edge / 2);
    divided = advanceActorCommand(divided, reverse, 215 * UNIT, 1 / 64 - edge);
    expect(divided.velocity).toEqual(expected.velocity);
    expect(divided.position).toEqual(expected.position);
  });

  it('samples a changed scope cap at the next segment and never advances on step(0)', () => {
    const origin = {...seed(), velocity: {x: 200 * UNIT, z: 0}};
    const half = advanceActorCommand(origin, right, 200 * UNIT, 1 / 128);
    const zero = advanceActorCommand(half, {...right, scopedSlow: true}, 100 * UNIT, 0);
    expect(zero).toEqual(half);
    const end = advanceActorCommand(zero, {...right, scopedSlow: true}, 100 * UNIT, 1 / 128);
    expect(end.velocity).toEqual(advanceActor(origin, right, 200 * UNIT, 1 / 64).velocity);
    const scoped = advanceActorCommand(end, {...right, scopedSlow: true}, 100 * UNIT, 1 / 64);
    expect(scoped.velocity).toEqual(advanceActor(end, {...right, scopedSlow: true}, 100 * UNIT, 1 / 64).velocity);
    expect(scoped.velocity.x).toBeGreaterThan(0);
  });

  it('discards a pending checkpoint after reset, teleport or external velocity changes', () => {
    const half = advanceActorCommand(seed(), right, 215 * UNIT, 1 / 128);
    const reset = resetActorMovementHistory(half);
    expect(reset.groundCommand).toBeUndefined();
    for (const patch of [{position: {...half.position, x: 10}}, {velocity: {x: 0, z: 0}}, {velocityModifier: .5}]) {
      const changed = {...half, ...patch};
      const next = advanceActorCommand(changed, right, 215 * UNIT, 1 / 128);
      const expected = advanceActor({...changed, groundCommand: undefined}, right, 215 * UNIT, 1 / 128);
      expect(next.position).toEqual(expected.position);
      expect(next.velocity).toEqual(expected.velocity);
    }
  });

  it('retains callback collisions and bounds saved state without retaining parent objects', () => {
    const actor = {...seed(), parentBookkeeping: {secret: true}};
    const next = advanceActorCommand(actor, right, 215 * UNIT, 1 / 128,
      (from, desired) => ({...desired, x: from.x}));
    expect(next.position.x).toBe(0);
    expect(JSON.stringify(next)).not.toContain('parentBookkeeping');
    expect(next.groundCommand?.origin).not.toHaveProperty('groundCommand');
    expect(next.groundCommand?.published).not.toHaveProperty('groundCommand');
    expect(advanceActorCommand(seed(), right, 215 * UNIT, 60).groundCommand).toBeUndefined();
  });

  it('does not replay earlier travel against a newly moved obstacle', () => {
    const world = {solids: [], selfId: 0, actors: [{id: 1, position: {x: 5, y: 64 * UNIT, z: 0}, feet: 0}]};
    const half = advanceActorCommand(seed(), right, 215 * UNIT, 1 / 128, undefined, undefined, undefined, world);
    world.actors[0].position.x = .83;
    const next = advanceActorCommand(half, right, 215 * UNIT, 1 / 128, undefined, undefined, undefined, world);
    const expected = advanceActor({...half, groundCommand: undefined}, right, 215 * UNIT, 1 / 128,
      undefined, undefined, undefined, world);
    expect(next.position).toEqual(expected.position);
    expect(next.velocity).toEqual(expected.velocity);
  });

  it('retains only boundary coordinates when the environment bounds are a whole arena', () => {
    const bounds = {...testArena(), unrelatedLargeMapData: 'unused-map-data'.repeat(10000)};
    const next = advanceActorCommand(seed(), right, 215 * UNIT, 1 / 128, undefined, undefined, undefined,
      {solids: [], bounds});
    expect(next.groundCommand?.contacts.length).toBeLessThan(100);
    expect(JSON.stringify(next)).not.toContain('unused-map-data');
  });

  it('clears the checkpoint at a jump or crouch edge and retains the contact solver', () => {
    const half = advanceActorCommand(seed(), right, 215 * UNIT, 1 / 128);
    for (const input of [{...right, jump: true, jumpPressed: true}, {...right, crouch: true}]) {
      const next = advanceActorCommand(half, input, 215 * UNIT, 1 / 128);
      const finalized = advanceActor(seed(), right, 215 * UNIT, 1 / 128);
      const expected = advanceActor(finalized, input, 215 * UNIT, 1 / 128);
      expect(next.groundCommand).toBeUndefined();
      expect(next.position).toEqual(expected.position);
      expect(next.velocity).toEqual(expected.velocity);
      expect(next.verticalVelocity).toBe(expected.verticalVelocity);
    }
  });
});
