import {GRAVITY, type Vec} from '../actor-physics';
import {CapsuleContacts, type DeathCapsule} from './death-collisions';
import {Vector3} from 'three';
import {LimbConstraints, type DeathLimb} from './death-joints';

export type DeathBody = {name: string; position: Vec; radius: number; mass?: number};
export type DeathLink = {a: string; b: string};
/** A distance range between two joints, in metres: the cheap verlet form of a joint angle limit. */
export type DeathStrut = {a: string; b: string; min?: number; max?: number};
/**
 * A one-sided joint limit: `joint` must stay at least `min` metres ahead of `pivot` along the forward axis of the
 * frame (origin, up, left, right); `sign` orients that axis (cross(right - left, up - origin) times sign).
 * Negative `min` allows that much backward travel: a hip or a spine hyperextending a few degrees, not folding back.
 */
export type DeathHinge = {joint: string; pivot: string; origin: string; up: string; left: string; right: string; min: number; sign: 1 | -1};
export type DeathContact = {body: string; point: Vec; normal: Vec; speed: number; solid: number};
export type DeathBox = {center: Vec; size: Vec};
export type DeathWorld = {floor?: number; boxes?: readonly DeathBox[]; gravity?: number};
export type DeathOptions = {
  struts?: readonly DeathStrut[];
  hinges?: readonly DeathHinge[];
  limbs?: readonly DeathLimb[];
  /** Keep joints that share no link apart by their radii (hands out of the chest, knees apart). */
  selfCollision?: boolean;
  /** Solid limb and torso volumes, including the gaps between joint spheres. */
  capsules?: readonly DeathCapsule[];
  /** Velocity kept per 1/120 s step. */
  damping?: number;
  /** Share of tangential motion removed on each floor or box contact. */
  friction?: number;
  iterations?: number;
};
const axes = ['x', 'y', 'z'] as const;
const STEP = 1 / 120;

