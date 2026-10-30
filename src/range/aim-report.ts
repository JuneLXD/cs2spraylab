import {DEG, UNIT, type Vec} from './actor-physics';
import {segmentMovement, type FlickEvent} from './aim-vector';
import type {Equipment} from './equipment';

/** The aim report: what every mode measures about your aim, the same way on the range and in AI Duel.
 *
 * Both engines feed one AimRecorder: the mouse movement that turns your view (`look`), you and the targets in view every
 * simulation step (`frame`), each shot (`shot`) and what it hit (`hit`, `clear`). Per target it measures how long you took to hit
 * it and where that time went (before moving, the first movement, adjusting, confirming on target), where the first movement
 * landed (inside, past or short of the target) and how far your crosshair was when the target appeared. Per shot it records
 * whether you were standing, had just stopped, were moving or in the air, how you stopped (tapping the opposite key or letting
 * go), whether you were accurate yet, and how fast the target was crossing your crosshair when you clicked. `aimReport` turns a
 * session's records into the numbers and tips the Aim tab shows.
 *
 * Offsets are in mouse space, as Direction Calibration's: degrees of view rotation, x to the right and y down, so a first movement
 * and the movement a target needs compare directly. View angles never include recoil: they are what the mouse controls. */

/** A target this step: a key that is new for every life (a respawned bot, a new ball), the point to aim at (world metres) and the
 * radius around it that counts as on target. `persistent` targets (the spray drills' dummy) get shot statistics only: a flick to
 * a target that never goes away is not a flick. */
export type AimTarget = {key: string; point: Vec; radius: number; persistent?: boolean};
/** You this step: eye position (metres), view angles (radians, without recoil), horizontal velocity and the weapon's running speed
 * (metres per second), the movement keys as the engines hold them (forward and side, -1 to 1), and your stance. */
export type AimPlayer = {eye: Vec; yaw: number; pitch: number; vx: number; vz: number; maxSpeed: number; forward: number; side: number;
  airborne: boolean; walking: boolean; ducking: boolean};
export type AimShotState = 'standing' | 'stopped' | 'moving' | 'air';
/** How a stop before a shot was made: tapping the opposite key, letting go, or not at all (the key still held). `since` is seconds
 * from starting the stop to the shot; `accurate` how long after you became accurate the shot came (negative: that much too early;
 * missing: never accurate before you moved again); `side` the way you were strafing, when it was mostly sideways. */
export type AimStop = {kind: 'counter' | 'release' | 'none'; since: number; accurate?: number; side?: 'left' | 'right'};
/** One shot. `speed` in units per second and `ratio` of the weapon's running speed; `n` its place in its trigger press (0 the
 * first, a click) and `first` whether it was the first; `crouched` and `walking` your stance; `target` the target it was aimed at
 * (the one it hit, else the nearest within reach of the crosshair); `cross` how fast that target was crossing the crosshair
 * (degrees per second, or the crosshair's own speed with no target); `on` the crosshair was on it. */
export type AimShot = {t: number; weapon: Equipment; state: AimShotState; speed: number; ratio: number; n: number; first: boolean; crouched: boolean;
  walking: boolean; stop?: AimStop; target?: string; cross: number; on?: boolean; hit: boolean; head: boolean};
/** One flick, from where its window starts (the target appearing, or your last shot or kill on something else) to the first hit.
 * `amp` is the movement it needed (degrees) and `heading` its direction on screen (degrees counterclockwise from right), `zone`
 * the target's radius (degrees), `peak` the first movement's top speed (degrees per second), `along` how far the first movement
 * went toward it (1 exactly, above 1 past it),
 * `angle` how far it turned off (degrees), `error` how far from the target it ended (fraction of `amp`), `inside` it ended on the
 * target. The phases add up to `total` (seconds): `before` moving (your reaction when `fresh`), the `flick`, `adjust`ing after it
 * and `confirm`ing on the target before the shot. `timed` is false when the window holds idle time rather than a flick: it began
 * when the session or round did, or was cut at the longest flick; such flicks still show where they landed. */
export type AimFlick = {valid: boolean; reason?: string; fresh: boolean; timed: boolean; amp: number; heading: number; zone: number; peak: number;
  along: number; angle: number; error: number; inside: boolean; before: number; flick: number; adjust: number; confirm?: number; total: number; corrections: number};

/** CS2 adds movement inaccuracy above 34% of the weapon's running speed; above half of it you were clearly moving. */
export const ACCURATE_SPEED = .34, MOVING_SPEED = .5;
/** Seconds: how far back a stop before a shot is looked for, how long a target may be out of view before it counts as gone, the
 * mouse and target history kept, the longest flick, the window for the crosshair's speed at a click, and the wait after becoming
 * accurate that counts as late. */
const STOP_WINDOW = .6, LOST = .5, HISTORY = 6, LONGEST = 4, CLICK_WINDOW = .03, LATE = .1;
/** A shot belongs to the nearest target within 4 degrees of the crosshair (or three of its radii); a click with the target crossing
 * the crosshair faster than 30 degrees per second was still moving; the smallest on-target zone. */
const REACH = 4, MOVING_CLICK = 30, ZONE = .15;
const MAX_EVENTS = 6000;
/** Flick sizes the report compares (degrees). */
export const AIM_SIZES: readonly {label: string; min: number; max: number}[] = [{label: 'Under 5°', min: 0, max: 5}, {label: '5–12°', min: 5, max: 12},
  {label: '12–25°', min: 12, max: 25}, {label: 'Over 25°', min: 25, max: Infinity}];
