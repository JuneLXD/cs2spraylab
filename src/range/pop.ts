import {DEG, UNIT, type Vec} from './actor-physics';

/** Pop (after Refrag's Pop mode): bright balls float on a dark wall ahead of you; a shot pops the first ball it
 * crosses and a new one appears elsewhere. Sizes and distances are metres; the setting stores the size in cm.
 * `hits` is how many bullets a ball takes before it pops (1 = Refrag's one-tap balls; more lets a spray stay on one
 * ball). `wall` adds a peek wall 1.5 m ahead of you that you step out from, to the left or the right, or a pillar you can
 * step out of on either side ('both'). A popped ball's replacement appears after `respawn` seconds (0 = at once), or,
 * with `respawnMode` 'pad', when you step onto the pad on the floor at your spawn point behind the cover. Movement
 * per axis: `speed` (m/s), `range` (how far a ball travels each way from where it appeared, m) and `flips` (sudden
 * reversals per second on top of turning back at the ends of its range); a speed or range of 0 keeps that axis still. */
export type PopWallSide = 'off' | 'left' | 'right' | 'both';
export type PopRespawnMode = 'timer' | 'pad';
export type PopAxisMotion = {speed: number; range: number; flips: number};
export type PopConfig = {size: number; count: number; spacing: number; distance: number; hits: number; wall: PopWallSide;
  respawn: number; respawnMode: PopRespawnMode; x: PopAxisMotion; y: PopAxisMotion};
/** `vx`/`vy` are the ball's current drift (m/s) across and up the wall. */
export type PopBall = {id: number; x: number; y: number; z: number; radius: number; hits: number; vx: number; vy: number};
export type PopHit = {ball: PopBall; point: Vec; distance: number; popped: boolean};
export type PopRegion = {x: number; y: number; z: number; halfW: number; halfH: number};
/** The peek wall as a collision box: `side` is the direction you step out (-1 = left, +1 = right, 0 = either side of a
 * pillar) and `edges` the x of each edge you can step past. */
export type PopWall = {id: string; center: Vec; size: Vec; side: -1 | 0 | 1; edges: number[]};
/** The respawn pad: a disc on the floor you step onto to bring popped balls back. */
export type PopPad = {x: number; z: number; radius: number};

export const POP_EYE = 64 * UNIT;
/** Where you stand in Pop: the near end of the range, so 40 m of wall fit in front of you. */
export const POP_SPAWN: Vec = {x: 0, y: POP_EYE, z: 2};
export const popLimits = {size: [8, 80], count: [1, 12], spacing: [.2, 5], distance: [3, 40], hits: [1, 10], respawn: [0, 5],
  speedX: [0, 6], rangeX: [0, 5], flipsX: [0, 4], speedY: [0, 4], rangeY: [0, 1.4], flipsY: [0, 4]} as const;
export const popColors: readonly (readonly [string, string])[] = [['Orange', '#ff6a4d'], ['Yellow', '#ffd23f'], ['Green', '#5dff7f'],
  ['Cyan', '#4df3ff'], ['Pink', '#ff4dd2'], ['White', '#ffffff']];
export const popBackgrounds: readonly (readonly [string, string])[] = [['Navy', '#151a28'], ['Black', '#000000'], ['Charcoal', '#2b2f36'],
  ['Slate', '#5b6470'], ['White', '#f0f0ec'], ['Forest', '#1d4d33']];
/** Peek wall: its near edge sits just past your shoulder, 1.5 m ahead, and it reaches 3 m across the other way. The
 * two-sided pillar is 1.6 m wide and centred on you. */
export const POP_WALL = {edge: .35, width: 3, pillar: 1.6, height: 2.8, thickness: .4, ahead: 1.5, peek: 1} as const;
/** The respawn pad sits on your spawn point; you are on it within this radius (m) of its centre. */
export const POP_PAD = {radius: .45} as const;

export function popConfig(settings: {popSize: number; popCount: number; popSpacing: number; popDistance: number; popHits: number; popWall: PopWallSide;
  popRespawn: number; popRespawnMode: PopRespawnMode; popMoveX: number; popRangeX: number; popFlipX: number; popMoveY: number; popRangeY: number;
  popFlipY: number}): PopConfig {
  return {size: settings.popSize / 100, count: settings.popCount, spacing: settings.popSpacing, distance: settings.popDistance,
    hits: settings.popHits, wall: settings.popWall, respawn: settings.popRespawn, respawnMode: settings.popRespawnMode,
    x: {speed: settings.popMoveX, range: settings.popRangeX, flips: settings.popFlipX},
    y: {speed: settings.popMoveY, range: settings.popRangeY, flips: settings.popFlipY}};
}

