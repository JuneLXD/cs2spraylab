import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {defaults, gameData} from '../config';
import {InputClock} from '../input-clock';
import {Simulation, mouseAngle} from '../simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';
import type {ActorCommand} from './types';

function combat() {
  const sim = new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42, testArena());
  sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
  sim.command(1, {}); sim.start();
  return sim;
}
function input(sim: DuelSimulation, patch: Partial<ActorCommand>) {
  sim.flushInput(); sim.command(0, patch); sim.processInput();
}

describe('event-time input and local presentation', () => {
  it('fires between ticks at the click angle and does not include a later flick', () => {
    const sim = combat();
    sim.advance(.002);
    input(sim, {yawDelta: .3, firePressed: true});
    const fire = sim.drainEvents().find(event => event.kind === 'fire');
    expect(fire).toMatchObject({kind: 'fire', tick: 0, at: .002});
    sim.command(0, {yawDelta: -.6});
    expect(fire?.kind === 'fire' && Math.atan2(-fire.direction.x, -fire.direction.z)).toBeCloseTo(.3, 10);
    expect(sim.renderSnapshot()[0].yaw).toBeCloseTo(-.3);
    expect(sim.time).toBe(.002); expect(sim.accumulator).toBe(0);
  });

  it('retains movement presses shorter than a physics tick', () => {
    const sim = combat();
    sim.advance(.001); input(sim, {side: 1});
    sim.advance(.002);
    const predicted = sim.renderSnapshot()[0].position.x;
    expect(predicted).toBeGreaterThan(0);
    input(sim, {side: 0});
    expect(sim.actors[0].position.x).toBeCloseTo(predicted, 12);
    expect(sim.actors[0].command.side).toBe(0);
    expect(sim.tick).toBe(0);
    sim.advance(STEP - .003);
    expect(sim.tick).toBe(1); expect(sim.time).toBeCloseTo(STEP, 12);
  });

  it.each([60, 144, 240, 360, 500])('replays the same input consistently with %s Hz render reads', hz => {
    const run = (refresh: number) => {
      const sim = combat(), clock = new InputClock(); clock.reset(1000);
      const events: {ms: number; patch?: Partial<ActorCommand>}[] = [
        {ms: 1.1, patch: {side: 1}}, {ms: 91.7, patch: {side: -1}},
        {ms: 123.4, patch: {firePressed: true}}, {ms: 131.2, patch: {crouch: true}},
        {ms: 180.1, patch: {side: 0}}, {ms: 230.9, patch: {crouch: false}},
      ];
      for (let frame = 1; frame / refresh < .3; frame++) events.push({ms: frame * 1000 / refresh});
      events.sort((a, b) => a.ms - b.ms);
      for (const event of events) {
        clock.advance(1000 + event.ms, dt => sim.advance(dt));
        if (event.patch) input(sim, event.patch);
        else sim.renderSnapshot();
      }
      clock.advance(1300, dt => sim.advance(dt)); sim.flushInput();
      return {actor: sim.snapshot()[0], events: sim.drainEvents()};
    };
    const expected = run(128), actual = run(hz);
    expect(actual.actor.position.x).toBeCloseTo(expected.actor.position.x, 10);
    expect(actual.actor.position.y).toBeCloseTo(expected.actor.position.y, 10);
    expect(actual.actor.velocity.x).toBeCloseTo(expected.actor.velocity.x, 10);
    expect(actual.actor.ammo).toBe(expected.actor.ammo);
    expect(actual.events.map(event => event.kind)).toEqual(expected.events.map(event => event.kind));
  });

  it('predicts local movement against terrain without modifying combat', () => {
    const sim = combat(), actor = sim.actors[0];
    sim.arena.solids.push({center: {x: .55, y: 1, z: actor.position.z}, size: {x: .2, y: 3, z: 3}});
    actor.velocity.x = 250 * UNIT;
    input(sim, {side: 1}); sim.advance(STEP / 2);
    const before = sim.snapshot(), events = sim.drainEvents();
    const shown = sim.renderSnapshot()[0];
    expect(shown.position.x).toBeGreaterThan(actor.position.x);
    expect(shown.position.x).toBeLessThanOrEqual(.55 - .1 - 16 * UNIT);
    for (let i = 0; i < 10; i++) sim.renderSnapshot();
    expect(sim.snapshot()).toEqual(before); expect(sim.drainEvents()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('matches shots to the last displayed target pose while applying live armor and damage', () => {
    const sim = combat(); sim.present(sim.renderSnapshot());
    sim.actors[1].position.x = 1;
    sim.actors[1].armor = 0;
    input(sim, {firePressed: true});
    expect(sim.drainEvents()).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'hit', victim: 1, group: 'head'})]));
    expect(sim.actors[1].health).toBeGreaterThan(356);
    expect(sim.actors[1].health).toBeLessThanOrEqual(360); // whole-point damage: exactly 40 at this range
    expect(sim.actors[1].armor).toBe(0);
  });

  it('does not damage a respawn through its previous displayed life', () => {
    const sim = combat(); sim.present(sim.renderSnapshot());
    sim.actors[1].generation++;
    input(sim, {firePressed: true});
    expect(sim.actors[1].health).toBe(500);
    expect(sim.drainEvents().some(event => event.kind === 'hit')).toBe(false);
  });

  it.each(['current', 'respawn', 'cover'] as const)('uses displayed capsules with %s life and cover state', scenario => {
    const sim = combat(), shown = sim.renderSnapshot(), enemy = shown[1];
    const point = {x: 0, y: sim.actors[0].position.y, z: enemy.position.z};
    enemy.hitboxes = [{start: point, end: {...point}, radius: .12, group: 'arm', index: 13}];
    sim.present(shown); sim.actors[1].position.x = 3; sim.actors[1].armor = 0;
    if (scenario === 'respawn') sim.actors[1].generation++;
    if (scenario === 'cover') sim.arena.solids.push({center: {x: 0, y: 1.5, z: 0}, size: {x: 3, y: 3, z: 2}, material: 'concrete'});
    input(sim, {firePressed: true});
    const hits = sim.drainEvents().filter(event => event.kind === 'hit');
    if (scenario === 'current') {
      expect(hits).toEqual([expect.objectContaining({victim: 1, group: 'arm', armorDamage: 0})]);
      expect(sim.actors[1].health).toBeGreaterThan(460); expect(sim.actors[1].health).toBeLessThan(470);
    } else {expect(hits).toEqual([]); expect(sim.actors[1].health).toBe(500);}
  });

  it('keeps current cover authoritative for a displayed target', () => {
    const sim = combat(); sim.present(sim.renderSnapshot());
    sim.arena.solids.push({center: {x: 0, y: 1.5, z: 0}, size: {x: 3, y: 3, z: 2}, material: 'concrete'});
    input(sim, {firePressed: true});
    expect(sim.actors[1].health).toBe(500);
  });

  it('samples full-auto shots at weapon-cycle deadlines rather than rounding to ticks', () => {
    const sim = combat(); sim.actors[0].yaw = Math.PI;
    sim.advance(.0013); input(sim, {firePressed: true, fireHeld: true});
    sim.advance(.249); sim.advance(.249);
    const shots = sim.drainEvents().filter(event => event.kind === 'fire' && event.actorId === 0);
    expect(shots.length).toBeGreaterThan(4);
    shots.forEach((shot, index) => expect(shot.at).toBeCloseTo(.0013 + index * gameData.weapons.ak47.cycle, 10));
    expect(sim.actors[0].weapon.ammo).toBe(30 - shots.length);
  });

  it('does not advance the world at the mouse polling rate', () => {
    const sim = combat(); sim.actors[0].yaw = Math.PI;
    for (let event = 0; event < 8000; event++) {sim.advance(1 / 8000); sim.command(0, {yawDelta: .00001});}
    expect(sim.tick).toBe(128); expect(sim.time).toBeCloseTo(1, 10);
    expect(sim.renderSnapshot()[0].yaw).toBeCloseTo(Math.PI + .08, 10);
  });

  it('preserves the user\'s 800 DPI / sensitivity 1 / zoom 1 / 4:3 mapping', () => {
    expect(defaults).toMatchObject({dpi: 800, sensitivity: 1, resolution: '1920x1440'});
    expect(defaults.keyboard.zoomSensitivity).toBe(1);
    // 800 counts per inch, 0.022 degrees per count: approximately 51.95 cm/360.
    expect(mouseAngle(800 * (360 / (.022 * 800)), 1)).toBeCloseTo(Math.PI * 2, 12);
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'ak47'}); range.active = true;
    range.advance(.0031); range.flushInput(); range.start();
    expect(range.lastShotAt).toBeCloseTo(.0031, 12);
  });
});
