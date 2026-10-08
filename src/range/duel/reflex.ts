import {UNIT, type Vec} from '../actor-physics';
import {BOTZ_SCALE, type BotzConfig, type BotzDistance} from './botz';
import {canFitInArena, traceSolid, type Arena, type Solid} from './geometry';
import {randomStream} from './rng';

/**
 * Fast Aim / Reflex, after the "Fast Aim / Reflex Training" workshop map: you stand on an island in the middle of the
 * hall, and bots wait out of sight behind a ring of walls, then come at you through its gaps, strafing A-D. Kill each
 * one before it reaches the island. One that gets there is counted and starts again, as on the map: it is training,
 * not a minigame. The island is marked on the floor, at ground level.
 */
export const REFLEX_ISLAND: Readonly<{x: number; z: number}> = {x: 0, z: -6};
export const REFLEX_ISLAND_HALF = 2.5;
/** A bot this close to the island (a square, measured from its centre) has reached you: the line around it. */
export const REFLEX_REACH = REFLEX_ISLAND_HALF + 1.2;
/** If you step off the island, a bot reaches you this close to you instead. */
export const REFLEX_TOUCH = 1.4;
export const REFLEX_PLAYER_SPAWN: Readonly<Vec> = {x: REFLEX_ISLAND.x, y: 64 * UNIT, z: REFLEX_ISLAND.z};
/** Half the width of the ring of walls, by distance setting. Side gaps are this far from you, corners 1.4 times as far. */
export const reflexRingSizes: Record<BotzDistance, number> = {near: 8, mixed: 11, far: 14};
const WALL_HEIGHT = 3.2, WALL_THICKNESS = .5, GAP_HALF = 2, CORNER_OPEN = 2.5;
const EYE = 64 * UNIT, HULL = 72 * UNIT;

type Point = {x: number; z: number};
export type ReflexEntrance = {index: number; corner: boolean; direction: Point; mouth: Point; inner: Point};
/** `lane` points from the island out through the bot's entrance. */
export type ReflexSpawn = {x: number; z: number; feet: number; entrance: number; route: Point[]; lane: Point};

/** The duel hall at Aim Botz size, with a ring of walls around the island in the middle. */
export function reflexArena(config: Pick<BotzConfig, 'distance'>): Arena {
  const size = reflexRingSizes[config.distance], {x, z} = REFLEX_ISLAND;
  const solids: Solid[] = [];
  // Two walls per side leave a gap in the middle of each side, and the corners open.
  const length = size - CORNER_OPEN - GAP_HALF, middle = (size - CORNER_OPEN + GAP_HALF) / 2;
  for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]] as const) for (const along of [-1, 1]) {
    const across = sign * size, offset = along * middle;
    solids.push({id: `reflex-wall-${axis}${sign}${along}`, kind: 'concrete', material: 'concrete',
      center: axis === 'x' ? {x: x + across, y: WALL_HEIGHT / 2, z: z + offset} : {x: x + offset, y: WALL_HEIGHT / 2, z: z + across},
      size: axis === 'x' ? {x: WALL_THICKNESS, y: WALL_HEIGHT, z: length} : {x: length, y: WALL_HEIGHT, z: WALL_THICKNESS}});
  }
  return {minX: -12 * BOTZ_SCALE, maxX: 12 * BOTZ_SCALE, minZ: -20 * BOTZ_SCALE, maxZ: 12 * BOTZ_SCALE, design: 'Reflex island', solids};
}

/** The eight ways in, clockwise from straight ahead (-z): the gap in each side (even) and the open corners (odd).
 * A bot runs to the mouth outside, through to the inner point, then at you. */
export function reflexEntrances(distance: BotzDistance): ReflexEntrance[] {
  const size = reflexRingSizes[distance], {x, z} = REFLEX_ISLAND;
  return Array.from({length: 8}, (_, index) => {
    const angle = index * Math.PI / 4, corner = index % 2 === 1;
    const direction = {x: Math.round(Math.sin(angle) * 1e9) / 1e9, z: Math.round(-Math.cos(angle) * 1e9) / 1e9};
    // Corners lie on the diagonals: offsets apply to both axes there.
    const at = (offset: number) => corner
      ? {x: x + Math.sign(direction.x) * (size + offset), z: z + Math.sign(direction.z) * (size + offset)}
      : {x: x + direction.x * (size + offset), z: z + direction.z * (size + offset)};
    return {index, corner, direction, mouth: at(corner ? 1 : .9), inner: at(corner ? -2.2 : -1.5)};
  });
}

