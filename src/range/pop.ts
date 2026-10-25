import {DEG, UNIT, type Vec} from './actor-physics';
import {resolveBulletRay, type PenetrationSolid, type PenetrationStats, type SurfaceContact} from './duel/penetration';

/** Pop (after Refrag's Pop mode): bright balls float on a dark wall ahead of you; a shot pops the first ball it
 * crosses and a new one appears elsewhere. Sizes and distances are metres; the setting stores the size in cm.
 * `hits` is how many bullets a ball takes before it pops (1 = Refrag's one-tap balls; more lets a spray stay on one
 * ball). `wall` adds a peek wall 1.5 m ahead of you that you step out from, to the left or the right, or a pillar you can
 * step out of on either side ('both'); `wallWidth` is how wide it is (m). With `wallbang` the wall no longer stops every
 * bullet: it is made of `wallMaterial` and the weapon's penetration decides, as in CS2, how much damage comes out the far
 * side (see `wallPass`). You start, and the respawn pad sits, centred behind it. A popped ball's replacement appears after
 * `respawn` seconds (0 = at once), or, with `respawnMode` 'pad',
 * when you step onto the pad on the floor: a `padWidth` by `padDepth` (m) rectangle across and along your line to the wall. Movement
 * per axis: `speed` (m/s), `range` (how far a ball travels each way from where it appeared, m) and `flips` (sudden
 * reversals per second on top of turning back at the ends of its range); a speed or range of 0 keeps that axis still.
 * `moveChance` is the share of balls that move at all: each ball that appears rolls it once and otherwise stays still. */
export type PopWallSide = 'off' | 'left' | 'right' | 'both';
export type PopRespawnMode = 'timer' | 'pad';
export type PopVariant = 'classic' | 'precision' | 'wide' | 'microshot';
export const popVariants: readonly {id: PopVariant; name: string; description: string}[] = [
  {id: 'classic', name: 'Classic Pop', description: 'Build your own field of balls, movement and peek cover.'},
  {id: 'precision', name: 'Center Return', description: 'Aim at the fixed center dot, shoot the moving dot entering from a side, then return to center to start the next rep.'},
  {id: 'wide', name: 'Wide Flicks', description: 'One target alternates across a wide field. Flick to the other side after each pop.'},
  {id: 'microshot', name: 'Microshot', description: 'One square target in a compact panel. Make small, controlled corrections; the whole square counts.'},
];
/** What a wallbangable peek wall is made of: it sets how much of a bullet's damage the wall eats (CS2 surface materials). It
 * never changes how the wall looks. */
export type PopWallMaterial = 'wood' | 'concrete' | 'metal';
export type PopAxisMotion = {speed: number; range: number; flips: number};
export type PopConfig = {variant: PopVariant; precisionSpeed: number; size: number; count: number; spacing: number; distance: number; hits: number; wall: PopWallSide; wallWidth: number;
  wallbang: boolean; wallMaterial: PopWallMaterial;
  respawn: number; respawnMode: PopRespawnMode; padWidth: number; padDepth: number; x: PopAxisMotion; y: PopAxisMotion; moveChance: number};
/** `vx`/`vy` are the ball's current drift (m/s) across and up the wall. */
export type PopBall = {id: number; x: number; y: number; z: number; radius: number; hits: number; vx: number; vy: number};
/** `wallbang` is true when the bullet came through the peek wall to reach the ball. */
export type PopHit = {ball: PopBall; point: Vec; distance: number; popped: boolean; wallbang: boolean};
/** Where a bullet met a face of the peek wall: distance along the ray (m), the point, the face's outward normal and the
 * damage the bullet carried at that face (an entry's is before the wall takes its share, an exit's after). */
export type PopWallContact = {distance: number; point: Vec; normal: Vec; damage: number};
/** What a wallbangable peek wall did to one bullet that met it: `entry` is where it hit the wall, `exit` where it came out
 * the far side (undefined when the wall stopped it) and `reach` how far along the ray (m) it can still do at least 1 damage. */
