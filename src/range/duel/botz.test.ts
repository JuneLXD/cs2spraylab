import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {gameData} from '../config';
import {BOTZ_PLAYER_SPAWN, BotzStrafe, botzArena, botzDistanceBands, botzDuelConfig, botzSummary, emptyBotzStats,
  sanitizeBotzConfig, type BotzConfig} from './botz';
import {traceSolid} from './geometry';
import {randomStream} from './rng';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';

const botzSim = (patch: Partial<BotzConfig> = {}, seed = 7) => {
  const botz = sanitizeBotzConfig(patch);
  const sim = new DuelSimulation(botzDuelConfig(botz), seed, botzArena(), 'ak47', 'usp', true, botz);
  sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
  return sim;
};
/** Points your crosshair at a bot: 1.62 m is head height, about 1.2 m the chest. */
const aimAt = (sim: DuelSimulation, id: number, height = 1.62) => {
  const eye = sim.actors[0].position, bot = sim.actors[id];
  const dx = bot.position.x - eye.x, dy = bot.feet + height - eye.y, dz = bot.position.z - eye.z;
  sim.actors[0].yaw = Math.atan2(-dx, -dz);
  sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
};
const fire = (sim: DuelSimulation) => {sim.command(0, {firePressed: true}); sim.step(); sim.command(0, {fireHeld: false});};
const runFor = (sim: DuelSimulation, seconds: number) => {for (let elapsed = 0; elapsed < seconds; elapsed += .25) sim.advance(.25);};

describe('Aim Botz setup', () => {
  it('sanitizes saved settings', () => {
    expect(sanitizeBotzConfig({botCount: 99, distance: 'x', movement: 'dance', respawnSeconds: -1, sessionSeconds: 45,
      weapon: '__proto__', infiniteAmmo: 'magazine', health: 0})).toMatchObject({botCount: 16, distance: 'mixed',
      movement: 'static', respawnSeconds: 0, sessionSeconds: 0, weapon: 'ak47', infiniteAmmo: 'magazine', health: 1});
    expect(sanitizeBotzConfig({botCount: 0, sessionSeconds: 60, weapon: 'knife', headshotOnly: true}))
      .toMatchObject({botCount: 1, sessionSeconds: 60, weapon: 'knife', headshotOnly: true});
    expect(sanitizeBotzConfig(null)).toEqual(sanitizeBotzConfig({}));
  });

  it.each(['near', 'mixed', 'far'] as const)('spawns %s bots in front of you, apart, in view and facing you', distance => {
    for (const seed of [1, 2, 3]) {
      const sim = botzSim({botCount: 16, distance}, seed), arena = botzArena();
      const bots = sim.actors.slice(1), [near, far] = botzDistanceBands[distance];
      expect(bots).toHaveLength(16);
      expect(sim.actors[0].position).toEqual(BOTZ_PLAYER_SPAWN);
      for (const bot of bots) {
        const range = Math.hypot(bot.position.x - BOTZ_PLAYER_SPAWN.x, bot.position.z - BOTZ_PLAYER_SPAWN.z);
        // Ledges are chosen by their centre, so their edges may sit just outside the band.
        expect(range).toBeGreaterThanOrEqual(near - (bot.feet ? 5 : 0));
        expect(range).toBeLessThanOrEqual(far + (bot.feet ? 5 : 0));
        expect(bot.position.z).toBeLessThan(BOTZ_PLAYER_SPAWN.z);
        expect(Math.abs(bot.position.x)).toBeLessThan(arena.maxX);
        expect(bot.position.y).toBeCloseTo(bot.feet + 64 * UNIT);
        const head = {x: bot.position.x - BOTZ_PLAYER_SPAWN.x, y: bot.position.y - BOTZ_PLAYER_SPAWN.y, z: bot.position.z - BOTZ_PLAYER_SPAWN.z};
        const length = Math.hypot(head.x, head.y, head.z);
        expect(traceSolid(BOTZ_PLAYER_SPAWN, {x: head.x / length, y: head.y / length, z: head.z / length}, sim.arena, length - .05).distance).toBe(Infinity);
        const facing = {x: -Math.sin(bot.yaw), z: -Math.cos(bot.yaw)};
        expect((facing.x * -head.x + facing.z * -head.z) / Math.hypot(head.x, head.z)).toBeCloseTo(1, 6);
        for (const other of bots) if (other !== bot && !bot.feet && !other.feet)
          expect(Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z)).toBeGreaterThanOrEqual(2.2);
      }
    }
  });

  it('puts some bots on ledges unless ledges are off', () => {
    const elevated = botzSim({botCount: 16, distance: 'far'}, 4).actors.slice(1).filter(bot => bot.feet > 0);
    expect(elevated.length).toBeGreaterThan(0);
    for (const bot of elevated) expect(botzArena().solids.some(solid => Math.abs(solid.center.y + solid.size.y / 2 - bot.feet) < 1e-9)).toBe(true);
    expect(botzSim({botCount: 16, distance: 'far', elevated: false}, 4).actors.slice(1).every(bot => bot.feet === 0)).toBe(true);
  });
});

