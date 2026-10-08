import {describe, expect, it} from 'vitest';
import {Matrix4, Quaternion, Vector3} from 'three';
import {rayCapsule, traceHitboxes, type HitCapsule} from './hitboxes';
import {resolveBulletRay, type PenetrationActor} from './penetration';

const capsule = (patch: Partial<HitCapsule> = {}): HitCapsule => ({start: {x: 0, y: 0, z: 0}, end: {x: 0, y: 2, z: 0}, radius: .5, group: 'arm', index: 0, ...patch});
const forward = {x: 0, y: 0, z: -1};

describe('posed capsule rays', () => {
  it('intersects the barrel and both rounded ends at their physical surface', () => {
    expect(rayCapsule({x: 0, y: 1, z: 3}, forward, capsule())).toEqual({entry: 2.5, exit: 3.5});
    expect(rayCapsule({x: 0, y: 3, z: 0}, {x: 0, y: -1, z: 0}, capsule())).toEqual({entry: .5, exit: 3.5});
    expect(rayCapsule({x: 0, y: -1, z: 0}, {x: 0, y: 1, z: 0}, capsule())).toEqual({entry: .5, exit: 3.5});
    expect(rayCapsule({x: 0, y: 2.3, z: 3}, forward, capsule())!.entry).toBeCloseTo(2.6, 12);
  });
  it('rejects empty corners of a capsule bounding box', () => {
    expect(rayCapsule({x: .45, y: 2.45, z: 3}, forward, capsule())).toBeUndefined();
    expect(rayCapsule({x: 0, y: 2.51, z: 3}, forward, capsule())).toBeUndefined();
  });
  it('retains exact tangencies, starts inside, finite range and exits beyond range', () => {
    expect(rayCapsule({x: .5, y: 1, z: 3}, forward, capsule())).toEqual({entry: 3, exit: 3});
    expect(rayCapsule({x: 0, y: 1, z: 0}, forward, capsule())).toEqual({entry: 0, exit: .5});
    expect(rayCapsule({x: 0, y: 1, z: 3}, forward, capsule(), 2.49)).toBeUndefined();
    expect(rayCapsule({x: 0, y: 1, z: 3}, forward, capsule(), 2.5)).toEqual({entry: 2.5, exit: 3.5});
    expect(rayCapsule({x: 0, y: 1, z: -3}, forward, capsule())).toBeUndefined();
  });
  it('handles sphere-shaped joints and rejects invalid geometry', () => {
    expect(rayCapsule({x: 0, y: 0, z: 3}, forward, capsule({end: {x: 0, y: 0, z: 0}}))).toEqual({entry: 2.5, exit: 3.5});
    for (const radius of [0, -1, NaN, Infinity]) expect(rayCapsule({x: 0, y: 0, z: 3}, forward, capsule({radius}))).toBeUndefined();
    expect(rayCapsule({x: 0, y: 1, z: 3}, {x: 0, y: 0, z: 0}, capsule())).toBeUndefined();
  });
  it('preserves crossings under arbitrary rigid poses', () => {
    for (let i = 0; i < 80; i++) {
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), i * .137);
      const matrix = new Matrix4().compose(new Vector3(i - 30, -i * .2, i * .07), rotation, new Vector3(1, 1, 1));
      const transform = (v: {x: number; y: number; z: number}) => new Vector3(v.x, v.y, v.z).applyMatrix4(matrix);
      const shape = capsule(), posed = {...shape, start: transform(shape.start), end: transform(shape.end)};
      const hit = rayCapsule(transform({x: .2, y: 1, z: 3}), new Vector3(0, 0, -1).applyQuaternion(rotation), posed)!;
      expect(hit.entry).toBeCloseTo(3 - Math.sqrt(.25 - .04), 10);
      expect(hit.exit).toBeCloseTo(3 + Math.sqrt(.25 - .04), 10);
    }
  });
  it('uses the nearest group and the complete actor flesh chord', () => {
    const front = capsule({start: {x: 0, y: 0, z: 2}, end: {x: 0, y: 2, z: 2}, group: 'head', index: 1});
    expect(traceHitboxes({x: 0, y: 1, z: 4}, forward, [capsule(), front])).toEqual({distance: 1.5, exitDistance: 4.5, group: 'head'});
    expect(traceHitboxes({x: 0, y: 1, z: 4}, forward, [])).toEqual({distance: Infinity, exitDistance: Infinity, group: undefined});
  });
  it('passes posed hitgroups, live armor and flesh exits through cover and collateral resolution', () => {
    const actor = (id: number, z: number): PenetrationActor => ({id, side: 'enemy', position: {x: 9, y: 1, z}, feet: 0, alive: true,
      armor: 100, helmet: false, hitboxes: [capsule({start: {x: 0, y: 0, z}, end: {x: 0, y: 2, z}, radius: .2, group: 'chest'})]});
    const result = resolveBulletRay({origin: {x: 0, y: 1, z: 0}, direction: forward, range: 30,
      equipment: 'awp', actors: [actor(1, -5), actor(2, -8)], shooterId: 0, shooterSide: 'player', arena: {solids: [
        {center: {x: 0, y: 1, z: -2}, size: {x: 2, y: 2, z: .01}, material: 'glass'}]}});
    expect(result.hits.map(h => h.actorId)).toEqual([1, 2]);
    expect(result.hits.every(h => h.group === 'chest' && h.armorDamage > 0)).toBe(true);
    expect(result.hits[0].distance).toBeCloseTo(4.8, 12);
    expect(result.hits[0].exitDistance).toBeCloseTo(5.2, 12);
    expect(result.hits[1].residualDamage).toBeLessThan(result.hits[0].residualDamage);
  });
  it('does not substitute analytic hits for an empty or missed visible pose', () => {
    const actor: PenetrationActor = {id: 1, side: 'enemy', position: {x: 0, y: 1, z: -5}, feet: 0, alive: true, hitboxes: []};
    const result = resolveBulletRay({origin: {x: 0, y: 1, z: 0}, direction: forward, range: 30, equipment: 'awp', actors: [actor], arena: {solids: []}});
    expect(result.hits).toEqual([]);
  });
});
