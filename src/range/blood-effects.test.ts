import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {BloodEffects} from './blood-effects';
import {randomStream} from './duel/rng';

const spread = (effects: BloodEffects, axis: 0 | 1 | 2) => {
  const position = effects.points.geometry.getAttribute('position'), alpha = effects.points.geometry.getAttribute('alpha');
  const values: number[] = [];
  for (let i = 0; i < alpha.count; i++) if (alpha.getX(i) > 0) values.push(position.array[i * 3 + axis]);
  return values;
};

describe('blood hit feedback', () => {
  it('bursts along the bullet, falls, fades out within half a second and leaves nothing behind', () => {
    const parent = new THREE.Group(), effects = new BloodEffects(parent, randomStream(7, 'blood'));
    expect(parent.children).toContain(effects.points); expect(effects.active).toBe(false);
    effects.burst({x: 1, y: 1.2, z: -3}, {x: 0, y: 0, z: -1}, 10);
    effects.update(10.08);
    expect(effects.active).toBe(true);
    const z = spread(effects, 2);
    expect(z.length).toBe(14);
    // Most droplets exit behind the body; a few splash back toward the shooter; none goes sideways by metres.
    expect(z.filter(value => value < -3).length).toBeGreaterThan(z.length / 2);
    expect(Math.max(...spread(effects, 0).map(value => Math.abs(value - 1)))).toBeLessThan(.5);
    const early = spread(effects, 1);
    effects.update(10.25);
    const later = spread(effects, 1);
    expect(later.reduce((sum, value) => sum + value, 0) / later.length).toBeLessThan(early.reduce((sum, value) => sum + value, 0) / early.length);
    effects.update(10.8);
    expect(effects.active).toBe(false);
    const alpha = effects.points.geometry.getAttribute('alpha');
    for (let i = 0; i < alpha.count; i++) expect(alpha.getX(i)).toBe(0);
  });
  it('recycles its pool, clears on demand and disposes its scene objects', () => {
    const parent = new THREE.Group(), effects = new BloodEffects(parent, randomStream(3, 'blood'));
    for (let i = 0; i < 40; i++) effects.burst({x: 0, y: 1, z: 0}, {x: 1, y: 0, z: 0}, i * .01);
    effects.update(.5);
    expect(effects.active).toBe(true);
    effects.clear(); expect(effects.active).toBe(false);
    effects.dispose(); expect(parent.children).not.toContain(effects.points);
  });
});