describe('Aim Botz play', () => {
  it('bots never shoot back, and the session has no rounds', () => {
    const sim = botzSim({botCount: 6, movement: 'strafe'});
    sim.start(); runFor(sim, 20);
    const events = sim.drainEvents();
    expect(events.some(event => event.kind === 'fire')).toBe(false);
    expect(events.some(event => event.kind === 'round')).toBe(false);
    expect(sim.phase).toBe('fighting');
    expect(sim.snapshot()[0].health).toBe(100);
  });

  it('a headshot kills, and the bot respawns somewhere else after the delay', () => {
    const sim = botzSim({botCount: 1, respawnSeconds: 1});
    sim.start(); aimAt(sim, 1);
    const before = {...sim.actors[1].position};
    fire(sim);
    const hit = sim.drainEvents().find(event => event.kind === 'hit');
    expect(hit).toMatchObject({kind: 'hit', victim: 1, group: 'head', lethal: true});
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.botzStats).toMatchObject({shots: 1, hits: 1, headHits: 1, kills: 1, headshots: 1, headshotStreak: 1});
    expect(sim.drops).toHaveLength(0);
    runFor(sim, .75);
    expect(sim.actors[1].alive).toBe(false);
    runFor(sim, .5);
    const bot = sim.snapshot()[1];
    expect(bot).toMatchObject({alive: true, health: 100, armor: 100, helmet: true, generation: 2});
    expect(Math.hypot(bot.position.x - before.x, bot.position.z - before.z)).toBeGreaterThanOrEqual(3);
  });

  it('headshot only: body hits register without damage', () => {
    const sim = botzSim({botCount: 1, headshotOnly: true});
    sim.start(); aimAt(sim, 1, 1.2); fire(sim);
    expect(sim.drainEvents().find(event => event.kind === 'hit')).toMatchObject({group: 'chest', healthDamage: 0, armorDamage: 0, lethal: false});
    expect(sim.actors[1].health).toBe(100);
    runFor(sim, .5); aimAt(sim, 1); fire(sim);
    expect(sim.actors[1].alive).toBe(false);
    expect(sim.botzStats).toMatchObject({shots: 2, hits: 2, kills: 1, headshots: 1});
  });

  it('counts a shotgun blast as one shot and one hit', () => {
    const sim = botzSim({botCount: 1, health: 500});
    sim.actors[0].weapon = new DuelWeaponState('nova', randomStream(3, 'pellets'));
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: BOTZ_PLAYER_SPAWN.z - 3}; sim.actors[1].feet = 0;
    sim.start(); aimAt(sim, 1, 1.25); fire(sim);
    expect(sim.botzStats).toMatchObject({shots: 1, hits: 1});
    expect(sim.botzStats.damage).toBeGreaterThan(gameData.weapons.nova.damage);
  });

  it.each([['off', 25, 90], ['reserve', 25, 90], ['magazine', 30, 90]] as const)('infinite ammo %s', (mode, ammo, reserve) => {
    const sim = botzSim({botCount: 1, infiniteAmmo: mode});
    sim.actors[0].yaw = Math.PI / 2; sim.start();
    sim.command(0, {fireHeld: true, firePressed: true});
    for (let tick = 0; tick < Math.round(.47 / STEP); tick++) sim.step();
    sim.command(0, {fireHeld: false});
    expect(sim.botzStats.shots).toBe(5);
    expect(sim.actors[0].weapon.ammo).toBe(ammo);
    sim.command(0, {reloadPressed: true});
    runFor(sim, 4);
    expect(sim.actors[0].weapon.ammo).toBe(30);
    expect(sim.actors[0].weapon.reserve).toBe(mode === 'off' ? reserve - 30 : reserve);
  });

  it('ends a timed session, and keeps an endless one going', () => {
    const timed = botzSim({botCount: 2, sessionSeconds: 30});
    timed.start(); runFor(timed, 29.5);
    expect(timed.phase).toBe('fighting');
    runFor(timed, 1);
    expect(timed.phase).toBe('result');
    expect(timed.drainEvents().filter(event => event.kind === 'round')).toHaveLength(1);
    const endless = botzSim({botCount: 2});
    endless.start(); runFor(endless, 200);
    expect(endless.phase).toBe('fighting');
  });

  it('strafing bots move side to side; standing bots stay put', () => {
    for (const movement of ['static', 'strafe'] as const) {
      const sim = botzSim({botCount: 4, movement, elevated: false}, 11);
      const start = sim.actors.slice(1).map(bot => ({...bot.position}));
      sim.start(); runFor(sim, 3);
      const moved = sim.actors.slice(1).map((bot, index) => Math.hypot(bot.position.x - start[index].x, bot.position.z - start[index].z));
      if (movement === 'static') expect(Math.max(...moved)).toBeLessThan(.01);
      else expect(Math.max(...moved)).toBeGreaterThan(.5);
      for (const bot of sim.actors.slice(1)) expect(Math.abs(bot.position.x)).toBeLessThan(18);
    }
  });

  it('crouching bots duck', () => {
    const sim = botzSim({botCount: 3, crouch: 'always'});
    sim.start(); runFor(sim, 1);
    expect(sim.snapshot().slice(1).every(bot => bot.crouched)).toBe(true);
  });
});