/** The eight screen directions flicks are grouped by, counterclockwise from right, 45 degrees each. */
export const AIM_DIRECTIONS = ['Right', 'Up-right', 'Up', 'Up-left', 'Left', 'Down-left', 'Down', 'Down-right'] as const;
/** Shots of a trigger press the report compares: the first (a click), then the rest of a burst or spray. */
export const AIM_BULLETS: readonly {label: string; from: number; to: number}[] = [{label: '1st', from: 0, to: 0}, {label: '2nd–3rd', from: 1, to: 2},
  {label: '4th–10th', from: 3, to: 9}, {label: '11th on', from: 10, to: Infinity}];

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Where a target is from the crosshair: the mouse movement it needs (x right, y down, degrees), the true angle to it, the
 * angular radius of its zone and whether the crosshair is on it. */
function offsetOf(eye: Vec, yaw: number, pitch: number, point: Vec, radius: number) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z, flat = Math.hypot(dx, dz), distance = Math.hypot(flat, dy);
  const x = -wrap(Math.atan2(-dx, -dz) - yaw) / DEG, y = -(Math.atan2(dy, flat) - pitch) / DEG;
  const dot = distance > 1e-9 ? (-Math.sin(yaw) * Math.cos(pitch) * dx + Math.sin(pitch) * dy - Math.cos(yaw) * Math.cos(pitch) * dz) / distance : 1;
  const angle = Math.acos(clamp(dot, -1, 1)) / DEG, zone = Math.max(ZONE, Math.atan(radius / Math.max(distance, 1e-6)) / DEG);
  return {x, y, angle, zone, on: angle <= zone};
}
/** Whether you are strafing right (1) or left (-1): moving mostly sideways relative to your view; 0 otherwise. */
function lateralOf(player: AimPlayer) {
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw), side = player.vx * cos - player.vz * sin, ahead = -player.vx * sin - player.vz * cos;
  return Math.hypot(player.vx, player.vz) < 1e-4 || Math.abs(side) <= Math.abs(ahead) ? 0 : Math.sign(side);
}
/** Whether the movement keys push along your velocity (1), against it (-1) or neither (0). */
function pushOf(player: AimPlayer) {
  const speed = Math.hypot(player.vx, player.vz), sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = -player.forward * sin + player.side * cos, wz = -player.forward * cos - player.side * sin, wish = Math.hypot(wx, wz);
  if (speed < 1e-4 || wish < 1e-9) return 0;
  const along = (wx * player.vx + wz * player.vz) / (wish * speed);
  return along > .25 ? 1 : along < -.25 ? -1 : 0;
}

type Sample = {t: number; x: number; y: number; on: boolean};
type Move = {t: number; ratio: number; air: boolean; push: number; lateral: number};
/** A target from when it came into view until it was killed or gone. `initial`: already there when the clock started, so it
 * never "appeared". `placement` is the angle from your crosshair when it came into view, `shots` the shots aimed at it, and
 * `start` where the flick to it began. */
export type AimTrack = {key: string; appearAt: number; seenAt: number; point: Vec; radius: number; zone: number; persistent: boolean; initial: boolean;
  samples: Sample[]; placement: number; shots: number; start?: number; firstHitAt?: number; killAt?: number; flick?: AimFlick};

export class AimRecorder {
  /** The session: a new id after `restart`, and when it started. */
  id = newId(); started = new Date().toISOString();
  /** Simulation seconds played, summed over frames (a new duel round restarts the simulation's clock). */
  seconds = 0;
  shots: AimShot[] = [];
  /** Targets that were killed or left view, with their flicks. */
  done: AimTrack[] = [];
  private tracks = new Map<string, AimTrack>();
  private events: FlickEvent[] = [];
  private moves: Move[] = [];
  private pending: AimShot[] = [];
  private lastFrame?: number;
  /** Your view at the last frame or shot, so a hit can check the crosshair against the target it actually hit. */
  private lastPlayer?: AimPlayer;