/** Picks hidden starting spots behind the walls beside an entrance, out of sight of the island. */
export class ReflexSpawner {
  private readonly random: () => number;
  private readonly entrances: ReflexEntrance[];
  private readonly size: number;
  constructor(private readonly config: BotzConfig, private readonly arena: Arena, seed: number) {
    this.random = randomStream(seed, 'reflex:spawn');
    this.entrances = reflexEntrances(config.distance);
    this.size = reflexRingSizes[config.distance];
  }

  /** `busy` entrances already have a bot on its way in: a second one there would queue behind it. */
  next(occupied: readonly Vec[], viewer: Vec, busy: ReadonlySet<number> = new Set()): ReflexSpawn {
    const allowed = this.config.approach === 'front' ? this.entrances.filter(entrance => entrance.index <= 1 || entrance.index === 7) : this.entrances;
    const open = allowed.filter(entrance => !busy.has(entrance.index));
    const free = (spot: Point) => occupied.every(other => Math.hypot(other.x - spot.x, other.z - spot.z) >= 1.2);
    // Never next to you, even if you have left the island for the space behind the walls.
    const clearOfYou = (spot: Point) => Math.hypot(viewer.x - spot.x, viewer.z - spot.z) >= 3;
    // Prefer a quiet entrance, then any. Bots pass through each other out of sight, so a crowded hidden spot beats
    // one in view.
    for (let attempt = 0; attempt < 100; attempt++) {
      const pool = attempt < 30 && open.length ? open : allowed;
      const entrance = pool[Math.floor(this.random() * pool.length)], spot = this.beside(entrance);
      if (!canFitInArena({x: spot.x, y: EYE, z: spot.z}, 0, HULL, this.arena) || !clearOfYou(spot) || attempt < 60 && !free(spot)) continue;
      if (attempt < 90 && !this.hidden(viewer, spot)) continue;
      return {...spot, feet: 0, entrance: entrance.index, route: [entrance.mouth, entrance.inner], lane: entrance.direction};
    }
    const away = (entrance: ReflexEntrance) => Math.hypot(viewer.x - entrance.mouth.x, viewer.z - entrance.mouth.z);
    const entrance = allowed.reduce((best, candidate) => away(candidate) > away(best) ? candidate : best);
    return {...entrance.mouth, feet: 0, entrance: entrance.index, route: [entrance.mouth, entrance.inner], lane: entrance.direction};
  }

  /** Behind a wall beside the entrance. Each wall hides bots for its side's gap nearer the gap and bots for the corner
   * nearer the corner, so a bot on its way out never has to get past one heading the other way. */
  private beside(entrance: ReflexEntrance): Point {
    const out = .9 + this.random(), along = this.random(), side = this.random() < .5 ? -1 : 1;
    const {x, z} = REFLEX_ISLAND, size = this.size, direction = entrance.direction;
    const end = size - CORNER_OPEN, middle = (GAP_HALF + end) / 2;
    if (!entrance.corner) {
      const near = GAP_HALF + 1, far = Math.min(middle, GAP_HALF + 3), lateral = side * (near + along * (far - near));
      return {x: x + direction.x * (size + out) - direction.z * lateral, z: z + direction.z * (size + out) + direction.x * lateral};
    }
    // Behind the end of one of the two walls that meet at the corner.
    const near = Math.max(middle, end - 2.6), back = near + along * (end - .4 - near);
    const sx = Math.sign(direction.x), sz = Math.sign(direction.z);
    return side < 0 ? {x: x + sx * (size + out), z: z + sz * back} : {x: x + sx * back, z: z + sz * (size + out)};
  }

  /** The head and both shoulders are behind a wall. */
  private hidden(viewer: Vec, spot: Point) {
    const dx = spot.x - viewer.x, dz = spot.z - viewer.z, length = Math.hypot(dx, dz) || 1;
    const across = {x: -dz / length * .35, z: dx / length * .35};
    return ([[0, 72 * UNIT], [1, 56 * UNIT], [-1, 56 * UNIT]] as const).every(([offset, height]) => {
      const tx = spot.x + across.x * offset - viewer.x, ty = height - viewer.y, tz = spot.z + across.z * offset - viewer.z;
      const distance = Math.hypot(tx, ty, tz);
      return Number.isFinite(traceSolid(viewer, {x: tx / distance, y: ty / distance, z: tz / distance}, this.arena, distance - .05).distance);
    });
  }
}

