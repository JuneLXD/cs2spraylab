import {afterEach, describe, expect, it, vi} from 'vitest';
import {UNIT, type Vec} from '../actor-physics';
import {botzDefaults, botzDuelConfig, botzSummary, emptyBotzStats, loadBotzHistory, reflexDefaults, sanitizeBotzConfig,
  saveBotzHistory, type BotzConfig, type BotzHistory} from './botz';
import {canFitInArena, traceSolid, type Arena} from './geometry';
import {REFLEX_ISLAND, REFLEX_ISLAND_HALF, REFLEX_PLAYER_SPAWN, REFLEX_REACH, reflexArena, reflexEntrances, reflexRing as ring,
  reflexRingSizes, ReflexSpawner} from './reflex';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';

const EYE = 64 * UNIT, HULL = 72 * UNIT;
const distances = ['near', 'mixed', 'far'] as const;
const reflexSim = (patch: Partial<BotzConfig> = {}, seed = 7) => {
  const botz = sanitizeBotzConfig({...patch, map: 'island'});
  const sim = new DuelSimulation(botzDuelConfig(botz), seed, reflexArena(botz), 'ak47', 'usp', true, botz);
  sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
  return sim;
};
const sees = (arena: Arena, from: Vec, to: Vec) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, arena, length - .05).distance);
};
/** The top of a standing bot's head. */
const head = (point: {x: number; z: number}) => ({x: point.x, y: HULL, z: point.z});
const aimAt = (sim: DuelSimulation, id: number, height = 1.62) => {
  const eye = sim.actors[0].position, bot = sim.actors[id];
  const dx = bot.position.x - eye.x, dy = bot.feet + height - eye.y, dz = bot.position.z - eye.z;
  sim.actors[0].yaw = Math.atan2(-dx, -dz);
  sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
};
const fire = (sim: DuelSimulation) => {sim.command(0, {firePressed: true}); sim.step(); sim.command(0, {fireHeld: false});};
const runFor = (sim: DuelSimulation, seconds: number) => {for (let elapsed = 0; elapsed < seconds; elapsed += .25) sim.advance(.25);};
/** Steps tick by tick until `done` holds, for at most `seconds`. */
const stepUntil = (sim: DuelSimulation, done: () => boolean, seconds: number) => {
  for (let tick = 0; tick < seconds * 128 && !done(); tick++) sim.step();
  return done();
};