  /** Mouse movement that turned the view at simulation time `t`: degrees to the right and down. */
  look(t: number, x: number, y: number) {
    if (!x && !y) return;
    this.events.push({t, bx: x, by: y, ox: x, oy: y});
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }
  /** One simulation step: you and the targets in view. `contact` counts the crosshair touching a target as its hit (held-fire
   * Pop exercises, which fire no shots). */
  frame(t: number, player: AimPlayer, targets: readonly AimTarget[], contact = false) {
    const initial = this.lastFrame === undefined;
    if (this.lastFrame !== undefined && t > this.lastFrame && t - this.lastFrame < .5) this.seconds += t - this.lastFrame;
    this.lastFrame = t; this.lastPlayer = player;
    const ratio = player.maxSpeed > 0 ? Math.hypot(player.vx, player.vz) / player.maxSpeed : 0;
    this.moves.push({t, ratio, air: player.airborne, push: pushOf(player), lateral: lateralOf(player)});
    while (this.moves.length && this.moves[0].t < t - STOP_WINDOW - .2) this.moves.shift();
    // A shot fired before you were accurate learns how early it was once you are.
    if (ratio <= ACCURATE_SPEED && !player.airborne) for (const shot of this.pending) if (shot.stop) shot.stop.accurate = shot.t - t;
    this.pending = this.pending.filter(shot => shot.stop?.accurate === undefined && t - shot.t < STOP_WINDOW);
    for (const target of targets) {
      const offset = offsetOf(player.eye, player.yaw, player.pitch, target.point, target.radius);
      let track = this.tracks.get(target.key);
      if (!track) {
        track = {key: target.key, appearAt: t, seenAt: t, point: {...target.point}, radius: target.radius, zone: offset.zone,
          persistent: !!target.persistent, initial, samples: [], placement: offset.angle, shots: 0};
        this.tracks.set(target.key, track);
      }
      track.seenAt = t; track.point = {x: target.point.x, y: target.point.y, z: target.point.z}; track.radius = target.radius; track.zone = offset.zone;
      track.samples.push({t, x: offset.x, y: offset.y, on: offset.on});
      while (track.samples.length > 2 && track.samples[0].t < t - HISTORY) track.samples.shift();
      if (contact && offset.on && track.firstHitAt === undefined && !track.persistent) this.firstHit(track, t, true);
    }
    for (const track of [...this.tracks.values()]) if (t - track.seenAt > LOST) this.close(track);
    let old = 0;
    while (old < this.events.length && this.events[old].t < t - HISTORY) old++;
    if (old) this.events.splice(0, old);
  }
  /** A shot you fired now (bullets and the Zeus; not the knife). `n`: its place in this trigger press, 0 for the first. Returns
   * its index for `hit`. */
  shot(t: number, player: AimPlayer, weapon: Equipment, n = 0) {
    this.lastPlayer = player;
    const speed = Math.hypot(player.vx, player.vz), ratio = player.maxSpeed > 0 ? speed / player.maxSpeed : 0;
    const {state, stop} = this.movement(t, player, ratio);
    let best: AimTrack | undefined, nearest: ReturnType<typeof offsetOf> | undefined;
    for (const track of this.tracks.values()) {
      if (t - track.seenAt > .05) continue;
      const offset = offsetOf(player.eye, player.yaw, player.pitch, track.point, track.radius);
      if (offset.angle <= Math.max(REACH, offset.zone * 3) && (!nearest || offset.angle < nearest.angle)) {best = track; nearest = offset;}
    }
    const cross = best && nearest ? this.crossing(best, t, nearest) : this.crosshairSpeed(t);
    const record: AimShot = {t, weapon, state, speed: speed / UNIT, ratio, n, first: n === 0, crouched: player.ducking, walking: player.walking, ...(stop ? {stop} : {}),
      ...(best && nearest ? {target: best.key, on: nearest.on} : {}), cross, hit: false, head: false};
    this.shots.push(record);
    if (best) best.shots++;
    if (stop && stop.kind !== 'none' && stop.accurate === undefined) this.pending.push(record);
    return this.shots.length - 1;
  }
  /** Shot `index` hit the target `key` (on the head?) and killed or popped it. */
  hit(index: number | undefined, key: string, head: boolean, kill: boolean) {
    const shot = index === undefined ? undefined : this.shots[index];
    if (!shot) return;
    shot.hit = true; shot.head ||= head;
    const track = this.tracks.get(key);
    if (shot.target !== key) {
      // Aimed nearer another target, but it hit this one: it was this one's shot.
      const aimed = shot.target ? this.tracks.get(shot.target) : undefined;
      if (aimed) aimed.shots--;
      shot.target = key;
      if (track) track.shots++;
      const player = this.lastPlayer;
      if (track && player) shot.on = offsetOf(player.eye, player.yaw, player.pitch, track.point, track.radius).on;
    }
    if (!track) return;
    if (track.firstHitAt === undefined && !track.persistent) this.firstHit(track, shot.t, shot.on ?? false);
    if (kill) {track.killAt = shot.t; this.close(track);}
  }
  /** The target `key` died without a shot record of its own (cleared by holding fire on it). */
  clear(key: string, t: number) {
    const track = this.tracks.get(key);
    if (!track) return;
    if (track.firstHitAt === undefined && !track.persistent) this.firstHit(track, t, true);
    track.killAt = t; this.close(track);
  }
  /** The simulation's clock starts over (a new duel round): open targets end and the histories go; the session's shots stay. */
  segment() {
    for (const track of [...this.tracks.values()]) this.close(track);
    this.events = []; this.moves = []; this.pending = []; this.lastFrame = undefined;
  }
  /** A new session. */
  restart() {
    this.segment(); this.shots = []; this.done = []; this.seconds = 0;
    this.id = newId(); this.started = new Date().toISOString();
  }
  /** The targets you engaged, the ones that are gone first. */
  get targets(): readonly AimTrack[] {return [...this.done, ...[...this.tracks.values()].filter(engaged)];}

