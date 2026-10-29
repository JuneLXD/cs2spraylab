import {DEG, type Vec} from './actor-physics';
import {analyzeFlick, type FlickCondition, type FlickEvent, type FlickRecord} from './aim-vector';
import type {PopBall, PopConfig, PopRegion} from './pop';
import {direction} from './shot-model';

/** Pop's Direction Calibration: a SpiderShot-style exercise with a balanced schedule. Rest the crosshair on the center dot,
 * flick to the one target that appears and shoot it, come back. Every round shows each of 16 screen directions at three sizes
 * once, in random order, so every direction gets the same evidence (random positions would leave some thin). Targets sit at
 * exact yaw/pitch offsets from the center dot, the units mouse counts turn the view in. aim-vector.ts analyses each flick. */
export const VECTOR_DIRECTIONS = 16, VECTOR_SIZES = 3;
/** Flicks per blind-test block: the profile is on or off for a whole block, in balanced pairs of blocks. */
export const VECTOR_BLOCK = 16;
/** A target not hit within this many seconds is withdrawn and the flick set aside. */
export const VECTOR_TIMEOUT = 4;
/** The center dot's radius in degrees of view, and the random rest on it before each target (s): long enough to settle, too
 * variable to anticipate. */
export const VECTOR_CENTER = .4, VECTOR_REST: readonly [number, number] = [.2, .45];
/** The three flick sizes (degrees) for the largest one. */
export const vectorSizes = (reach: number) => [reach / 3, reach * 2 / 3, reach];
/** The largest flick (degrees) that keeps every target above the floor at the target distance and size. */
export const vectorReach = (config: Pick<PopConfig, 'vectorReach' | 'distance' | 'size'>) =>
  Math.min(config.vectorReach, Math.atan((1.4 - config.size / 2 - .02) / config.distance) / DEG);

/** What the simulation tells the exercise each step: your view angles (radians), whether recoil and view punch have settled,
 * which axes are inverted (1 x, 2 y), the profile you have set (scaled by its strength) and whether it is switched on, and
 * whether the blind test is running. */
export type VectorLook = {yaw: number; pitch: number; settled: boolean; flip: number; profile?: readonly number[]; on: boolean; testing: boolean};

type Trial = {id: number; spawn: number; dir: number; amp: number; radius: number; target: {x: number; y: number}; events: FlickEvent[];
  shots: number; condition: FlickCondition; profile?: readonly number[]; flip: number};
