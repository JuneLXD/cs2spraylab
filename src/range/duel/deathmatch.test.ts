import {describe, expect, it} from 'vitest';
import {UNIT, type Vec} from '../actor-physics';
import {sanitizeDuelConfig, type DuelConfig} from './config';
import {traceSolid, type Arena} from './geometry';
import {routeTo} from './navigation';
import {DuelSimulation} from './simulation';
import {TeamSpawner} from './team-spawns';
import {DuelWeaponState} from './weapon-state';
import {workshopArena, type WorkshopData} from './workshop';
import redline from './maps/aim_redline.json';

const EYE = 64 * UNIT;
const arena: Arena = workshopArena('aim_redline', redline as unknown as WorkshopData);
const spawns = arena.workshop!.spawns;
const tSide = (point: Vec) => point.x < 8, ctSide = (point: Vec) => point.x > 15;
const deathmatch = (patch: Partial<DuelConfig> = {}, seed = 5) => {
  const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 3, respawnSeconds: 2, skill: 3, ...patch}), seed, arena, 'ak47', 'usp', true);
  sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
  return sim;
};
const sees = (from: Vec, to: Vec) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, arena, length - .05).distance);
};
/** Stand a bot on a floor spot the player can see, 5-12 m away, so a test shot is deterministic. */
const expose = (sim: DuelSimulation, id: number) => {
  const eye = sim.actors[0].position;
  const spot = arena.workshop!.spots.find(([x, feet, z]) => feet < .05 &&
    Math.hypot(x - eye.x, z - eye.z) > 5 && Math.hypot(x - eye.x, z - eye.z) < 12 && sees(eye, {x, y: feet + EYE, z}));
  if (!spot) throw new Error('No visible floor spot near the spawn');
  Object.assign(sim.actors[id], {position: {x: spot[0], y: spot[1] + EYE, z: spot[2]}, feet: spot[1], grounded: true});
};
const aimAt = (sim: DuelSimulation, id: number, height = 1.62) => {
  const eye = sim.actors[0].position, bot = sim.actors[id];
  const dx = bot.position.x - eye.x, dy = bot.feet + height - eye.y, dz = bot.position.z - eye.z;
  sim.actors[0].yaw = Math.atan2(-dx, -dz);
  sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
};
const fire = (sim: DuelSimulation) => {sim.command(0, {firePressed: true}); sim.step(); sim.command(0, {fireHeld: false});};
const runFor = (sim: DuelSimulation, seconds: number) => {for (let elapsed = 0; elapsed < seconds; elapsed += .25) sim.advance(.25);};