export type PopWallPass = {entry: PopWallContact; exit?: PopWallContact; reach: number};
export type PopRegion = {x: number; y: number; z: number; halfW: number; halfH: number};
/** The peek wall as a collision box: `side` is the direction you step out (-1 = left, +1 = right, 0 = either side of a
 * pillar) and `edges` the x of each edge you can step past. */
export type PopWall = {id: string; center: Vec; size: Vec; side: -1 | 0 | 1; edges: number[]};
/** The respawn pad: a rectangle on the floor you step onto to bring popped balls back, `halfW` across (x) and `halfD`
 * along your line to the wall (z) from its centre. */
export type PopPad = {x: number; z: number; halfW: number; halfD: number};

export const POP_EYE = 64 * UNIT;
/** Where you stand in Pop: the near end of the range, so 40 m of wall fit in front of you. */
export const POP_SPAWN: Vec = {x: 0, y: POP_EYE, z: 2};
/** A brief continuous fixation arms a rep; merely sweeping across the center does not. */
export const POP_CENTER_HOLD = .12;
export const popLimits = {size: [8, 80], count: [1, 12], spacing: [.2, 5], distance: [3, 40], hits: [1, 10], wallWidth: [.6, 8], respawn: [0, 5],
  padWidth: [.3, 3], padDepth: [.3, 3], speedX: [0, 6], rangeX: [0, 5], flipsX: [0, 4], speedY: [0, 4], rangeY: [0, 1.4], flipsY: [0, 4]} as const;
export const popColors: readonly (readonly [string, string])[] = [['Orange', '#ff6a4d'], ['Yellow', '#ffd23f'], ['Green', '#5dff7f'],
  ['Cyan', '#4df3ff'], ['Pink', '#ff4dd2'], ['White', '#ffffff']];
export const popBackgrounds: readonly (readonly [string, string])[] = [['Navy', '#151a28'], ['Black', '#000000'], ['Charcoal', '#2b2f36'],
  ['Slate', '#5b6470'], ['White', '#f0f0ec'], ['Forest', '#1d4d33']];
export const popPadColors: readonly (readonly [string, string])[] = [['Cyan', '#4df3ff'], ['Yellow', '#ffd23f'], ['Green', '#5dff7f'],
  ['Orange', '#ff6a4d'], ['Magenta', '#ff4dd2'], ['White', '#ffffff']];
/** The sound the pad makes when stepping onto it brings the balls back: a synthesized two-note chime, the Pop hit sounds, or none. */
export type PopPadSound = 'chime' | 'hitmarker' | 'pop' | 'off';
/** Peek wall: its near edge sits just past your shoulder, 1.5 m ahead, and it reaches the chosen width across the other
 * way; the two-sided pillar is centred on where you first stood. */
export const POP_WALL = {edge: .35, height: 2.8, thickness: .4, ahead: 1.5, peek: 1} as const;
/** The respawn pad sits on your spawn point, centred behind the peek wall; `padWidth`/`padDepth` set its extent. */

/** The materials a wallbangable peek wall can be made of, as the Wall material setting lists them. */
export const popWallMaterials: readonly (readonly [PopWallMaterial, string])[] = [['wood', 'Wood'], ['concrete', 'Concrete'], ['metal', 'Metal']];

export function popConfig(settings: {popVariant: PopVariant; popPrecisionSpeed: number; popSize: number; popCount: number; popSpacing: number; popDistance: number; popHits: number; popWall: PopWallSide;
  popWallWidth: number; popWallbang: boolean; popWallMaterial: PopWallMaterial; popRespawn: number; popRespawnMode: PopRespawnMode; popPadWidth: number;
  popPadDepth: number; popMoveX: number; popRangeX: number; popFlipX: number; popMoveY: number; popRangeY: number; popFlipY: number; popMoveChance: number}): PopConfig {
  const classic = settings.popVariant === 'classic';
  return {variant: settings.popVariant, precisionSpeed: settings.popPrecisionSpeed, size: settings.popSize / 100, count: classic ? settings.popCount : 1, spacing: settings.popSpacing, distance: settings.popDistance,
    hits: settings.popHits, wall: settings.popWall, wallWidth: settings.popWallWidth, wallbang: settings.popWallbang, wallMaterial: settings.popWallMaterial,
    respawn: settings.popRespawn, respawnMode: settings.popRespawnMode,
    padWidth: settings.popPadWidth, padDepth: settings.popPadDepth,
    x: {speed: settings.popMoveX, range: settings.popRangeX, flips: settings.popFlipX},
    y: {speed: settings.popMoveY, range: settings.popRangeY, flips: settings.popFlipY}, moveChance: settings.popMoveChance,
    ...(!classic ? {wall: 'off' as const, wallbang: false, respawnMode: 'timer' as const,
      x: {speed: 0, range: 0, flips: 0}, y: {speed: 0, range: 0, flips: 0}, moveChance: 0} : {})};
}

