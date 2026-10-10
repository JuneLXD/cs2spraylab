import {describe, expect, it} from 'vitest';
import {POP_SPAWN, PopField, popConfig, popRegion, popWall, rayBoxDistance} from './pop';
import {defaults, sanitizeSettings} from './config';
import {Simulation} from './simulation';
import {drillSetupSummary, rangeDrillDefaults} from './ui/drill-setup';
import {sanitizeBotzConfig} from './duel/botz';
import {sanitizeDuelConfig} from './duel/config';

/** Deterministic stand-in for Math.random. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const unit = (from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return {x: dx / length, y: dy / length, z: dz / length};
};

describe('pop field', () => {
  it('floats the configured number of balls on a wall at the chosen distance, spaced as asked and inside the view', () => {
    const config = popConfig({...defaults, popSize: 30, popCount: 6, popSpacing: 1, popDistance: 12});
    const field = new PopField(config, POP_SPAWN, lcg(7));
    const region = popRegion(config, POP_SPAWN);
    expect(field.balls).toHaveLength(6);
    for (const ball of field.balls) {
      expect(ball.radius).toBeCloseTo(.15);
      expect(ball.z).toBeCloseTo(POP_SPAWN.z - 12);
      expect(Math.abs(ball.x - region.x)).toBeLessThanOrEqual(region.halfW + 1e-9);
      expect(Math.abs(ball.y - region.y)).toBeLessThanOrEqual(region.halfH + 1e-9);
    }
    for (const a of field.balls) for (const b of field.balls) if (a !== b)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(1 + .3 - 1e-9);
    // The wall stays inside the 90-degree view with a margin, whatever the count.
    expect(region.halfW).toBeLessThanOrEqual(12 * .55 + 1e-9); expect(region.halfH).toBeLessThanOrEqual(1.4);
  });

  it('pops the nearest ball a ray crosses, replaces it, and reports misses and out-of-range balls', () => {
    const field = new PopField(popConfig({...defaults, popSize: 40, popCount: 3, popSpacing: 1, popDistance: 10}), POP_SPAWN, lcg(3));
    const [first] = field.balls;
    const hit = field.hit(POP_SPAWN, unit(POP_SPAWN, first));
    expect(hit?.ball).toBe(first);
    expect(hit!.distance).toBeCloseTo(Math.hypot(first.x - POP_SPAWN.x, first.y - POP_SPAWN.y, first.z - POP_SPAWN.z) - .2, 6);
    expect(Math.hypot(hit!.point.x - first.x, hit!.point.y - first.y, hit!.point.z - first.z)).toBeCloseTo(.2, 6);
    expect(field.balls).toHaveLength(3); expect(field.balls).not.toContain(first); expect(field.pops).toBe(1);
    expect(field.drainPopped()).toEqual([first]); expect(field.drainPopped()).toEqual([]);
    expect(field.hit(POP_SPAWN, {x: 0, y: 1, z: 0})).toBeUndefined();
    expect(field.hit(POP_SPAWN, unit(POP_SPAWN, field.balls[0]), 1)).toBeUndefined();
    expect(field.pops).toBe(1);
    // Two balls on one ray: the nearer one pops.
    field.balls.push({id: 900, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 4, radius: .2, hits: 0}, {id: 901, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 8, radius: .2, hits: 0});
    expect(field.hit(POP_SPAWN, {x: 0, y: 0, z: -1})?.ball.id).toBe(900);
    field.reset();
    expect(field.balls).toHaveLength(3); expect(field.pops).toBe(0); expect(field.shots).toBe(0);
  });

  it('still fills the wall when the spacing cannot be honoured, and the settings are bounded', () => {
    const field = new PopField(popConfig({...defaults, popSize: 80, popCount: 12, popSpacing: 5, popDistance: 3}), POP_SPAWN, lcg(11));
    expect(field.balls).toHaveLength(12);
    const settings = sanitizeSettings({popSize: 500, popCount: 0, popSpacing: -1, popDistance: 1000, popColor: 'red'});
    expect([settings.popSize, settings.popCount, settings.popSpacing, settings.popDistance, settings.popColor]).toEqual([80, 1, .2, 40, '#ff6a4d']);
    expect(sanitizeSettings({popColor: '#4DF3FF', popCount: 4.4}).popColor).toBe('#4df3ff');
    expect(sanitizeSettings({popCount: 4.4}).popCount).toBe(4);
    expect(sanitizeSettings({}).popSize).toBe(30);
    expect([sanitizeSettings({}).popAmmo, sanitizeSettings({}).popSound]).toEqual(['magazine', 'hitmarker']);
    expect([sanitizeSettings({}).popMuteGun, sanitizeSettings({}).popHideImpacts, sanitizeSettings({}).popHideHud]).toEqual([false, false, false]);
    expect(sanitizeSettings({popMuteGun: true, popHideImpacts: 'yes', popHideHud: 1})).toMatchObject({popMuteGun: true, popHideImpacts: false, popHideHud: false});
    expect([sanitizeSettings({popAmmo: 'reserve', popSound: 'pop'}).popAmmo, sanitizeSettings({popAmmo: 'always', popSound: 'x'}).popAmmo]).toEqual(['reserve', 'magazine']);
    expect([sanitizeSettings({popSound: 'synth'}).popSound, sanitizeSettings({popSound: 'pop'}).popSound, sanitizeSettings({popSound: 'x'}).popSound]).toEqual(['synth', 'pop', 'hitmarker']);
  });

  it('never reloads by default: a held trigger keeps firing; infinite reserve reloads from a full reserve; normal runs down', () => {
    const run = (popAmmo: 'off' | 'reserve' | 'magazine') => {
      const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', primaryEnabled: true, spread: false, popAmmo});
      sim.start(true);
      for (let t = 0; t < 7; t += .25) sim.advance(.25);
      return sim;
    };
    const endless = run('magazine');
    expect(endless.pop!.shots).toBeGreaterThan(60); expect(endless.loadedAmmo).toBe(30); expect(endless.reserveAmmo).toBe(90); expect(endless.firing).toBe(true);
    const reserve = run('reserve');
    expect(reserve.pop!.shots).toBe(30); expect(reserve.reserveAmmo).toBe(90); expect(reserve.loadedAmmo).toBe(30);
    const normal = run('off');
    expect(normal.pop!.shots).toBe(30); expect(normal.reserveAmmo).toBe(60); expect(normal.loadedAmmo).toBe(30);
  });
});

describe('pop peek wall and hits to pop', () => {
  const base = {...defaults, popSize: 40, popCount: 3, popSpacing: 1, popDistance: 10, popHits: 1, popWall: 'off' as const};
  it('raises a 3 m wall 1.5 m ahead with its edge past the chosen shoulder, and centres the balls on the peek line', () => {
    expect(popWall({wall: 'off'}, POP_SPAWN)).toBeUndefined();
    const left = popWall({wall: 'left'}, POP_SPAWN)!, right = popWall({wall: 'right'}, POP_SPAWN)!;
    expect(left.side).toBe(-1); expect(left.edge).toBeCloseTo(-.35); expect(left.center).toEqual({x: 1.15, y: 1.4, z: .5});
    expect(left.size).toEqual({x: 3, y: 2.8, z: .4});
    expect(right.side).toBe(1); expect(right.edge).toBeCloseTo(.35); expect(right.center.x).toBeCloseTo(-1.15);
    expect(popRegion(popConfig({...base, popWall: 'left'}), POP_SPAWN).x).toBeCloseTo(-1);
    expect(popRegion(popConfig({...base, popWall: 'right'}), POP_SPAWN).x).toBeCloseTo(1);
    expect(popRegion(popConfig(base), POP_SPAWN).x).toBe(0);
  });

  it('stops bullets at the wall from behind it and lets them through once you have stepped out', () => {
    const field = new PopField(popConfig({...base, popWall: 'left'}), POP_SPAWN, lcg(5));
    field.balls.push({id: 900, x: 0, y: POP_SPAWN.y, z: POP_SPAWN.z - 10, radius: .2, hits: 0},
      {id: 901, x: -1, y: POP_SPAWN.y, z: POP_SPAWN.z - 10, radius: .2, hits: 0}, {id: 902, x: 2, y: POP_SPAWN.y, z: -8, radius: .2, hits: 0});
    const ahead = {x: 0, y: 0, z: -1};
    expect(field.wallHit(POP_SPAWN, ahead)?.distance).toBeCloseTo(1.3, 6);
    expect(field.wallHit(POP_SPAWN, ahead)?.point.z).toBeCloseTo(.7, 6);
    expect(field.wallHit(POP_SPAWN, ahead, 1)).toBeUndefined();
    expect(field.hit(POP_SPAWN, ahead)).toBeUndefined();
    // A ball that the wall hides from where you stand cannot be hit through it.
    expect(field.hit(POP_SPAWN, unit(POP_SPAWN, {x: 2, y: POP_SPAWN.y, z: -8}))).toBeUndefined();
    expect(field.hits).toBe(0);
    expect(rayBoxDistance(POP_SPAWN, {x: 0, y: 1, z: 0}, field.wall!)).toBeUndefined();
    expect(rayBoxDistance({x: 1.15, y: 1.4, z: .5}, ahead, field.wall!)).toBe(0);
    const peeked = {x: -1, y: POP_SPAWN.y, z: POP_SPAWN.z};
    expect(field.wallHit(peeked, ahead)).toBeUndefined();
    expect(field.hit(peeked, ahead)?.ball.id).toBe(901);
    expect(new PopField(popConfig(base), POP_SPAWN, lcg(5)).wallHit(POP_SPAWN, ahead)).toBeUndefined();
  });

  it('pops a ball only after the configured hits and counts every hit', () => {
    const field = new PopField(popConfig({...base, popHits: 3}), POP_SPAWN, lcg(9));
    const [first] = field.balls, dir = unit(POP_SPAWN, first);
    const one = field.hit(POP_SPAWN, dir)!;
    expect(one.popped).toBe(false); expect(one.ball).toBe(first); expect(first.hits).toBe(1);
    expect([field.hits, field.pops]).toEqual([1, 0]); expect(field.balls).toContain(first); expect(field.drainPopped()).toEqual([]);
    expect(field.hit(POP_SPAWN, dir)!.popped).toBe(false);
    const third = field.hit(POP_SPAWN, dir)!;
    expect(third.popped).toBe(true); expect([field.hits, field.pops]).toEqual([3, 1]);
    expect(field.balls).not.toContain(first); expect(field.balls).toHaveLength(3); expect(field.drainPopped()).toEqual([first]);
    expect(field.balls.every(ball => ball.hits === 0)).toBe(true);
    field.reset(); expect([field.hits, field.pops, field.shots]).toEqual([0, 0, 0]);
  });

  it('bounds the new settings and shows them in the drill summary', () => {
    expect(sanitizeSettings({})).toMatchObject({popHits: 1, popWall: 'off', popBackground: '#151a28', popRespawn: 0});
    expect([sanitizeSettings({popRespawn: -1}).popRespawn, sanitizeSettings({popRespawn: 9}).popRespawn, sanitizeSettings({popRespawn: 1.26}).popRespawn]).toEqual([0, 5, 1.3]);
    expect(sanitizeSettings({popHits: 0, popWall: 'up', popBackground: 'blue'})).toMatchObject({popHits: 1, popWall: 'off', popBackground: '#151a28'});
    expect(sanitizeSettings({popHits: 99, popWall: 'right', popBackground: '#F0F0EC'})).toMatchObject({popHits: 10, popWall: 'right', popBackground: '#f0f0ec'});
    expect(sanitizeSettings({popHits: 2.6, popWall: 'left'})).toMatchObject({popHits: 3, popWall: 'left'});
    expect(rangeDrillDefaults('pop')).toMatchObject({popHits: 1, popWall: 'off', popBackground: '#151a28'});
    const botz = sanitizeBotzConfig({}), duel = sanitizeDuelConfig({});
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popHits: 4, popWall: 'left', popRespawn: 1.5}), botz, duel)).toContain('4 hits to pop · peek wall, left · 1.5 s respawn');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop'}), botz, duel)).not.toMatch(/hits to pop|peek wall|respawn/);
  });

  it('blocks walking through the wall and puts you back behind it when the wall changes', () => {
    const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', popWall: 'left'});
    expect(sim.environment.solids.map(solid => solid.id)).toContain('pop-wall');
    sim.active = true; sim.input = {...sim.input, forward: 1};
    for (let t = 0; t < 2; t += .25) sim.advance(.25);
    // The wall's near face is at z = 0.7; the hull radius keeps you about 0.4 m from it.
    expect(sim.position.z).toBeGreaterThan(1); expect(sim.position.z).toBeLessThan(1.3);
    sim.configure({...sim.settings, popWall: 'off'});
    expect(sim.position).toEqual({...POP_SPAWN});
    expect(sim.environment.solids.map(solid => solid.id)).not.toContain('pop-wall');
    sim.active = true; sim.input = {...sim.input, forward: 1};
    for (let t = 0; t < 2; t += .25) sim.advance(.25);
    expect(sim.position.z).toBeLessThan(0);
  });

  it('delays a popped ball\'s replacement by the respawn delay, counted from the shot', () => {
    const field = new PopField(popConfig({...base, popRespawn: 1}), POP_SPAWN, lcg(13));
    const [first] = field.balls;
    expect(field.hit(POP_SPAWN, unit(POP_SPAWN, first), Infinity, 2)?.popped).toBe(true);
    expect(field.balls).toHaveLength(2); expect(field.pending).toEqual([3]); expect(field.pops).toBe(1);
    field.advance(2.9); expect(field.balls).toHaveLength(2);
    field.advance(3); expect(field.balls).toHaveLength(3); expect(field.pending).toEqual([]);
    // Two pops in a row come back in order; a reset drops the queue; no delay spawns at once as before.
    const [a, b] = field.balls;
    field.hit(POP_SPAWN, unit(POP_SPAWN, a), Infinity, 4); field.hit(POP_SPAWN, unit(POP_SPAWN, b), Infinity, 4.5);
    expect(field.balls).toHaveLength(1); expect(field.pending).toEqual([5, 5.5]);
    field.advance(5.2); expect(field.balls).toHaveLength(2);
    field.reset(); expect(field.pending).toEqual([]); expect(field.balls).toHaveLength(3);
    const instant = new PopField(popConfig(base), POP_SPAWN, lcg(13));
    instant.hit(POP_SPAWN, unit(POP_SPAWN, instant.balls[0]), Infinity, 7);
    expect(instant.balls).toHaveLength(3); expect(instant.pending).toEqual([]);
  });

  it('runs the respawn clock from the simulation, so a popped ball comes back as time passes', () => {
    const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', spread: false, popCount: 5, popRespawn: .5}, lcg(21));
    sim.onShot = shot => {sim.pop!.hit(shot.origin, shot.direction, shot.maxDistance, shot.at);};
    const ball = sim.pop!.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
    expect(sim.pop!.pops).toBe(1); expect(sim.pop!.balls).toHaveLength(4);
    sim.active = true;
    sim.advance(.25); expect(sim.pop!.balls).toHaveLength(4);
    sim.advance(.3); expect(sim.pop!.balls).toHaveLength(5);
  });
});
