import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings, type Settings} from './config';
import {POP_SPAWN, PopField, popConfig, type PopBall} from './pop';
import {capturePopPreset, popPresetPatch, popVariantPatch} from './pop-presets';
import {Simulation, resultAccuracy} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';
import {RangeHistory} from './ui/screens/RangeHistory';
import {recentSessions} from './ui/session-data';

const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const setup = (variant: 'closepairs' | 'pokeball', patch: Partial<Settings> = {}) =>
  sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch(variant), ...patch});
const ray = (ball: PopBall) => {
  const x = ball.x - POP_SPAWN.x, y = ball.y - POP_SPAWN.y, z = ball.z - POP_SPAWN.z, d = Math.hypot(x, y, z);
  return {x: x / d, y: y / d, z: z / d};
};
const miss = {x: 0, y: 1, z: 0};

describe('Close Pairs', () => {
  it('keeps the surviving target fixed and replaces only the popped target nearby, inside a fixed center radius', () => {
    const field = new PopField(popConfig(setup('closepairs')), POP_SPAWN, seeded(7)), angles = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      expect(field.balls).toHaveLength(2);
      const [target, survivor] = field.balls, unchanged = {...survivor};
      expect(field.hit(POP_SPAWN, ray(target), Infinity, i)?.popped).toBe(true);
      expect(field.balls[0]).toBe(survivor); expect(survivor).toEqual(unchanged);
      const replacement = field.balls[1], dx = replacement.x - survivor.x, dy = replacement.y - survivor.y;
      expect(replacement.id).not.toBe(target.id); expect(Math.hypot(dx, dy)).toBeCloseTo(.35, 10);
      for (const ball of field.balls) expect(Math.hypot(ball.x - field.region.x, ball.y - field.region.y)).toBeLessThanOrEqual(1 + 1e-9);
      angles.add(Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8);
    }
    expect(angles.size).toBe(8); expect(field.pops).toBe(1000);
  });

  it.each([0, .25, .5, .75])('fits large dots without overlap and escapes the boundary with constant RNG %s', random => {
    const field = new PopField(popConfig(setup('closepairs', {popSize: 80, popPairGap: .12, popPairRadius: .3, popDistance: 3})), POP_SPAWN, () => random);
    for (let i = 0; i < 100; i++) {
      const [a, b] = field.balls;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
      for (const ball of field.balls) {
        expect(Math.hypot(ball.x - field.region.x, ball.y - field.region.y)).toBeLessThanOrEqual(field.config.pairRadius + 1e-9);
        expect(ball.y - ball.radius).toBeGreaterThan(0);
        expect(Math.abs(ball.x) + ball.radius).toBeLessThan(3);
      }
      field.hit(POP_SPAWN, ray(a), Infinity, i);
    }
  });

  it('respects misses, multiple hits and delayed replacements even when both dots clear before the delay', () => {
    const field = new PopField(popConfig(setup('closepairs', {popHits: 2, popRespawn: .5})), POP_SPAWN, seeded(1));
    const before = field.balls.map(ball => ({...ball}));
    expect(field.hit(POP_SPAWN, miss)).toBeUndefined(); field.advance(.2); expect(field.balls).toEqual(before);
    for (const ball of [...field.balls]) {
      expect(field.hit(POP_SPAWN, ray(ball), Infinity, .2)?.popped).toBe(false);
      expect(field.hit(POP_SPAWN, ray(ball), Infinity, .2)?.popped).toBe(true);
    }
    expect(field.balls).toHaveLength(0); field.advance(.69); expect(field.balls).toHaveLength(0);
    field.advance(.7); expect(field.balls).toHaveLength(2);
    field.hit(POP_SPAWN, ray(field.balls[0])); field.reset(); field.advance(2);
    expect(field.balls).toHaveLength(2); expect(field.pending).toEqual([]); expect(field.pops).toBe(0);
  });
});