/** Cosmetic joint/capsule PBD, deliberately independent of damage and live actor collision. */
export class DeathPhysics {
  readonly bodies: DeathBody[];
  readonly positions: Float64Array;
  private previous: Float64Array;
  private stepStart: Float64Array;
  private inverseMass: Float64Array;
  private links: {a: number; b: number; length: number}[];
  private struts: {a: number; b: number; min: number; max: number}[];
  private hinges: {joint: number; pivot: number; origin: number; up: number; left: number; right: number; min: number; sign: number}[];
  private pairs: [number, number][] = [];
  private readonly capsuleContacts?: CapsuleContacts;
  private readonly limbConstraints?: LimbConstraints;
  private readonly limbAxis = new Vector3();
  private readonly contactRadii: Float64Array;
  private readonly damping: number;
  private readonly friction: number;
  private readonly iterations: number;
  private accumulator = 0;
  private age = 0;
  private quiet = 0;
  private lastContacts = new Map<number, number>();
  sleeping = false;
  /** Correction distances applied per constraint kind in the last step() call, for tuning probes. */
  readonly stats = {links: 0, struts: 0, hinges: 0, limbs: 0, pairs: 0, capsules: 0, contacts: 0, speed: 0};
  constructor(bodies: readonly DeathBody[], links: readonly DeathLink[], velocity: Vec = {x: 0, y: 0, z: 0}, options: DeathOptions = {}) {
    if (bodies.length > 24 || new Set(bodies.map(b => b.name)).size !== bodies.length ||
      bodies.some(b => !axes.every(a => Number.isFinite(b.position[a])) || !Number.isFinite(b.radius) || b.radius <= 0 ||
        b.mass !== undefined && (!Number.isFinite(b.mass) || b.mass <= 0)))
      throw new Error('Death bodies must be finite, unique, positive-radius and bounded to 24.');
    this.bodies = bodies.map(b => ({...b, position: {...b.position}}));
    this.positions = new Float64Array(bodies.flatMap(b => axes.map(a => b.position[a])));
    this.previous = this.positions.slice();
    this.stepStart = this.positions.slice();
    this.inverseMass = new Float64Array(bodies.map(b => 1 / Math.max(.1, b.mass ?? 1)));
    this.contactRadii = new Float64Array(bodies.map(b => b.radius));
    this.damping = Math.min(1, Math.max(.9, options.damping ?? .992));
    this.friction = Math.min(1, Math.max(0, options.friction ?? .18));
    this.iterations = Math.min(24, Math.max(1, Math.round(options.iterations ?? 8)));
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z), cap = Number.isFinite(speed) ? Math.min(1, 8 / (speed || 1)) : 0;
    for (let i = 0; i < bodies.length; i++) for (let axis = 0; axis < 3; axis++)
      this.previous[i * 3 + axis] -= (cap ? velocity[axes[axis]] * cap : 0) * STEP;
    const index = (name: string) => bodies.findIndex(b => b.name === name);
    const distance = (a: number, b: number) => Math.hypot(...axes.map((_, k) => this.positions[a * 3 + k] - this.positions[b * 3 + k]));
    this.links = links.slice(0, 96).map(link => {
      const a = index(link.a), b = index(link.b);
      if (a < 0 || b < 0 || a === b) throw new Error('Death link endpoints must exist and differ.');
      return {a, b, length: distance(a, b)};
    });
    this.struts = (options.struts ?? []).slice(0, 64).map(strut => {
      const a = index(strut.a), b = index(strut.b);
      if (a < 0 || b < 0 || a === b) throw new Error('Death strut endpoints must exist and differ.');
      const min = strut.min ?? 0, max = strut.max ?? Infinity;
      if (!(min >= 0) || !(max >= min)) throw new Error('Death strut range must be ordered and non-negative.');
      return {a, b, min, max};
    });
    this.hinges = (options.hinges ?? []).slice(0, 16).map(hinge => {
      const joint = index(hinge.joint), pivot = index(hinge.pivot), origin = index(hinge.origin), up = index(hinge.up), left = index(hinge.left), right = index(hinge.right);
      if ([joint, pivot, origin, up, left, right].some(i => i < 0) || joint === pivot || left === right || up === origin || !Number.isFinite(hinge.min))
        throw new Error('Death hinge joints must exist and define a frame.');
      return {joint, pivot, origin, up, left, right, min: hinge.min, sign: hinge.sign < 0 ? -1 : 1};
    });
    if (options.limbs?.length) this.limbConstraints = new LimbConstraints(options.limbs, bodies, this.positions, this.inverseMass);
    if (options.selfCollision) {
      const joined = new Set([...this.links, ...this.struts].map(({a, b}) => a * 64 + b).flatMap(key => [key, (key % 64) * 64 + Math.floor(key / 64)]));
      for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) if (!joined.has(a * 64 + b)) this.pairs.push([a, b]);
      if (options.capsules?.length) {
        this.capsuleContacts = new CapsuleContacts(options.capsules, bodies, this.positions, this.inverseMass);
        this.capsuleContacts.expandRadii(this.contactRadii);
      }
    }
  }
  point(name: string): Vec | undefined {
    const i = this.bodies.findIndex(body => body.name === name) * 3;
    return i < 0 ? undefined : {x: this.positions[i], y: this.positions[i + 1], z: this.positions[i + 2]};
  }
  limbNormal(root: string): Vec | undefined {
    const normal = this.limbConstraints?.normal(root, this.limbAxis);
    return normal && {x: normal.x, y: normal.y, z: normal.z};
  }
  impulse(name: string, velocity: Vec) {
    const index = this.bodies.findIndex(body => body.name === name) * 3;
    if (index < 0 || !axes.every(a => Number.isFinite(velocity[a]))) return;
    for (let k = 0; k < 3; k++) this.previous[index + k] -= Math.max(-6, Math.min(6, velocity[axes[k]])) * STEP;
    this.sleeping = false; this.quiet = 0;
  }
  step(dt: number, world: DeathWorld = {}): DeathContact[] {
    if (this.sleeping || !Number.isFinite(dt) || dt <= 0) return [];
    this.accumulator = Math.min(this.accumulator + dt, STEP * 8);
    const contacts: DeathContact[] = [], boxes = world.boxes?.slice(0, 128) ?? [];
    this.stats.links = this.stats.struts = this.stats.hinges = this.stats.limbs = this.stats.pairs = this.stats.capsules = this.stats.contacts = this.stats.speed = 0;
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP; this.age += STEP;
      this.stepStart.set(this.positions);
      for (let i = 0; i < this.positions.length; i++) {
        const p = this.positions[i], delta = Math.max(-.08, Math.min(.08, (p - this.previous[i]) * this.damping));
        const gravity = Number.isFinite(world.gravity) && world.gravity! >= 0 ? world.gravity! : GRAVITY;
        this.previous[i] = p; this.positions[i] += delta - (i % 3 === 1 ? gravity * STEP * STEP : 0);
      }
      // Sweep before link relaxation, then project contacts after every iteration.
      for (let i = 0; i < this.bodies.length; i++) boxes.forEach((box, solid) => this.sweep(i, box, solid, contacts));
      for (let iteration = 0; iteration < this.iterations; iteration++) {
        for (const link of this.links) this.stats.links += this.separate(link.a, link.b, link.length, link.length);
        for (const strut of this.struts) this.stats.struts += this.separate(strut.a, strut.b, strut.min, strut.max);
        for (const hinge of this.hinges) this.stats.hinges += this.limitHinge(hinge);
        for (const [a, b] of this.pairs) this.stats.pairs += this.separate(a, b, (this.bodies[a].radius + this.bodies[b].radius) * .75, Infinity);
        this.stats.capsules += this.capsuleContacts?.solve(this.age) ?? 0;
        this.stats.limbs += this.limbConstraints?.solve() ?? 0;
        // Angular projection moves the endpoints of a limb. Close its lengths
        // and the torso frame again before placing those bones against solids.
        if (this.limbConstraints) for (const link of this.links) this.stats.links += this.separate(link.a, link.b, link.length, link.length);
        for (let i = 0; i < this.bodies.length; i++) {
          const at = i * 3, floor = (world.floor ?? 0) + this.contactRadii[i];
          if (this.positions[at + 1] < floor) this.contact(i, 1, floor, -1, contacts);
          boxes.forEach((box, solid) => this.collide(i, box, solid, contacts));
        }
      }
      let motion = 0;
      // Contacts edit `previous` to remove velocity. Sleep uses actual movement
      // between solved poses, not those artificial friction/contact offsets.
      for (let i = 0; i < this.positions.length; i++) motion = Math.max(motion, Math.abs(this.positions[i] - this.stepStart[i]) / STEP);
      this.stats.speed = Math.max(this.stats.speed, motion);
      // Hinges and contacts can alternate millimetre corrections in an otherwise
      // settled pose. Freeze those after half a second instead of visible buzzing.
      this.quiet = motion < (this.limbConstraints ? .18 : this.pairs.length ? .12 : .045) ? this.quiet + STEP : 0;
      // Sleeping freezes a solved contact pose; it does not switch to a canned floor pose.
      if (this.quiet > .5 || this.age > 8) {this.sleeping = true; this.accumulator = 0; break;}
    }
    return contacts;
  }
  /** Moves two joints so their distance lands inside [min, max], weighted by inverse mass. */
  private separate(a: number, b: number, min: number, max: number) {
    const ia = a * 3, ib = b * 3;
    const x = this.positions[ib] - this.positions[ia], y = this.positions[ib + 1] - this.positions[ia + 1],
      z = this.positions[ib + 2] - this.positions[ia + 2], length = Math.hypot(x, y, z);
    if (length < 1e-9) {
      // Coincident joints have no direction: nudge the lighter one up so the next pass can resolve them.
      if (min > 0) this.positions[(this.inverseMass[a] >= this.inverseMass[b] ? ia : ib) + 1] += min * .5;
      return min * .5;
    }
    const target = length < min ? min : length > max ? max : length;
    if (target === length) return 0;
    const correction = (length - target) / length / (this.inverseMass[a] + this.inverseMass[b]);
    const dx = x * correction, dy = y * correction, dz = z * correction;
    this.positions[ia] += dx * this.inverseMass[a]; this.positions[ia + 1] += dy * this.inverseMass[a]; this.positions[ia + 2] += dz * this.inverseMass[a];
    this.positions[ib] -= dx * this.inverseMass[b]; this.positions[ib + 1] -= dy * this.inverseMass[b]; this.positions[ib + 2] -= dz * this.inverseMass[b];
    return Math.abs(length - target);
  }
  private limitHinge(hinge: {joint: number; pivot: number; origin: number; up: number; left: number; right: number; min: number; sign: number}) {
    const p = this.positions, o = hinge.origin * 3, u = hinge.up * 3, l = hinge.left * 3, r = hinge.right * 3;
    const ux = p[u] - p[o], uy = p[u + 1] - p[o + 1], uz = p[u + 2] - p[o + 2];
    const lx = p[r] - p[l], ly = p[r + 1] - p[l + 1], lz = p[r + 2] - p[l + 2];
    // forward = sign * (lateral x up)
    let fx = ly * uz - lz * uy, fy = lz * ux - lx * uz, fz = lx * uy - ly * ux;
    const length = Math.hypot(fx, fy, fz);
    if (length < 1e-9) return 0;
    fx *= hinge.sign / length; fy *= hinge.sign / length; fz *= hinge.sign / length;
    const j = hinge.joint * 3, v = hinge.pivot * 3;
    const d = (p[j] - p[v]) * fx + (p[j + 1] - p[v + 1]) * fy + (p[j + 2] - p[v + 2]) * fz;
    if (d >= hinge.min) return 0;
    // Only the joint moves, softly: pushing the pivot would twist the rigid frame that defines the axis.
    const push = (hinge.min - d) * .5;
    p[j] += fx * push; p[j + 1] += fy * push; p[j + 2] += fz * push;
    return hinge.min - d;
  }
  private contact(body: number, axis: number, value: number, solid: number, contacts: DeathContact[]) {
    const index = body * 3 + axis, speed = Math.abs(this.positions[index] - this.previous[index]) / STEP;
    const normal: Vec = {x: 0, y: 0, z: 0}; normal[axes[axis]] = value >= this.positions[index] ? 1 : -1;
    this.stats.contacts += Math.abs(value - this.positions[index]);
    this.positions[index] = value; this.previous[index] = value;
    for (let k = 0; k < 3; k++) if (k !== axis) this.previous[body * 3 + k] += (this.positions[body * 3 + k] - this.previous[body * 3 + k]) * this.friction;
    if (speed > .6 && this.age - (this.lastContacts.get(body) ?? -Infinity) > .1) {
      this.lastContacts.set(body, this.age);
      const point = this.point(this.bodies[body].name)!;
      point[axes[axis]] -= normal[axes[axis]] * this.contactRadii[body];
      contacts.push({body: this.bodies[body].name, point, normal, speed, solid});
    }
  }
  private collide(body: number, box: DeathBox, solid: number, contacts: DeathContact[]) {
    const at = body * 3, radius = this.contactRadii[body];
    const x = this.positions[at], y = this.positions[at + 1], z = this.positions[at + 2];
    const minX = box.center.x - box.size.x / 2 - radius, maxX = box.center.x + box.size.x / 2 + radius;
    if (x >= maxX || x <= minX) return;
    const minY = box.center.y - box.size.y / 2 - radius, maxY = box.center.y + box.size.y / 2 + radius;
    if (y >= maxY || y <= minY) return;
    const minZ = box.center.z - box.size.z / 2 - radius, maxZ = box.center.z + box.size.z / 2 + radius;
    if (z >= maxZ || z <= minZ) return;
    // Same edge order and strict tie break as the array-based solver, without
    // allocating six bounds/edge arrays for every joint/box/relaxation pass.
    let axis = 0, value = minX, gap = Math.abs(minX - x);
    let d = Math.abs(maxX - x); if (d < gap) {value = maxX; gap = d;}
    d = Math.abs(minY - y); if (d < gap) {axis = 1; value = minY; gap = d;}
    d = Math.abs(maxY - y); if (d < gap) {axis = 1; value = maxY; gap = d;}
    d = Math.abs(minZ - z); if (d < gap) {axis = 2; value = minZ; gap = d;}
    d = Math.abs(maxZ - z); if (d < gap) {axis = 2; value = maxZ;}
    this.contact(body, axis, value, solid, contacts);
  }
  private sweep(body: number, box: DeathBox, solid: number, contacts: DeathContact[]) {
    const at = body * 3, radius = this.contactRadii[body];
    let near = 0, far = 1, hitAxis = -1, edge = 0;
    for (let k = 0; k < 3; k++) {
      const min = box.center[axes[k]] - box.size[axes[k]] / 2 - radius, max = min + box.size[axes[k]] + radius * 2;
      const from = this.previous[at + k], d = this.positions[at + k] - from;
      if (Math.abs(d) < 1e-9) {if (from < min || from > max) return; continue;}
      const a = (min - from) / d, b = (max - from) / d, enter = Math.min(a, b);
      if (enter > near) {near = enter; hitAxis = k; edge = d > 0 ? min : max;}
      far = Math.min(far, Math.max(a, b)); if (near > far) return;
    }
    if (hitAxis >= 0 && near >= 0 && near <= 1) {
      this.contact(body, hitAxis, edge, solid, contacts);
    }
  }
}

