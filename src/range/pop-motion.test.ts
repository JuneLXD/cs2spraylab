import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings, type Settings} from './config';
import {POP_SPAWN, PopField, popConfig, type PopBall} from './pop';
import {capturePopPreset, popPresetPatch, popVariantPatch} from './pop-presets';
import {heldAimName, resultAccuracy, Simulation} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';
import {recentSessions} from './ui/session-data';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const variants = ['floatingheads', 'pasu', 'driftts'] as const;
const seeded = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const setup = (variant: typeof variants[number], patch: Partial<Settings> = {}) =>
  sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch(variant), ...patch});
const field = (variant: typeof variants[number], patch: Partial<Settings> = {}, time = 0) => new PopField(popConfig(setup(variant, patch)), POP_SPAWN, seeded(3), time);
const ray = (ball: PopBall) => {
  const x = ball.x - POP_SPAWN.x, y = ball.y - POP_SPAWN.y, z = ball.z - POP_SPAWN.z, length = Math.hypot(x, y, z);
  return {x: x / length, y: y / length, z: z / length};
};

describe('moving Pop exercises', () => {
  it.each(variants)('%s moves continuously, remains centered and freezes when time is paused', variant => {
    const pop = field(variant), ids = pop.balls.map(ball => ball.id), initial = pop.balls.map(ball => ({...ball}));
    let previous = initial;
    for (let i = 1; i <= 1200; i++) {
      pop.advance(i / 120);
      expect(pop.balls.map(ball => ball.id)).toEqual(ids);
      for (const [j, ball] of pop.balls.entries()) {
        expect(Math.hypot(ball.x - previous[j].x, ball.y - previous[j].y)).toBeLessThan(.01);
        expect(Math.hypot(ball.x - pop.region.x, ball.y - pop.region.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
      previous = pop.balls.map(ball => ({...ball}));
    }
    expect(pop.balls.some((ball, i) => Math.hypot(ball.x - initial[i].x, ball.y - initial[i].y) > .05)).toBe(true);
    pop.advance(10); expect(pop.balls).toEqual(previous); expect(pop.pops).toBe(0);
  });

  it.each(variants)('%s has identical paths across 30 and 144 Hz updates and a long frame', variant => {
    const slow = field(variant), fast = field(variant), jump = field(variant);
    for (let i = 1; i <= 300; i++) slow.advance(i / 30);
    for (let i = 1; i <= 1440; i++) fast.advance(i / 144);
    jump.advance(10);
    for (const [i, ball] of slow.balls.entries()) for (const key of ['x', 'y', 'vx', 'vy'] as const) {
      expect(ball[key]).toBeCloseTo(fast.balls[i][key], 10); expect(ball[key]).toBeCloseTo(jump.balls[i][key], 10);
    }
  });

  it.each(variants)('%s honors current simulation time on entry/reset and starts replacement motion at its birth', variant => {
    const pop = field(variant, {popMotionCount: 1}, 90), initial = {...pop.balls[0]};
    pop.advance(90); expect(pop.balls[0]).toEqual(initial);
    pop.advance(90.01); expect(Math.hypot(pop.balls[0].x - initial.x, pop.balls[0].y - initial.y)).toBeLessThan(.01);
    const ball = pop.balls[0];
    if (variant === 'driftts') pop.hold(POP_SPAWN, ray(ball), .2, 90.01);
    else pop.hit(POP_SPAWN, ray(ball), Infinity, 90.01);
    const replacement = {...pop.balls[0]}; expect(replacement.id).not.toBe(initial.id);
    pop.advance(90.01); expect(pop.balls[0]).toEqual(replacement);
    pop.reset(); const reset = {...pop.balls[0]}; pop.advance(90.01); expect(pop.balls[0]).toEqual(reset);
    expect(pop.pops).toBe(0); expect(pop.pending).toEqual([]);
  });

  it.each(variants)('%s keeps even largest dots inside the view and above the floor at extreme settings', variant => {
    const pop = field(variant, {popSize: 80, popDistance: 3, popMotionRadius: 1.2, popMotionCount: 6,
      popMotionSpeed: 3, popMotionRate: 3, popFloatBob: .2});
    for (let i = 0; i < 300; i++) {
      pop.advance(i / 20);
      for (const ball of pop.balls) {
        expect(Math.hypot(ball.x, ball.y - POP_SPAWN.y)).toBeLessThanOrEqual(1.2 + 1e-9);
        expect(ball.y - ball.radius).toBeGreaterThan(0);
        expect(Math.abs(ball.x) + ball.radius).toBeLessThan(3);
      }
    }
  });

  it('Floating Heads stays in separated horizontal lanes, supports zero bob and gradually reverses', () => {
    const pop = field('floatingheads', {popFloatBob: 0}), start = pop.balls.map(ball => ({...ball}));
    const signs = new Set<number>();
    for (let i = 0; i < 120; i++) {
      pop.advance(i / 10); signs.add(Math.sign(pop.balls[0].vx));
      pop.balls.forEach((ball, j) => {expect(ball.y).toBe(start[j].y); expect(ball.vy).toBeCloseTo(0);});
    }
    expect(signs.has(1) && signs.has(-1)).toBe(true);
    const bobbing = field('floatingheads'), first = {...bobbing.balls[0]}; bobbing.advance(2);
    expect(Math.abs(bobbing.balls[0].y - first.y)).toBeGreaterThan(.01);
    const survivor = {...bobbing.balls[1]}; bobbing.hit(POP_SPAWN, ray(bobbing.balls[0]));
    expect(bobbing.balls[0]).toEqual(survivor);
  });

  it('Pasu travels diagonally, changes direction and scores against the current moving sphere', () => {
    const pop = field('pasu', {popMotionCount: 1}), initial = {...pop.balls[0]}, directions = new Set<string>();
    for (let i = 0; i < 100; i++) {
      pop.advance(i / 10); const ball = pop.balls[0];
      expect(Math.abs(ball.vx)).toBeGreaterThan(.1); expect(Math.abs(ball.vy)).toBeGreaterThan(.1);
      directions.add(`${Math.sign(ball.vx)},${Math.sign(ball.vy)}`);
    }
    expect(directions.size).toBe(4);
    expect(pop.hit(POP_SPAWN, ray(initial))).toBeUndefined();
    expect(pop.hit(POP_SPAWN, ray(pop.balls[0]))?.popped).toBe(true);
  });

  it('DriftTS changes speed smoothly, retains partial progress during movement and replaces after a held clear', () => {
    const pop = field('driftts', {popMotionCount: 1}), speeds: number[] = [];
    let prior = {...pop.balls[0]};
    for (let i = 1; i <= 600; i++) {
      pop.advance(i / 120); const ball = pop.balls[0], speed = Math.hypot(ball.vx, ball.vy); speeds.push(speed);
      expect(Math.hypot(ball.vx - prior.vx, ball.vy - prior.vy)).toBeLessThan(.08); prior = {...ball};
    }
    expect(Math.max(...speeds)).toBeGreaterThan(.3); expect(Math.min(...speeds)).toBeLessThan(.02);
    const ball = pop.balls[0]; expect(pop.hit(POP_SPAWN, ray(ball))).toBeUndefined();
    pop.hold(POP_SPAWN, ray(ball), .1); pop.advance(5.1);
    expect(ball.hits).toBeCloseTo(.5); expect(pop.hold(POP_SPAWN, ray(ball), .1)?.popped).toBe(true);
    expect(pop.pops).toBe(1); expect(pop.balls[0].id).not.toBe(ball.id); expect(pop.balls[0].hits).toBe(0);
  });

  it.each(variants)('%s supports delayed refill and clears motion state when reset', variant => {
    const pop = field(variant, {popMotionCount: 1, popRespawn: .5});
    const ball = pop.balls[0];
    if (variant === 'driftts') pop.hold(POP_SPAWN, ray(ball), .2);
    else pop.hit(POP_SPAWN, ray(ball));
    expect(pop.balls).toHaveLength(0); pop.advance(.49); expect(pop.balls).toHaveLength(0);
    pop.advance(.5); expect(pop.balls).toHaveLength(1); expect(pop.balls[0].hits).toBe(0);
    pop.reset(); pop.advance(.6); expect(pop.balls).toHaveLength(1); expect(pop.pops).toBe(0);
  });

  it('DriftTS uses held crosshair contact, stops when released and saves its own name and time accuracy', () => {
    const sim = new Simulation(setup('driftts', {popMotionCount: 1, popMotionSpeed: .1, popSize: 40}), seeded(4));
    const aim = () => {const ball = sim.pop!.balls[0], d = ray(ball); sim.yaw = Math.atan2(-d.x, -d.z); sim.pitch = Math.asin(d.y);};
    const ammo = sim.loadedAmmo; aim(); sim.pressTrigger();
    for (let i = 0; i < 15; i++) {aim(); sim.advance(.02);}
    sim.flushInput(); sim.release('mouse'); const held = sim.pop!.heldSeconds;
    expect(sim.pop!.pops).toBeGreaterThanOrEqual(1); sim.advance(.1); expect(sim.pop!.heldSeconds).toBe(held);
    expect(sim.loadedAmmo).toBe(ammo); expect(sim.pop!.shots).toBe(0); expect(sim.recoil).toEqual({yaw: 0, pitch: 0});
    sim.publishPopResult(); const result = sim.latest!;
    expect(result.pokeball?.variant).toBe('driftts'); expect(heldAimName(result)).toBe('DriftTS');
    // A replacement may appear between aim samples, so reacquiring it contributes a short miss.
    expect(resultAccuracy(result)).toBeGreaterThan(90); expect(resultAccuracy(result)).toBeLessThan(100);
    expect(recentSessions([result], {botz: [], reflex: [], redline: [], duel: []})[0]).toMatchObject({title: 'DriftTS', unit: 'ON TARGET'});
    sim.cancel(); const before = {...sim.pop!.balls[0]}; sim.advance(10); expect(sim.pop!.balls[0]).toEqual(before);
  });

  it.each(variants)('%s saves all controls and exposes only applicable settings', variant => {
    const settings = setup(variant, {popMotionCount: 4, popMotionSpeed: 1.3, popMotionRadius: .8,
      popMotionRate: 2.2, popFloatBob: .08, pop3D: true, popMoveX: 5, popWall: 'both', popRespawnMode: 'pad'});
    expect(popConfig(settings)).toMatchObject({count: 4, motionSpeed: 1.3, motionRadius: .8, wall: 'off', respawnMode: 'timer'});
    expect(popPresetPatch(capturePopPreset(settings, false))).toMatchObject({popVariant: variant, popMotionCount: 4,
      popMotionSpeed: 1.3, popMotionRadius: .8, popMotionRate: 2.2, popFloatBob: .08, pop3D: true});
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings, update: () => {}}));
    for (const label of ['Moving targets', 'Target speed', 'Center radius']) expect(html).toContain(label);
    expect(html).not.toContain('Peek wall'); expect(html).not.toContain('Target spacing');
    expect(html.includes('Vertical bob')).toBe(variant === 'floatingheads');
    expect(html.includes('Direction changes')).toBe(variant !== 'floatingheads');
    expect(html.includes('Hold time')).toBe(variant === 'driftts');
    expect(html.includes('Hits to pop')).toBe(variant !== 'driftts');
    expect(rangeDrillDefaults('pop')).toMatchObject({popMotionCount: 3, popMotionSpeed: .6, popMotionRadius: 1, popMotionRate: 1.2, popFloatBob: .04});
  });

  it('bounds imported motion controls', () => {
    expect(sanitizeSettings({popMotionCount: 100, popMotionSpeed: -2, popMotionRadius: Infinity,
      popMotionRate: 99, popFloatBob: -.1})).toMatchObject({popMotionCount: 6, popMotionSpeed: .1, popMotionRadius: 1, popMotionRate: 3, popFloatBob: 0});
  });
});
