import {describe, expect, it} from 'vitest';
import {UNIT, type Vec} from '../actor-physics';
import {botzDistanceBands, botzDuelConfig, sanitizeBotzConfig, WorkshopSpawner, workshopPlayerSpawn, type BotzConfig} from './botz';
import {canFitInArena, traceSolid, type Arena} from './geometry';
import {DuelSimulation} from './simulation';
import {workshopArena, type WorkshopData} from './workshop';
import redline from './maps/aim_redline.json';

const EYE = 64 * UNIT, HULL = 72 * UNIT;
const arena: Arena = workshopArena('aim_redline', redline as unknown as WorkshopData);
const redlineSim = (patch: Partial<BotzConfig> = {}, seed = 3) => {
  const botz = sanitizeBotzConfig({...patch, map: 'redline'});
  return new DuelSimulation(botzDuelConfig(botz), seed, arena, 'ak47', 'usp', true, botz);
};
const sees = (from: Vec, to: Vec) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, arena, length - .05).distance);
};
const runFor = (sim: DuelSimulation, seconds: number) => {for (let elapsed = 0; elapsed < seconds; elapsed += .25) sim.advance(.25);};

describe('aim_redline', () => {
  it('loads as invisible collision for the warehouse, with both teams\' spawns standing on the floor or catwalk', () => {
    expect(arena.workshop).toMatchObject({name: 'aim_redline', credits: 'BOT Reed', model: '/maps/aim_redline.glb'});
    expect(arena.solids.length).toBeGreaterThan(1000);
    expect(arena.maxX - arena.minX).toBeGreaterThan(30); expect(arena.maxX - arena.minX).toBeLessThan(45);
    expect(arena.maxZ - arena.minZ).toBeGreaterThan(30); expect(arena.maxZ - arena.minZ).toBeLessThan(45);
    const spawns = arena.workshop!.spawns;
    expect(spawns.filter(spawn => spawn.team === 't')).toHaveLength(10);
    expect(spawns.filter(spawn => spawn.team === 'ct')).toHaveLength(10);
    for (const spawn of spawns) expect(spawn.y < .05 || Math.abs(spawn.y - 3.3) < .2).toBe(true);
    // Voxelised collision sits up to 10 cm proud of the real surfaces, so a spawn tucked against a crate can touch it.
    expect(spawns.filter(spawn => canFitInArena({x: spawn.x, y: spawn.y + EYE, z: spawn.z}, spawn.y, HULL, arena)).length).toBeGreaterThanOrEqual(18);
    // Player clips and fences stop movement but not bullets.
    expect(arena.solids.some(solid => solid.shotBlocking === false)).toBe(true);
    for (const [x, feet, z] of arena.workshop!.spots.slice(0, 400)) expect(canFitInArena({x, y: feet + EYE, z}, feet, HULL, arena)).toBe(true);
  });

  it('you start at the north end looking down the hall; bots stand on spots in front of you, apart and in view', () => {
    const spawn = workshopPlayerSpawn(arena.workshop!);
    expect(Math.hypot(spawn.x - 11, spawn.z + 28)).toBeLessThan(.5);
    expect(spawn.y).toBeLessThan(.05);
    for (const distance of ['near', 'mixed', 'far'] as const) {
      const sim = redlineSim({botCount: 10, distance}), player = sim.actors[0], [near, far] = botzDistanceBands[distance];
      expect(player.position).toEqual({x: spawn.x, y: spawn.y + EYE, z: spawn.z});
      expect(player.yaw).toBe(spawn.yaw);
      // Facing down the hall, toward the catwalk at its south end.
      const facing = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
      expect(facing.z).toBeCloseTo(1, 6);
      for (const bot of sim.actors.slice(1)) {
        expect(arena.workshop!.spots.some(([x, feet, z]) => x === bot.position.x && feet === bot.feet && z === bot.position.z)).toBe(true);
        const range = Math.hypot(bot.position.x - spawn.x, bot.position.z - spawn.z);
        expect(range).toBeGreaterThanOrEqual(near); expect(range).toBeLessThanOrEqual(far);
        expect(sees(player.position, {x: bot.position.x, y: bot.feet + EYE, z: bot.position.z})).toBe(true);
        for (const other of sim.actors.slice(1)) if (other !== bot && Math.abs(other.feet - bot.feet) < .4)
          expect(Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z)).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it('bots on crates and the catwalk stay up there, and walls stop you', () => {
    const sim = redlineSim({botCount: 16, distance: 'far'}, 5);
    const raised = sim.actors.slice(1).filter(bot => bot.feet > .4).map(bot => ({id: bot.id, feet: bot.feet}));
    expect(raised.length).toBeGreaterThan(0);
    sim.start(); runFor(sim, 1);
    for (const {id, feet} of raised) expect(sim.actors[id].feet).toBeCloseTo(feet, 2);
    // Run sideways into the wall to your left for 6 s: you stop inside the hall.
    sim.command(0, {side: -1});
    runFor(sim, 6);
    const player = sim.actors[0];
    expect(player.alive).toBe(true);
    expect(canFitInArena(player.position, player.feet, HULL, arena)).toBe(true);
    expect(player.position.x).toBeGreaterThan(arena.minX); expect(player.position.x).toBeLessThan(arena.maxX);
    expect(player.position.z).toBeGreaterThan(arena.minZ); expect(player.position.z).toBeLessThan(arena.maxZ);
  });

  it('never spawns a bot behind a fence, glass or a player clip, such as the storage under the catwalk', () => {
    const sight: Arena = {...arena, solids: arena.solids.map(solid => solid.shotBlocking === false ? {...solid, shotBlocking: true} : solid)};
    for (const distance of ['near', 'mixed', 'far'] as const) {
      const config = sanitizeBotzConfig({map: 'redline', distance}), spawner = new WorkshopSpawner(config, arena, 9, workshopPlayerSpawn(arena.workshop!));
      const eye = {x: workshopPlayerSpawn(arena.workshop!).x, y: EYE, z: workshopPlayerSpawn(arena.workshop!).z};
      for (let n = 0; n < 150; n++) {
        const spot = spawner.next([], undefined, eye), head = {x: spot.x, y: spot.feet + EYE, z: spot.z};
        const dx = head.x - eye.x, dy = head.y - eye.y, dz = head.z - eye.z, length = Math.hypot(dx, dy, dz);
        expect(Number.isFinite(traceSolid(eye, {x: dx / length, y: dy / length, z: dz / length}, sight, length - .05).distance), `${distance} ${spot.x},${spot.z}`).toBe(false);
      }
    }
  });

  it('16 strafing bots simulate well inside real time', () => {
    const sim = redlineSim({botCount: 16, movement: 'strafe', distance: 'mixed', elevated: false});
    sim.start(); runFor(sim, 1);
    const started = performance.now();
    runFor(sim, 10);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(sim.phase).toBe('fighting');
  });
});
