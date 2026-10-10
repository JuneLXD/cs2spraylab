import {DEG, UNIT, type Vec} from './actor-physics';

/** Pop (after Refrag's Pop mode): bright balls float on a dark wall ahead of you; a shot pops the first ball it
 * crosses and a new one appears elsewhere. Sizes and distances are metres; the setting stores the size in cm.
 * `hits` is how many bullets a ball takes before it pops (1 = Refrag's one-tap balls; more lets a spray stay on one
 * ball). `wall` adds a peek wall 1.5 m ahead of you that you step out from, to the left or the right. `respawn` is the
 * delay in seconds before a popped ball's replacement appears (0 = at once). */
export type PopWallSide = 'off' | 'left' | 'right';
export type PopConfig = {size: number; count: number; spacing: number; distance: number; hits: number; wall: PopWallSide; respawn: number};
export type PopBall = {id: number; x: number; y: number; z: number; radius: number; hits: number};
export type PopHit = {ball: PopBall; point: Vec; distance: number; popped: boolean};
export type PopRegion = {x: number; y: number; z: number; halfW: number; halfH: number};
/** The peek wall as a collision box: `side` is the direction you step out (-1 = left, +1 = right) past its `edge`. */
export type PopWall = {id: string; center: Vec; size: Vec; side: -1 | 1; edge: number};

export const POP_EYE = 64 * UNIT;
/** Where you stand in Pop: the near end of the range, so 40 m of wall fit in front of you. */
export const POP_SPAWN: Vec = {x: 0, y: POP_EYE, z: 2};
export const popLimits = {size: [8, 80], count: [1, 12], spacing: [.2, 5], distance: [3, 40], hits: [1, 10], respawn: [0, 5]} as const;
export const popColors: readonly (readonly [string, string])[] = [['Orange', '#ff6a4d'], ['Yellow', '#ffd23f'], ['Green', '#5dff7f'],
  ['Cyan', '#4df3ff'], ['Pink', '#ff4dd2'], ['White', '#ffffff']];
export const popBackgrounds: readonly (readonly [string, string])[] = [['Navy', '#151a28'], ['Black', '#000000'], ['Charcoal', '#2b2f36'],
  ['Slate', '#5b6470'], ['White', '#f0f0ec'], ['Forest', '#1d4d33']];
/** Peek wall: its near edge sits just past your shoulder, 1.5 m ahead, and it reaches 3 m across the other way. */
export const POP_WALL = {edge: .35, width: 3, height: 2.8, thickness: .4, ahead: 1.5, peek: 1} as const;

export function popConfig(settings: {popSize: number; popCount: number; popSpacing: number; popDistance: number; popHits: number; popWall: PopWallSide;
  popRespawn: number}): PopConfig {
  return {size: settings.popSize / 100, count: settings.popCount, spacing: settings.popSpacing, distance: settings.popDistance,
    hits: settings.popHits, wall: settings.popWall, respawn: settings.popRespawn};
}

export const popWallSide = (wall: PopWallSide): -1 | 0 | 1 => wall === 'left' ? -1 : wall === 'right' ? 1 : 0;

/** The peek wall for the chosen side, or undefined when it is off. */
export function popWall(config: Pick<PopConfig, 'wall'>, origin: Vec): PopWall | undefined {
  const side = popWallSide(config.wall);
  if (!side) return undefined;
  const edge = origin.x + side * POP_WALL.edge;
  return {id: 'pop-wall', side, edge, center: {x: edge - side * POP_WALL.width / 2, y: POP_WALL.height / 2, z: origin.z - POP_WALL.ahead},
    size: {x: POP_WALL.width, y: POP_WALL.height, z: POP_WALL.thickness}};
}

/** The wall the balls float on: centred ahead at eye height (on your peek line when the peek wall is up), wide enough
 * for the count at the requested spacing, and capped so every ball stays well inside the 90-degree 4:3 view and
 * between knee and head height. */
export function popRegion(config: PopConfig, origin: Vec): PopRegion {
  const r = config.size / 2, gap = config.spacing + 2 * r;
  const wanted = Math.max(gap, gap * Math.sqrt(config.count) * .75);
  const halfW = Math.min(wanted, config.distance * Math.tan(45 * DEG) * .55);
  const halfH = Math.min(wanted * .6, config.distance * Math.tan(36.87 * DEG) * .45, 1.4);
  return {x: origin.x + popWallSide(config.wall) * POP_WALL.peek, y: origin.y, z: origin.z - config.distance,
    halfW: Math.max(halfW, r), halfH: Math.max(halfH, r)};
}