/** Strafing like a player in a gunfight: A or D for 0.35-0.8 s, mostly sideways with a slight lean so the bot still
 * closes in a little; about one switch in four first stops dead for 0.15-0.35 s, as a player counter-strafes to shoot;
 * now and then the same way again, so the switches are not a rhythm you can time. A bot that crouches all the way
 * (`crawling`) leans in more and holds each way longer, or it would hardly get anywhere. */
export class ReflexStrafe {
  private side: -1 | 0 | 1 = 0;
  private last: -1 | 1;
  private lean = .3;
  private until = 0;
  constructor(private readonly random: () => number, private readonly crawling = false) {this.last = random() < .5 ? -1 : 1;}
  /** `prefer` steers the next move back toward the bot's lane when it has drifted out of it. */
  keys(time: number, prefer?: -1 | 1): {forward: number; side: -1 | 0 | 1} {
    if (time >= this.until) {
      if (this.side !== 0 && this.random() < .25) {
        this.side = 0; this.until = time + .15 + this.random() * .2;
      } else {
        this.last = prefer && this.random() < .85 ? prefer : this.random() < .8 ? (this.last === 1 ? -1 : 1) : this.last;
        this.side = this.last;
        // Forward against 1 sideways: 0.2-0.45 is 11-24 degrees off pure strafing; crawling, 35-45 degrees.
        this.lean = this.crawling ? .7 + this.random() * .3 : .2 + this.random() * .25;
        this.until = time + (this.crawling ? .6 + this.random() * .5 : .35 + this.random() * .45);
      }
    }
    return {forward: this.side ? this.lean : 0, side: this.side};
  }
  /** Turn back now, as at the edge of a ledge. */
  flip(time: number) {
    this.last = this.last === 1 ? -1 : 1; this.side = this.last;
    this.until = time + (this.crawling ? .6 + this.random() * .5 : .35 + this.random() * .45);
  }
}

/** Crouch spam at a person's pace: down for 0.45-0.8 s, up for 0.5-1.1 s, over and over. That is slow enough for CS2's
 * duck-speed penalty to leave every crouch at the normal speed. */
export class ReflexCrouch {
  private down = false;
  private until: number;
  constructor(private readonly random: () => number, time: number) {this.until = time + random() * .3;}
  crouched(time: number) {
    if (time < this.until) return this.down;
    this.down = !this.down;
    this.until = time + (this.down ? .45 + this.random() * .35 : .5 + this.random() * .6);
    return this.down;
  }
}

/** One bot's run at you: `leg` 0 out of sight to its entrance's mouth, 1 through the gap, 2 in the open.
 * `goAt` holds it out of sight until then; `queuedAt` is when it reached the mouth, so bots there take turns. */
export type ReflexRun = {entrance: number; route: Point[]; lane: Point; leg: number; goAt: number; queuedAt?: number;
  strafe?: ReflexStrafe; crouch?: ReflexCrouch; crouchAlways: boolean};

/** Distance from the middle of the island, measured square like the ring of walls. */
export const reflexRing = (point: Point) => Math.max(Math.abs(point.x - REFLEX_ISLAND.x), Math.abs(point.z - REFLEX_ISLAND.z));
export const atMouth = (run: ReflexRun, position: Point) => Math.hypot(run.route[0].x - position.x, run.route[0].z - position.z) < .6;

/** Where a rushing bot heads next: to its entrance's mouth, through the gap, then straight at you.
 * It waits at the mouth until it is `clear` to go. */
export function reflexTarget(run: ReflexRun, position: Point, player: Point, clear = true): Point {
  const [mouth, inner] = run.route;
  if (run.leg === 0 && clear && atMouth(run, position)) run.leg = 1;
  if (run.leg === 1 && reflexRing(position) <= reflexRing(inner)) run.leg = 2;
  if (run.leg === 0) return mouth;
  if (run.leg === 2) return player;
  // Through the gap along its centre line, two metres ahead: bots side by side move in parallel, never into each other.
  const dx = inner.x - mouth.x, dz = inner.z - mouth.z, length = Math.hypot(dx, dz);
  const along = Math.max(0, ((position.x - mouth.x) * dx + (position.z - mouth.z) * dz) / length) + 2;
  return {x: mouth.x + dx / length * along, z: mouth.z + dz / length * along};
}
