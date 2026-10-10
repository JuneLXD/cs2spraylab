import {PunchRecovery} from './punch-recovery';

export type RecoilParameters = {
  recoilSeed: number; recoilAngle: number; recoilVariance: number;
  recoilMagnitude: number; recoilMagnitudeVariance: number; fullAuto: boolean;
  magazine: number; cycle: number;
};
export type RecoilAngle = { yaw: number; pitch: number };
export type RecoilSelection = {seed: number; burst?: boolean};
const f = Math.fround;

/** Current native lookup: ordinary automatic fire uses the recovering index;
 * semiautomatic/burst fire uses the supplied command integer's low six bits.
 * An omitted selection preserves legacy/captured-pattern callers. */
export function recoilTableIndex(w: RecoilParameters, index: number, selection?: RecoilSelection) {
  return (selection && (!w.fullAuto || selection.burst) ? selection.seed : Math.trunc(index)) & 63;
}

// Park-Miller with the 32-entry shuffle used by tier0's uniform stream.
// Float conversion is tested against offline emulation of the installed DLL.
export class UniformRandomStream {
  private state: number;
  private shuffle = new Int32Array(32);
  private previous = 0;
  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < -2147483647 || seed > 2147483647) {
      throw new RangeError('Source random seed must be an integer in [-2147483647, 2147483647]');
    }
    this.state = -Math.abs(seed);
  }
  private nextInteger() {
    if (this.state <= 0 || this.previous === 0) {
      this.state = Math.max(1, -this.state);
      for (let j = 39; j >= 0; j--) {
        this.state = this.state * 16807 % 2147483647;
        if (j < 32) this.shuffle[j] = this.state;
      }
      this.previous = this.shuffle[0];
    }
    this.state = this.state * 16807 % 2147483647;
    const index = Math.floor(this.previous / 67108864);
    this.previous = this.shuffle[index];
    this.shuffle[index] = this.state;
    return this.previous;
  }
  float(low: number, high: number) {
    const unit = Math.min(.9999998807907104, f(f(this.nextInteger()) * f(1 / 2147483647)));
    return f(f(unit * f(high - low)) + low);
  }
}

// The caller supplies the numeric shot seed, not a recoil-table seed or a
// prediction of a live game's command seed. One closure owns one stream.
export function sourceRandom(seed: number): () => number {
  const stream = new UniformRandomStream(seed);
  return () => stream.float(0, 1);
}

// Installed build 2000924, client 7cbad0..7cbb48. The first 64 shotgun
// spread entries stratify radii by pellet number, without sqrt area sampling.
export function shotgunSpreadTable(seed: number, pellets: number) {
  if (!Number.isInteger(pellets) || pellets < 2 || pellets > 64) throw new RangeError('Shotgun pellet count must be 2..64');
  const random = new UniformRandomStream(seed), step = f(1 / pellets);
  return Array.from({length: 64}, (_, index) => {
    const angle = random.float(0, f(Math.PI * 2)), pellet = index % pellets;
    const radius = random.float(f(pellet * step), f((pellet + 1) * step));
    return {angle, radius: Math.max(0, Math.min(1, radius))};
  });
}

export function recoilTable(w: RecoilParameters) {
  const random = new UniformRandomStream(w.recoilSeed);
  let angle = 0, magnitude = 0;
  return Array.from({ length: 64 }, (_, i) => {
    const a = f(f(w.recoilAngle) + random.float(-f(w.recoilVariance), f(w.recoilVariance)));
    const m = f(f(w.recoilMagnitude) + random.float(-f(w.recoilMagnitudeVariance), f(w.recoilMagnitudeVariance)));
    angle = w.fullAuto && i > 0 ? f(angle + f(f(a - angle) * f(.55))) : a;
    magnitude = w.fullAuto && i > 0 ? f(magnitude + f(f(m - magnitude) * f(.55))) : m;
    if (w.fullAuto && i < 4) magnitude = f(magnitude * f(.75 + i / 16));
    return { angle, magnitude };
  });
}

const DT = 1 / 128;
// Preview points use the same native cache and fractional-time quaternion
// interpolation as live firing, including the small-angle cutoff.
export function nativeRecoilPattern(w: RecoilParameters): RecoilAngle[] {
  const table = recoilTable(w);
  let recovery = new PunchRecovery();
  return Array.from({ length: w.magazine }, (_, shot) => {
    const elapsed = shot ? w.cycle : 0, current = recovery.sample(elapsed);
    const angle = recovery.sample(elapsed + DT), velocity = recovery.velocity(elapsed);
    const point = { yaw: current.yaw * 2, pitch: current.pitch * 2 };
    const impulse = table[shot % 64];
    const radians = f(impulse.angle * f(Math.PI / 180));
    const next = { yaw: f(velocity.yaw + f(Math.sin(radians) * impulse.magnitude)), pitch: f(velocity.pitch + f(Math.cos(radians) * impulse.magnitude)), roll: 0 };
    recovery = new PunchRecovery(angle, next);
    return point;
  });
}
