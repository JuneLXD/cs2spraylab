import {describe, expect, it} from 'vitest';
import {DeathPhysics, buildCorpseRig, corpseJoints} from './death-physics';

describe('cosmetic skeletal contact solver', () => {
  it('uses the shared native 800-unit gravity, not Earth gravity', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12}], []);
    rag.step(1 / 120); expect(rag.point('head')!.y).toBeCloseTo(2 - 800 * .0254 / 120 ** 2, 10);
  });
  it('settles against the floor without penetrating and freezes the solved pose', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12} ], []);
    const contacts = [];
    for (let n = 0; n < 600; n++) contacts.push(...rag.step(1 / 60));
    expect(rag.point('head')!.y).toBeCloseTo(.12); expect(rag.sleeping).toBe(true);
    expect(contacts.length).toBeGreaterThan(0); expect(contacts.length).toBeLessThan(8);
    expect(contacts[0].point.y).toBeCloseTo(0); expect(contacts[0].normal).toEqual({x: 0, y: 1, z: 0});
    const final = [...rag.positions]; rag.step(5); expect([...rag.positions]).toEqual(final);
  });
  it('lands on arbitrary prop tops and sweeps thin side walls', () => {
    const world = {boxes: [{center: {x: 0, y: .5, z: 0}, size: {x: 3, y: 1, z: 3}}]};
    const rag = new DeathPhysics([{name: 'hip', position: {x: 0, y: 3, z: 0}, radius: .12}], []);
    for (let n = 0; n < 300; n++) rag.step(1 / 60, world);
    expect(rag.point('hip')!.y).toBeCloseTo(1.12);
    const moving = new DeathPhysics([{name: 'hip', position: {x: -.3, y: 1, z: 0}, radius: .04}], [], {x: 8, y: 0, z: 0});
    const walls = [];
    for (let n = 0; n < 10; n++) walls.push(...moving.step(1 / 120, {boxes: [{center: {x: 0, y: 1, z: 0}, size: {x: .01, y: 5, z: 5}}]}));
    expect(moving.point('hip')!.x).toBeLessThanOrEqual(-.045 + 1e-8);
    expect(walls[0].solid).toBe(0); expect(walls[0].point.x).toBeCloseTo(-.005);
    expect(walls[0].normal.x).toBe(-1);
  });
  it('preserves link lengths, is deterministic across render rates, and does not mutate initial poses', () => {
    const bodies = [{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .12},
      {name: 'head', position: {x: 0, y: 2.7, z: .05}, radius: .12}];
    const links = [{a: 'hip', b: 'head'}];
    const a = new DeathPhysics(bodies, links), b = new DeathPhysics(bodies, links);
    a.impulse('head', {x: 2, y: -.5, z: 1}); b.impulse('head', {x: 2, y: -.5, z: 1});
    for (let n = 0; n < 120; n++) a.step(1 / 60);
    for (let n = 0; n < 240; n++) b.step(1 / 120);
    expect([...a.positions]).toEqual([...b.positions]); expect(bodies[0].position.y).toBe(2);
    const hip = a.point('hip')!, head = a.point('head')!;
    expect(Math.hypot(head.x - hip.x, head.y - hip.y, head.z - hip.z)).toBeCloseTo(Math.hypot(.7, .05), 2);
  });
  it('bounds catch-up after pauses and rejects invalid or oversized skeletons', () => {
    const a = new DeathPhysics([{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .1}], []);
    a.step(Infinity); a.step(NaN); expect(a.point('hip')!.y).toBe(2);
    a.step(100); expect(a.point('hip')!.y).toBeGreaterThan(1.9);
    expect(() => new DeathPhysics([{name: 'hip', position: {x: NaN, y: 0, z: 0}, radius: .1}], [])).toThrow();
    expect(() => new DeathPhysics(Array.from({length: 25}, (_, i) => ({name: String(i), position: {x: 0, y: 1, z: 0}, radius: .1})), [])).toThrow();
    expect(() => new DeathPhysics(a.bodies, [{a: 'hip', b: 'missing'}])).toThrow();
  });
});

/** A standing pose with the rifle held ahead: hands forward of the chest, knees a little ahead of the hips. */
const standing: Record<string, {x: number; y: number; z: number}> = {
  pelvis: {x: 0, y: 1, z: 0}, spine_2: {x: 0, y: 1.25, z: 0}, neck_0: {x: 0, y: 1.48, z: 0}, head_0: {x: 0, y: 1.6, z: 0},
  arm_upper_L: {x: -.2, y: 1.45, z: 0}, arm_lower_L: {x: -.25, y: 1.2, z: .08}, hand_L: {x: -.15, y: 1.1, z: .32},
  arm_upper_R: {x: .2, y: 1.45, z: 0}, arm_lower_R: {x: .25, y: 1.2, z: .08}, hand_R: {x: .1, y: 1.1, z: .3},
  leg_upper_L: {x: -.1, y: .95, z: 0}, leg_lower_L: {x: -.1, y: .5, z: .03}, ankle_L: {x: -.1, y: .06, z: 0},
  leg_upper_R: {x: .1, y: .95, z: 0}, leg_lower_R: {x: .1, y: .5, z: .03}, ankle_R: {x: .1, y: .06, z: 0},
};
const rigOf = (pose = standing) => buildCorpseRig(name => pose[name]);
const solver = (rig: NonNullable<ReturnType<typeof rigOf>>, velocity = {x: 0, y: 0, z: 0}) =>
  new DeathPhysics(rig.bodies, rig.links, velocity, {struts: rig.struts, hinges: rig.hinges, selfCollision: true, damping: .98, friction: .45, iterations: 10});