  /** Standing, stopped, moving or in the air at a shot, and how the stop before it was made. */
  private movement(t: number, player: AimPlayer, ratio: number): {state: AimShotState; stop?: AimStop} {
    const recent = this.moves.filter(move => move.t >= t - STOP_WINDOW - 1e-9 && move.t <= t + 1e-9);
    const fast = ratio > MOVING_SPEED || recent.some(move => move.ratio > MOVING_SPEED);
    const state: AimShotState = player.airborne ? 'air' : ratio > ACCURATE_SPEED ? 'moving' : fast ? 'stopped' : 'standing';
    if (!fast || player.airborne) return {state};
    const sideOf = (lateral: number | undefined) => lateral === 1 ? {side: 'right' as const} : lateral === -1 ? {side: 'left' as const} : {};
    if (pushOf(player) === 1) return {state, stop: {kind: 'none', since: 0, ...sideOf(lateralOf(player))}};
    let last = -1;
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].push === 1) {last = i; break;}
    const stopAt = last >= 0 ? recent[last + 1]?.t ?? t : recent[0]?.t ?? t, after = recent.filter(move => move.t >= stopAt - 1e-9);
    const accurateAt = ratio <= ACCURATE_SPEED ? after.find(move => move.ratio <= ACCURATE_SPEED && !move.air)?.t ?? t : undefined;
    const counter = pushOf(player) === -1 || after.some(move => move.push === -1 && move.t <= (accurateAt ?? t) + 1e-9);
    // The way you were strafing: while the key last pushed you along.
    const moving = recent[last >= 0 ? last : 0];
    return {state, stop: {kind: counter ? 'counter' : 'release', since: Math.max(0, t - stopAt), ...(accurateAt !== undefined ? {accurate: Math.max(0, t - accurateAt)} : {}),
      ...sideOf(moving?.lateral)}};
  }
  /** Where a target was from the crosshair at `time`: its last sample, plus the target's own movement toward the next one, less
   * the mouse movement since (the target moves smoothly between steps; the crosshair moves with each mouse event). */
  private offsetAt(track: AimTrack, time: number) {
    const samples = track.samples;
    let i = samples.length - 1;
    while (i > 0 && samples[i].t > time + 1e-9) i--;
    const sample = samples[i];
    if (!sample) return {x: 0, y: 0, on: false};
    if (sample.t > time + 1e-9) return {x: sample.x, y: sample.y, on: sample.on};
    const moved = (from: number, to: number) => {
      let x = 0, y = 0;
      for (const event of this.events) if (event.t > from + 1e-9 && event.t <= to + 1e-9) {x += event.ox; y += event.oy;}
      return {x, y};
    };
    const mouse = moved(sample.t, time), next = samples[i + 1];
    let x = sample.x - mouse.x, y = sample.y - mouse.y;
    if (next && next.t > sample.t) {
      const between = moved(sample.t, next.t), share = (time - sample.t) / (next.t - sample.t);
      x += share * (next.x - sample.x + between.x); y += share * (next.y - sample.y + between.y);
    }
    return {x, y, on: sample.on};
  }
  /** How fast a target crossed the crosshair over the last 30 ms (degrees per second). */
  private crossing(track: AimTrack, t: number, now: {x: number; y: number}) {
    const first = track.samples[0]?.t ?? t, from = Math.max(first, t - CLICK_WINDOW);
    if (t - from < .004) return this.crosshairSpeed(t);
    const before = this.offsetAt(track, from);
    return Math.hypot(now.x - before.x, now.y - before.y) / (t - from);
  }
  private crosshairSpeed(t: number) {
    let x = 0, y = 0;
    for (const event of this.events) if (event.t > t - CLICK_WINDOW && event.t <= t + 1e-9) {x += event.ox; y += event.oy;}
    return Math.hypot(x, y) / CLICK_WINDOW;
  }
  /** Your last shot or kill on anything but `key` before `end`. */
  private lastOther(key: string, end: number) {
    let latest: number | undefined;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      if (shot.t < end - LONGEST) break;
      if (shot.t < end - 1e-9 && shot.target !== key) {latest = shot.t; break;}
    }
    for (let i = this.done.length - 1; i >= 0 && i >= this.done.length - 64; i--) {
      const at = this.done[i].killAt;
      if (at !== undefined && at < end - 1e-9 && at > (latest ?? -Infinity)) latest = at;
    }
    return latest;
  }
  /** A target appearing is "fresh" when it came into view after your last shot or kill on anything else, within the longest
   * flick: only then is the time before moving a reaction. */
  private firstHit(track: AimTrack, end: number, on: boolean) {
    track.firstHitAt = end;
    const other = this.lastOther(track.key, end);
    const fresh = !track.initial && (other === undefined || other < track.appearAt - 1e-6) && end - track.appearAt <= LONGEST;
    track.start = Math.max(track.appearAt, other ?? -Infinity, end - LONGEST);
    const timed = !(track.initial && other === undefined) && track.start > end - LONGEST + 1e-9;
    track.flick = this.analyse(track, track.start, end, fresh, timed, on);
  }
  /** The flick to `track` between `start` and the hit at `end`. */
  private analyse(track: AimTrack, start: number, end: number, fresh: boolean, timed: boolean, on: boolean): AimFlick {
    const begin = this.offsetAt(track, start), needed = Math.hypot(begin.x, begin.y), total = Math.max(0, end - start);
    const heading = (x: number, y: number) => (Math.atan2(-y, x) / DEG + 360) % 360;
    const result = (valid: boolean, reason?: string, peak = 0): AimFlick => ({valid, ...(reason ? {reason} : {}), fresh, timed, amp: needed, heading: heading(begin.x, begin.y),
      zone: track.zone, peak, along: 0, angle: 0, error: 0, inside: false, before: 0, flick: 0, adjust: total, total, corrections: 0});
    if (needed <= Math.max(.5, track.zone)) return result(false, 'already on target');
    const events = this.events.filter(event => event.t >= start - 1e-9 && event.t <= end + 1e-9);
    const segment = segmentMovement(start, end, needed, events, fresh ? .08 : 0);
    if (!segment.valid) return result(false, segment.reason, segment.peak);
    // The landing error is where the target was when the first movement ended, so a target (or you) moving is accounted for.
    const land = this.offsetAt(track, segment.stop), out = segment.out, rx = out.x + land.x, ry = out.y + land.y, amp = Math.hypot(rx, ry);
    if (!(amp > 1e-6)) return result(false, 'no target', segment.peak);
    const along = (out.x * rx + out.y * ry) / (amp * amp), angle = Math.atan2(rx * out.y - ry * out.x, rx * out.x + ry * out.y) / DEG;
    if (along < .2 || along > 2.5) return result(false, 'far off', segment.peak);
    if (Math.abs(angle) > 45) return result(false, 'wrong direction', segment.peak);
    const onAt = on ? this.onTargetSince(track, end) : undefined, onset = start + segment.reaction;
    const adjust = onAt === undefined ? Math.max(0, end - segment.stop) : Math.max(0, onAt - segment.stop);
    return {valid: true, fresh, timed, amp, heading: heading(rx, ry), zone: track.zone, peak: segment.peak, along, angle, error: Math.hypot(land.x, land.y) / amp,
      inside: Math.hypot(land.x, land.y) <= track.zone,
      before: segment.reaction, flick: Math.max(0, segment.stop - onset), adjust, ...(onAt === undefined ? {} : {confirm: Math.max(0, end - Math.max(onAt, segment.stop))}),
      total, corrections: segment.corrections};
  }
  /** When the crosshair last came onto the target before `end` (it is on it then). */
  private onTargetSince(track: AimTrack, end: number) {
    let since = end;
    for (let i = track.samples.length - 1; i >= 0; i--) {
      const sample = track.samples[i];
      if (sample.t > end + 1e-9) continue;
      if (!sample.on) break;
      since = sample.t;
    }
    return since;
  }
  private close(track: AimTrack) {
    this.tracks.delete(track.key);
    if (!engaged(track)) return;
    track.samples = [];
    this.done.push(track);
    if (this.done.length > 4000) this.done.splice(0, this.done.length - 4000);
  }
}
/** Shot at, hit or killed: a target you engaged. */
const engaged = (track: AimTrack) => !track.persistent && (track.shots > 0 || track.firstHitAt !== undefined || track.killAt !== undefined);

