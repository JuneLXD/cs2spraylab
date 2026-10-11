import type {DeathBody} from './death-physics';

/** Rounded body volume along a bone; trims keep the adjoining joint free to bend. */
export type DeathCapsule = {name: string; a: string; b: string; radius: number;
  start?: number; end?: number; exclude?: readonly string[]};
type Segment = {a: number; b: number; radius: number; start: number; end: number};
type Pair = {a: number; b: number; initial: number; normal: number[]};
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Closest points, including parallel, intersecting and zero-length segments.
 * out = [fractionA, fractionB, deltaX, deltaY, deltaZ, distance]. No per-contact allocations. */
export function closestSegments(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>, out: Float64Array) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
  const rx = a[0] - c[0], ry = a[1] - c[1], rz = a[2] - c[2];
  const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz;
  const vr = vx * rx + vy * ry + vz * rz, ur = ux * rx + uy * ry + uz * rz;
  let s = 0, t = 0;
  if (uu < 1e-12) t = vv < 1e-12 ? 0 : clamp(vr / vv);
  else if (vv < 1e-12) s = clamp(-ur / uu);
  else {
    const uv = ux * vx + uy * vy + uz * vz, determinant = uu * vv - uv * uv;
    s = determinant > 1e-12 ? clamp((uv * vr - ur * vv) / determinant) : 0;
    t = (uv * s + vr) / vv;
    if (t < 0) {t = 0; s = clamp(-ur / uu);}
    else if (t > 1) {t = 1; s = clamp((uv - ur) / uu);}
  }
  out[0] = s; out[1] = t;
  out[2] = rx + ux * s - vx * t; out[3] = ry + uy * s - vy * t; out[4] = rz + uz * s - vz * t;
  out[5] = Math.hypot(out[2], out[3], out[4]);
}

/** Non-adjacent body volumes exchange mass-weighted corrections at their closest points. */
export class CapsuleContacts {
  readonly pairs: Pair[] = [];
  private readonly segments: Segment[];
  private readonly ends = Array.from({length: 4}, () => new Float64Array(3));
  private readonly closest = new Float64Array(6);
  constructor(readonly definitions: readonly DeathCapsule[], bodies: readonly DeathBody[],
    private readonly positions: Float64Array, private readonly inverseMass: Float64Array) {
    if (definitions.length > 24 || new Set(definitions.map(d => d.name)).size !== definitions.length)
      throw new Error('Death capsules must be unique and bounded to 24.');
    this.segments = definitions.map(def => {
      const a = bodies.findIndex(b => b.name === def.a), b = bodies.findIndex(b => b.name === def.b);
      const start = def.start ?? 0, end = def.end ?? 1;
      if (a < 0 || b < 0 || !Number.isFinite(def.radius) || def.radius <= 0 || !(start >= 0 && end <= 1 && start <= end))
        throw new Error('Death capsules need existing endpoints, positive radii and ordered trims.');
      return {a, b, radius: def.radius, start, end};
    });
    for (let a = 0; a < definitions.length; a++) for (let b = a + 1; b < definitions.length; b++) {
      const first = this.segments[a], second = this.segments[b];
      if (first.a === second.a || first.a === second.b || first.b === second.a || first.b === second.b ||
        definitions[a].exclude?.includes(definitions[b].name) || definitions[b].exclude?.includes(definitions[a].name)) continue;
      this.measure(first, second);
      const distance = this.closest[5];
      let normal = Array.from(this.closest.slice(2, 5));
      if (distance < 1e-8) {
        const [p, q, r, s] = this.ends;
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
        const vx = s[0] - r[0], vy = s[1] - r[1], vz = s[2] - r[2];
        normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        if (Math.hypot(...normal) < 1e-8) normal = Math.abs(ux) < Math.abs(uy) ? [0, -uz, uy] : [-uy, ux, 0];
        if (Math.hypot(...normal) < 1e-8) normal = [1, 0, 0];
      }
      const length = Math.hypot(...normal);
      this.pairs.push({a, b, initial: Math.min(distance, first.radius + second.radius), normal: normal.map(v => v / length)});
    }
  }
  /** The imported weapon-holding pose may overlap slightly. Ease out only that
   * initial overlap, then keep the full body thickness for the entire fall. */
  clearance(pair: Pair, age: number) {
    const full = this.segments[pair.a].radius + this.segments[pair.b].radius;
    return full - (full - pair.initial) * Math.max(0, 1 - age / .18);
  }
  private measure(a: Segment, b: Segment) {
    for (let end = 0; end < 4; end++) {
      const segment = end < 2 ? a : b, t = end % 2 === 0 ? segment.start : segment.end;
      for (let k = 0; k < 3; k++) this.ends[end][k] = this.positions[segment.a * 3 + k] * (1 - t) + this.positions[segment.b * 3 + k] * t;
    }
    closestSegments(this.ends[0], this.ends[1], this.ends[2], this.ends[3], this.closest);
  }
  solve(age: number) {
    let corrections = 0;
    for (const pair of this.pairs) {
      const a = this.segments[pair.a], b = this.segments[pair.b];
      this.measure(a, b);
      const distance = this.closest[5], overlap = this.clearance(pair, age) - distance;
      if (overlap <= 0) continue;
      const s = a.start + (a.end - a.start) * this.closest[0], t = b.start + (b.end - b.start) * this.closest[1];
      const wa = this.inverseMass[a.a], wb = this.inverseMass[a.b], wc = this.inverseMass[b.a], wd = this.inverseMass[b.b];
      const massA = a.a === a.b ? wa : (1 - s) ** 2 * wa + s * s * wb;
      const massB = b.a === b.b ? wc : (1 - t) ** 2 * wc + t * t * wd;
      const push = overlap / (massA + massB);
      for (let k = 0; k < 3; k++) {
        const normal = distance > 1e-8 ? this.closest[k + 2] / distance : pair.normal[k];
        this.positions[a.a * 3 + k] += normal * push * (1 - s) * wa;
        this.positions[a.b * 3 + k] += normal * push * s * wb;
        this.positions[b.a * 3 + k] -= normal * push * (1 - t) * wc;
        this.positions[b.b * 3 + k] -= normal * push * t * wd;
      }
      corrections += overlap;
    }
    return corrections;
  }
  /** Floor/box contacts need the same thickness as the self-contact volumes. */
  expandRadii(radii: Float64Array) {
    for (const segment of this.segments) {
      radii[segment.a] = Math.max(radii[segment.a], segment.radius);
      radii[segment.b] = Math.max(radii[segment.b], segment.radius);
    }
  }
}
