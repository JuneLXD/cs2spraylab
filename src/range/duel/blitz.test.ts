import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {blitzDuelConfig, blitzLevel, blitzSummary, chooseSwingers, nextArena, sanitizeBlitzConfig, smartStep, swingSchedule,
  type BlitzArena, type BlitzArenaSet} from './blitz';
import {traceSolid, type Arena} from './geometry';
import {DuelSimulation, freeSpawnPose} from './simulation';
import {workshopArena, type WorkshopData} from './workshop';
import ancient from './maps/de_ancient.json';
import ancientArenas from './maps/de_ancient.blitz.json';

const EYE = 64 * UNIT;
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const arenaSet = ancientArenas as unknown as BlitzArenaSet;
let cachedArena: Arena | undefined;
const map = () => cachedArena ??= workshopArena('de_ancient', ancient as unknown as WorkshopData);
const sees = (arena: Arena, from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, arena, length - .05).distance);
};

describe('Blitz setup', () => {
  it('bounds every option, maps Refrag\'s difficulties and presets, and derives the duel config', () => {
    const d = sanitizeBlitzConfig({});
    expect(d).toMatchObject({map: 'de_ancient', swingers: 5, difficulty: 'normal', skill: 6, smart: false, preset: 'default', noPrimary: false,
      reactionMs: 0, repeekReactionMs: 0, aimOffset: 1, headshotOnly: false, order: 'random', arena: 0, repeat: 0, autoskip: true,
      firstSwingSeconds: 1, swingGapMin: .35, swingGapMax: 1.1, roundSeconds: 45});
    expect(sanitizeBlitzConfig({swingers: 9, difficulty: 'nope', skill: 13, preset: 'knife', reactionMs: 5000, aimOffset: 9, repeat: 99, roundSeconds: 1, swingGapMin: 2, swingGapMax: 1}))
      .toMatchObject({swingers: 5, difficulty: 'normal', skill: 6, preset: 'default', reactionMs: 1500, aimOffset: 1.5, repeat: 20, roundSeconds: 15, swingGapMin: 2, swingGapMax: 2});
    expect(sanitizeBlitzConfig({repeat: -5, reactionMs: 123, repeekReactionMs: 44, arena: 3.6, smart: true, autoskip: false, order: 'sequence'}))
      .toMatchObject({repeat: -1, reactionMs: 120, repeekReactionMs: 40, arena: 4, smart: true, autoskip: false, order: 'sequence'});
    expect(blitzLevel(sanitizeBlitzConfig({difficulty: 'easy'}))).toBe(3);
    expect(blitzLevel(sanitizeBlitzConfig({difficulty: 'hard'}))).toBe(9);
    expect(blitzLevel(sanitizeBlitzConfig({difficulty: 'custom', skill: '10+'}))).toBe('10+');
    expect(blitzLevel(sanitizeBlitzConfig({difficulty: 'hard', smart: true}), 4)).toBe(4);
    expect(smartStep(6, 'won', false)).toBe(7); expect(smartStep(6, 'won', true)).toBe(6); expect(smartStep(6, 'lost', true)).toBe(5);
    expect(smartStep(10, 'won', false)).toBe('10+'); expect(smartStep('10+', 'lost', true)).toBe(10); expect(smartStep(1, 'lost', true)).toBe(1);
    const full = blitzDuelConfig(sanitizeBlitzConfig({swingers: 3, difficulty: 'hard', aimOffset: .8, roundSeconds: 60}));
    expect(full).toMatchObject({botCount: 3, skill: 9, weapons: ['ak47', 'm4a4', 'm4a1s'], armor: true, helmet: true, accuracy: .8, behavior: 'holder',
      roundSeconds: 60, respawnSeconds: 0, radarEnabled: false, spawnImmunitySeconds: 0});
    expect(blitzDuelConfig(sanitizeBlitzConfig({preset: 'awp', noPrimary: true}))).toMatchObject({weapons: ['glock', 'usp'], armor: false, helmet: false});
    expect(blitzDuelConfig(sanitizeBlitzConfig({preset: 'force'}))).toMatchObject({weapons: ['galil', 'famas', 'mac10', 'mp9', 'deagle'], armor: true, helmet: false});
    expect(blitzSummary(sanitizeBlitzConfig({swingers: 4, difficulty: 'easy', preset: 'awp', headshotOnly: true, repeat: -1})))
      .toBe('4 swingers · easy · AWP · headshots only · random arenas · repeat forever · Ancient');
    expect(blitzSummary(sanitizeBlitzConfig({smart: true, noPrimary: true, order: 'sequence', repeat: 2})))
      .toBe('5 swingers · smart · Pistol round · no primary · arenas in order · repeat ×2 · Ancient');
  });

  it('spreads the chosen swingers around the clock, staggers their swings and follows the arena rules', () => {
    const arena: BlitzArena = {id: 'a', name: 'A', side: 't', player: {x: 0, y: 0, z: 0, yaw: 0}, sectors: 12,
      swingers: [0, 20, 40, 60, 180, 200, 220, 300].map(bearing => ({bearing, distance: 10, hold: {x: 0, y: 0, z: 0}, peek: {x: 1, y: 0, z: 0}}))};
    const chosen = chooseSwingers(arena, 4, lcg(3)).map(s => s.bearing).sort((a, b) => a - b);
    expect(chosen).toHaveLength(4);
    const gaps = chosen.map((b, i) => (chosen[(i + 1) % 4] - b + 360) % 360);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40);
    expect(chooseSwingers(arena, 20, lcg(3))).toHaveLength(8);
    const config = sanitizeBlitzConfig({firstSwingSeconds: 1, swingGapMin: .5, swingGapMax: 1});
    const times = swingSchedule(5, config, lcg(9));
    expect(times[0]).toBe(1);
    for (let i = 1; i < times.length; i++) {expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(.5 - 1e-4); expect(times[i] - times[i - 1]).toBeLessThanOrEqual(1 + 1e-4);}
    const rules = sanitizeBlitzConfig({order: 'sequence'});
    expect(nextArena({index: 2, clears: 0, deaths: 0}, 'won', rules, 5, lcg(1))).toEqual({index: 3, clears: 0, deaths: 0});
    expect(nextArena({index: 4, clears: 0, deaths: 0}, 'won', rules, 5, lcg(1))).toEqual({index: 0, clears: 0, deaths: 0});
    expect(nextArena({index: 2, clears: 0, deaths: 1}, 'lost', rules, 5, lcg(1))).toEqual({index: 2, clears: 0, deaths: 2});
    expect(nextArena({index: 2, clears: 1, deaths: 0}, 'draw', rules, 5, lcg(1))).toEqual({index: 2, clears: 1, deaths: 0});
    const twice = sanitizeBlitzConfig({order: 'sequence', repeat: 2});
    expect(nextArena({index: 2, clears: 0, deaths: 0}, 'won', twice, 5, lcg(1))).toEqual({index: 2, clears: 1, deaths: 0});
    expect(nextArena({index: 2, clears: 2, deaths: 0}, 'won', twice, 5, lcg(1))).toEqual({index: 3, clears: 0, deaths: 0});
    expect(nextArena({index: 2, clears: 40, deaths: 0}, 'won', sanitizeBlitzConfig({repeat: -1}), 5, lcg(1))).toEqual({index: 2, clears: 41, deaths: 0});
    const smart = sanitizeBlitzConfig({smart: true, autoskip: true, order: 'sequence'});
    expect(nextArena({index: 2, clears: 0, deaths: 2}, 'lost', smart, 5, lcg(1))).toEqual({index: 3, clears: 0, deaths: 0});
    expect(nextArena({index: 2, clears: 0, deaths: 2}, 'lost', {...smart, autoskip: false}, 5, lcg(1))).toEqual({index: 2, clears: 0, deaths: 3});
    for (let i = 0; i < 20; i++) expect(nextArena({index: 2, clears: 0, deaths: 0}, 'won', sanitizeBlitzConfig({order: 'random'}), 5, lcg(i)).index).not.toBe(2);
    expect(nextArena({index: 0, clears: 0, deaths: 0}, 'won', sanitizeBlitzConfig({}), 1, lcg(1)).index).toBe(0);
  });
});