describe('Fast Aim / Reflex setup', () => {
  it('keeps its own defaults, separate from Aim Botz', () => {
    expect(sanitizeBotzConfig({map: 'island'})).toEqual(reflexDefaults);
    expect(reflexDefaults).toMatchObject({map: 'island', weapon: 'knife', movement: 'strafe', crouch: 'some', infiniteAmmo: 'magazine', approach: 'around'});
    expect(sanitizeBotzConfig({})).toEqual(botzDefaults);
    expect(sanitizeBotzConfig({map: 'moon', approach: 'sky'})).toMatchObject({map: 'yard', approach: 'around', weapon: 'ak47'});
    expect(sanitizeBotzConfig({map: 'island', approach: 'front', weapon: 'ak47', crouch: 'never', botCount: 40}))
      .toMatchObject({map: 'island', approach: 'front', weapon: 'ak47', crouch: 'never', botCount: 16});
  });

  it.each(distances)('%s: a ring of walls with eight clear ways in, each in view of the island from its mouth', distance => {
    const arena = reflexArena({distance}), entrances = reflexEntrances(distance), size = reflexRingSizes[distance];
    expect(entrances.map(entrance => entrance.corner)).toEqual([false, true, false, true, false, true, false, true]);
    // Only the ring of walls: the island is marked on the floor, at ground level.
    expect(arena.solids).toHaveLength(8);
    for (const solid of arena.solids) expect(ring(solid.center) - Math.max(solid.size.x, solid.size.z) / 2).toBeGreaterThan(REFLEX_ISLAND_HALF);
    for (const solid of arena.solids) {
      expect(Math.abs(solid.center.x) + solid.size.x / 2).toBeLessThan(arena.maxX - 1);
      expect(solid.center.z - solid.size.z / 2).toBeGreaterThan(arena.minZ + 1);
      expect(solid.center.z + solid.size.z / 2).toBeLessThan(arena.maxZ - 1);
    }
    for (const entrance of entrances) {
      expect(ring(entrance.mouth)).toBeGreaterThan(size);
      expect(ring(entrance.inner)).toBeLessThan(size - 1);
      expect(sees(arena, REFLEX_PLAYER_SPAWN, head(entrance.mouth))).toBe(true);
      // Mouth, inner point, then straight on to the reach line: a bot's hull fits all the way.
      const path = [entrance.mouth, entrance.inner, REFLEX_ISLAND];
      for (let leg = 0; leg < 2; leg++) for (let t = 0; t <= 1; t += .02) {
        const x = path[leg].x + (path[leg + 1].x - path[leg].x) * t, z = path[leg].z + (path[leg + 1].z - path[leg].z) * t;
        if (ring({x, z}) > REFLEX_REACH) expect(canFitInArena({x, y: EYE, z}, 0, HULL, arena), `${entrance.index} at ${x},${z}`).toBe(true);
      }
    }
  });

  it('you stand on the island, at ground level', () => {
    const sim = reflexSim({botCount: 1});
    expect(sim.actors[0].position).toEqual(REFLEX_PLAYER_SPAWN);
    sim.start(); runFor(sim, 1);
    expect(sim.actors[0].feet).toBe(0);
    expect(sim.actors[0].position.y).toBeCloseTo(EYE, 6);
  });

  it.each(distances)('%s: bots start out of sight behind the walls, apart and facing you', distance => {
    for (const seed of [1, 2, 3]) {
      const sim = reflexSim({botCount: 8, distance}, seed), bots = sim.actors.slice(1);
      expect(bots).toHaveLength(8);
      for (const bot of bots) {
        expect(ring(bot.position)).toBeGreaterThan(reflexRingSizes[distance]);
        expect(canFitInArena(bot.position, 0, HULL, sim.arena)).toBe(true);
        expect(sees(sim.arena, REFLEX_PLAYER_SPAWN, head(bot.position))).toBe(false);
        const toYou = {x: REFLEX_PLAYER_SPAWN.x - bot.position.x, z: REFLEX_PLAYER_SPAWN.z - bot.position.z};
        expect((-Math.sin(bot.yaw) * toYou.x - Math.cos(bot.yaw) * toYou.z) / Math.hypot(toYou.x, toYou.z)).toBeCloseTo(1, 6);
        for (const other of bots) if (other !== bot)
          expect(Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z)).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it('spawns behind every gap, with a clear run to its mouth; In front uses only the three ahead', () => {
    for (const distance of distances) for (const approach of ['around', 'front'] as const) {
      const config = sanitizeBotzConfig({map: 'island', distance, approach}), arena = reflexArena(config);
      const spawner = new ReflexSpawner(config, arena, 5), used = new Set<number>();
      for (let n = 0; n < 200; n++) {
        const spawn = spawner.next([], REFLEX_PLAYER_SPAWN), mouth = spawn.route[0];
        used.add(spawn.entrance);
        expect(spawn.route).toEqual([reflexEntrances(distance)[spawn.entrance].mouth, reflexEntrances(distance)[spawn.entrance].inner]);
        expect(sees(arena, REFLEX_PLAYER_SPAWN, head(spawn))).toBe(false);
        for (let t = 0; t <= 1; t += .05) expect(canFitInArena({x: spawn.x + (mouth.x - spawn.x) * t, y: EYE,
          z: spawn.z + (mouth.z - spawn.z) * t}, 0, HULL, arena)).toBe(true);
      }
      expect([...used].sort()).toEqual(approach === 'front' ? [0, 1, 7] : [0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('never spawns a bot next to you, even when you stand where bots wait', () => {
    const config = sanitizeBotzConfig({map: 'island', approach: 'front', respawnSeconds: 0}), arena = reflexArena(config);
    const spawner = new ReflexSpawner(config, arena, 4), hideout = reflexEntrances('mixed')[0].mouth;
    const you = {x: hideout.x + 3.5, y: EYE, z: hideout.z - .5};
    for (let n = 0; n < 100; n++) {
      const spawn = spawner.next([], you);
      expect(Math.hypot(spawn.x - you.x, spawn.z - you.z)).toBeGreaterThanOrEqual(3);
    }
  });

  it('a new bot avoids a gap another bot is already running through', () => {
    const config = sanitizeBotzConfig({map: 'island'}), spawner = new ReflexSpawner(config, reflexArena(config), 9);
    for (let n = 0; n < 50; n++) expect([0, 1, 2, 3, 4, 5, 6]).toContain(spawner.next([], REFLEX_PLAYER_SPAWN, new Set([7])).entrance);
  });
});

describe('Fast Aim / Reflex play', () => {
  it('bots set off one after another, rush the island, never attack, and count when they reach it', () => {
    const sim = reflexSim({botCount: 4}), start = sim.actors.map(actor => ({...actor.position}));
    sim.start(); runFor(sim, .5);
    expect(Math.hypot(sim.actors[1].position.x - start[1].x, sim.actors[1].position.z - start[1].z)).toBeGreaterThan(1);
    expect(sim.actors[4].position).toEqual(start[4]);
    runFor(sim, 30);
    const events = sim.drainEvents();
    expect(events.some(event => event.kind === 'fire' || event.kind === 'hit' || event.kind === 'round')).toBe(false);
    expect(sim.phase).toBe('fighting');
    expect(sim.snapshot()[0]).toMatchObject({health: 100, alive: true});
    expect(sim.botzStats.leaks).toBeGreaterThan(3);
    // Nothing was killed, so every new life was an arrival.
    expect(sim.actors.slice(1).reduce((sum, bot) => sum + bot.generation - 1, 0)).toBe(sim.botzStats.leaks);
  });

  it.each(distances)('%s: no bot gets stuck on the way in, even with 16 bots through the three gaps in front', distance => {
    for (const [botCount, approach, movement] of [[8, 'around', 'static'], [8, 'around', 'strafe'], [16, 'front', 'strafe']] as const) {
      const sim = reflexSim({botCount, approach, distance, movement, crouch: 'some'}, 3);
      const generations = sim.actors.map(actor => actor.generation), lastArrival = sim.actors.map(() => 0);
      let longest = 0;
      sim.start();
      for (let tick = 0; tick < 60 * 128; tick++) {
        sim.step();
        for (const bot of sim.actors.slice(1)) if (bot.generation !== generations[bot.id]) {
          generations[bot.id] = bot.generation;
          longest = Math.max(longest, sim.time - lastArrival[bot.id]);
          lastArrival[bot.id] = sim.time;
        }
      }
      for (const bot of sim.actors.slice(1)) longest = Math.max(longest, sim.time - lastArrival[bot.id]);
      // A lap is the wait, a short hidden run, the gap, then a slow strafing approach: well under the whole 60 s.
      expect(longest, `${botCount} ${approach} ${movement}`).toBeLessThan(35);
      expect(sim.botzStats.leaks).toBe(sim.actors.slice(1).reduce((sum, bot) => sum + bot.generation - 1, 0));
    }
  });

  it('straight runners come right at you; strafing bots mostly strafe A-D, spam crouch, and only edge closer', () => {
    /** In the open: how much of the time a bot moves mostly sideways, its mean speed toward you, how often it switches
     * sides and how much of the time it is crouched, and how often it ducks or stands up. */
    const measure = (patch: Partial<BotzConfig>) => {
      const sim = reflexSim({botCount: 6, ...patch}, 4), size = reflexRingSizes[sim.botz!.distance];
      let ticks = 0, sideways = 0, closing = 0, switches = 0, crouched = 0, stanceChanges = 0;
      const sides = new Map<string, number>(), stances = new Map<string, boolean>();
      sim.start();
      for (let tick = 0; tick < 30 * 128; tick++) {
        sim.step();
        const [player, ...bots] = sim.snapshot();
        for (const bot of bots) {
          if (!bot.alive || ring(bot.position) > size - 2.5 || ring(bot.position) < REFLEX_REACH + .3) continue;
          const life = `${bot.id}:${bot.generation}`, toYou = {x: player.position.x - bot.position.x, z: player.position.z - bot.position.z};
          const distance = Math.hypot(toYou.x, toYou.z), along = (bot.velocity.x * toYou.x + bot.velocity.z * toYou.z) / distance;
          const across = (bot.velocity.z * toYou.x - bot.velocity.x * toYou.z) / distance;
          ticks++; closing += along;
          if (Math.abs(across) > Math.abs(along) * 1.2) sideways++;
          if (Math.abs(across) > 1) {
            if (sides.has(life) && sides.get(life) !== Math.sign(across)) switches++;
            sides.set(life, Math.sign(across));
          }
          if (bot.crouched) crouched++;
          if (stances.has(life) && stances.get(life) !== bot.crouched) stanceChanges++;
          stances.set(life, bot.crouched);
        }
      }
      const seconds = ticks / 128;
      return {seconds, sideways: sideways / ticks, closing: closing / ticks, switches: switches / seconds,
        crouched: crouched / ticks, stanceChanges: stanceChanges / seconds};
    };
    const straight = measure({movement: 'static', crouch: 'never'});
    expect(straight.seconds).toBeGreaterThan(20);
    expect(straight.sideways).toBeLessThan(.02);
    expect(straight.closing).toBeGreaterThan(6);
    expect(straight.crouched).toBe(0);
    const strafing = measure({movement: 'strafe', crouch: 'never'});
    expect(strafing.sideways).toBeGreaterThan(.6);
    // About one change of direction a second, like a player strafing in a fight: not a twitch.
    expect(strafing.switches).toBeGreaterThan(.9);
    expect(strafing.switches).toBeLessThan(2);
    expect(strafing.closing).toBeGreaterThan(1);
    expect(strafing.closing).toBeLessThan(2.5);
    // The default: strafing with crouch spam at a person's pace (under a crouch a second), still closing in a little.
    const spamming = measure({});
    expect(spamming.sideways).toBeGreaterThan(.6);
    expect(spamming.switches).toBeGreaterThan(.6);
    expect(spamming.crouched).toBeGreaterThan(.3);
    expect(spamming.crouched).toBeLessThan(.6);
    expect(spamming.stanceChanges).toBeGreaterThan(1);
    expect(spamming.stanceChanges).toBeLessThan(2.5);
    expect(spamming.closing).toBeGreaterThan(.5);
    expect(spamming.closing).toBeLessThan(1.5);
    // Crouched all the way, a strafing bot still makes its way in.
    const crawling = measure({movement: 'strafe', crouch: 'always'});
    expect(crawling.crouched).toBe(1);
    expect(crawling.closing).toBeGreaterThan(.5);
  });

  it('a headshot kills a rushing bot, which comes back out of sight after the delay', () => {
    const sim = reflexSim({botCount: 1, movement: 'static', crouch: 'never', respawnSeconds: 1}, 2);
    const size = reflexRingSizes[sim.botz!.distance];
    sim.start();
    expect(stepUntil(sim, () => ring(sim.actors[1].position) < size - 2, 10)).toBe(true);
    aimAt(sim, 1); fire(sim);
    expect(sim.drainEvents().find(event => event.kind === 'hit')).toMatchObject({victim: 1, group: 'head', lethal: true});
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.botzStats).toMatchObject({shots: 1, hits: 1, kills: 1, headshots: 1, leaks: 0});
    const killedAt = sim.time;
    expect(stepUntil(sim, () => sim.actors[1].alive, 2)).toBe(true);
    expect(sim.time - killedAt).toBeCloseTo(1, 1);
    const bot = sim.snapshot()[1];
    expect(bot).toMatchObject({alive: true, generation: 2, health: 100});
    expect(ring(bot.position)).toBeGreaterThan(size);
    expect(sees(sim.arena, sim.actors[0].position, head(bot.position))).toBe(false);
  });

  it('a bot that reaches the island counts once and starts again out of sight after the delay', () => {
    const sim = reflexSim({botCount: 1, respawnSeconds: .5}, 6), size = reflexRingSizes[sim.botz!.distance];
    sim.start();
    expect(stepUntil(sim, () => sim.botzStats.leaks === 1, 30)).toBe(true);
    const bot = sim.actors[1], spot = {...bot.position};
    expect(bot).toMatchObject({alive: true, generation: 2, health: 100});
    expect(ring(spot)).toBeGreaterThan(size);
    expect(sees(sim.arena, sim.actors[0].position, head(spot))).toBe(false);
    runFor(sim, .25);
    expect(sim.actors[1].position).toEqual(spot);
    runFor(sim, .75);
    expect(Math.hypot(sim.actors[1].position.x - spot.x, sim.actors[1].position.z - spot.z)).toBeGreaterThan(1);
    expect(sim.botzStats.leaks).toBe(1);
  });

  it('a bot reaches you where you stand if you step off the island', () => {
    const sim = reflexSim({botCount: 1, movement: 'static', crouch: 'never', approach: 'front'}, 8);
    Object.assign(sim.actors[0], {position: {x: 0, y: EYE, z: REFLEX_ISLAND.z - 8}, feet: 0});
    let last = {...sim.actors[1].position};
    sim.start();
    expect(stepUntil(sim, () => {
      if (sim.botzStats.leaks) return true;
      last = {...sim.actors[1].position};
      return false;
    }, 15)).toBe(true);
    const player = sim.actors[0].position;
    expect(Math.hypot(last.x - player.x, last.z - player.z)).toBeLessThan(1.6);
    expect(ring(last)).toBeGreaterThan(REFLEX_REACH);
    expect(sim.actors[0].alive).toBe(true);
  });

  it('timed sessions end as in Aim Botz, and the summary carries arrivals', () => {
    const sim = reflexSim({botCount: 2, sessionSeconds: 30});
    sim.start(); runFor(sim, 29.5);
    expect(sim.phase).toBe('fighting');
    runFor(sim, 1);
    expect(sim.phase).toBe('result');
    expect(sim.drainEvents().filter(event => event.kind === 'round')).toHaveLength(1);
    expect(botzSummary({...emptyBotzStats(), kills: 6, leaks: 3}, 60, 60)).toMatchObject({kills: 6, leaks: 3, killsPerMinute: 6});
  });
});

describe('Fast Aim / Reflex history', () => {
  afterEach(() => {vi.unstubAllGlobals();});
  it('is kept apart from Aim Botz sessions', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => {store.set(key, value);}});
    const entry: BotzHistory = {date: '2026-10-07T12:00:00Z', weapon: 'ak47', distance: 'mixed', movement: 'strafe', headshotOnly: false,
      seconds: 60, kills: 20, headshotRate: 50, accuracy: 40, killsPerMinute: 20, leaks: 4};
    saveBotzHistory([entry], 'island');
    expect(loadBotzHistory('island')).toEqual([entry]);
    expect(loadBotzHistory()).toEqual([]);
    expect([...store.keys()]).toEqual(['spraylab.reflex.history.v1']);
  });
});