export const popWallSide = (wall: PopWallSide): -1 | 0 | 1 => wall === 'left' ? -1 : wall === 'right' ? 1 : 0;
export const axisMoves = (axis: PopAxisMotion) => axis.speed > 0 && axis.range > 0;

/** The peek wall for the chosen side, or undefined when it is off. */
export function popWall(config: Pick<PopConfig, 'wall'>, origin: Vec): PopWall | undefined {
  if (config.wall === 'off') return undefined;
  const z = origin.z - POP_WALL.ahead, y = POP_WALL.height / 2;
  if (config.wall === 'both') return {id: 'pop-wall', side: 0, edges: [origin.x - POP_WALL.pillar / 2, origin.x + POP_WALL.pillar / 2],
    center: {x: origin.x, y, z}, size: {x: POP_WALL.pillar, y: POP_WALL.height, z: POP_WALL.thickness}};
  const side = popWallSide(config.wall) as -1 | 1, edge = origin.x + side * POP_WALL.edge;
  return {id: 'pop-wall', side, edges: [edge], center: {x: edge - side * POP_WALL.width / 2, y, z},
    size: {x: POP_WALL.width, y: POP_WALL.height, z: POP_WALL.thickness}};
}

export const popPad = (origin: Vec): PopPad => ({x: origin.x, z: origin.z, radius: POP_PAD.radius});

