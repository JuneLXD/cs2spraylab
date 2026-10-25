import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings} from './config';
import {POP_SPAWN, PopField, popConfig} from './pop';
import {capturePopPreset, popPresetPatch, popVariantPatch} from './pop-presets';
import {rangeDrillDefaults} from './ui/drill-setup';

const settings = {...defaults, mode: 'pop' as const, ...popVariantPatch('microshot')};
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ray = (point: {x: number; y: number; z: number}) => {
  const x = point.x - POP_SPAWN.x, y = point.y - POP_SPAWN.y, z = point.z - POP_SPAWN.z, d = Math.hypot(x, y, z);
  return {x: x / d, y: y / d, z: z / d};
};

describe('Microshot rectangle groups', () => {
  it('keeps unhit dots and their rectangle fixed until the last dot is popped, in any order', () => {
    const field = new PopField(popConfig(settings), POP_SPAWN, seeded(4)), rectangle = {...field.cluster!};
    expect(field.balls).toHaveLength(3);
    const [first, second, third] = field.balls.map(ball => ({...ball}));
    expect(field.hit(POP_SPAWN, ray(second))?.popped).toBe(true);
    field.advance(100);
    expect(field.balls).toEqual([first, third]); expect(field.cluster).toEqual(rectangle);
    expect(field.clustersCleared).toBe(0); expect(field.pending).toEqual([]);
    field.hit(POP_SPAWN, ray(first)); field.advance(101);
    expect(field.balls).toEqual([third]); expect(field.cluster).toEqual(rectangle);
    field.hit(POP_SPAWN, ray(third));
    expect(field.balls).toEqual([]); expect(field.clustersCleared).toBe(1);
    // New dots only appear on the next update, so later pellets from the same shot cannot clear another group.
    expect(field.hit(POP_SPAWN, ray(third))).toBeUndefined();
    field.advance(101.01);
    expect(field.balls).toHaveLength(3); expect(field.cluster).not.toEqual(rectangle);
    expect(field.balls.every(ball => ball.id > third.id)).toBe(true);
    expect(field.pops).toBe(3);
  });

  it('starts the group delay at the final pop and resets pending groups and progress', () => {
    const field = new PopField(popConfig({...settings, popRespawn: 1, popClusterCount: 2}), POP_SPAWN, seeded(3));
    field.hit(POP_SPAWN, ray(field.balls[0]), Infinity, 1); field.advance(20);
    expect(field.balls).toHaveLength(1);
    field.hit(POP_SPAWN, ray(field.balls[0]), Infinity, 20);
    field.advance(20.99); expect(field.balls).toHaveLength(0);
    field.advance(21); expect(field.balls).toHaveLength(2);
    for (const ball of [...field.balls]) field.hit(POP_SPAWN, ray(ball), Infinity, 22);
    field.reset(); field.advance(30);
    expect(field.balls).toHaveLength(2); expect(field.clustersCleared).toBe(0);
    expect([field.hits, field.pops, field.shots]).toEqual([0, 0, 0]);
  });

  it('scores dots rather than the enclosing rectangle, and waits for all hits on every dot', () => {
    const field = new PopField(popConfig({...settings, popHits: 2}), POP_SPAWN, seeded(9)), rectangle = field.cluster!;
    expect(field.hit(POP_SPAWN, ray({...rectangle, x: rectangle.x + rectangle.halfW}))).toBeUndefined();
    expect(field.hit(POP_SPAWN, {x: 0, y: 0, z: 1})).toBeUndefined();
    for (const ball of [...field.balls]) {
      expect(field.hit(POP_SPAWN, ray(ball), 1)).toBeUndefined();
      expect(field.hit(POP_SPAWN, ray(ball))?.popped).toBe(false);
    }
    expect(field.balls).toHaveLength(3); expect(field.clustersCleared).toBe(0);
    for (const ball of [...field.balls]) expect(field.hit(POP_SPAWN, ray(ball))?.popped).toBe(true);
    expect(field.hits).toBe(6); expect(field.pops).toBe(3); expect(field.clustersCleared).toBe(1);
  });

  it.each([1, 3, 12])('keeps %i separate dots inside every rectangle and moves the whole group after clearing', count => {
    for (const extremes of [false, true]) for (const distance of [3, 8, 40]) {
      const field = new PopField(popConfig({...settings, popClusterCount: count, popDistance: distance,
        popSize: extremes ? 80 : 8, popClusterWidth: extremes ? .3 : .7, popClusterHeight: extremes ? .3 : .6}),
      POP_SPAWN, extremes ? () => .5 : seeded(17));
      for (let group = 0; group < 30; group++) {
        const box = {...field.cluster!};
        expect(field.balls).toHaveLength(count);
        expect(Math.abs(box.x - field.region.x) + box.halfW).toBeLessThanOrEqual(field.region.halfW + 1e-9);
        expect(Math.abs(box.y - field.region.y) + box.halfH).toBeLessThanOrEqual(field.region.halfH + 1e-9);
        expect(box.y - box.halfH).toBeGreaterThan(0);
        for (const [i, ball] of field.balls.entries()) {
          expect(Math.abs(ball.x - box.x) + ball.radius).toBeLessThan(box.halfW);
          expect(Math.abs(ball.y - box.y) + ball.radius).toBeLessThan(box.halfH);
          for (const other of field.balls.slice(i + 1)) expect(Math.hypot(ball.x - other.x, ball.y - other.y)).toBeGreaterThan(ball.radius + other.radius);
        }
        for (const ball of [...field.balls]) expect(field.hit(POP_SPAWN, ray(ball))?.popped).toBe(true);
        field.advance(group + 1);
        expect(Math.hypot(field.cluster!.x - box.x, field.cluster!.y - box.y)).toBeGreaterThan(0);
      }
    }
  });

  it('sanitizes, saves and restores count and dimensions, including older Microshot settings', () => {
    expect(sanitizeSettings({popVariant: 'microshot'})).toMatchObject({popClusterCount: 3, popClusterWidth: .7, popClusterHeight: .6});
    expect(sanitizeSettings({popClusterCount: 100, popClusterWidth: -1, popClusterHeight: 99})).toMatchObject({popClusterCount: 12, popClusterWidth: .3, popClusterHeight: 2});
    const captured = capturePopPreset({...settings, popClusterCount: 5, popClusterWidth: 1, popClusterHeight: .8}, false);
    expect(popPresetPatch(captured)).toMatchObject({popVariant: 'microshot', popClusterCount: 5, popClusterWidth: 1, popClusterHeight: .8});
    expect(rangeDrillDefaults('pop')).toMatchObject({popClusterCount: 3, popClusterWidth: .7, popClusterHeight: .6});
  });
});
