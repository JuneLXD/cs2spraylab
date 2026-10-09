import {describe, expect, it} from 'vitest';
import {POP_SPAWN, PopField, popConfig, popRegion} from './pop';
import {defaults, sanitizeSettings} from './config';
import {Simulation} from './simulation';

/** Deterministic stand-in for Math.random. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const unit = (from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return {x: dx / length, y: dy / length, z: dz / length};
};

describe('pop field', () => {
  it('floats the configured number of balls on a wall at the chosen distance, spaced as asked and inside the view', () => {
    const config = popConfig({popSize: 30, popCount: 6, popSpacing: 1, popDistance: 12});
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
    const field = new PopField(popConfig({popSize: 40, popCount: 3, popSpacing: 1, popDistance: 10}), POP_SPAWN, lcg(3));
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
    field.balls.push({id: 900, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 4, radius: .2}, {id: 901, x: POP_SPAWN.x, y: POP_SPAWN.y, z: POP_SPAWN.z - 8, radius: .2});
    expect(field.hit(POP_SPAWN, {x: 0, y: 0, z: -1})?.ball.id).toBe(900);
    field.reset();
    expect(field.balls).toHaveLength(3); expect(field.pops).toBe(0); expect(field.shots).toBe(0);
  });

  it('still fills the wall when the spacing cannot be honoured, and the settings are bounded', () => {
    const field = new PopField(popConfig({popSize: 80, popCount: 12, popSpacing: 5, popDistance: 3}), POP_SPAWN, lcg(11));
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