describe('deathmatch on aim_redline', () => {
  it('needs an imported map and a respawn delay; otherwise AI Duel keeps its rounds', () => {
    expect(deathmatch().deathmatch).toBe(true);
    expect(new DuelSimulation(sanitizeDuelConfig({respawnSeconds: 0}), 1, arena).deathmatch).toBe(false);
    expect(sanitizeDuelConfig({respawnSeconds: 99}).respawnSeconds).toBe(10);
    expect(sanitizeDuelConfig({respawnSeconds: 2.3}).respawnSeconds).toBe(2.5);
    expect(sanitizeDuelConfig({}).respawnSeconds).toBe(0);
  });

  it('starts you on the T side and the bots on CT spawns the player cannot see, with their configured loadout and skill', () => {
    const sim = deathmatch({botCount: 4, weapons: ['m4a4'], health: 80, armor: true, helmet: false});
    const player = sim.actors[0];
    expect(tSide(player.position)).toBe(true); expect(player.feet).toBeLessThan(.5);
    expect(spawns.some(spawn => spawn.team === 't' && Math.hypot(spawn.x - player.position.x, spawn.z - player.position.z) < .01)).toBe(true);
    expect(sim.actors).toHaveLength(5);
    for (const bot of sim.actors.slice(1)) {
      expect(ctSide(bot.position)).toBe(true);
      expect(spawns.some(spawn => spawn.team === 'ct' && Math.hypot(spawn.x - bot.position.x, spawn.z - bot.position.z) < .01)).toBe(true);
      expect(bot).toMatchObject({alive: true, health: 80, armor: 100, helmet: false, generation: 1});
      expect(bot.weapon.id).toBe('m4a4');
      expect(sees(player.position, {x: bot.position.x, y: bot.feet + EYE, z: bot.position.z})).toBe(false);
    }
    const positions = sim.actors.slice(1).map(bot => bot.position);
    for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++)
      expect(Math.hypot(positions[a].x - positions[b].x, positions[a].z - positions[b].z)).toBeGreaterThan(1);
  });

  it('a kill never ends the session: the bot comes back on its own side after the delay with a new life', () => {
    const sim = deathmatch({botCount: 1, respawnSeconds: 2});
    sim.start();
    expose(sim, 1); aimAt(sim, 1);
    fire(sim);
    const events = sim.drainEvents();
    expect(events.find(event => event.kind === 'hit')).toMatchObject({victim: 1, group: 'head', lethal: true});
    expect(events.some(event => event.kind === 'round')).toBe(false);
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.phase).toBe('fighting');
    expect(sim.deathmatchStats).toEqual({kills: 1, deaths: 0});
    runFor(sim, 1.5);
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.respawnIn(1)).toBeGreaterThan(0);
    expect(sim.phase).toBe('fighting');
    runFor(sim, 1);
    const bot = sim.actors[1];
    expect(bot).toMatchObject({alive: true, health: 100, armor: 100, helmet: true, generation: 2});
    expect(ctSide(bot.position)).toBe(true);
    expect(sim.respawnIn(1)).toBe(0);
    expect(sim.drainEvents().some(event => event.kind === 'round')).toBe(false);
    // No weapon is left behind: everyone comes back with their own loadout.
    expect(sim.drops).toHaveLength(0);
  });

  it('a dead player respawns on the T side with the original loadout, full health and armor, counting the death', () => {
    const sim = deathmatch({botCount: 2, respawnSeconds: 1.5, playerHealth: 100});
    sim.start();
    runFor(sim, .5);
    const player = sim.actors[0];
    player.alive = false; player.health = 0;
    sim.step();
    expect(sim.phase).toBe('fighting');
    expect(sim.respawnIn(0)).toBeGreaterThan(1.4);
    runFor(sim, 1);
    expect(sim.actors[0].alive).toBe(false);
    runFor(sim, .75);
    const reborn = sim.actors[0];
    expect(reborn).not.toBe(player);
    expect(reborn).toMatchObject({alive: true, health: 100, armor: 100, helmet: true, generation: 2, side: 'player'});
    expect(reborn.weapon.id).toBe('ak47'); expect(reborn.weapon.ammo).toBe(30);
    expect(tSide(reborn.position)).toBe(true);
    expect(reborn.equipReadyAt).toBeGreaterThan(sim.time - .25);
    expect(sim.loadout).toEqual({primary: 'ak47', sidearm: 'usp'});
    expect(sim.drainEvents().some(event => event.kind === 'round')).toBe(false);
  });

  it('bots route around the warehouse collision instead of walking into walls', () => {
    const spawner = new TeamSpawner(arena, 1);
    const from = spawner.first('t'), to = spawner.first('ct');
    const path = routeTo({x: from.x, y: from.y, z: from.z}, {x: to.x, y: to.y, z: to.z}, arena, undefined, {lenient: true});
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(.01);
    // Every floor spawn of either team can start a route to the other side.
    for (const spawn of spawns.filter(point => point.y < .5)) {
      const target = spawn.team === 't' ? to : from;
      expect(routeTo({x: spawn.x, y: spawn.y, z: spawn.z}, {x: target.x, y: target.y, z: target.z}, arena, undefined, {lenient: true}).length, `${spawn.team} spawn ${spawn.x.toFixed(1)},${spawn.z.toFixed(1)}`).toBeGreaterThan(0);
    }
    const sim = deathmatch({botCount: 3});
    sim.start();
    const start = sim.actors.slice(1).map(bot => ({...bot.position}));
    runFor(sim, 8);
    const moved = sim.actors.slice(1).map((bot, index) => Math.hypot(bot.position.x - start[index].x, bot.position.z - start[index].z));
    expect(Math.max(...moved)).toBeGreaterThan(4);
    for (const bot of sim.actors.slice(1)) {
      expect(bot.position.x).toBeGreaterThan(arena.minX); expect(bot.position.x).toBeLessThan(arena.maxX);
      expect(bot.position.z).toBeGreaterThan(arena.minZ); expect(bot.position.z).toBeLessThan(arena.maxZ);
      expect(bot.alive).toBe(true);
    }
  });

  it('keeps five routing bots and respawns within the imported-map CPU budget', () => {
    const sim = deathmatch({botCount: 5, respawnSeconds: 1});
    sim.start();
    const started = performance.now();
    runFor(sim, 10);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(sim.phase).toBe('fighting');
  });
});