export type AimBucket = {shots: number; hits: number};
export type AimTip = {tone: 'good' | 'warn'; title: string; detail: string};
/** Half a session: its shots and hit rate, its timed flicks and their median time to hit. */
export type AimHalf = {shots: number; hit: number; flicks: number; time?: number};
/** Stops made while strafing one way: how many, how many shots came before you were accurate, and the median time to accurate. */
export type AimSide = {n: number; early: number; toAccurate?: number};
/** Grouped flicks: how many, the first movement's bias and typical miss, and the median time to hit. */
export type AimGroup = {label: string; n: number; bias: number; error: number; time: number};
/** A session's aim report. Times in seconds, angles in degrees, speeds in units per second; shares from 0 to 1.
 * - `targets` the targets you engaged (shot at or hit), `cleared` the ones you killed or popped, `firstShot` the share whose
 *   first shot hit; `timeToHit`/`timeToKill` medians from where each flick's window starts, over the `hitTimes` timed flicks.
 * - `placement` the median angle from your crosshair to targets as they appeared and `placed` the share already under it;
 *   `reaction` the median time before moving toward a target that appeared while you were still.
 * - `phases` the mean of each phase of the `n` timed flicks (means add up to the mean total), `landing` where the first
 *   movements of all analysed flicks ended, `sizes` the same by flick size.
 * - `movement` shots by state, `stops` how the stops before shots were made (`toAccurate` the median time from starting a stop to
 *   being accurate, by how it was made) and `click` the target's speed across your crosshair at the first shot of each press.
 * Added later, so older saved reports may lack them:
 * - `perMinute` targets cleared per minute; `throughput` Fitts' throughput of the timed flicks (bits per second: log2 of the
 *   distance over the target's width, plus 1, over the time from starting to move to the hit); `peak` the median top speed of
 *   first movements (degrees per second).
 * - `spread` the middle half (25th to 75th percentile) of reaction times and times to hit, and `scatter` how much first
 *   movements vary around their own bias (one standard deviation, as a share of the flick).
 * - `halves` the session's first and second half; `directions` flicks by the eight screen directions; `bullets` hit rates by a
 *   shot's place in its trigger press; `misses` the missed shots with a target near, split by whether the crosshair was on it;
 *   `stance` crouched and walking shots; `sides` stops while strafing left and right. */
export type AimReport = {version: 1; id: string; mode: string; label: string; weapon: Equipment; started: string; date: string; seconds: number;
  shots: number; hits: number; heads: number; targets: number; cleared: number; firstShot?: number; hitTimes: number; timeToHit?: number; timeToKill?: number;
  placement?: number; placed?: number; fresh: number; reaction?: number; flicks: number;
  phases?: {n: number; before: number; flick: number; adjust: number; confirm: number; total: number};
  landing?: {inside: number; past: number; short: number; error: number; bias: number; corrections: number};
  sizes: {label: string; n: number; bias: number; error: number; time: number}[];
  movement: {standing: AimBucket; stopped: AimBucket; moving: AimBucket; air: AimBucket; speed: number};
  stops?: {n: number; counter: number; release: number; none: number; since?: number; early: number; onTime: number; late: number; wait?: number;
    toAccurate?: {counter?: number; release?: number}};
  click?: {n: number; speed: number; settled: AimBucket; moving: AimBucket};
  perMinute?: number; throughput?: number; peak?: number;
  spread?: {reaction?: [number, number]; time?: [number, number]; scatter?: number};
  halves?: {first: AimHalf; second: AimHalf};
  directions?: AimGroup[];
  bullets?: {label: string; shots: number; hits: number}[];
  misses?: {n: number; on: number; off: number};
  stance?: {crouched: AimBucket; walking: AimBucket};
  sides?: {left?: AimSide; right?: AimSide};
  tips: AimTip[]};

