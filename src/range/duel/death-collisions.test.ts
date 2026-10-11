import {describe, expect, it} from 'vitest';
import {CapsuleContacts, closestSegments, type DeathCapsule} from './death-collisions';
import {DeathPhysics} from './death-physics';

const distance = (a: number[], b: number[], c: number[], d: number[]) => {
  const result = new Float64Array(6); closestSegments(a, b, c, d, result); return result;
};
const crossed = [
  {name: 'a', position: {x: -.5, y: 1, z: 0}, radius: .05},
  {name: 'b', position: {x: .5, y: 1, z: 0}, radius: .05},
  {name: 'c', position: {x: 0, y: 1, z: -.5}, radius: .05},
  {name: 'd', position: {x: 0, y: 1, z: .5}, radius: .05},
];
const capsules: DeathCapsule[] = [
  {name: 'arm', a: 'a', b: 'b', radius: .08}, {name: 'leg', a: 'c', b: 'd', radius: .1},
];

describe('solid corpse limb contacts', () => {
  it('finds crossings missed by the endpoint spheres, including parallel and spherical bodies', () => {
    expect([...distance([-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1])]).toEqual([.5, .5, 0, 0, 0, 0]);
    expect(distance([0, 0, 0], [1, 0, 0], [.4, .2, 0], [2, .2, 0])[5]).toBeCloseTo(.2);
    expect(distance([0, 0, 0], [0, 0, 0], [-1, 1, 0], [1, 1, 0])[5]).toBe(1);
    expect(distance([0, 0, 0], [0, 0, 0], [2, 0, 0], [2, 0, 0])[5]).toBe(2);
    expect(distance([0, 0, 0], [1, 0, 0], [2, 1, 0], [2, 2, 0])[5]).toBeCloseTo(Math.SQRT2);
  });
  it('separates intersecting limbs while preserving lengths, centre of mass and the source pose', () => {
    const rag = new DeathPhysics(crossed, [{a: 'a', b: 'b'}, {a: 'c', b: 'd'}], undefined,
      {selfCollision: true, capsules, damping: .98, iterations: 16});
    for (let i = 0; i < 30; i++) rag.step(1 / 120, {gravity: 0});
    const points = crossed.map(b => {const p = rag.point(b.name)!; return [p.x, p.y, p.z];});
    expect(distance(...points as [number[], number[], number[], number[]])[5]).toBeGreaterThanOrEqual(.18 - 1e-6);
    expect(points.reduce((sum, p) => sum + p[1], 0) / 4).toBeCloseTo(1, 9);
    expect(Math.hypot(...points[0].map((v, i) => v - points[1][i]))).toBeCloseTo(1, 6);
    expect(crossed[0].position.y).toBe(1);
  });
  it('keeps the captured pose on handoff and releases initial overlap without an instantaneous jump', () => {
    const p = new Float64Array(crossed.flatMap(b => Object.values(b.position))), initial = p.slice();
    const contacts = new CapsuleContacts(capsules, crossed, p, new Float64Array([1, 1, 1, 1]));
    contacts.solve(0); expect([...p]).toEqual([...initial]);
    contacts.solve(.09);
    expect(distance([...p.slice(0, 3)], [...p.slice(3, 6)], [...p.slice(6, 9)], [...p.slice(9, 12)])[5]).toBeCloseTo(.09);
    contacts.solve(.18);
    expect(distance([...p.slice(0, 3)], [...p.slice(3, 6)], [...p.slice(6, 9)], [...p.slice(9, 12)])[5]).toBeCloseTo(.18);
  });
  it('moves a lighter arm farther than a heavy torso and handles coincident spheres', () => {
    const positions = new Float64Array([0, 0, 0, 0, 0, 0]);
    const bodies = [{name: 'a', position: {x: 0, y: 0, z: 0}, radius: .1}, {name: 'b', position: {x: 0, y: 0, z: 0}, radius: .1}];
    const contacts = new CapsuleContacts([{name: 'hand', a: 'a', b: 'a', radius: .1}, {name: 'trunk', a: 'b', b: 'b', radius: .2}], bodies, positions, new Float64Array([1, .1]));
    contacts.solve(1);
    expect(positions[0] - positions[3]).toBeCloseTo(.3);
    expect(positions[0]).toBeCloseTo(-positions[3] * 10);
  });
  it('excludes adjoining joints and explicit anatomical neighbours, but not crossing limbs', () => {
    const p = new Float64Array(crossed.flatMap(b => Object.values(b.position)));
    const m = new Float64Array([1, 1, 1, 1]);
    const joined = new CapsuleContacts([capsules[0], {...capsules[1], a: 'b'}], crossed, p, m);
    expect(joined.pairs).toHaveLength(0);
    const excluded = new CapsuleContacts([{...capsules[0], exclude: ['leg']}, capsules[1]], crossed, p, m);
    expect(excluded.pairs).toHaveLength(0);
    expect(new CapsuleContacts(capsules, crossed, p, m).pairs).toHaveLength(1);
    expect(() => new CapsuleContacts([{...capsules[0], radius: NaN}], crossed, p, m)).toThrow();
  });
  it('uses limb thickness for floor contact and is deterministic across render rates', () => {
    const bodies = crossed.slice(0, 2), links = [{a: 'a', b: 'b'}];
    const make = () => new DeathPhysics(bodies, links, undefined, {selfCollision: true, capsules: [capsules[0]]});
    const a = make(), b = make();
    for (let i = 0; i < 180; i++) a.step(1 / 60);
    for (let i = 0; i < 360; i++) b.step(1 / 120);
    expect([...a.positions]).toEqual([...b.positions]);
    expect(a.point('a')!.y).toBeCloseTo(.08);
  });
});