export const popWallSide = (wall: PopWallSide): -1 | 0 | 1 => wall === 'left' ? -1 : wall === 'right' ? 1 : 0;
export const axisMoves = (axis: PopAxisMotion) => axis.speed > 0 && axis.range > 0;

/** The peek wall for the chosen side, or undefined when it is off. `origin` is the Pop spawn point: a one-sided wall's
 * near edge sits 0.35 m past its shoulder and the wall runs `wallWidth` the other way; the pillar is centred on it. */
export function popWall(config: Pick<PopConfig, 'wall' | 'wallWidth'>, origin: Vec): PopWall | undefined {
  if (config.wall === 'off') return undefined;
  const z = origin.z - POP_WALL.ahead, y = POP_WALL.height / 2, width = config.wallWidth;
  if (config.wall === 'both') return {id: 'pop-wall', side: 0, edges: [origin.x - width / 2, origin.x + width / 2],
    center: {x: origin.x, y, z}, size: {x: width, y: POP_WALL.height, z: POP_WALL.thickness}};
  const side = popWallSide(config.wall) as -1 | 1, edge = origin.x + side * POP_WALL.edge;
  return {id: 'pop-wall', side, edges: [edge], center: {x: edge - side * width / 2, y, z},
    size: {x: width, y: POP_WALL.height, z: POP_WALL.thickness}};
}

/** The respawn pad: centred behind the peek wall when one is up, else on the Pop spawn point. */
export const popPad = (config: Pick<PopConfig, 'wall' | 'wallWidth' | 'padWidth' | 'padDepth'>, origin: Vec): PopPad =>
  ({x: popWall(config, origin)?.center.x ?? origin.x, z: origin.z, halfW: config.padWidth / 2, halfD: config.padDepth / 2});
/** Where you start: on the pad's centre, so centred behind the cover. */
export const popSpawn = (config: Pick<PopConfig, 'wall' | 'wallWidth'>, origin: Vec): Vec => ({...origin, x: popWall(config, origin)?.center.x ?? origin.x});

/** The wall the balls float on: centred ahead at eye height (on your peek line when a one-sided peek wall is up), wide
 * enough for the count at the requested spacing, and capped so every ball stays well inside the 90-degree 4:3 view and
 * between knee and head height. */