const median = (values: readonly number[]) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
/** The 25th and 75th percentiles (linear between ranks), from four values on. */
const quartiles = (values: readonly number[]): [number, number] | undefined => {
  if (values.length < 4) return undefined;
  const sorted = [...values].sort((a, b) => a - b), at = (q: number) => {const rank = q * (sorted.length - 1), low = Math.floor(rank); return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (rank - low);};
  return [at(.25), at(.75)];
};
const bucket = (shots: readonly AimShot[]): AimBucket => ({shots: shots.length, hits: shots.filter(shot => shot.hit).length});
const geometricBias = (flicks: readonly AimFlick[]) => Math.exp(mean(flicks.map(flick => Math.log(Math.max(flick.along, 1e-3))))) - 1;
const group = (label: string, flicks: readonly AimFlick[]): AimGroup => ({label, n: flicks.length, bias: flicks.length ? geometricBias(flicks) : 0,
  error: Math.sqrt(mean(flicks.map(flick => flick.error ** 2))), time: median(flicks.filter(flick => flick.timed).map(flick => flick.total)) ?? 0});

/** The report for a recorder's session, or undefined before the first shot or hit. `mode`, `label` and `weapon` name what was
 * played (the weapon fired most when there were shots). `placement` is false where targets appear away from your crosshair on
 * purpose (Pop's flick exercises): crosshair placement means nothing there. */