export const skeletalDeathLinks: DeathLink[] = [
  ['pelvis', 'spine_2'], ['spine_2', 'head_0'],
  ['spine_2', 'arm_upper_L'], ['arm_upper_L', 'arm_lower_L'], ['arm_lower_L', 'hand_L'],
  ['spine_2', 'arm_upper_R'], ['arm_upper_R', 'arm_lower_R'], ['arm_lower_R', 'hand_R'],
  ['pelvis', 'leg_lower_L'], ['leg_lower_L', 'ankle_L'], ['pelvis', 'leg_lower_R'], ['leg_lower_R', 'ankle_R'],
  ['arm_upper_L', 'arm_upper_R'], ['pelvis', 'arm_upper_L'], ['pelvis', 'arm_upper_R'],
].map(([a, b]) => ({a, b}));

/** Joints of the corpse rig: every limb joint of the native skeleton, so bones only rotate when the rig moves. */
export const corpseJoints: readonly {name: string; radius: number; mass: number}[] = [
  // Trunk spheres stay close to the hip and shoulder radii: a rigid frame whose joints want different floor
  // clearances never comes to rest on the floor.
  {name: 'pelvis', radius: .1, mass: 6}, {name: 'spine_2', radius: .11, mass: 4},
  {name: 'neck_0', radius: .09, mass: 1}, {name: 'head_0', radius: .12, mass: 2},
  {name: 'arm_upper_L', radius: .08, mass: 1.5}, {name: 'arm_lower_L', radius: .06, mass: 1}, {name: 'hand_L', radius: .045, mass: .6},
  {name: 'arm_upper_R', radius: .08, mass: 1.5}, {name: 'arm_lower_R', radius: .06, mass: 1}, {name: 'hand_R', radius: .045, mass: .6},
  {name: 'leg_upper_L', radius: .09, mass: 2}, {name: 'leg_lower_L', radius: .07, mass: 1.5}, {name: 'ankle_L', radius: .06, mass: 1},
  {name: 'leg_upper_R', radius: .09, mass: 2}, {name: 'leg_lower_R', radius: .07, mass: 1.5}, {name: 'ankle_R', radius: .06, mass: 1},
];
const corpseChain: readonly [string, string][] = [
  ['pelvis', 'spine_2'], ['spine_2', 'neck_0'], ['neck_0', 'head_0'],
  ['spine_2', 'arm_upper_L'], ['arm_upper_L', 'arm_lower_L'], ['arm_lower_L', 'hand_L'],
  ['spine_2', 'arm_upper_R'], ['arm_upper_R', 'arm_lower_R'], ['arm_lower_R', 'hand_R'],
  ['pelvis', 'leg_upper_L'], ['leg_upper_L', 'leg_lower_L'], ['leg_lower_L', 'ankle_L'],
  ['pelvis', 'leg_upper_R'], ['leg_upper_R', 'leg_lower_R'], ['leg_lower_R', 'ankle_R'],
];
/** A single torso frame preserves the captured spine curve and shoulder/hip alignment.
 * Separate hip and shoulder frames share only one point and can turn inside out around it. */