export function popRegion(config: PopConfig, origin: Vec): PopRegion {
  const r = config.size / 2, gap = config.spacing + 2 * r;
  if (config.variant !== 'classic') {
    // These are panel edges; single-target spawns inset by the target radius below. Scale with distance so each
    // exercise keeps its angular footprint until the physical floor/side-wall limits of the range.
    const scale = config.distance / 8;
    const halfW = config.variant === 'wide' ? Math.min(config.distance * .8, 11) : (config.variant === 'precision' ? .75 : 1) * scale;
    const halfH = Math.min((config.variant === 'microshot' ? .6 : config.variant === 'precision' ? 1.1 : 1.25) * scale, 1.4);
    return {x: origin.x, y: origin.y, z: origin.z - config.distance, halfW: Math.max(halfW, r * 2),
      halfH: Math.max(halfH, r * 2 + (config.variant === 'precision' ? .1 * scale : 0))};
  }
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
  /** Balls the pad brought back since the engine last asked, for its trigger sound and flash. */
  private padReturned = 0;
  private nextId = 1;
  /** Retained across delayed respawns, so consecutive single targets cannot occupy the same spot. */
  private previous?: PopBall;
  /** Center Return's fixed marker is an aim gate, never a scored/shootable ball. */
  readonly center?: Vec & {radius: number};
  precisionPhase: 'center' | 'target' = 'center';
  centerProgress = 0;
  private centeredSince?: number;
  private precisionReadyAt = 0;
  private precisionMotion?: {at: number; x: number};
  readonly region: PopRegion;
  readonly wall?: PopWall;
  /** The wall as a surface bullets can pass through; only when wallbang is on. */
  private readonly wallSolid?: PenetrationSolid;
  readonly pad: PopPad;
  constructor(readonly config: PopConfig, origin: Vec, private readonly random: () => number = Math.random) {
    this.region = popRegion(config, origin);
    if (config.variant === 'precision') this.center = {...this.region, radius: .05 * config.distance / 8};
    this.wall = popWall(config, origin);
    this.wallSolid = this.wall && config.wallbang ? {id: this.wall.id, center: this.wall.center, size: this.wall.size, material: config.wallMaterial} : undefined;
    this.pad = popPad(config, origin);
    if (!this.center) for (let i = 0; i < config.count; i++) this.spawn();
  }
  get moving() {return !!this.center || axisMoves(this.config.x) || axisMoves(this.config.y);}
  /** Fixed center dot under the actual crosshair ray, independent of shots/spread. */
  aimedAtCenter(origin: Vec, direction: Vec) {
    const center = this.center;
    if (!center || direction.z >= -1e-12) return false;
    const t = (center.z - origin.z) / direction.z;
    return t >= 0 && Math.hypot(origin.x + direction.x * t - center.x, origin.y + direction.y * t - center.y) <= center.radius;
  }
  private returnToCenter(time: number) {
    this.balls = []; this.precisionMotion = undefined; this.precisionPhase = 'center';
    this.centeredSince = undefined; this.centerProgress = 0; this.precisionReadyAt = time + this.config.respawn;
  }
  private advancePrecision(time: number, player?: Vec, aim?: Vec) {
    const {region, config} = this;
    if (this.precisionPhase === 'target') {
      const ball = this.balls[0], motion = this.precisionMotion!;
      ball.x = motion.x + ball.vx * Math.max(0, time - motion.at);
      if (Math.abs(ball.x - region.x) > region.halfW - ball.radius + 1e-9) this.returnToCenter(time);
      return;
    }
    if (!player || !aim || !this.aimedAtCenter(player, aim)) {this.centeredSince = undefined; this.centerProgress = 0; return;}
    this.centeredSince ??= time;
    this.centerProgress = Math.min(1, (time - this.centeredSince) / POP_CENTER_HOLD);
    if (this.centerProgress < 1 || time < this.precisionReadyAt) return;
    const side = this.random() < .5 ? -1 : 1, r = config.size / 2, h = region.halfH - r;
    // Keep the travel lane clear of the center dot: waiting on center can never score a target crossing it.
    const laneGap = Math.min(h, r + this.center!.radius * 2);
    const y = (this.random() < .5 ? -1 : 1) * (laneGap + this.random() * (h - laneGap));
    const ball = {id: this.nextId++, x: region.x + side * (region.halfW - r), y: region.y + y,
      z: region.z, radius: r, hits: 0, vx: -side * config.precisionSpeed, vy: 0};
    this.balls.push(ball); this.precisionMotion = {at: time, x: ball.x}; this.precisionPhase = 'target';
    this.centeredSince = undefined; this.centerProgress = 0;
  }
  /** A new ball at least the chosen space from every other one; when the wall cannot fit that, the clearest spot tried. */
  private spawn() {
    const {region, config} = this, r = config.size / 2, gap = config.spacing + 2 * r;
    if (config.variant !== 'classic') {
      const w = region.halfW - r, h = region.halfH - r;
      const side = this.previous ? (this.previous.x >= region.x ? -1 : 1) : (this.random() < .5 ? -1 : 1);
      let x = region.x, y = region.y;
      for (let attempt = 0; attempt < 32; attempt++) {
        x = region.x + (config.variant === 'wide' ? side * (.35 + this.random() * .65) : this.random() * 2 - 1) * w;
        y = region.y + (this.random() * 2 - 1) * h;
        if (!this.previous || Math.hypot(x - this.previous.x, y - this.previous.y) >= Math.min(config.size * 1.5, Math.max(w, h))) break;
        // Even a constant RNG must produce a different, fully bounded target.
        if (attempt === 31) {
          x = region.x + (this.previous.x >= region.x ? -w : w);
          y = region.y + (this.previous.y >= region.y ? -h : h);
        }
      }
      const ball: PopBall = {id: this.nextId++, x, y, z: region.z, radius: r, hits: 0, vx: 0, vy: 0};
      this.balls.push(ball); return ball;
    }
    let best: PopBall | undefined, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = {id: this.nextId, x: region.x + (this.random() * 2 - 1) * region.halfW,
        y: region.y + (this.random() * 2 - 1) * region.halfH, z: region.z, radius: r, hits: 0, vx: 0, vy: 0};
      const clearance = Math.min(Infinity, ...this.balls.map(ball => Math.hypot(ball.x - candidate.x, ball.y - candidate.y)));
      if (clearance >= gap) {best = candidate; break;}
      if (clearance > bestClearance) {bestClearance = clearance; best = candidate;}
    }
    this.nextId++; this.balls.push(best!);
    // With motion configured, each ball rolls once whether it moves at all; a mover drifts from where it appeared,
    // as far as its range each way but never past the field's edge.
    if (this.moving && this.random() < config.moveChance) {
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
    // Balls that ran into each other part again and, if still closing, bounce along the axis they met on. Only the
    // movers give way: a still ball is never shoved.
    for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
      const a = this.balls[i], b = this.balls[j], aMoves = this.travel.has(a.id), bMoves = this.travel.has(b.id);
      if (!aMoves && !bMoves) continue;
      const dx = b.x - a.x, dy = b.y - a.y, gap = Math.hypot(dx, dy), least = a.radius + b.radius;
      if (gap >= least || gap < 1e-9) continue;
      const push = (least - gap) / (aMoves && bMoves ? 2 : 1), nx = dx / gap, ny = dy / gap;
      if (aMoves) {a.x -= nx * push; a.y -= ny * push;}
      if (bMoves) {b.x += nx * push; b.y += ny * push;}
      if (Math.abs(dx) >= Math.abs(dy)) {if ((b.vx - a.vx) * dx < 0) {if (aMoves) a.vx = -a.vx; if (bMoves) b.vx = -b.vx;}}
      else if ((b.vy - a.vy) * dy < 0) {if (aMoves) a.vy = -a.vy; if (bMoves) b.vy = -b.vy;}
    }
  }
  /** Whether a player standing at `position` (x/z) is on the respawn pad: within its rectangle, edges included. */
  onPadAt(position: Vec) {return Math.abs(position.x - this.pad.x) <= this.pad.halfW + 1e-9 && Math.abs(position.z - this.pad.z) <= this.pad.halfD + 1e-9;}
  /** Moves the balls on to `time` and spawns the replacements that are due: by the timer, or, in pad mode, all of them
   * the moment you step onto the pad (`player` is where you stand). */
  advance(time: number, player?: Vec, aim?: Vec) {
    const dt = Math.min(Math.max(time - this.now, 0), .25);
    this.now = time;
    if (this.center) {this.advancePrecision(time, player, aim); return;}
    if (this.config.respawnMode === 'pad') {
      if (player) {
        const on = this.onPadAt(player);
        if (on && this.onPad === false) while (this.pending.length) {this.pending.shift(); this.spawn(); this.padReturned++;}
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
  /** What a wallbangable peek wall does to a bullet fired along the unit `direction`, by CS2's penetration arithmetic: the
   * weapon's `stats`, the wall's material and the thickness of wall this ray actually crosses (a ray that clips the edge
   * crosses far less than one that goes straight through) decide how much damage comes out the far side. Undefined when the
   * wall is off, not wallbangable, or the ray misses it. Pass the result to `hit()`. */
  wallPass(origin: Vec, direction: Vec, range: number, stats: PenetrationStats): PopWallPass | undefined {
    if (!this.wallSolid) return undefined;
    const ray = resolveBulletRay({origin, direction, range, stats, arena: {solids: [this.wallSolid]}, actors: []});
    const entry = ray.surfaces.find(contact => contact.phase === 'entry'), exit = ray.surfaces.find(contact => contact.phase === 'exit');
    if (!entry) return undefined;
    const contact = ({distance, point, normal, residualDamage}: SurfaceContact): PopWallContact => ({distance, point, normal, damage: residualDamage});
    if (!exit) return {entry: contact(entry), reach: entry.distance};
    // Past the wall only the range falloff is left, so the bullet stays dangerous until it drops below 1 damage.
    const falloff = Math.log(stats.rangeModifier);
    return {entry: contact(entry), exit: contact(exit), reach: falloff < 0 ? exit.distance + 500 * UNIT * Math.log(exit.residualDamage) / -falloff : Infinity};
  }
  /** The nearest ball a unit-direction ray crosses within `maxDistance` and before the peek wall: it takes a hit, and
   * once it has taken `config.hits` it is popped and replaced (after the respawn delay counted from `time`, or when
   * you next step onto the pad). A wallbangable wall is handled by `wallPass()`: given its result, a bullet that came out
   * the far side keeps going as far as it has damage left (`reach`) and one that did not stops at the wall's face. Undefined
   * for a miss. */
  hit(origin: Vec, direction: Vec, maxDistance = Infinity, time = this.now, pass?: PopWallPass): PopHit | undefined {
    const limit = Math.min(maxDistance, pass ? pass.reach : this.wallHit(origin, direction, maxDistance)?.distance ?? Infinity);
    let nearest: PopHit | undefined;
    for (const ball of this.balls) {
      if (this.config.variant === 'microshot') {
        if (Math.abs(direction.z) < 1e-12) continue;
        const t = (ball.z - origin.z) / direction.z;
        if (t < 0 || t > limit) continue;
        const point = {x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: ball.z};
        if (Math.abs(point.x - ball.x) > ball.radius + 1e-9 || Math.abs(point.y - ball.y) > ball.radius + 1e-9) continue;
        if (!nearest || t < nearest.distance) nearest = {ball, point, distance: t, popped: false, wallbang: false};
        continue;
      }
      const ox = origin.x - ball.x, oy = origin.y - ball.y, oz = origin.z - ball.z;
      const b = ox * direction.x + oy * direction.y + oz * direction.z;
      const c = ox * ox + oy * oy + oz * oz - ball.radius * ball.radius;
      const discriminant = b * b - c;
      if (discriminant < 0) continue;
      const t = -b - Math.sqrt(discriminant);
      if (t < 0 || t > limit) continue;
      if (!nearest || t < nearest.distance) nearest = {ball, distance: t, popped: false, wallbang: !!pass?.exit && t > pass.exit.distance,
        point: {x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t}};
    }
    if (!nearest) return undefined;
    this.hits++; nearest.ball.hits++;
    if (nearest.ball.hits < this.config.hits) return nearest;
    nearest.popped = true;
    this.previous = nearest.ball;
    this.balls = this.balls.filter(ball => ball !== nearest!.ball); this.travel.delete(nearest.ball.id);
    this.pops++; this.popped.push(nearest.ball);
    if (this.center) {this.returnToCenter(time); return nearest;}
    if (this.config.respawnMode === 'pad') this.pending.push(Infinity);
    else if (this.config.respawn > 0) this.pending.push(time + this.config.respawn);
    else this.spawn();
    return nearest;
  }
  drainPopped() {const popped = this.popped; this.popped = []; return popped;}
  /** How many balls stepping onto the pad brought back since the last call (0 when it has not triggered). */
  drainPadTrigger() {const returned = this.padReturned; this.padReturned = 0; return returned;}
  reset() {
    this.previous = undefined;
    this.balls = []; this.popped = []; this.pending = []; this.travel.clear(); this.onPad = undefined; this.padReturned = 0;
    this.pops = this.hits = this.shots = 0;
    if (this.center) {this.returnToCenter(this.now); this.precisionReadyAt = this.now;}
    else for (let i = 0; i < this.config.count; i++) this.spawn();
  }
}
