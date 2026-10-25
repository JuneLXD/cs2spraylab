import type {PopBall, PopConfig, PopRegion} from './pop';

export const movingPop = (variant?: string) => variant === 'floatingheads' || variant === 'pasu' || variant === 'driftts';
export const holdPop = (variant?: string) => variant === 'pokeball' || variant === 'driftts';
type Point = {x: number; y: number};
type Motion = {lane: number; seed: number; turn: number; at: number; duration: number; from: Point; to: Point; vx: number; vy: number; phase: number};

/** A reflected coordinate, including its direction, works for arbitrarily many edge crossings. */
function reflected(value: number, half: number) {
  const span = half * 2, phase = ((value + half) % (span * 2) + span * 2) % (span * 2);
  return {value: -half + (phase <= span ? phase : span * 2 - phase), sign: phase <= span ? 1 : -1};
}
/** Local deterministic noise: turn choices do not depend on render cadence or other targets' lifetimes. */
function noise(seed: number, index: number) {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 4294967296;
}

/** Absolute simulation-time paths keep pause, input flushing and different render rates consistent. */
export class PopMotion {
  private states = new Map<number, Motion>();
  readonly halfW: number; readonly halfH: number; readonly bob: number;
  constructor(private config: PopConfig, private region: PopRegion, private random: () => number) {
    // The rectangle's corners lie on the configured center circle; target radius is added by popRegion.
    this.halfW = config.motionRadius * .8; this.halfH = config.motionRadius * .6;
    this.bob = Math.min(config.floatBob, this.halfH * .3);
  }
  private freeLane() {
    const occupied = new Set([...this.states.values()].map(state => state.lane));
    for (let lane = 0; lane < this.config.count; lane++) if (!occupied.has(lane)) return lane;
    return 0;
  }
  get spawnY() {
    const lane = this.freeLane(), count = this.config.count;
    return this.region.y + (count === 1 ? 0 : (lane / (count - 1) * 2 - 1) * (this.halfH - this.bob));
  }
  add(ball: PopBall, time: number) {
    const from = {x: ball.x - this.region.x, y: ball.y - this.region.y};
    const state: Motion = {lane: this.freeLane(), seed: Math.floor(this.random() * 4294967296), turn: 0, at: time,
      duration: 1, from, to: from, vx: 0, vy: 0, phase: Math.asin(Math.max(-1, Math.min(1, from.x / this.halfW)))};
    if (noise(state.seed, 0) < .5) state.phase = Math.PI - state.phase;
    this.plan(state); this.states.set(ball.id, state); this.place(ball, state, time);
  }
  remove(id: number) {this.states.delete(id);}
  clear() {this.states.clear();}
  advance(balls: PopBall[], time: number) {
    for (const ball of balls) {
      const state = this.states.get(ball.id); if (!state) continue;
      if (this.config.variant !== 'floatingheads') while (time >= state.at + state.duration) {
        const end = this.position(state, state.duration);
        state.from = {x: end.x, y: end.y}; state.at += state.duration; state.turn++; this.plan(state);
      }
      this.place(ball, state, time);
    }
  }
  private plan(state: Motion) {
    const rand = (offset: number) => noise(state.seed, state.turn * 6 + offset + 1), speed = this.config.motionSpeed;
    state.duration = (.7 + rand(0) * .6) / this.config.motionRate;
    if (this.config.variant === 'pasu') {
      const angle = (.14 + rand(1) * .22) * Math.PI;
      state.vx = Math.cos(angle) * speed * (rand(2) < .5 ? -1 : 1);
      state.vy = Math.sin(angle) * speed * (rand(3) < .5 ? -1 : 1);
    } else if (this.config.variant === 'driftts') {
      // Short mostly horizontal strokes, with cubic easing to accelerate and decelerate at every turn.
      const length = Math.min(this.halfW * .75, speed * state.duration / 1.5 * (.6 + .4 * rand(1)));
      const slope = (rand(2) * 2 - 1) * .15, dx = length / Math.hypot(1, slope) * (rand(3) < .5 ? -1 : 1);
      state.to = {x: reflected(state.from.x + dx, this.halfW).value,
        y: reflected(state.from.y + dx * slope, this.halfH).value};
    }
  }
  private position(state: Motion, elapsed: number) {
    if (this.config.variant === 'floatingheads') {
      const omega = this.config.motionSpeed / this.halfW, phase = state.phase + elapsed * omega;
      const bobPhase = elapsed * omega * .8 * (noise(state.seed, 3) < .5 ? -1 : 1);
      return {x: this.halfW * Math.sin(phase), y: state.from.y + this.bob * Math.sin(bobPhase),
        vx: this.config.motionSpeed * Math.cos(phase), vy: this.bob * omega * .8 * Math.cos(bobPhase) * (noise(state.seed, 3) < .5 ? -1 : 1)};
    }
    if (this.config.variant === 'pasu') {
      const x = reflected(state.from.x + state.vx * elapsed, this.halfW), y = reflected(state.from.y + state.vy * elapsed, this.halfH);
      return {x: x.value, y: y.value, vx: state.vx * x.sign, vy: state.vy * y.sign};
    }
    const t = Math.min(1, Math.max(0, elapsed / state.duration)), ease = t * t * (3 - 2 * t), velocity = 6 * t * (1 - t) / state.duration;
    return {x: state.from.x + (state.to.x - state.from.x) * ease, y: state.from.y + (state.to.y - state.from.y) * ease,
      vx: (state.to.x - state.from.x) * velocity, vy: (state.to.y - state.from.y) * velocity};
  }
  private place(ball: PopBall, state: Motion, time: number) {
    const position = this.position(state, Math.max(0, time - state.at));
    ball.x = this.region.x + position.x; ball.y = this.region.y + position.y;
    ball.vx = position.vx; ball.vy = position.vy;
  }
}