const corpseFrames: readonly (readonly string[])[] = [
  ['pelvis', 'leg_upper_L', 'leg_upper_R', 'spine_2', 'arm_upper_L', 'arm_upper_R', 'neck_0'],
];
/**
 * Joint limits as a fraction of the straight chain length (knees and elbows fold so far, the trunk cannot fold in
 * half) or of the distance in the death pose (`rest`). A limit never exceeds the pose's own distance, so the rig
 * starts at rest instead of fighting its first frame.
 */
const corpseLimits: readonly {a: string; b: string; through: string; min: number; basis?: 'chain' | 'rest'}[] = [
  {a: 'leg_upper_L', b: 'ankle_L', through: 'leg_lower_L', min: .82}, {a: 'leg_upper_R', b: 'ankle_R', through: 'leg_lower_R', min: .82},
  {a: 'arm_upper_L', b: 'hand_L', through: 'arm_lower_L', min: .35}, {a: 'arm_upper_R', b: 'hand_R', through: 'arm_lower_R', min: .35},
  {a: 'pelvis', b: 'head_0', through: 'spine_2', min: .82},
  // Standing legs give way without folding the knees into the chest. The rest-pose
  // clamp below still admits the full crouch or running pose at the instant of death.
  {a: 'leg_lower_L', b: 'spine_2', through: 'pelvis', min: .88}, {a: 'leg_lower_R', b: 'spine_2', through: 'pelvis', min: .88},
  // The head hangs on the neck: it can whip back or loll, but not drop onto a shoulder.
  {a: 'head_0', b: 'arm_upper_L', through: 'spine_2', min: .8, basis: 'rest'}, {a: 'head_0', b: 'arm_upper_R', through: 'spine_2', min: .8, basis: 'rest'},
];
const corpseCapsules: readonly DeathCapsule[] = [
  {name: 'hips', a: 'pelvis', b: 'spine_2', radius: .16, exclude: ['thigh_L', 'thigh_R', 'head']},
  {name: 'chest', a: 'spine_2', b: 'neck_0', radius: .17, exclude: ['upper_arm_L', 'upper_arm_R', 'head']},
  {name: 'head', a: 'head_0', b: 'head_0', radius: .12},
  ...(['L', 'R'] as const).flatMap(side => [
    {name: `upper_arm_${side}`, a: `arm_upper_${side}`, b: `arm_lower_${side}`, radius: .075, start: .2},
    {name: `forearm_${side}`, a: `arm_lower_${side}`, b: `hand_${side}`, radius: .065},
    {name: `hand_${side}`, a: `hand_${side}`, b: `hand_${side}`, radius: .085},
    {name: `thigh_${side}`, a: `leg_upper_${side}`, b: `leg_lower_${side}`, radius: .105, start: .15},
    {name: `shin_${side}`, a: `leg_lower_${side}`, b: `ankle_${side}`, radius: .075},
  ]),
];
export type CorpseRig = {bodies: DeathBody[]; links: DeathLink[]; struts: DeathStrut[]; hinges: DeathHinge[]; limbs: DeathLimb[]; capsules: DeathCapsule[]};
/** Builds the rig from the bones' world positions at death; joints the model lacks are left out with their constraints. */
export function buildCorpseRig(position: (bone: string) => Vec | undefined): CorpseRig | undefined {
  const bodies: DeathBody[] = [];
  for (const joint of corpseJoints) {
    const at = position(joint.name);
    if (at && axes.every(axis => Number.isFinite(at[axis]))) bodies.push({name: joint.name, radius: joint.radius, mass: joint.mass, position: {...at}});
  }
  const has = (name: string) => bodies.some(body => body.name === name);
  if (!has('pelvis') || !has('spine_2')) return undefined;
  const links: DeathLink[] = corpseChain.filter(([a, b]) => has(a) && has(b)).map(([a, b]) => ({a, b}));
  if (!has('neck_0') && has('head_0')) links.push({a: 'spine_2', b: 'head_0'});
  const seen = new Set(links.map(({a, b}) => `${a}|${b}`));
  for (const frame of corpseFrames) for (let i = 0; i < frame.length; i++) for (let j = i + 1; j < frame.length; j++) {
    const a = frame[i], b = frame[j];
    if (has(a) && has(b) && !seen.has(`${a}|${b}`) && !seen.has(`${b}|${a}`)) {links.push({a, b}); seen.add(`${a}|${b}`);}
  }
  const distance = (a: string, b: string) => {
    const p = position(a)!, q = position(b)!; return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };
  const struts: DeathStrut[] = corpseLimits.filter(limit => has(limit.a) && has(limit.b) && has(limit.through)).map(limit => {
    const span = limit.basis === 'rest' ? distance(limit.a, limit.b) : distance(limit.a, limit.through) + distance(limit.through, limit.b);
    return {a: limit.a, b: limit.b, min: Math.min(span * limit.min, distance(limit.a, limit.b) * .98)};
  });
  const limbs: DeathLimb[] = [];
  if (['neck_0', 'arm_upper_L', 'arm_upper_R'].every(has)) for (const side of ['L', 'R']) {
    for (const [kind, tip, maxBend, maxSwing, maxTwist] of [['leg', 'ankle', 110, 65, 30], ['arm', 'hand', 150, 130, 65]] as const) {
      const root = `${kind}_upper_${side}`, joint = `${kind}_lower_${side}`, end = `${tip}_${side}`;
      if ([root, joint, end].every(has)) limbs.push({root, joint, tip: end, maxBend: maxBend * Math.PI / 180,
        maxSwing: maxSwing * Math.PI / 180, maxTwist: maxTwist * Math.PI / 180});
    }
  }
  return {bodies, links, struts, hinges: [], limbs, capsules: corpseCapsules.filter(c => has(c.a) && has(c.b))};
}
