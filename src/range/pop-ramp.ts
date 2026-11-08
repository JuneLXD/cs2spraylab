import {DEG, type Vec} from './actor-physics';
import {rampSurface, surfaceHeight, type TerrainSolid} from './terrain';

/** Pop's practice ramp: a wedge on the range floor that you start on and walk over, so diagonal counter-strafing (W+D, W+A, S+D,
 * S+A and the stop that follows) can be practised on a slope. It is the engine's ordinary ramp terrain (`terrain.ts`): the
 * hull follows its surface, steps up and down it and stays grounded, so movement, friction and counter-strafe timing are the
 * ones every other mode uses. Only the placement is Pop's.
 *
 * `angle` is the slope in degrees, `length` the run along the slope and `width` the span across it (m). `facing` is which way
 * it rises as seen from where you stand at the start (towards the balls, away from them, or to your left or right). `start` is
 * how far up the ramp you begin: 0 is the bottom edge, 1 the top (never closer than half a metre to the top edge). */
export type PopRampFacing = 'wall' | 'away' | 'left' | 'right';
export type PopRampConfig = {angle: number; length: number; width: number; facing: PopRampFacing; start: number};

/** Every setting that shapes the ramp, in the order the settings list them. */
export const popRampKeys = ['popRamp', 'popRampAngle', 'popRampLength', 'popRampWidth', 'popRampFacing', 'popRampStart'] as const;
export const popRampFacings: readonly (readonly [PopRampFacing, string])[] = [
  ['wall', 'Uphill toward the balls'], ['away', 'Downhill toward the balls'], ['left', 'Uphill to your left'], ['right', 'Uphill to your right']];
/** Steeper than about 45 degrees is not standable ground in CS2 (a surface normal below 0.7), so the angle stops at 40. */
export const popRampLimits = {angle: [3, 40], length: [2, 10], width: [1, 16]} as const;

/** The ramp stands against the range's near wall, the farthest back you can stand (z = 5), so all of it is in front of you. */
export const POP_RAMP_BACK = 5;
/** The balls never come closer than this to the end of the ramp that faces them. */
export const POP_RAMP_CLEARANCE = 1.5;
/** A start at the very top would put you on the edge; it stops this far short of it. */
const TOP_MARGIN = .5;

export type PopRampLayout = {
  solid: TerrainSolid & {id: string};
  /** Where you stand at the start: x and z, and the height of the ground under you. */
  start: {x: number; z: number; feet: number};
  /** Height of the top edge above the floor (m). */
  rise: number;
  /** How far the ramp reaches from where you start towards the balls (m). */
  ahead: number;
};

/** The ramp as a wedge solid centred on x = 0 against the near wall, and where you start on it. */
export function popRampLayout(ramp: PopRampConfig): PopRampLayout {
  const {length, width} = ramp, rise = length * Math.tan(ramp.angle * DEG);
  const alongZ = ramp.facing === 'wall' || ramp.facing === 'away';
  // Slope direction along the axis: height grows towards -z (the balls) for 'wall', and towards the back for 'away'.
  const direction: 1 | -1 = ramp.facing === 'wall' || ramp.facing === 'left' ? -1 : 1;
  const axis = alongZ ? 'z' : 'x';
  const solid = {id: 'pop-ramp', center: {x: 0, y: rise / 2, z: POP_RAMP_BACK - (alongZ ? length : width) / 2},
    size: {x: alongZ ? width : length, y: rise, z: alongZ ? length : width},
    traversal: {kind: 'ramp' as const, axis: axis as 'x' | 'z', rise, direction}};
  // The bottom edge is the end the slope rises away from; you start `run` metres up from it.
  const run = Math.min(Math.max(0, Math.min(1, ramp.start)) * length, Math.max(0, length - TOP_MARGIN));
  const low = solid.center[axis] - solid.size[axis] / 2, high = solid.center[axis] + solid.size[axis] / 2;
  const along = (direction === 1 ? low : high) + direction * run;
  const x = axis === 'x' ? along : solid.center.x, z = axis === 'z' ? along : solid.center.z;
  return {solid, rise, start: {x, z, feet: surfaceHeight(solid, x, z)}, ahead: z - (solid.center.z - solid.size.z / 2)};
}

/** The height of the ground under a hull centred at (x, z): the ramp's surface where the centre is over it, else the floor. */
export function popRampFloorAt(solid: TerrainSolid, x: number, z: number): number {
  const over = Math.abs(x - solid.center.x) <= solid.size.x / 2 + 1e-9 && Math.abs(z - solid.center.z) <= solid.size.z / 2 + 1e-9;
  return over ? surfaceHeight(solid, x, z) : 0;
}

/** The height of the ramp's visible surface at (x, z): the plain slope, without the allowance for the hull that `feet` carries
 * (a standing hull rests on the surface under its uphill edge). */
export function popRampSurfaceAt(solid: TerrainSolid, x: number, z: number): number {
  const {slopeX, slopeZ, centerHeight} = rampSurface(solid);
  return centerHeight + slopeX * (x - solid.center.x) + slopeZ * (z - solid.center.z);
}

/** Distance along a unit ray to the ramp's surface (its slope, its sides or its top end), 0 from inside it, undefined for a
 * miss. The wedge is convex, so this clips the ray against its six planes. */
export function rayRampDistance(origin: Vec, direction: Vec, solid: TerrainSolid): number | undefined {
  const {slopeX, slopeZ, centerHeight} = rampSurface(solid), {center: c, size: s} = solid;
  // A point p is inside when dot(normal, p) <= offset for every plane.
  const planes: readonly (readonly [Vec, number])[] = [
    [{x: 1, y: 0, z: 0}, c.x + s.x / 2], [{x: -1, y: 0, z: 0}, -(c.x - s.x / 2)],
    [{x: 0, y: 0, z: 1}, c.z + s.z / 2], [{x: 0, y: 0, z: -1}, -(c.z - s.z / 2)],
    [{x: 0, y: -1, z: 0}, -(c.y - s.y / 2)],
    [{x: -slopeX, y: 1, z: -slopeZ}, centerHeight - slopeX * c.x - slopeZ * c.z]];
  let near = 0, far = Infinity;
  for (const [n, offset] of planes) {
    const toward = n.x * direction.x + n.y * direction.y + n.z * direction.z, room = offset - (n.x * origin.x + n.y * origin.y + n.z * origin.z);
    if (Math.abs(toward) < 1e-12) {if (room < 0) return undefined; continue;}
    const t = room / toward;
    if (toward < 0) near = Math.max(near, t); else far = Math.min(far, t);
    if (near > far) return undefined;
  }
  return near;
}
