import {describe, expect, it} from 'vitest';
import {UNIT} from '../actor-physics';
import {isKnifeBackstab, resolveDamage, resolvePelletDamage} from './damage';

describe('armor-aware native damage parameters', () => {
  it('protects chest/stomach/arms with armor, head only with a helmet, and never legs', () => {
    for (const group of ['chest', 'stomach', 'arm'] as const) expect(resolveDamage('nova', group, 0, 100, false).armorDamage).toBeGreaterThan(0);
    expect(resolveDamage('nova', 'head', 0, 100, false)).toEqual({healthDamage: 104, armorDamage: 0});
    expect(resolveDamage('nova', 'head', 0, 100, true)).toEqual({healthDamage: 52, armorDamage: 26});
    expect(resolveDamage('nova', 'leg', 0, 100, true)).toEqual({healthDamage: 19, armorDamage: 0});
  });
  it('truncates each hit to whole health and armor points like the game HUD', () => {
    // AK-47 chest on Kevlar: 36 * 1.55 / 2 = 27.9 -> 27 damage, (36 - 27.9) / 2 = 4.05 -> 4 armor.
    expect(resolveDamage('ak47', 'chest', 0, 100, true)).toEqual({healthDamage: 27, armorDamage: 4});
    expect(resolveDamage('m4a4', 'chest', 0, 100, true)).toEqual({healthDamage: 23, armorDamage: 4});
    expect(resolveDamage('awp', 'chest', 0, 100, true)).toEqual({healthDamage: 112, armorDamage: 1});
    // Falloff: 36 * 0.98 at 500 units -> 35.28 -> 35 unarmored.
    expect(resolveDamage('ak47', 'chest', 500 * UNIT, 0, false)).toEqual({healthDamage: 35, armorDamage: 0});
  });
  it('depletes armor across pellets instead of granting each pellet the original protection', () => {
    const hits = Array.from({length: 9}, () => ({group: 'chest' as const, distanceMeters: 0}));
    expect(resolvePelletDamage('nova', hits, 10, false)).toEqual({healthDamage: 213, armorDamage: 10});
    expect(resolvePelletDamage('nova', hits, 0, false)).toEqual({healthDamage: 234, armorDamage: 0});
  });
  it.each([
    ['primary', true, false, 40, 34, 3], ['primary', false, false, 25, 21, 1],
    ['primary', false, true, 90, 76, 6], ['secondary', false, false, 65, 55, 4],
    ['secondary', false, true, 180, 153, 13],
  ] as const)('%s first=%s back=%s uses the complete knife damage table', (attack, firstSlash, backstab, raw, armored, armorLoss) => {
    const context = {attack, firstSlash, backstab};
    expect(resolveDamage('knife', 'head', .5, 0, false, context).healthDamage).toBe(raw);
    expect(resolveDamage('knife', 'leg', .5, 100, false, context)).toEqual({healthDamage: armored, armorDamage: armorLoss});
  });
  it('bounds melee/Zeus rays and rejects invalid distances without damage', () => {
    expect(resolveDamage('knife', 'chest', 33 * UNIT, 0, false, {attack: 'secondary'}).healthDamage).toBe(0);
    expect(resolveDamage('knife', 'chest', 49 * UNIT, 0, false).healthDamage).toBe(0);
    expect(resolveDamage('zeus', 'chest', 121 * UNIT, 0, false).healthDamage).toBe(0);
    for (const distance of [-1, NaN, Infinity]) expect(resolveDamage('ak47', 'head', distance, 100, true).healthDamage).toBe(0);
  });
  it('Zeus ignores helmet/armor and hitgroup multipliers', () => {
    const damage = resolveDamage('zeus', 'chest', 1, 0, false);
    expect(resolveDamage('zeus', 'head', 1, 100, true)).toEqual(damage);
    expect(resolveDamage('zeus', 'leg', 1, 100, true)).toEqual(damage);
    expect(damage.armorDamage).toBe(0);
  });
  it('checks victim-facing backstab geometry without screen-space coordinates', () => {
    const victim = {x: 0, y: 0, z: 0};
    expect(isKnifeBackstab({x: 0, y: 0, z: 1}, victim, 0)).toBe(true);
    expect(isKnifeBackstab({x: 0, y: 0, z: -1}, victim, 0)).toBe(false);
    expect(isKnifeBackstab({x: 1, y: 0, z: 0}, victim, 0)).toBe(false);
    expect(isKnifeBackstab(victim, victim, 0)).toBe(false);
  });
});