describe('Aim Botz: closing in and crouch spam', () => {
  it('keeps the new options, and the island keeps its own', () => {
    expect(sanitizeBotzConfig({movement: 'close', crouch: 'spam'})).toMatchObject({movement: 'close', crouch: 'spam'});
    expect(sanitizeBotzConfig({map: 'island', movement: 'close', crouch: 'spam'})).toMatchObject({movement: 'strafe', crouch: 'some'});
  });

  it('bots strafe A-D mostly sideways and edge closer, holding about 4-6 m away', () => {
    const sim = botzSim({botCount: 8, movement: 'close', elevated: false, distance: 'mixed'}, 6);
    const range = () => sim.actors.slice(1).map(bot => Math.hypot(bot.position.x - BOTZ_PLAYER_SPAWN.x, bot.position.z - BOTZ_PLAYER_SPAWN.z));
    const start = range();
    let sideways = 0, moving = 0, nearest = Infinity;
    sim.start();
    for (let tick = 0; tick < 40 * 128; tick++) {
      sim.step();
      const [player, ...bots] = sim.snapshot();
      for (const bot of bots) {
        const to = {x: player.position.x - bot.position.x, z: player.position.z - bot.position.z}, distance = Math.hypot(to.x, to.z);
        nearest = Math.min(nearest, distance);
        if (Math.hypot(bot.velocity.x, bot.velocity.z) < 1) continue;
        moving++;
        const along = (bot.velocity.x * to.x + bot.velocity.z * to.z) / distance, across = (bot.velocity.z * to.x - bot.velocity.x * to.z) / distance;
        if (Math.abs(across) > Math.abs(along)) sideways++;
      }
    }
    const end = range();
    expect(end.reduce((a, b) => a + b) / end.length).toBeLessThan(start.reduce((a, b) => a + b) / start.length - 8);
    expect(sideways / moving).toBeGreaterThan(.6);
    expect(nearest).toBeGreaterThan(3);
    for (const bot of sim.actors.slice(1)) expect(Math.abs(bot.position.x)).toBeLessThan(18);
  });

  it('about half the bots spam crouch, at a person\'s pace; bots on ledges never step off', () => {
    const sim = botzSim({botCount: 16, crouch: 'spam', movement: 'close', distance: 'far'}, 2);
    const ledges = sim.actors.slice(1).filter(bot => bot.feet > 0).map(bot => ({id: bot.id, feet: bot.feet}));
    expect(ledges.length).toBeGreaterThan(0);
    const changes = sim.actors.map(() => 0), last = sim.actors.map(() => false);
    sim.start();
    for (let tick = 0; tick < 10 * 128; tick++) {
      sim.step();
      for (const bot of sim.snapshot().slice(1)) {if (bot.crouched !== last[bot.id]) changes[bot.id]++; last[bot.id] = bot.crouched;}
    }
    const spammers = changes.slice(1).filter(count => count >= 4);
    expect(spammers.length).toBeGreaterThanOrEqual(4); expect(spammers.length).toBeLessThanOrEqual(12);
    // Down and up about once a second at most: under 25 changes in 10 s.
    for (const count of spammers) expect(count).toBeLessThan(25);
    for (const {id, feet} of ledges) expect(sim.actors[id].feet).toBeCloseTo(feet, 3);
  });
});