const MAX_EVENTS = 4000;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class PopVector {
  phase: 'center' | 'target' = 'center';
  /** How far through the rest on the center dot (0-1). */
  progress = 0;
  /** Flicks finished this session, and how many the analysis accepted. */
  flicks = 0; accepted = 0;
  /** Seconds before an unhit target is withdrawn. */
  timeout = VECTOR_TIMEOUT;
  private schedule: {dir: number; size: number}[] = [];
  private blocks: boolean[] = [];
  private tested = 0;
  private trial?: Trial;
  private centeredSince?: number;
  private rest: number;
  private readyAt: number;
  private nextId = 1;
  private finished: FlickRecord[] = [];
  constructor(readonly config: PopConfig, readonly region: PopRegion, private readonly random: () => number, time = 0) {
    this.rest = this.nextRest(); this.readyAt = time;
  }
  get reach() {return vectorReach(this.config);}
  /** Whether the blind test applies the profile to the current (or next) flick. */
  get testOn() {
    const block = Math.floor(this.tested / VECTOR_BLOCK);
    while (this.blocks.length <= block) this.blocks.push(...(this.random() < .5 ? [true, false] : [false, true]));
    return this.blocks[block];
  }
  private condition(look: VectorLook): FlickCondition {
    return look.testing ? this.testOn ? 'test-on' : 'test-off' : look.on && look.profile ? 'on' : 'off';
  }
  private nextRest() {return VECTOR_REST[0] + this.random() * (VECTOR_REST[1] - VECTOR_REST[0]);}
  /** Every direction at every size once, shuffled; used from the end. */
  private shuffle() {
    const order = Array.from({length: VECTOR_DIRECTIONS * VECTOR_SIZES}, (_, i) => ({dir: i % VECTOR_DIRECTIONS, size: Math.floor(i / VECTOR_DIRECTIONS)}));
    for (let i = order.length - 1; i > 0; i--) {const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
    return order;
  }

  /** Moves the exercise on to `time`: holds the next target until you have rested on the center dot (`centered`, with recoil
   * settled) for a random moment, then places it. Returns the target to show, or 'withdrawn' when one was left too long or the
   * profile setting changed under it. `shots` is the field's shot count. */
  advance(time: number, player: Vec | undefined, centered: boolean, look: VectorLook | undefined, shots: number): PopBall | 'withdrawn' | undefined {
    const trial = this.trial;
    if (trial) {
      if (time - trial.spawn > this.timeout) {this.finish(time, shots, 'timeout'); return 'withdrawn';}
      if (look && this.condition(look) !== trial.condition) {this.finish(time, shots, 'profile changed'); return 'withdrawn';}
      return undefined;
    }
    if (!player || !look || !centered || !look.settled) {this.centeredSince = undefined; this.progress = 0; return undefined;}
    this.centeredSince ??= time;
    this.progress = Math.min(1, (time - this.centeredSince) / this.rest);
    if (this.progress < 1 || time < this.readyAt) return undefined;
    return this.spawn(time, player, look, shots);
  }
  private spawn(time: number, player: Vec, look: VectorLook, shots: number): PopBall {
    if (!this.schedule.length) this.schedule = this.shuffle();
    const {dir, size} = this.schedule.pop()!, amp = vectorSizes(this.reach)[size], angle = dir * 2 * Math.PI / VECTOR_DIRECTIONS, {region, config} = this;
    // The target sits `amp` degrees from the center dot as seen from where you stand: right of it by amp*cos, above it by amp*sin.
    const cx = region.x - player.x, cy = region.y - player.y, cz = region.z - player.z;
    const toward = direction(Math.atan2(-cx, -cz) - amp * Math.cos(angle) * DEG, Math.atan2(cy, Math.hypot(cx, cz)) + amp * Math.sin(angle) * DEG);
    const along = (region.z - player.z) / toward.z, radius = config.size / 2;
    const ball: PopBall = {id: this.nextId++, x: player.x + toward.x * along, y: player.y + toward.y * along, z: region.z, radius, hits: 0, vx: 0, vy: 0};
    // What the flick needs from where your crosshair actually is, in mouse space (counts right, counts toward you).
    const dx = ball.x - player.x, dy = ball.y - player.y, dz = ball.z - player.z, distance = Math.hypot(dx, dy, dz);
    const right = -wrap(Math.atan2(-dx, -dz) - look.yaw) / DEG, up = (Math.atan2(dy, Math.hypot(dx, dz)) - look.pitch) / DEG;
    const condition = this.condition(look);
    this.trial = {id: ball.id, spawn: time, dir, amp, radius: Math.atan(radius / distance) / DEG, flip: look.flip,
      target: {x: right * (look.flip & 1 ? -1 : 1), y: -up * (look.flip & 2 ? -1 : 1)}, events: [], shots, condition,
      ...(condition === 'on' || condition === 'test-on' ? {profile: look.profile} : {})};
    this.phase = 'target'; this.progress = 0; this.centeredSince = undefined;
    return ball;
  }
  /** A mouse event during the flick, in mouse-space degrees without (`bx`, `by`) and with (`ox`, `oy`) the profile. */
  record(time: number, bx: number, by: number, ox: number, oy: number) {
    const trial = this.trial;
    if (trial && time >= trial.spawn - 1e-9 && trial.events.length < MAX_EVENTS) trial.events.push({t: time, bx, by, ox, oy});
  }
  /** Ends the flick: analysed when its target was hit (no `reason`), set aside otherwise. */
  finish(time: number, shots: number, reason?: string) {
    const trial = this.trial;
    if (!trial) return;
    const analysis = reason ? undefined : analyzeFlick(trial.spawn, time, trial.target, trial.events), valid = !!analysis?.valid;
    const r = (value: number) => Math.round(value * 1e4) / 1e4;
    this.finished.push({at: Date.now(), dir: trial.dir, amp: r(trial.amp), radius: r(trial.radius), tx: r(trial.target.x), ty: r(trial.target.y),
      mx: r(analysis?.base.x ?? 0), my: r(analysis?.base.y ?? 0), px: r(analysis?.out.x ?? 0), py: r(analysis?.out.y ?? 0),
      reaction: r(analysis?.reaction ?? 0), total: r(time - trial.spawn), corrections: analysis?.corrections ?? 0, shots: shots - trial.shots,
      condition: trial.condition, ...(trial.profile ? {profile: [...trial.profile]} : {}), ...(trial.flip ? {flip: trial.flip} : {}),
      valid, ...(valid ? {} : {reason: reason ?? analysis?.reason ?? 'unknown'})});
    this.flicks++; if (valid) this.accepted++;
    if (trial.condition === 'test-on' || trial.condition === 'test-off') this.tested++;
    this.trial = undefined; this.phase = 'center'; this.progress = 0; this.centeredSince = undefined;
    this.readyAt = time + this.config.respawn; this.rest = this.nextRest();
  }
  /** Flicks finished since the last call, for storage. */
  drain() {const finished = this.finished; this.finished = []; return finished;}
  reset(time: number) {
    this.trial = undefined; this.schedule = []; this.blocks = []; this.tested = 0; this.finished = [];
    this.phase = 'center'; this.progress = 0; this.centeredSince = undefined; this.flicks = this.accepted = 0;
    this.readyAt = time; this.rest = this.nextRest();
  }
}
