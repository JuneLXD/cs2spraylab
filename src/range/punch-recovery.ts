// Installed Linux client 2000927, 0x15147a0. Time is sampled relative to the
// last impulse; input/render updates must never restart the 128 Hz cache.
export type PunchVector = {pitch: number; yaw: number; roll: number};
const f = Math.fround, STEP = 1 / 128, DECAY = f(Math.exp(-8 * STEP));
const zero = (): PunchVector => ({pitch: 0, yaw: 0, roll: 0});
const length = (v: PunchVector) => f(Math.sqrt(f(f(f(v.pitch * v.pitch) + f(v.yaw * v.yaw)) + f(v.roll * v.roll))));
const scale = (v: PunchVector, n: number): PunchVector => ({pitch: f(v.pitch * n), yaw: f(v.yaw * n), roll: f(v.roll * n)});
const clamp = (x: number) => Math.max(-89, Math.min(89, x));

function quaternion(v: PunchVector) {
  const half = f(Math.PI / 360);
  const p = f(clamp(v.pitch) * half), y = f(clamp(v.yaw) * half), r = f(clamp(v.roll) * half);
  const sp = f(Math.sin(p)), cp = f(Math.cos(p)), sy = f(Math.sin(y)), cy = f(Math.cos(y)), sr = f(Math.sin(r)), cr = f(Math.cos(r));
  return [f(f(f(sr * cp) * cy) - f(f(cr * sp) * sy)), f(f(f(cr * sp) * cy) + f(f(sr * cp) * sy)),
    f(f(f(cr * cp) * sy) - f(f(sr * sp) * cy)), f(f(f(cr * cp) * cy) + f(f(sr * sp) * sy))];
}

function interpolate(a: PunchVector, b: PunchVector, t: number): PunchVector {
  const q = quaternion(a), p = quaternion(b);
  // Native polynomial correction to normalized quaternion interpolation.
  const dot = f(f(f(q[0] * p[0]) + f(q[1] * p[1])) + f(f(q[2] * p[2]) + f(q[3] * p[3]))), d = Math.abs(dot);
  const k = f(f(f(f(f(f(3.55644989) - f(f(1.43518996) * d)) * d) - f(3.24519992)) * d) + f(1.09039998));
  const l = f(f(f(f(f(.215637997) * d) - f(1.06020999)) * d) + f(.848012984));
  const centered = f(t - .5);
  const alpha = f(t + f(f(f(k * f(centered * centered)) + l) * f(f(centered * t) * f(t - 1))));
  const beta = dot <= 0 ? -alpha : alpha;
  const mixed = q.map((v, i) => f(f(v * f(1 - alpha)) + f(p[i] * beta)));
  const norm = f(Math.sqrt(f(f(f(mixed[0] ** 2) + f(mixed[1] ** 2)) + f(f(mixed[2] ** 2) + f(mixed[3] ** 2)))));
  const [x, y, z, w] = mixed.map(v => f(v / norm));
  const forwardX = f(1 - f(f(2 * f(y * y)) + f(2 * f(z * z))));
  const forwardY = f(f(2 * f(x * y)) + f(2 * f(w * z)));
  const forwardZ = f(f(2 * f(x * z)) - f(2 * f(w * y)));
  const horizontal = f(Math.sqrt(f(f(forwardX * forwardX) + f(forwardY * forwardY))));
  const degrees = f(180 / Math.PI);
  const pitch = f(f(Math.atan2(-forwardZ, horizontal)) * degrees);
  const yaw = f(f(Math.atan2(forwardY, forwardX)) * degrees);
  const roll = f(f(Math.atan2(f(f(2 * f(y * z)) + f(2 * f(w * x))), f(1 - f(f(2 * f(x * x)) + f(2 * f(y * y)))))) * degrees);
  return {pitch, yaw, roll};
}

export class PunchRecovery {
  private samples: PunchVector[];
  constructor(angle: PunchVector = zero(), private readonly impulse: PunchVector = zero()) {
    this.samples = [{...angle}];
  }
  clone() {
    const copy = new PunchRecovery(this.samples[0], this.impulse);
    copy.samples = this.samples.slice();
    return copy;
  }
  velocity(seconds: number) {
    const v = scale(this.impulse, f(Math.exp(f(-4.5 * Math.max(0, seconds)))));
    return length(v) < 1 / 32 ? zero() : v;
  }
  sample(seconds: number, cutoff = true): PunchVector {
    const base = this.samples[0];
    if (base.pitch === 0 && base.yaw === 0 && base.roll === 0 && this.impulse.pitch === 0 && this.impulse.yaw === 0 && this.impulse.roll === 0) return zero();
    const ticks = f(Math.max(0, seconds) * 128), index = Math.floor(ticks);
    while (this.samples.length <= Math.min(128, index + 1)) {
      const n = this.samples.length, decayed = scale(this.samples[n - 1], DECAY), magnitude = length(decayed);
      const angle = scale(decayed, magnitude > 18 * STEP ? f(1 - f(18 * STEP / magnitude)) : 0);
      const before = this.velocity((n - 1) * STEP), after = this.velocity(n * STEP);
      this.samples.push({pitch: f(f(angle.pitch + f(before.pitch * STEP / 2)) + f(after.pitch * STEP / 2)),
        yaw: f(f(angle.yaw + f(before.yaw * STEP / 2)) + f(after.yaw * STEP / 2)),
        roll: f(f(angle.roll + f(before.roll * STEP / 2)) + f(after.roll * STEP / 2))});
    }
    const at = (n: number) => n < this.samples.length ? this.samples[n]
      : scale(this.samples[128], f(Math.pow(DECAY, n - 128)));
    const angle = interpolate(at(index), at(index + 1), f(ticks - index));
    return cutoff && length(angle) < 1 / 32 ? zero() : angle;
  }
}
