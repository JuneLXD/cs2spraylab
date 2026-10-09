import {DEG, UNIT, type Vec} from './actor-physics';

/** Pop (after Refrag's Pop mode): bright balls float on a dark wall ahead of you; a shot pops the first ball it
 * crosses and a new one appears elsewhere. Sizes and distances are metres; the setting stores the size in cm. */
export type PopConfig = {size: number; count: number; spacing: number; distance: number};
export type PopBall = {id: number; x: number; y: number; z: number; radius: number};
export type PopHit = {ball: PopBall; point: Vec; distance: number};
export type PopRegion = {x: number; y: number; z: number; halfW: number; halfH: number};

export const POP_EYE = 64 * UNIT;
/** Where you stand in Pop: the near end of the range, so 40 m of wall fit in front of you. */
export const POP_SPAWN: Vec = {x: 0, y: POP_EYE, z: 2};
export const popLimits = {size: [8, 80], count: [1, 12], spacing: [.2, 5], distance: [3, 40]} as const;
export const popColors: readonly (readonly [string, string])[] = [['Orange', '#ff6a4d'], ['Yellow', '#ffd23f'], ['Green', '#5dff7f'],
  ['Cyan', '#4df3ff'], ['Pink', '#ff4dd2'], ['White', '#ffffff']];

export function popConfig(settings: {popSize: number; popCount: number; popSpacing: number; popDistance: number}): PopConfig {
  return {size: settings.popSize / 100, count: settings.popCount, spacing: settings.popSpacing, distance: settings.popDistance};
}

/** The wall the balls float on: centred ahead at eye height, wide enough for the count at the requested spacing, and
 * capped so every ball stays well inside the 90-degree 4:3 view and between knee and head height. */
export function popRegion(config: PopConfig, origin: Vec): PopRegion {
  const r = config.size / 2, gap = config.spacing + 2 * r;
  const wanted = Math.max(gap, gap * Math.sqrt(config.count) * .75);
  const halfW = Math.min(wanted, config.distance * Math.tan(45 * DEG) * .55);
  const halfH = Math.min(wanted * .6, config.distance * Math.tan(36.87 * DEG) * .45, 1.4);
  return {x: origin.x, y: origin.y, z: origin.z - config.distance, halfW: Math.max(halfW, r), halfH: Math.max(halfH, r)};
}

export class PopField {
  balls: PopBall[] = [];
  pops = 0; shots = 0;
  /** Balls popped since the renderer last asked, for the burst animation. */
  private popped: PopBall[] = [];
  private nextId = 1;
  readonly region: PopRegion;
  constructor(readonly config: PopConfig, origin: Vec, private readonly random: () => number = Math.random) {
    this.region = popRegion(config, origin);
    for (let i = 0; i < config.count; i++) this.spawn();
  }
  /** A new ball at least the chosen space from every other one; when the wall cannot fit that, the clearest spot tried. */
  private spawn() {
    const {region, config} = this, r = config.size / 2, gap = config.spacing + 2 * r;
    let best: PopBall | undefined, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = {id: this.nextId, x: region.x + (this.random() * 2 - 1) * region.halfW,
        y: region.y + (this.random() * 2 - 1) * region.halfH, z: region.z, radius: r};
      const clearance = Math.min(Infinity, ...this.balls.map(ball => Math.hypot(ball.x - candidate.x, ball.y - candidate.y)));
      if (clearance >= gap) {best = candidate; break;}
      if (clearance > bestClearance) {bestClearance = clearance; best = candidate;}
    }
    this.nextId++; this.balls.push(best!);
    return best!;
  }
  /** The nearest ball a unit-direction ray crosses within `maxDistance`: popped and replaced. Undefined for a miss. */
  hit(origin: Vec, direction: Vec, maxDistance = Infinity): PopHit | undefined {
    let nearest: PopHit | undefined;
    for (const ball of this.balls) {
      const ox = origin.x - ball.x, oy = origin.y - ball.y, oz = origin.z - ball.z;
      const b = ox * direction.x + oy * direction.y + oz * direction.z;
      const c = ox * ox + oy * oy + oz * oz - ball.radius * ball.radius;
      const discriminant = b * b - c;
      if (discriminant < 0) continue;
      const t = -b - Math.sqrt(discriminant);
      if (t < 0 || t > maxDistance) continue;
      if (!nearest || t < nearest.distance) nearest = {ball, distance: t,
        point: {x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t}};
    }
    if (!nearest) return undefined;
    this.balls = this.balls.filter(ball => ball !== nearest!.ball);
    this.pops++; this.popped.push(nearest.ball); this.spawn();
    return nearest;
  }
  drainPopped() {const popped = this.popped; this.popped = []; return popped;}
  reset() {
    this.balls = []; this.popped = []; this.pops = this.shots = 0;
    for (let i = 0; i < this.config.count; i++) this.spawn();
  }
}
