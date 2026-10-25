import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings} from './config';
import {POP_SPAWN, PopField, popConfig} from './pop';
import {capturePopPreset, popPresetPatch, popVariantPatch} from './pop-presets';
import {rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const setup = {...defaults, mode: 'pop' as const, ...popVariantPatch('wide')};
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const aim = (point: {x: number; y: number; z: number}) => {
  const x = point.x - POP_SPAWN.x, y = point.y - POP_SPAWN.y, z = point.z - POP_SPAWN.z, d = Math.hypot(x, y, z);
  return {x: x / d, y: y / d, z: z / d};
};

describe('Micro Flicks', () => {
  it('starts at center, waits on misses, and moves only after the required hits', () => {
    const field = new PopField(popConfig({...setup, popHits: 2}), POP_SPAWN, seeded(1)), ball = {...field.balls[0]};
    expect([ball.x, ball.y, ball.z]).toEqual([POP_SPAWN.x, POP_SPAWN.y, POP_SPAWN.z - 8]);
    field.advance(100); expect(field.balls).toEqual([ball]);
    expect(field.hit(POP_SPAWN, {x: 0, y: 1, z: 0})).toBeUndefined();
    expect(field.hit(POP_SPAWN, aim(ball))?.popped).toBe(false);
    field.advance(200); expect(field.balls).toEqual([{...ball, hits: 1}]);
    expect(field.hit(POP_SPAWN, aim(ball))?.popped).toBe(true);
    expect(field.balls).toHaveLength(1); expect(field.balls[0].id).not.toBe(ball.id);
    expect(Math.hypot(field.balls[0].x - ball.x, field.balls[0].y - ball.y)).toBeCloseTo(.3);
    expect(field.hits).toBe(2); expect(field.pops).toBe(1);
  });

  it('takes short hops in every direction without drifting outside the fixed center circle', () => {
    const field = new PopField(popConfig(setup), POP_SPAWN, seeded(7)), directions = new Set<number>();
    let sameSide = 0;
    for (let i = 0; i < 1000; i++) {
      const before = field.balls[0];
      expect(field.hit(POP_SPAWN, aim(before))?.popped).toBe(true);
      expect(field.balls).toHaveLength(1);
      const after = field.balls[0], dx = after.x - before.x, dy = after.y - before.y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(.3, 10);
      expect(Math.hypot(after.x - field.region.x, after.y - field.region.y)).toBeLessThanOrEqual(1 + 1e-9);
      directions.add(Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8);
      if (before.x * after.x > 0) sameSide++;
    }
    expect(directions.size).toBe(8); expect(sameSide).toBeGreaterThan(500); expect(field.pops).toBe(1000);
  });

  it.each([0, .25, .5, .75])('turns inward instead of sticking at the boundary with a constant RNG of %s', value => {
    const field = new PopField(popConfig({...setup, popFlickRadius: .3, popFlickStep: 1, popSize: 80, popDistance: 3}), POP_SPAWN, () => value);
    for (let i = 0; i < 50; i++) {
      const before = field.balls[0]; field.hit(POP_SPAWN, aim(before));
      const after = field.balls[0];
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(.3);
      expect(Math.hypot(after.x - field.region.x, after.y - field.region.y)).toBeLessThanOrEqual(.3 + 1e-9);
      expect(after.y - after.radius).toBeGreaterThan(0);
    }
  });

  it('preserves the previous position through a delay and restarts at center', () => {
    const field = new PopField(popConfig({...setup, popRespawn: .5}), POP_SPAWN, seeded(5));
    for (let i = 0; i < 5; i++) {
      const before = field.balls[0]; field.hit(POP_SPAWN, aim(before), Infinity, i);
      field.advance(i + .49); expect(field.balls).toHaveLength(0);
      field.advance(i + .5); expect(field.balls).toHaveLength(1);
      expect(Math.hypot(field.balls[0].x - before.x, field.balls[0].y - before.y)).toBeCloseTo(.3);
    }
    field.hit(POP_SPAWN, aim(field.balls[0]), Infinity, 10); field.reset(); field.advance(20);
    expect(field.balls).toHaveLength(1); expect(field.pending).toEqual([]); expect(field.pops).toBe(0);
    expect([field.balls[0].x, field.balls[0].y]).toEqual([POP_SPAWN.x, POP_SPAWN.y]);
  });

  it('keeps the entire largest dot above the floor and within the view at the closest distance', () => {
    const field = new PopField(popConfig({...setup, popFlickRadius: 1.2, popFlickStep: 1, popSize: 80, popDistance: 3}), POP_SPAWN, seeded(6));
    for (let i = 0; i < 200; i++) {
      const ball = field.balls[0];
      expect(ball.y - ball.radius).toBeGreaterThan(0);
      expect(Math.abs(ball.x) + ball.radius).toBeLessThan(3);
      expect(Math.abs(ball.y - POP_SPAWN.y) + ball.radius).toBeLessThan(3 * .75);
      field.hit(POP_SPAWN, aim(ball));
    }
  });

  it('migrates old wide setups, bounds controls, and saves/restores the new settings', () => {
    expect(sanitizeSettings({popVariant: 'wide'})).toMatchObject({popVariant: 'wide', popFlickStep: .3, popFlickRadius: 1});
    expect(sanitizeSettings({popFlickStep: 10, popFlickRadius: -.5})).toMatchObject({popFlickStep: .3, popFlickRadius: .3});
    expect(sanitizeSettings({popFlickStep: 0, popFlickRadius: 100})).toMatchObject({popFlickStep: .05, popFlickRadius: 1.2});
    const captured = capturePopPreset({...setup, popFlickStep: .2, popFlickRadius: .6}, false);
    expect(popPresetPatch(captured)).toMatchObject({popVariant: 'wide', popFlickStep: .2, popFlickRadius: .6});
    expect(rangeDrillDefaults('pop')).toMatchObject({popFlickStep: .3, popFlickRadius: 1});
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings: setup, update: () => {}}));
    expect(html).toContain('Micro Flicks'); expect(html).not.toContain('Wide Flicks');
    expect(html).toContain('Jump distance'); expect(html).toContain('Center radius');
    expect(html).not.toContain('Dots per rectangle'); expect(html).not.toContain('Target speed');
  });
});