describe('Pokeball', () => {
  it('requires held-fire time; bullets cannot bypass it, misses do not damage targets, and partial progress stays', () => {
    const field = new PopField(popConfig(setup('pokeball')), POP_SPAWN, seeded(2));
    const [a, b] = field.balls;
    expect(field.hit(POP_SPAWN, ray(a))).toBeUndefined(); expect(a.hits).toBe(0);
    field.hold(POP_SPAWN, ray(a), .05); expect(a.hits).toBeCloseTo(1 / 3); expect(field.holdProgress).toBeCloseTo(1 / 3);
    field.hold(POP_SPAWN, miss, .1); expect(a.hits).toBeCloseTo(1 / 3); expect(field.holdProgress).toBe(0);
    field.hold(POP_SPAWN, ray(b), .05); expect(a.hits).toBeCloseTo(1 / 3); expect(b.hits).toBeCloseTo(1 / 3);
    expect(field.hold(POP_SPAWN, ray(a), .1)?.popped).toBe(true);
    expect(field.balls).toHaveLength(2); expect(field.balls[0]).toBe(b); expect(b.hits).toBeCloseTo(1 / 3);
    expect(field.pops).toBe(1); expect(field.heldSeconds).toBeCloseTo(.3); expect(field.onTargetSeconds).toBeCloseTo(.2);
    expect(field.shots).toBe(0); expect(field.hits).toBe(0);
  });

  it.each(['ak47', 'deagle', 'awp'] as const)('holds with %s without weapon recoil, ammo use or bullet events', weapon => {
    const sim = new Simulation(setup('pokeball', weapon === 'deagle'
      ? {primaryEnabled: false, sidearm: weapon, popAmmo: 'off'} : {weapon, popAmmo: 'off'}), seeded(4));
    let bullets = 0; sim.onShot = () => bullets++;
    const ammo = sim.loadedAmmo;
    sim.pressTrigger(); sim.advance(.1); sim.flushInput(); expect(sim.pop!.pops).toBe(0);
    expect(sim.pop!.balls[0].hits).toBeCloseTo(2 / 3);
    sim.advance(.06); expect(sim.pop!.pops).toBe(1);
    expect(bullets).toBe(0); expect(sim.loadedAmmo).toBe(ammo); expect(sim.recoil).toEqual({yaw: 0, pitch: 0});
    sim.release('mouse'); const held = sim.pop!.heldSeconds;
    sim.advance(.2); expect(sim.pop!.heldSeconds).toBe(held); expect(sim.pop!.holdProgress).toBe(0);
  });

  it('freezes during pause, clears hold input on release, and resets all progress and statistics', () => {
    const sim = new Simulation(setup('pokeball'), seeded(1));
    sim.pressTrigger(); sim.advance(.05); sim.cancel();
    const saved = {...sim.pop!.balls[0]}, held = sim.pop!.heldSeconds;
    sim.advance(100); expect(sim.pop!.balls[0]).toEqual(saved); expect(sim.pop!.heldSeconds).toBe(held);
    sim.active = true; sim.advance(.2); expect(sim.pop!.heldSeconds).toBe(held);
    sim.pressTrigger(); sim.advance(.11); expect(sim.pop!.pops).toBe(1);
    sim.reset(); expect(sim.pop!.heldSeconds).toBe(0); expect(sim.pop!.onTargetSeconds).toBe(0);
    expect(sim.pop!.balls).toHaveLength(2); expect(sim.pop!.balls.every(ball => ball.hits === 0)).toBe(true);
    expect(sim.firing).toBe(false); expect(sim.active).toBe(false);
  });

  it.each([30, 60, 144])('accrues the same hold progress at %s render frames per second', fps => {
    const sim = new Simulation(setup('pokeball', {popHoldTime: .5}), seeded(2));
    sim.pressTrigger(); for (let i = 0; i < fps; i++) sim.advance(.3 / fps); sim.flushInput();
    expect(sim.pop!.heldSeconds).toBeCloseTo(.3, 9); expect(sim.pop!.balls[0].hits).toBeCloseTo(.6, 9);
  });

  it('saves and displays time-based session accuracy without inventing bullet counts', () => {
    const sim = new Simulation(setup('pokeball'), seeded(3));
    sim.pressTrigger(); sim.advance(.1); sim.flushInput(); sim.yaw = Math.PI / 2; sim.advance(.1); sim.flushInput(); sim.release('mouse');
    sim.publishPopResult(); sim.publishPopResult();
    const result = sim.latest!;
    expect(sim.attempts).toBe(1); expect(result.shots).toBe(0); expect(result.hits).toBe(0);
    expect(resultAccuracy(result)).toBeCloseTo(50);
    const html = renderToStaticMarkup(createElement(RangeHistory, {results: [result], legacy: []}));
    expect(html).toContain('Pokeball'); expect(html).toContain('50.0% on target'); expect(html).not.toContain('NaN');
    const [recent] = recentSessions([result], {botz: [], reflex: [], redline: [], duel: []});
    expect(recent).toMatchObject({title: 'Pokeball', value: '50%', unit: 'ON TARGET'});
  });
});

describe('paired Pop settings', () => {
  it.each(['closepairs', 'pokeball'] as const)('persists %s and all controls, isolates hidden classic rules and restores defaults', variant => {
    const settings = setup(variant, {popPairGap: .24, popPairRadius: .7, popHoldTime: .23, pop3D: true,
      popWall: 'both', popRespawnMode: 'pad', popMoveX: 3, popCount: 12});
    const config = popConfig(settings);
    expect(config).toMatchObject({count: 2, pairGap: .24, pairRadius: .7, holdTime: .23, wall: 'off', respawnMode: 'timer', moveChance: 0});
    const preset = popPresetPatch(capturePopPreset(settings, false));
    expect(preset).toMatchObject({popVariant: variant, popPairGap: .24, popPairRadius: .7, popHoldTime: .23, pop3D: true});
    expect(rangeDrillDefaults('pop')).toMatchObject({popPairGap: .35, popPairRadius: 1, popHoldTime: .15});
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings, update: () => {}}));
    expect(html).toContain('Target spacing'); expect(html).toContain('Center radius'); expect(html).not.toContain('Peek wall');
    if (variant === 'pokeball') {expect(html).toContain('Hold time'); expect(html).not.toContain('Hits to pop'); expect(html).not.toContain('Ammo mode');}
    else {expect(html).toContain('Hits to pop'); expect(html).not.toContain('Hold time');}
  });

  it('sanitizes imported values and limits effective spacing to the bounded area', () => {
    expect(sanitizeSettings({popPairGap: -1, popPairRadius: 999, popHoldTime: 'bad'})).toMatchObject({popPairGap: .12, popPairRadius: 1.2, popHoldTime: .15});
    expect(sanitizeSettings({popHoldTime: 2}).popHoldTime).toBe(.5);
    expect(popConfig(setup('closepairs', {popPairGap: 1, popPairRadius: .3})).pairGap).toBe(.3);
  });
});