describe('Aim Botz: bots on ledges', () => {
  it.each(['strafe', 'close'] as const)('%s: they move about on their ledge and never step off it', movement => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = botzSim({botCount: 16, distance: 'far', movement}, seed);
      const ledges = new Map(sim.actors.slice(1).filter(bot => bot.feet > 0).map(bot => [bot.id, {feet: bot.feet, x: bot.position.x, z: bot.position.z, moved: 0}]));
      sim.start();
      for (let tick = 0; tick < 15 * 128; tick++) {
        sim.step();
        for (const [id, ledge] of ledges) {
          const bot = sim.actors[id];
          expect(Math.abs(bot.feet - ledge.feet), `bot ${id} at tick ${tick}`).toBeLessThanOrEqual(.25);
          ledge.moved = Math.max(ledge.moved, Math.hypot(bot.position.x - ledge.x, bot.position.z - ledge.z));
        }
      }
      for (const ledge of ledges.values()) {expect(ledge.moved).toBeGreaterThan(.3); checked++;}
    }
    expect(checked).toBeGreaterThan(4);
  });
});

describe('Aim Botz stats', () => {
  it('summarizes accuracy, headshot rate and pace', () => {
    expect(botzSummary({...emptyBotzStats(), shots: 10, hits: 7, kills: 4, headshots: 3}, 120, 0))
      .toMatchObject({accuracy: 70, headshotRate: 75, killsPerMinute: 2, secondsPerKill: 30});
    expect(botzSummary(emptyBotzStats(), 0, 60)).toMatchObject({accuracy: 0, headshotRate: 0, killsPerMinute: 0, secondsPerKill: null});
  });

  it('strafes in alternating directions with short stops', () => {
    const strafe = new BotzStrafe(randomStream(5, 'strafe')), seen: number[] = [];
    for (let time = 0; time < 30; time += STEP) {
      const side = strafe.side(time);
      if (seen[seen.length - 1] !== side) seen.push(side);
    }
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toContain(0);
    for (let index = 1; index < seen.length; index++) if (seen[index] && seen[index - 1]) expect(seen[index]).toBe(-seen[index - 1]);
  });
});
