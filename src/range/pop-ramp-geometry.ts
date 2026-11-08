import {BufferGeometry, Color, Float32BufferAttribute} from 'three';
import {rampSurface, type TerrainSolid} from './terrain';

type Point = [number, number, number];
const TOP = new Color('#6f7b85'), SIDE_X = new Color('#454d55'), SIDE_Z = new Color('#515a62'), MARK = new Color('#d6dee4');

/** The ramp as one mesh, its shading baked into vertex colours so an unlit material shows it as authored under Pop's dim
 * lights: the sloped top, the faces that rise from the floor, a light border along the top's edge and a cross line every
 * metre of run, so the slope's direction and length read at a glance. Built from the same solid the movement uses. */
export function popRampGeometry(solid: TerrainSolid): BufferGeometry {
  const {slopeX, slopeZ, centerHeight} = rampSurface(solid), {center: c, size: s} = solid;
  const x0 = c.x - s.x / 2, x1 = c.x + s.x / 2, z0 = c.z - s.z / 2, z1 = c.z + s.z / 2, floor = c.y - s.y / 2;
  const height = (x: number, z: number) => centerHeight + slopeX * (x - c.x) + slopeZ * (z - c.z);
  const positions: number[] = [], colors: number[] = [];
  const quad = (points: readonly [Point, Point, Point, Point], color: Color) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {positions.push(...points[i]); colors.push(color.r, color.g, color.b);}
  };
  const top = (x: number, z: number, lift = 0): Point => [x, height(x, z) + lift, z];
  quad([top(x0, z0), top(x0, z1), top(x1, z1), top(x1, z0)], TOP);
  // The faces that rise from the floor. The bottom edge of the slope has no height, so it has no face.
  const face = (a: readonly [number, number], b: readonly [number, number], color: Color) => {
    const ha = height(a[0], a[1]) - floor, hb = height(b[0], b[1]) - floor;
    if (ha < 1e-6 && hb < 1e-6) return;
    quad([[a[0], floor, a[1]], [b[0], floor, b[1]], [b[0], floor + hb, b[1]], [a[0], floor + ha, a[1]]], color);
  };
  face([x0, z0], [x0, z1], SIDE_X); face([x1, z0], [x1, z1], SIDE_X); face([x0, z0], [x1, z0], SIDE_Z); face([x0, z1], [x1, z1], SIDE_Z);
  // Markings lie a hair above the slope: the pad (12 mm) and bullet marks sit above them, so nothing else needs a depth offset.
  const lift = .008, edge = Math.min(.06, s.x / 8, s.z / 8), line = .05;
  const strip = (xa: number, xb: number, za: number, zb: number) =>
    quad([top(xa, za, lift), top(xa, zb, lift), top(xb, zb, lift), top(xb, za, lift)], MARK);
  strip(x0, x1, z0, z0 + edge); strip(x0, x1, z1 - edge, z1); strip(x0, x0 + edge, z0 + edge, z1 - edge); strip(x1 - edge, x1, z0 + edge, z1 - edge);
  const ramp = solid.traversal?.kind === 'ramp' ? solid.traversal : undefined;
  if (ramp) {
    const lo = ramp.axis === 'x' ? x0 : z0, hi = ramp.axis === 'x' ? x1 : z1, direction = ramp.direction ?? 1;
    for (let k = 1; k < hi - lo - 1e-6; k++) {
      const at = (direction === 1 ? lo : hi) + direction * k;
      if (ramp.axis === 'x') strip(at - line / 2, at + line / 2, z0 + edge, z1 - edge);
      else strip(x0 + edge, x1 - edge, at - line / 2, at + line / 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
