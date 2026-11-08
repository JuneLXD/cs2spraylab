import {BufferGeometry, Color, Float32BufferAttribute} from 'three';
import {rampSurface, type TerrainSolid} from './terrain';

type Point = [number, number, number];
type Interval = readonly [number, number];
type Span = {from: number; to: number; marked: boolean};
const TOP = new Color('#6f7b85'), SIDE_X = new Color('#454d55'), SIDE_Z = new Color('#515a62'), MARK = new Color('#d6dee4');
/** The light border along the edge of every top, and the width of the cross line every metre of a ramp's run (m). */
const EDGE = .06, LINE = .05;

/** [lo, hi] cut into plain and marked spans. `marks` lie inside it, sorted and apart. */
function spans(lo: number, hi: number, marks: readonly Interval[]): Span[] {
  const out: Span[] = []; let at = lo;
  for (const [from, to] of marks) {
    if (from > at + 1e-9) out.push({from: at, to: from, marked: false});
    out.push({from, to, marked: true}); at = to;
  }
  if (hi > at + 1e-9) out.push({from: at, to: hi, marked: false});
  return out;
}

/** The ramps and platform as one mesh, their shading baked into vertex colours so an unlit material shows them as authored under
 * Pop's dim lights: the sloped or flat tops, the faces that rise from the floor, a light border along the edge of each top and a
 * cross line every metre of run on a ramp, so the slope's direction and length read at a glance. Built from the same solids the
 * movement uses. The markings are cells of the top itself, never strips laid over it, so nothing overlaps, no depth offset is
 * needed and no view angle or depth precision can lose a line. */
export function popRampGeometry(solids: readonly TerrainSolid[]): BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const quad = (points: readonly [Point, Point, Point, Point], color: Color) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {positions.push(...points[i]); colors.push(color.r, color.g, color.b);}
  };
  for (const solid of solids) {
    const {slopeX, slopeZ, centerHeight} = rampSurface(solid), {center: c, size: s} = solid;
    const x0 = c.x - s.x / 2, x1 = c.x + s.x / 2, z0 = c.z - s.z / 2, z1 = c.z + s.z / 2, floor = c.y - s.y / 2;
    const top = (x: number, z: number): Point => [x, centerHeight + slopeX * (x - c.x) + slopeZ * (z - c.z), z];
    // The faces that rise from the floor. The bottom edge of a slope has no height, so it has no face. Where two solids meet
    // their faces coincide inside the structure and are never seen.
    const face = (a: readonly [number, number], b: readonly [number, number], color: Color) => {
      const ha = top(a[0], a[1])[1] - floor, hb = top(b[0], b[1])[1] - floor;
      if (ha < 1e-6 && hb < 1e-6) return;
      quad([[a[0], floor, a[1]], [b[0], floor, b[1]], [b[0], floor + hb, b[1]], [a[0], floor + ha, a[1]]], color);
    };
    face([x0, z0], [x0, z1], SIDE_X); face([x1, z0], [x1, z1], SIDE_X); face([x0, z0], [x1, z0], SIDE_Z); face([x0, z1], [x1, z1], SIDE_Z);
    // The top, cut along its markings: a border all round and, on a ramp, a line across it every metre of run.
    const ramp = solid.traversal?.kind === 'ramp' ? solid.traversal : undefined, edge = Math.min(EDGE, s.x / 8, s.z / 8);
    const marks = (axis: 'x' | 'z', lo: number, hi: number): Interval[] => {
      const list: Interval[] = [[lo, lo + edge], [hi - edge, hi]];
      if (ramp?.axis === axis) {
        const direction = ramp.direction ?? 1;
        for (let k = 1; k < hi - lo - 1e-6; k++) {const at = (direction === 1 ? lo : hi) + direction * k; list.push([at - LINE / 2, at + LINE / 2]);}
      }
      return list.sort((a, b) => a[0] - b[0]);
    };
    for (const a of spans(x0, x1, marks('x', x0, x1))) for (const b of spans(z0, z1, marks('z', z0, z1)))
      quad([top(a.from, b.from), top(a.from, b.to), top(a.to, b.to), top(a.to, b.from)], a.marked || b.marked ? MARK : TOP);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