export function aimReport(recorder: AimRecorder, meta: {mode: string; label: string; weapon: Equipment; placement?: boolean}): AimReport | undefined {
  const shots = recorder.shots, byTarget = new Map<string, AimShot[]>(), tracks = recorder.targets;
  for (const shot of shots) if (shot.target) {const list = byTarget.get(shot.target); if (list) list.push(shot); else byTarget.set(shot.target, [shot]);}
  if (!shots.length && !tracks.length) return undefined;
  const used = new Map<Equipment, number>();
  for (const shot of shots) used.set(shot.weapon, (used.get(shot.weapon) ?? 0) + 1);
  const weapon = [...used].sort((a, b) => b[1] - a[1])[0]?.[0] ?? meta.weapon;
  const shotAt = tracks.filter(track => byTarget.has(track.key)), flicks = tracks.map(track => track.flick).filter((flick): flick is AimFlick => !!flick);
  const valid = flicks.filter(flick => flick.valid), fresh = flicks.filter(flick => flick.fresh), timed = valid.filter(flick => flick.timed);
  const appeared = tracks.filter(track => track.flick?.fresh);
  const states = (state: AimShotState) => bucket(shots.filter(shot => shot.state === state));
  const stopped = shots.filter(shot => shot.stop), stopping = stopped.filter(shot => shot.stop!.kind !== 'none');
  const accurate = (shot: AimShot) => shot.stop!.accurate;
  const clicks = shots.filter(shot => shot.first);
  const toAccurate = (kind: 'counter' | 'release') => median(stopping.filter(shot => shot.stop!.kind === kind && (accurate(shot) ?? -1) >= 0)
    .map(shot => shot.stop!.since - accurate(shot)!));
  const report: AimReport = {version: 1, id: recorder.id, mode: meta.mode, label: meta.label, weapon, started: recorder.started, date: new Date().toISOString(),
    seconds: recorder.seconds, shots: shots.length, hits: shots.filter(shot => shot.hit).length, heads: shots.filter(shot => shot.head).length,
    targets: tracks.length, cleared: tracks.filter(track => track.killAt !== undefined).length,
    ...(shotAt.length ? {firstShot: shotAt.filter(track => byTarget.get(track.key)![0].hit).length / shotAt.length} : {}),
    hitTimes: flicks.filter(flick => flick.timed).length, ...optional('timeToHit', median(flicks.filter(flick => flick.timed).map(flick => flick.total))),
    ...optional('timeToKill', median(tracks.filter(track => track.killAt !== undefined && track.start !== undefined && track.flick?.timed).map(track => track.killAt! - track.start!))),
    ...(appeared.length && meta.placement !== false ? {placement: median(appeared.map(track => track.placement)), placed: appeared.filter(track => track.flick?.reason === 'already on target').length / appeared.length} : {}),
    fresh: fresh.length, ...optional('reaction', median(valid.filter(flick => flick.fresh).map(flick => flick.before))), flicks: valid.length,
    ...(timed.length ? {phases: {n: timed.length, before: mean(timed.map(flick => flick.before)), flick: mean(timed.map(flick => flick.flick)), adjust: mean(timed.map(flick => flick.adjust)),
      confirm: mean(timed.map(flick => flick.confirm ?? 0)), total: mean(timed.map(flick => flick.total))}} : {}),
    ...(valid.length ? {landing: landing(valid)} : {}),
    sizes: AIM_SIZES.map(size => group(size.label, valid.filter(flick => flick.amp >= size.min && flick.amp < size.max))).filter(size => size.n > 0),
    movement: {standing: states('standing'), stopped: states('stopped'), moving: states('moving'), air: states('air'), speed: median(shots.map(shot => shot.speed)) ?? 0},
    ...(stopped.length ? {stops: {n: stopped.length, counter: stopped.filter(shot => shot.stop!.kind === 'counter').length,
      release: stopped.filter(shot => shot.stop!.kind === 'release').length, none: stopped.filter(shot => shot.stop!.kind === 'none').length,
      ...optional('since', median(stopping.map(shot => shot.stop!.since))),
      early: stopping.filter(shot => (accurate(shot) ?? -1) < 0).length, onTime: stopping.filter(shot => (accurate(shot) ?? -1) >= 0 && accurate(shot)! <= LATE).length,
      late: stopping.filter(shot => (accurate(shot) ?? -1) > LATE).length, ...optional('wait', median(stopping.map(accurate).filter((value): value is number => value !== undefined && value >= 0))),
      toAccurate: {...optional('counter', toAccurate('counter')), ...optional('release', toAccurate('release'))}}} : {}),
    ...(clicks.length ? {click: {n: clicks.length, speed: median(clicks.map(shot => shot.cross)) ?? 0,
      settled: bucket(clicks.filter(shot => shot.cross < MOVING_CLICK)), moving: bucket(clicks.filter(shot => shot.cross >= MOVING_CLICK))}} : {}),
    ...more(recorder, shots, tracks, valid, timed, stopping),
    tips: []};
  report.tips = aimTips(report);
  return report;
}
/** The report's later additions (see AimReport). */
function more(recorder: AimRecorder, shots: readonly AimShot[], tracks: readonly AimTrack[], valid: readonly AimFlick[], timed: readonly AimFlick[],
  stopping: readonly AimShot[]): Partial<AimReport> {
  const cleared = tracks.filter(track => track.killAt !== undefined).length;
  const moved = timed.filter(flick => flick.total - flick.before > .05);
  const scatter = valid.length >= 5 ? (() => {
    const logs = valid.map(flick => Math.log(Math.max(flick.along, 1e-3))), center = mean(logs);
    return Math.exp(Math.sqrt(logs.reduce((sum, value) => sum + (value - center) ** 2, 0) / (logs.length - 1))) - 1;
  })() : undefined;
  const reaction = quartiles(valid.filter(flick => flick.fresh).map(flick => flick.before)), time = quartiles(timed.map(flick => flick.total));
  // The session's halves: shots in order, and timed flicks in the order of their hits.
  const ordered = tracks.filter(track => track.flick?.timed && track.firstHitAt !== undefined).sort((a, b) => a.firstHitAt! - b.firstHitAt!).map(track => track.flick!);
  const half = (list: readonly AimShot[], flicks: readonly AimFlick[]): AimHalf => ({shots: list.length, hit: list.length ? list.filter(shot => shot.hit).length / list.length : 0,
    flicks: flicks.length, ...optional('time', flicks.length >= 3 ? median(flicks.map(flick => flick.total)) : undefined)});
  const side = (way: 'left' | 'right'): AimSide | undefined => {
    const list = stopping.filter(shot => shot.stop!.side === way);
    return list.length ? {n: list.length, early: list.filter(shot => (shot.stop!.accurate ?? -1) < 0).length,
      ...optional('toAccurate', median(list.filter(shot => (shot.stop!.accurate ?? -1) >= 0).map(shot => shot.stop!.since - shot.stop!.accurate!)))} : undefined;
  };
  const missed = shots.filter(shot => !shot.hit && shot.target !== undefined), left = side('left'), right = side('right');
  return {
    ...(recorder.seconds >= 10 && cleared ? {perMinute: cleared / recorder.seconds * 60} : {}),
    ...(moved.length >= 5 ? {throughput: mean(moved.map(flick => Math.log2(flick.amp / (2 * flick.zone) + 1) / (flick.total - flick.before)))} : {}),
    ...optional('peak', median(valid.map(flick => flick.peak))),
    ...(reaction || time || scatter !== undefined ? {spread: {...(reaction ? {reaction} : {}), ...(time ? {time} : {}), ...(scatter === undefined ? {} : {scatter})}} : {}),
    ...(shots.length >= 10 ? {halves: {first: half(shots.slice(0, shots.length >> 1), ordered.slice(0, ordered.length >> 1)),
      second: half(shots.slice(shots.length >> 1), ordered.slice(ordered.length >> 1))}} : {}),
    ...(valid.length ? {directions: AIM_DIRECTIONS.map((label, sector) => group(label, valid.filter(flick => Math.round(flick.heading / 45) % 8 === sector))).filter(entry => entry.n > 0)} : {}),
    ...(shots.length ? {bullets: AIM_BULLETS.map(range => ({label: range.label, ...bucket(shots.filter(shot => shot.n >= range.from && shot.n <= range.to))})).filter(entry => entry.shots > 0)} : {}),
    ...(missed.length ? {misses: {n: missed.length, on: missed.filter(shot => shot.on).length, off: missed.filter(shot => !shot.on).length}} : {}),
    ...(shots.length ? {stance: {crouched: bucket(shots.filter(shot => shot.crouched)), walking: bucket(shots.filter(shot => shot.walking))}} : {}),
    ...(left || right ? {sides: {...(left ? {left} : {}), ...(right ? {right} : {})}} : {}),
  };
}
const optional = <K extends string>(key: K, value: number | undefined) => (value === undefined ? {} : {[key]: value}) as Partial<Record<K, number>>;
function landing(flicks: readonly AimFlick[]) {
  const inside = flicks.filter(flick => flick.inside).length, past = flicks.filter(flick => !flick.inside && flick.along > 1).length, n = flicks.length;
  return {inside: inside / n, past: past / n, short: (n - inside - past) / n, error: Math.sqrt(mean(flicks.map(flick => flick.error ** 2))),
    bias: geometricBias(flicks), corrections: mean(flicks.map(flick => flick.corrections))};
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const rate = (value: AimBucket) => value.shots ? value.hits / value.shots : 0;
/** Up to three things to work on, the most costly first; each needs enough evidence to say it. */
export function aimTips(report: AimReport): AimTip[] {
  const tips: AimTip[] = [], {movement, stops, landing: land, phases, click} = report, n = report.shots;
  if (movement.air.shots >= 2 && movement.air.shots / n >= .03)
    tips.push({tone: 'warn', title: `${movement.air.shots} shots fired in the air`, detail: 'A jump adds a large inaccuracy until you land: land, then shoot.'});
  if (movement.moving.shots >= 3 && movement.moving.shots / n >= .15)
    tips.push({tone: 'warn', title: `${percent(movement.moving.shots / n)} of your shots were fired while moving`,
      detail: `Above a third of your running speed every shot gets movement inaccuracy (they hit ${percent(rate(movement.moving))}, standing or stopped shots ${percent(rate({shots: movement.standing.shots + movement.stopped.shots, hits: movement.standing.hits + movement.stopped.hits}))}). Stop first: tap the opposite key, then shoot.`});
  const made = stops ? stops.counter + stops.release : 0;
  if (stops && made >= 5) {
    if (stops.early / made >= .3)
      tips.push({tone: 'warn', title: `${percent(stops.early / made)} of your shots after stopping came too early`,
        detail: `You fired before you had slowed to an accurate speed${stops.since === undefined ? '' : `, a median ${ms(stops.since)} after starting the stop`}. Let the stop finish before you click.`});
    else if (stops.release / made >= .5)
      tips.push({tone: 'warn', title: 'You mostly stop by letting go of the key',
        detail: `Tapping the opposite key stops you sooner${stops.toAccurate?.counter !== undefined && stops.toAccurate.release !== undefined ? ` (your counter-strafes were accurate after ${ms(stops.toAccurate.counter)}, your releases after ${ms(stops.toAccurate.release)})` : ''}. Counter-strafe: release, tap the opposite key, shoot.`});
    else if (stops.wait !== undefined && stops.wait > .12)
      tips.push({tone: 'warn', title: `You wait ${ms(stops.wait)} after you are already accurate`, detail: 'Your stops are clean. Shoot as the stop finishes instead of after it.'});
  }
  const {left, right} = report.sides ?? {};
  if (left && right && left.n >= 4 && right.n >= 4) {
    const slower = (left.toAccurate ?? 0) > (right.toAccurate ?? 0) ? 'left' : 'right', early = left.early / left.n > right.early / right.n ? 'left' : 'right';
    if (left.toAccurate !== undefined && right.toAccurate !== undefined && Math.abs(left.toAccurate - right.toAccurate) >= .03)
      tips.push({tone: 'warn', title: `Your stops from strafing ${slower} are slower`, detail: `Accurate after ${ms(slower === 'left' ? left.toAccurate : right.toAccurate)} stopping from the ${slower}, ${ms(slower === 'left' ? right.toAccurate : left.toAccurate)} from the ${slower === 'left' ? 'right' : 'left'}. Practise the counter-strafe for that side.`});
    else if (Math.abs(left.early / left.n - right.early / right.n) >= .25)
      tips.push({tone: 'warn', title: `You shoot too early after strafing ${early}`, detail: `${percent((early === 'left' ? left : right).early / (early === 'left' ? left : right).n)} of those shots came before you were accurate, against ${percent((early === 'left' ? right : left).early / (early === 'left' ? right : left).n)} the other way.`});
  }
  const misses = report.misses;
  if (misses && misses.n >= 8 && misses.on / misses.n >= .6)
    tips.push({tone: 'warn', title: 'Most misses came with the crosshair on the target', detail: `${misses.on} of ${misses.n}: spread, recoil or moving did it, not your aim. Stop fully before shooting and keep bursts short.`});
  if (land && report.flicks >= 8 && Math.abs(land.bias) >= .08) {
    const counted = report.sizes.filter(size => size.n >= 4), large = counted[counted.length - 1];
    tips.push({tone: 'warn', title: `Your first movements ${land.bias < 0 ? `fall ${percent(-land.bias)} short` : `go ${percent(land.bias)} past the target`}`,
      detail: `${large && Math.abs(large.bias) > Math.abs(land.bias) ? `Most on ${large.label.toLowerCase()} flicks (${percent(Math.abs(large.bias))}). ` : ''}Each miss costs a correction (${land.corrections.toFixed(1)} per flick). Aim the first movement ${land.bias < 0 ? 'all the way to' : 'to stop on'} the target.`});
  } else if (land && report.flicks >= 8 && land.corrections >= 1.5)
    tips.push({tone: 'warn', title: `${land.corrections.toFixed(1)} corrections per flick`, detail: 'Your first movement rarely lands. Slow it slightly until it lands on the target, then speed up again.'});
  if (phases && phases.n >= 8 && phases.confirm >= .15)
    tips.push({tone: 'warn', title: `You stay on the target ${ms(phases.confirm)} before clicking`, detail: 'The crosshair is already there: click as soon as it is on the target.'});
  if (click && click.moving.shots >= 5 && click.moving.shots / click.n >= .25 && rate(click.moving) < rate(click.settled) - .15)
    tips.push({tone: 'warn', title: 'Clicks with the crosshair still moving miss more', detail: `They hit ${percent(rate(click.moving))}, settled clicks ${percent(rate(click.settled))}. Stop the crosshair on the target, then click.`});
  if (report.placement !== undefined && report.fresh >= 5 && report.placement >= 6)
    tips.push({tone: 'warn', title: `Your crosshair was ${report.placement.toFixed(0)}° away when targets appeared`, detail: 'Keep it where the next target will appear: at head height, on the angle you expect.'});
  if (report.firstShot !== undefined && report.targets >= 8 && report.firstShot < .5)
    tips.push({tone: 'warn', title: `${percent(report.firstShot)} of targets were hit with the first shot`, detail: 'Take the first shot a moment later, once the crosshair has stopped on the target.'});
  if (!tips.length && n >= 10) tips.push({tone: 'good', title: 'No clear weakness this session', detail: 'Keep the same rhythm, or make the drill harder: smaller or more distant targets, or a faster pace.'});
  return tips.slice(0, 3);
}