describe('corpse rig', () => {
  it('builds every joint of the native skeleton with limits the pose already satisfies', () => {
    const rig = rigOf()!;
    expect(rig.bodies.map(body => body.name)).toEqual(corpseJoints.map(joint => joint.name));
    expect(rig.links.length).toBeGreaterThan(14); expect(rig.hinges).toHaveLength(0);
    const at = (name: string) => rig.bodies.find(body => body.name === name)!.position;
    for (const strut of rig.struts) {
      const a = at(strut.a), b = at(strut.b);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThanOrEqual(strut.min!);
    }
    // Without gravity nothing fights: the first steps leave the pose where it is.
    const rest = solver(rig); rest.step(.1, {gravity: 0});
    rig.bodies.forEach((body, i) => expect(rest.point(body.name)!.y).toBeCloseTo(body.position.y, 6));
    expect(rigOf({pelvis: standing.pelvis})).toBeUndefined();
    expect(rigOf({pelvis: standing.pelvis, spine_2: standing.spine_2, head_0: standing.head_0})!.bodies).toHaveLength(3);
  });
  it('falls, keeps bone lengths, never sinks below the floor and settles within three seconds', () => {
    const rig = rigOf()!, rag = solver(rig);
    rag.impulse('spine_2', {x: 0, y: -.3, z: 2});
    for (let n = 0; n < 180; n++) rag.step(1 / 60, {floor: 0});
    expect(rag.sleeping).toBe(true);
    for (const body of rig.bodies) {
      const point = rag.point(body.name)!;
      expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
      expect(point.y).toBeGreaterThanOrEqual(body.radius - 1e-6);
    }
    expect(rag.point('head_0')!.y).toBeLessThan(.5); expect(rag.point('pelvis')!.y).toBeLessThan(.4);
    const head = rag.point('head_0')!, left = rag.point('ankle_L')!, right = rag.point('ankle_R')!;
    expect(Math.hypot(head.x - (left.x + right.x) / 2, head.z - (left.z + right.z) / 2)).toBeGreaterThan(1.2);
    for (const link of rig.links) {
      const a = rag.point(link.a)!, b = rag.point(link.b)!, pa = standing[link.a], pb = standing[link.b];
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z), 1);
    }
    for (const strut of rig.struts) {
      const a = rag.point(strut.a)!, b = rag.point(strut.b)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThanOrEqual(strut.min! - .02);
    }
  });
  it('pushes a joint ahead of its hinge and separates overlapping unlinked joints', () => {
    const bodies = [{name: 'origin', position: {x: 0, y: 0, z: 0}, radius: .05}, {name: 'up', position: {x: 0, y: 1, z: 0}, radius: .05},
      {name: 'left', position: {x: -.1, y: 0, z: 0}, radius: .05}, {name: 'right', position: {x: .1, y: 0, z: 0}, radius: .05},
      {name: 'knee', position: {x: 0, y: -.5, z: -.2}, radius: .05}];
    const rag = new DeathPhysics(bodies, [{a: 'origin', b: 'up'}, {a: 'origin', b: 'left'}, {a: 'origin', b: 'right'}, {a: 'left', b: 'right'}, {a: 'origin', b: 'knee'}], undefined,
      {hinges: [{joint: 'knee', pivot: 'origin', origin: 'origin', up: 'up', left: 'left', right: 'right', min: 0, sign: 1}]});
    rag.step(.05, {gravity: 0, floor: -10});
    expect(rag.point('knee')!.z).toBeGreaterThan(-.2);
    const pair = new DeathPhysics([{name: 'a', position: {x: 0, y: 1, z: 0}, radius: .1}, {name: 'b', position: {x: .02, y: 1, z: 0}, radius: .1}], [], undefined, {selfCollision: true});
    pair.step(.05, {gravity: 0});
    const a = pair.point('a')!, b = pair.point('b')!;
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(.1);
    expect(() => new DeathPhysics(bodies, [], undefined, {hinges: [{joint: 'knee', pivot: 'origin', origin: 'origin', up: 'up', left: 'left', right: 'missing', min: 0, sign: 1}]})).toThrow();
    expect(() => new DeathPhysics(bodies, [], undefined, {struts: [{a: 'knee', b: 'origin', min: 1, max: .5}]})).toThrow();
  });
});
