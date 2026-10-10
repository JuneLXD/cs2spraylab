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
    field.balls.push({id: 900, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 4, radius: .2, hits: 0, vx: 0, vy: 0}, {id: 901, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 8, radius: .2, hits: 0, vx: 0, vy: 0});
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
    expect(left.side).toBe(-1); expect(left.edges).toEqual([-.35]); expect(left.center).toEqual({x: 1.15, y: 1.4, z: .5});
    expect(left.size).toEqual({x: 3, y: 2.8, z: .4});
    expect(right.side).toBe(1); expect(right.edges).toEqual([.35]); expect(right.center.x).toBeCloseTo(-1.15);
    expect(popRegion(popConfig({...base, popWall: 'left'}), POP_SPAWN).x).toBeCloseTo(-1);
    expect(popRegion(popConfig({...base, popWall: 'right'}), POP_SPAWN).x).toBeCloseTo(1);
    expect(popRegion(popConfig(base), POP_SPAWN).x).toBe(0);
    // Both sides: a pillar centred on you with an edge each way; the balls stay centred.
    const both = popWall({wall: 'both'}, POP_SPAWN)!;
    expect(both.side).toBe(0); expect(both.edges).toEqual([-.8, .8]); expect(both.center).toEqual({x: 0, y: 1.4, z: .5});
    expect(both.size).toEqual({x: 1.6, y: 2.8, z: .4});
    expect(popRegion(popConfig({...base, popWall: 'both'}), POP_SPAWN).x).toBe(0);
    const pillar = new PopField(popConfig({...base, popWall: 'both'}), POP_SPAWN, lcg(5)), ahead = {x: 0, y: 0, z: -1};
    expect(pillar.wallHit(POP_SPAWN, ahead)?.distance).toBeCloseTo(1.3, 6);
    expect(pillar.wallHit({x: -1.3, y: POP_SPAWN.y, z: POP_SPAWN.z}, ahead)).toBeUndefined();
    expect(pillar.wallHit({x: 1.3, y: POP_SPAWN.y, z: POP_SPAWN.z}, ahead)).toBeUndefined();
  });

  it('stops bullets at the wall from behind it and lets them through once you have stepped out', () => {
    const field = new PopField(popConfig({...base, popWall: 'left'}), POP_SPAWN, lcg(5));
    field.balls.push({id: 900, x: 0, y: POP_SPAWN.y, z: POP_SPAWN.z - 10, radius: .2, hits: 0, vx: 0, vy: 0},
      {id: 901, x: -1, y: POP_SPAWN.y, z: POP_SPAWN.z - 10, radius: .2, hits: 0, vx: 0, vy: 0}, {id: 902, x: 2, y: POP_SPAWN.y, z: -8, radius: .2, hits: 0, vx: 0, vy: 0});
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
    expect(sanitizeSettings({popWall: 'both'}).popWall).toBe('both');
    expect([sanitizeSettings({}).popMoveX, sanitizeSettings({popMoveX: 9, popMoveY: -2}).popMoveX, sanitizeSettings({popMoveX: 9, popMoveY: -2}).popMoveY, sanitizeSettings({popMoveY: 1.26}).popMoveY]).toEqual([0, 6, 0, 1.3]);
    expect(sanitizeSettings({})).toMatchObject({popRespawnMode: 'timer', popRangeX: 1.5, popFlipX: 0, popRangeY: .5, popFlipY: 0});
    expect(sanitizeSettings({popRespawnMode: 'pad', popRangeX: 9, popFlipX: 2.55, popRangeY: 3, popFlipY: -1})).toMatchObject({popRespawnMode: 'pad', popRangeX: 5, popFlipX: 2.6, popRangeY: 1.4, popFlipY: 0});
    expect(sanitizeSettings({popRespawnMode: 'later'}).popRespawnMode).toBe('timer');
    expect(rangeDrillDefaults('pop')).toMatchObject({popHits: 1, popWall: 'off', popBackground: '#151a28'});
    const botz = sanitizeBotzConfig({}), duel = sanitizeDuelConfig({});
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popHits: 4, popWall: 'left', popRespawn: 1.5, popMoveX: 2, popMoveY: .5}), botz, duel)).toContain('4 hits to pop · peek wall, left · 1.5 s respawn · 2 m/s ±1.5 m left-right · 0.5 m/s ±0.5 m up-down');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRespawnMode: 'pad', popRespawn: 2, popMoveX: 2, popRangeX: 0}), botz, duel)).toContain(' · respawn on the pad · never reload');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRespawnMode: 'pad', popRespawn: 2, popMoveX: 2, popRangeX: 0}), botz, duel)).not.toMatch(/2 s respawn|left-right/);
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop'}), botz, duel)).not.toMatch(/hits to pop|peek wall|respawn|m\/s/);
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

  it('drifts the balls at the chosen speed within their range, turning back at the ends and parting when they meet', () => {
    const config = popConfig({...base, popCount: 4, popSize: 30, popDistance: 12, popMoveX: 2, popRangeX: .8, popMoveY: .5, popRangeY: .3});
    const field = new PopField(config, POP_SPAWN, lcg(17)), {region} = field, r = .15;
    const start = field.balls.map(ball => ({...ball}));
    expect(field.balls.every(ball => Math.abs(ball.vx) === 2 && Math.abs(ball.vy) === .5)).toBe(true);
    let turned = 0, previous = field.balls.map(ball => ball.vx);
    for (let t = 1 / 128; t <= 6; t += 1 / 128) {
      field.advance(t);
      field.balls.forEach((ball, i) => {
        expect(Math.abs(ball.vx)).toBe(2); expect(Math.abs(ball.vy)).toBe(.5);
        // Being pushed apart by a neighbour can shove a ball a little past its window or the field for one step.
        expect(Math.abs(ball.x - start[i].x)).toBeLessThanOrEqual(.8 + r); expect(Math.abs(ball.y - start[i].y)).toBeLessThanOrEqual(.3 + r);
        expect(Math.abs(ball.x - region.x)).toBeLessThanOrEqual(region.halfW + r); expect(Math.abs(ball.y - region.y)).toBeLessThanOrEqual(region.halfH + r);
        if (ball.vx !== previous[i]) turned++;
      });
      previous = field.balls.map(ball => ball.vx);
      for (const a of field.balls) for (const b of field.balls) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * r - .02);
    }
    expect(field.balls.map(ball => ball.id)).toEqual(start.map(ball => ball.id));
    expect(turned).toBeGreaterThanOrEqual(4);
    expect(field.balls.some((ball, i) => Math.abs(ball.x - start[i].x) > .4)).toBe(true);
    // Without sudden changes a lone ball only turns at the ends of its window; with them it also reverses in between.
    const calm = new PopField(popConfig({...base, popCount: 1, popMoveX: 1, popRangeX: .6}), POP_SPAWN, lcg(5)), [lone] = calm.balls;
    const ends = [Math.max(calm.region.x - calm.region.halfW, lone.x - .6), Math.min(calm.region.x + calm.region.halfW, lone.x + .6)];
    let last = lone.vx, turns = 0;
    for (let t = 1 / 128; t <= 6; t += 1 / 128) {
      calm.advance(t);
      if (lone.vx !== last) {last = lone.vx; turns++; expect(ends.some(end => Math.abs(lone.x - end) < 1e-9)).toBe(true);}
    }
    expect(turns).toBeGreaterThanOrEqual(4);
    const sudden = new PopField(popConfig({...base, popCount: 1, popMoveX: 1, popRangeX: 5, popFlipX: 2}), POP_SPAWN, lcg(5)), [jumpy] = sudden.balls;
    const edges = [sudden.region.x - sudden.region.halfW, sudden.region.x + sudden.region.halfW];
    let away = 0; last = jumpy.vx;
    for (let t = 1 / 128; t <= 6; t += 1 / 128) {
      sudden.advance(t);
      if (jumpy.vx !== last) {last = jumpy.vx; if (edges.every(edge => Math.abs(jumpy.x - edge) > 1e-6)) away++;}
    }
    expect(away).toBeGreaterThanOrEqual(6);
    // A ball heading for the field's edge turns back there; a still field never moves and draws no extra random numbers.
    const edge = new PopField(popConfig({...base, popCount: 1, popMoveX: 2, popRangeX: 5}), POP_SPAWN, lcg(3)), [runner] = edge.balls;
    runner.x = edge.region.x + edge.region.halfW - .1; runner.vx = 2;
    edge.advance(.1); expect(runner.x).toBeCloseTo(edge.region.x + edge.region.halfW, 9); expect(runner.vx).toBe(-2);
    const still = new PopField(popConfig(base), POP_SPAWN, lcg(3)), frozen = still.balls.map(ball => ({...ball}));
    still.advance(5); expect(still.balls).toEqual(frozen);
    expect(new PopField(popConfig({...base, popMoveX: 3, popRangeX: 0}), POP_SPAWN, lcg(3)).balls.map(({x, y}) => [x, y])).toEqual(frozen.map(({x, y}) => [x, y]));
  });

  it('in pad mode, popped balls wait until you step onto the pad', () => {
    const field = new PopField(popConfig({...base, popRespawnMode: 'pad', popRespawn: 1}), POP_SPAWN, lcg(29));
    const onPad = {...POP_SPAWN}, offPad = {x: -1, y: POP_SPAWN.y, z: POP_SPAWN.z};
    expect(field.pad).toEqual({x: 0, z: 2, radius: .45});
    expect(field.onPadAt(onPad)).toBe(true); expect(field.onPadAt({x: .3, y: 0, z: 2.3})).toBe(true); expect(field.onPadAt({x: .5, y: 0, z: 2})).toBe(false);
    field.advance(0, onPad);
    expect(field.hit(onPad, unit(onPad, field.balls[0]), Infinity, 1)?.popped).toBe(true);
    expect(field.balls).toHaveLength(2); expect(field.pending).toEqual([Infinity]);
    field.advance(2, onPad); field.advance(9, onPad);           // standing on it, and no timer, bring nothing back
    expect(field.balls).toHaveLength(2);
    field.advance(10, offPad); expect(field.balls).toHaveLength(2);
    field.advance(11, onPad); expect(field.balls).toHaveLength(3); expect(field.pending).toEqual([]);
    field.reset(); field.advance(12, onPad); expect(field.balls).toHaveLength(3);
  });

  it('brings pad-mode balls back when the player walks onto the pad in the simulation', () => {
    const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', spread: false, popCount: 5, popRespawnMode: 'pad'}, lcg(31));
    sim.onShot = shot => {sim.pop!.hit(shot.origin, shot.direction, shot.maxDistance, shot.at);};
    sim.active = true; sim.advance(.1);                         // starts on the pad: nothing to trigger
    const ball = sim.pop!.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
    expect(sim.pop!.pops).toBe(1); expect(sim.pop!.balls).toHaveLength(4);
    sim.active = true; sim.advance(1); expect(sim.pop!.balls).toHaveLength(4);
    sim.position.x = -1; sim.advance(.1); expect(sim.pop!.balls).toHaveLength(4);
    sim.position.x = 0; sim.advance(.1); expect(sim.pop!.balls).toHaveLength(5);
  });

  it('moves the balls from the simulation clock and pops them where they are now', () => {
    const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', spread: false, popCount: 3, popMoveX: 3}, lcg(23));
    const before = sim.pop!.balls.map(ball => ball.x);
    sim.active = true; sim.advance(.25);
    expect(sim.pop!.balls.map(ball => ball.x)).not.toEqual(before);
    sim.onShot = shot => {sim.pop!.hit(shot.origin, shot.direction, shot.maxDistance, shot.at);};
    const ball = sim.pop!.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
    expect(sim.pop!.pops).toBe(1);
  });
});