/** The wall the balls float on: centred ahead at eye height (on your peek line when a one-sided peek wall is up), wide
 * enough for the count at the requested spacing, and capped so every ball stays well inside the 90-degree 4:3 view and
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

type Travel = {minX: number; maxX: number; minY: number; maxY: number; flipX: number; flipY: number};

export class PopField {
  balls: PopBall[] = [];
  /** Balls burst, bullets that touched a ball (pops included), and shots fired this session. */
  pops = 0; hits = 0; shots = 0;
  /** Balls popped since the renderer last asked, for the burst animation. */
  private popped: PopBall[] = [];
  /** Replacements waiting: when each is due in simulation seconds (Infinity = until you step on the pad). */
  pending: number[] = [];
  private now = 0;
  /** Each drifting ball's travel window and next sudden reversal, by ball id. */
  private travel = new Map<number, Travel>();
  /** Whether you were on the pad at the last advance; unknown until the first one, so a session never starts by triggering it. */
  private onPad?: boolean;
  private nextId = 1;
  readonly region: PopRegion;
  readonly wall?: PopWall;
  readonly pad: PopPad;
  constructor(readonly config: PopConfig, origin: Vec, private readonly random: () => number = Math.random) {
    this.region = popRegion(config, origin);
    this.wall = popWall(config, origin);
    this.pad = popPad(origin);
    for (let i = 0; i < config.count; i++) this.spawn();
  }
  get moving() {return axisMoves(this.config.x) || axisMoves(this.config.y);}
  /** A new ball at least the chosen space from every other one; when the wall cannot fit that, the clearest spot tried. */
  private spawn() {
    const {region, config} = this, r = config.size / 2, gap = config.spacing + 2 * r;
    let best: PopBall | undefined, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = {id: this.nextId, x: region.x + (this.random() * 2 - 1) * region.halfW,
        y: region.y + (this.random() * 2 - 1) * region.halfH, z: region.z, radius: r, hits: 0, vx: 0, vy: 0};
      const clearance = Math.min(Infinity, ...this.balls.map(ball => Math.hypot(ball.x - candidate.x, ball.y - candidate.y)));
      if (clearance >= gap) {best = candidate; break;}
      if (clearance > bestClearance) {bestClearance = clearance; best = candidate;}
    }
    this.nextId++; this.balls.push(best!);
    if (this.moving) {
      // It drifts from where it appeared, as far as its range each way but never past the field's edge.
      const ball = best!, {x, y} = config;
      if (axisMoves(x)) ball.vx = x.speed * (this.random() < .5 ? -1 : 1);
      if (axisMoves(y)) ball.vy = y.speed * (this.random() < .5 ? -1 : 1);
      this.travel.set(ball.id, {minX: Math.max(region.x - region.halfW, ball.x - x.range), maxX: Math.min(region.x + region.halfW, ball.x + x.range),
        minY: Math.max(region.y - region.halfH, ball.y - y.range), maxY: Math.min(region.y + region.halfH, ball.y + y.range),
        flipX: this.nextFlip(x), flipY: this.nextFlip(y)});
    }
    return best!;
  }
  /** When the next sudden reversal on an axis is due: about every 1/flips seconds, jittered by half either way. */
  private nextFlip(axis: PopAxisMotion) {
    return axis.flips > 0 && axisMoves(axis) ? this.now + (.5 + this.random()) / axis.flips : Infinity;
  }
  /** Drifts every ball by `dt`: turn back at the ends of its travel, reverse when a sudden change is due, and part balls that met. */
  private move(dt: number, time: number) {
    for (const ball of this.balls) {
      const travel = this.travel.get(ball.id);
      if (!travel) continue;
      if (time >= travel.flipX) {ball.vx = -ball.vx; travel.flipX = this.nextFlip(this.config.x);}
      if (time >= travel.flipY) {ball.vy = -ball.vy; travel.flipY = this.nextFlip(this.config.y);}
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x <= travel.minX) {ball.x = travel.minX; ball.vx = Math.abs(ball.vx);} else if (ball.x >= travel.maxX) {ball.x = travel.maxX; ball.vx = -Math.abs(ball.vx);}
      if (ball.y <= travel.minY) {ball.y = travel.minY; ball.vy = Math.abs(ball.vy);} else if (ball.y >= travel.maxY) {ball.y = travel.maxY; ball.vy = -Math.abs(ball.vy);}
    }
    // Balls that ran into each other are pushed apart and, if still closing, bounce along the axis they met on.
    for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
      const a = this.balls[i], b = this.balls[j];
      const dx = b.x - a.x, dy = b.y - a.y, gap = Math.hypot(dx, dy), least = a.radius + b.radius;
      if (gap >= least || gap < 1e-9) continue;
      const push = (least - gap) / 2, nx = dx / gap, ny = dy / gap;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      if (Math.abs(dx) >= Math.abs(dy)) {if ((b.vx - a.vx) * dx < 0) {a.vx = -a.vx; b.vx = -b.vx;}}
      else if ((b.vy - a.vy) * dy < 0) {a.vy = -a.vy; b.vy = -b.vy;}
    }
  }
  /** Whether a player standing at `position` (x/z) is on the respawn pad. */
  onPadAt(position: Vec) {return Math.hypot(position.x - this.pad.x, position.z - this.pad.z) <= this.pad.radius;}
  /** Moves the balls on to `time` and spawns the replacements that are due: by the timer, or, in pad mode, all of them
   * the moment you step onto the pad (`player` is where you stand). */
  advance(time: number, player?: Vec) {
    const dt = Math.min(Math.max(time - this.now, 0), .25);
    this.now = time;
    if (this.config.respawnMode === 'pad') {
      if (player) {
        const on = this.onPadAt(player);
        if (on && this.onPad === false) while (this.pending.length) {this.pending.shift(); this.spawn();}
        this.onPad = on;
      }
    } else while (this.pending.length && this.pending[0] <= time + 1e-9) {this.pending.shift(); this.spawn();}
    if (dt > 0 && this.moving) this.move(dt, time);
  }
  /** Where a unit-direction ray meets the peek wall within `maxDistance`, if it is up and in the way. */
  wallHit(origin: Vec, direction: Vec, maxDistance = Infinity): {distance: number; point: Vec} | undefined {
    if (!this.wall) return undefined;
    const distance = rayBoxDistance(origin, direction, this.wall);
    if (distance === undefined || distance > maxDistance) return undefined;
    return {distance, point: {x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance}};
  }
  /** The nearest ball a unit-direction ray crosses within `maxDistance` and before the peek wall: it takes a hit, and
   * once it has taken `config.hits` it is popped and replaced (after the respawn delay counted from `time`, or when
   * you next step onto the pad). Undefined for a miss. */
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
    this.balls = this.balls.filter(ball => ball !== nearest!.ball); this.travel.delete(nearest.ball.id);
    this.pops++; this.popped.push(nearest.ball);
    if (this.config.respawnMode === 'pad') this.pending.push(Infinity);
    else if (this.config.respawn > 0) this.pending.push(time + this.config.respawn);
    else this.spawn();
    return nearest;
  }
  drainPopped() {const popped = this.popped; this.popped = []; return popped;}
  reset() {
    this.balls = []; this.popped = []; this.pending = []; this.travel.clear(); this.onPad = undefined;
    this.pops = this.hits = this.shots = 0;
    for (let i = 0; i < this.config.count; i++) this.spawn();
  }
}