/** Distance along a unit ray to an axis-aligned box, 0 from inside it, undefined for a miss. */
export function rayBoxDistance(origin: Vec, direction: Vec, box: {center: Vec; size: Vec}): number | undefined {
  let near = 0, far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const min = box.center[axis] - box.size[axis] / 2, max = box.center[axis] + box.size[axis] / 2;
    const d = direction[axis], o = origin[axis];
    if (Math.abs(d) < 1e-12) {if (o < min || o > max) return undefined; continue;}
    let t1 = (min - o) / d, t2 = (max - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1); far = Math.min(far, t2);
    if (near > far) return undefined;
  }
  return near;
}

export class PopField {
  balls: PopBall[] = [];
  /** Balls burst, bullets that touched a ball (pops included), and shots fired this session. */
  pops = 0; hits = 0; shots = 0;
  /** Balls popped since the renderer last asked, for the burst animation. */
  private popped: PopBall[] = [];
  /** Replacements waiting for the respawn delay: when each is due, in simulation seconds. */
  pending: number[] = [];
  private now = 0;
  private nextId = 1;
  readonly region: PopRegion;
  readonly wall?: PopWall;
  constructor(readonly config: PopConfig, origin: Vec, private readonly random: () => number = Math.random) {
    this.region = popRegion(config, origin);
    this.wall = popWall(config, origin);
    for (let i = 0; i < config.count; i++) this.spawn();
  }
  /** A new ball at least the chosen space from every other one; when the wall cannot fit that, the clearest spot tried. */
  private spawn() {
    const {region, config} = this, r = config.size / 2, gap = config.spacing + 2 * r;
    let best: PopBall | undefined, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = {id: this.nextId, x: region.x + (this.random() * 2 - 1) * region.halfW,
        y: region.y + (this.random() * 2 - 1) * region.halfH, z: region.z, radius: r, hits: 0};
      const clearance = Math.min(Infinity, ...this.balls.map(ball => Math.hypot(ball.x - candidate.x, ball.y - candidate.y)));
      if (clearance >= gap) {best = candidate; break;}
      if (clearance > bestClearance) {bestClearance = clearance; best = candidate;}
    }
    this.nextId++; this.balls.push(best!);
    return best!;
  }
  /** Where a unit-direction ray meets the peek wall within `maxDistance`, if it is up and in the way. */
  wallHit(origin: Vec, direction: Vec, maxDistance = Infinity): {distance: number; point: Vec} | undefined {
    if (!this.wall) return undefined;
    const distance = rayBoxDistance(origin, direction, this.wall);
    if (distance === undefined || distance > maxDistance) return undefined;
    return {distance, point: {x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance}};
  }
  /** Spawns the replacements whose respawn delay has passed by `time`. */
  advance(time: number) {
    this.now = time;
    while (this.pending.length && this.pending[0] <= time + 1e-9) {this.pending.shift(); this.spawn();}
  }
  /** The nearest ball a unit-direction ray crosses within `maxDistance` and before the peek wall: it takes a hit, and
   * once it has taken `config.hits` it is popped and replaced (after the respawn delay, counted from `time`).
   * Undefined for a miss. */
  hit(origin: Vec, direction: Vec, maxDistance = Infinity, time = this.now): PopHit | undefined {
    const limit = Math.min(maxDistance, this.wallHit(origin, direction, maxDistance)?.distance ?? Infinity);
    let nearest: PopHit | undefined;
    for (const ball of this.balls) {
      const ox = origin.x - ball.x, oy = origin.y - ball.y, oz = origin.z - ball.z;
      const b = ox * direction.x + oy * direction.y + oz * direction.z;
      const c = ox * ox + oy * oy + oz * oz - ball.radius * ball.radius;
      const discriminant = b * b - c;
      if (discriminant < 0) continue;
      const t = -b - Math.sqrt(discriminant);
      if (t < 0 || t > limit) continue;
      if (!nearest || t < nearest.distance) nearest = {ball, distance: t, popped: false,
        point: {x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t}};
    }
    if (!nearest) return undefined;
    this.hits++; nearest.ball.hits++;
    if (nearest.ball.hits < this.config.hits) return nearest;
    nearest.popped = true;
    this.balls = this.balls.filter(ball => ball !== nearest!.ball);
    this.pops++; this.popped.push(nearest.ball);
    if (this.config.respawn > 0) this.pending.push(time + this.config.respawn); else this.spawn();
    return nearest;
  }
  drainPopped() {const popped = this.popped; this.popped = []; return popped;}
  reset() {
    this.balls = []; this.popped = []; this.pending = []; this.pops = this.hits = this.shots = 0;
    for (let i = 0; i < this.config.count; i++) this.spawn();
  }
}