describe('Ancient arenas', () => {
  it('has spread-out arenas whose swingers hide from you and then show themselves 5-30 m away', () => {
    const arena = map(), {arenas} = arenaSet;
    expect(arenaSet.map).toBe('de_ancient');
    expect(arenas.length).toBeGreaterThanOrEqual(12);
    for (const a of arenas) for (const b of arenas) if (a !== b) expect(Math.hypot(a.player.x - b.player.x, a.player.z - b.player.z)).toBeGreaterThanOrEqual(10 - 1e-9);
    for (const scene of arenas.slice(0, 8)) {
      expect(scene.swingers.length).toBeGreaterThanOrEqual(5);
      // A strict (full-hull) spot: the engine places you there without moving you sideways (a voxel floor may lift the
      // feet by a few centimetres).
      const settled = (spot: {x: number; y: number; z: number}) => {
        const pose = freeSpawnPose({...spot}, arena);
        expect(Math.hypot(pose.x - spot.x, pose.z - spot.z)).toBe(0); expect(Math.abs(pose.y - spot.y)).toBeLessThan(.2);
      };
      settled(scene.player);
      const eye = {x: scene.player.x, y: scene.player.y + EYE, z: scene.player.z};
      const sectors = new Set<number>();
      for (const swinger of scene.swingers) {
        expect(swinger.distance).toBeGreaterThanOrEqual(5); expect(swinger.distance).toBeLessThanOrEqual(30);
        expect(Math.hypot(swinger.peek.x - swinger.hold.x, swinger.peek.z - swinger.hold.z)).toBeLessThanOrEqual(1.5 + 1e-9);
        expect(sees(arena, eye, {x: swinger.peek.x, y: swinger.peek.y + EYE, z: swinger.peek.z})).toBe(true);
        expect(sees(arena, eye, {x: swinger.hold.x, y: swinger.hold.y + EYE, z: swinger.hold.z})).toBe(false);
        settled(swinger.hold); settled(swinger.peek);
        sectors.add(Math.floor(swinger.bearing / 30));
      }
      expect(sectors.size).toBeGreaterThanOrEqual(4);
    }
  }, 60000);

  it('holds the swingers hidden until their swing, then sends them at you, and ends the arena when all are down', () => {
    const arena = map(), scene = arenaSet.arenas[0];
    const config = sanitizeBlitzConfig({swingers: 5, firstSwingSeconds: 1, swingGapMin: .5, swingGapMax: .5});
    const sim = new DuelSimulation(blitzDuelConfig(config), 7, arena, 'ak47', 'usp', true, undefined, {config, arena: scene, level: 6});
    expect(sim.blitz).toBeDefined(); expect(sim.deathmatch).toBe(false);
    expect(sim.actors).toHaveLength(6);
    const player = sim.actors[0];
    // The first swinger shoots a standing player dead within a second of reaching its peek: stay alive for the clock.
    player.health = 100000;
    const run = (until: number) => {while (sim.time < until && sim.phase === 'fighting') sim.step();};
    expect(Math.hypot(player.position.x - scene.player.x, player.position.z - scene.player.z)).toBeLessThan(.6);
    expect(player.yaw).toBeCloseTo(scene.player.yaw, 3);
    const holds = sim.actors.slice(1).map(bot => ({...bot.position}));
    const schedule = sim.blitzSchedule().sort((a, b) => a.swingAt - b.swingAt);
    expect(schedule.map(s => s.swingAt)).toEqual([1, 1.5, 2, 2.5, 3]);
    sim.start();
    // Before the first swing nobody moves: the swingers hold facing you, out of your sight.
    const eye = player.position;
    for (const bot of sim.actors.slice(1)) expect(sees(arena, eye, bot.position)).toBe(false);
    run(.9);
    sim.actors.slice(1).forEach((bot, i) => expect(Math.hypot(bot.position.x - holds[i].x, bot.position.z - holds[i].z)).toBeLessThan(.05));
    expect(sim.blitzSwung()).toBe(0);
    run(1.6);
    expect(sim.blitzSwung()).toBe(2);
    const first = schedule[0].id;
    expect(Math.hypot(sim.actors[first].position.x - holds[first - 1].x, sim.actors[first].position.z - holds[first - 1].z)).toBeGreaterThan(.3);
    run(3.2);
    expect(sim.blitzSwung()).toBe(5);
    expect(sim.phase).toBe('fighting');
    // The swingers come at you: by now at least one has fired.
    expect(sim.actors.slice(1).some(bot => bot.weapon.ammo < 30)).toBe(true);
    for (const bot of sim.actors.slice(1)) {bot.health = 0; bot.alive = false;}
    sim.step();
    expect(sim.phase).toBe('result'); expect(sim.outcome).toBe('won');
    // Dying loses the arena instead.
    const again = new DuelSimulation(blitzDuelConfig(config), 8, arena, 'ak47', 'usp', true, undefined, {config, arena: scene, level: 6});
    again.start(); again.actors[0].health = 0; again.actors[0].alive = false; again.step();
    expect(again.outcome).toBe('lost');
    // No primary: you carry only the sidearm and the swingers get pistols.
    const pistols = sanitizeBlitzConfig({noPrimary: true});
    const eco = new DuelSimulation(blitzDuelConfig(pistols), 9, arena, 'ak47', 'usp', false, undefined, {config: pistols, arena: scene, level: 6});
    expect(eco.actors[0].weapon.id).toBe('usp');
    expect(eco.actors.slice(1).every(bot => ['glock', 'usp'].includes(bot.weapon.id))).toBe(true);
  }, 60000);
});
