import type {Vec} from '../actor-physics';
import type {Hitgroup} from './types';

export type HitCapsule = {start: Vec; end: Vec; radius: number; group: Hitgroup; index: number};
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract = (a: Vec, b: Vec): Vec => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const finite = (v: Vec) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Entry/exit along a unit ray, including starts inside and degenerate capsules. */
export function rayCapsule(origin: Vec, direction: Vec, capsule: HitCapsule, maxDistance = Infinity) {
  const {start, end, radius} = capsule;
  if (![origin, direction, start, end].every(finite) || !Number.isFinite(radius) || radius <= 0 || !(maxDistance >= 0)) return;
  const axis = subtract(end, start), offset = subtract(origin, start), length2 = dot(axis, axis), direction2 = dot(direction, direction);
  if (direction2 < 1e-18) return;
  const axialDirection = dot(axis, direction), axialOrigin = dot(axis, offset), rayOrigin = dot(direction, offset);
  const projection = length2 ? Math.max(0, Math.min(1, axialOrigin / length2)) : 0;
  const inside = dot(offset, offset) - 2 * projection * axialOrigin + projection * projection * length2 <= radius * radius;
  let near = Infinity, far = -Infinity;
  const accept = (t: number) => {if (t >= -1e-10) {near = Math.min(near, Math.max(0, t)); far = Math.max(far, Math.max(0, t));}};
  const sphere = (center: Vec, side: -1 | 0 | 1) => {
    const q = subtract(origin, center), b = dot(q, direction), c = dot(q, q) - radius * radius;
    const discriminant = b * b - direction2 * c;
    if (discriminant < 0) return;
    const root = Math.sqrt(discriminant);
    for (const t of [(-b - root) / direction2, (-b + root) / direction2]) {
      const along = axialOrigin + t * axialDirection;
      if (side === 0 || (side === -1 ? along <= 1e-10 : along >= length2 - 1e-10)) accept(t);
    }
  };
  if (length2 < 1e-18) sphere(start, 0);
  else {
    const a = length2 * direction2 - axialDirection * axialDirection;
    const b = length2 * rayOrigin - axialOrigin * axialDirection;
    const c = length2 * (dot(offset, offset) - radius * radius) - axialOrigin * axialOrigin;
    const discriminant = b * b - a * c;
    if (a > length2 * direction2 * 1e-12 && discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / a, (-b + root) / a]) {
        const along = axialOrigin + t * axialDirection;
        if (along >= -1e-10 && along <= length2 + 1e-10) accept(t);
      }
    }
    sphere(start, -1); sphere(end, 1);
  }
  const entry = inside ? 0 : near;
  return entry <= maxDistance && far >= entry && Number.isFinite(far) ? {entry, exit: far} : undefined;
}

export function traceHitboxes(origin: Vec, direction: Vec, hitboxes: readonly HitCapsule[], maxDistance = Infinity) {
  let distance = Infinity, exitDistance = -Infinity, group: Hitgroup | undefined;
  for (const capsule of hitboxes) {
    // Retain the full flesh chord even when an exit or another limb is beyond range.
    const hit = rayCapsule(origin, direction, capsule);
    if (!hit) continue;
    exitDistance = Math.max(exitDistance, hit.exit);
    if (hit.entry < distance && hit.entry <= maxDistance) {distance = hit.entry; group = capsule.group;}
  }
  return {distance, exitDistance: group ? exitDistance : Infinity, group};
}
