import {DEG, type Vec} from './actor-physics';
import {normalize, rampSurface, surfaceHeight, type TerrainSolid} from './terrain';

/** Pop's practice ramps: wedges on the range floor that you start on and walk over, so diagonal counter-strafing (W+D, W+A, S+D,
 * S+A and the stop that follows) can be practised on a slope. They are the engine's ordinary ramp terrain (`terrain.ts`): the
 * hull follows the surface, steps up and down it and stays grounded, so movement, friction and counter-strafe timing are the
 * ones every other mode uses. Only the placement is Pop's.
 *
 * Two layouts. `platform` is a small square platform with a ramp down each of its four sides, and you start in the middle of
 * it. `ramp` is one ramp you start on. `angle` is the slope in degrees and `length` the run of a ramp along its slope (m).
 * A platform stands `length * tan(angle)` high and `platform` is the side of its square top, which is also the width of each
 * of its ramps. A single ramp has its own `width` and `facing` (which way it rises as seen from where you stand at the start:
 * towards the balls, away from them, or to your left or right) and `start` is how far up it you begin: 0 is the bottom edge, 1
 * the top (never closer than half a metre to the top edge). */
export type PopRampShape = 'platform' | 'ramp';
export type PopRampFacing = 'wall' | 'away' | 'left' | 'right';
export type PopRampConfig = {shape: PopRampShape; angle: number; length: number; width: number; facing: PopRampFacing; start: number; platform: number};

/** Every setting that shapes the ramps, in the order the settings list them. */
export const popRampKeys = ['popRamp', 'popRampShape', 'popRampAngle', 'popRampLength', 'popRampWidth', 'popRampFacing', 'popRampStart', 'popRampPlatform'] as const;
export const popRampShapes: readonly (readonly [PopRampShape, string])[] = [['platform', 'Platform with four ramps'], ['ramp', 'One ramp']];
export const popRampFacings: readonly (readonly [PopRampFacing, string])[] = [
  ['wall', 'Uphill toward the balls'], ['away', 'Downhill toward the balls'], ['left', 'Uphill to your left'], ['right', 'Uphill to your right']];
/** Steeper than about 45 degrees is not standable ground in CS2 (a surface normal below 0.7), so the angle stops at 40. */
export const popRampLimits = {angle: [3, 40], length: [2, 10], width: [1, 16], platform: [1.5, 6]} as const;

/** The ramps stand against the range's near wall, the farthest back you can stand (z = 5), so all of them are in front of you. */
export const POP_RAMP_BACK = 5;
/** The balls never come closer than this to the end of the ramp that faces them. */
export const POP_RAMP_CLEARANCE = 1.5;
/** A start at the very top would put you on the edge; it stops this far short of it. */
const TOP_MARGIN = .5;
/** The foot of a ramp stays this close to the middle of the range: you can walk 11.3 m either way (Simulation.environment). */
const REACH = 11;

export type PopRampSolid = TerrainSolid & {id: string};
export type PopRampLayout = {
  /** What the movement code walks on: one wedge, or a platform and its four ramps. */
  solids: PopRampSolid[];
  /** Where you stand at the start: x and z, and the height of the ground under you. */
  start: {x: number; z: number; feet: number};
  /** Height of the top above the floor (m). */
  rise: number;
  /** How far the ramps reach from where you start towards the balls (m). */
  ahead: number;
};

/** The ramps as solids centred on x = 0 against the near wall, and where you start on them. */
export function popRampLayout(ramp: PopRampConfig): PopRampLayout {
  return ramp.shape === 'platform' ? platformLayout(ramp) : singleLayout(ramp);
}

/** A square platform with a wedge down each side, all of them as wide as the platform and as high as it, so the corners
 * between the ramps are open. The back ramp's foot stands against the near wall; you start in the middle of the platform. */
function platformLayout(ramp: PopRampConfig): PopRampLayout {
  const side = ramp.platform, half = side / 2, length = Math.min(ramp.length, REACH - half), rise = length * Math.tan(ramp.angle * DEG);
  const z = POP_RAMP_BACK - half - length, reach = half + length / 2;
  // `direction` is the way the surface rises along its axis: towards the platform.
  const wedge = (id: string, axis: 'x' | 'z', direction: 1 | -1, cx: number, cz: number): PopRampSolid => ({id, center: {x: cx, y: rise / 2, z: cz},
    size: {x: axis === 'x' ? length : side, y: rise, z: axis === 'z' ? length : side}, traversal: {kind: 'ramp', axis, rise, direction}});
  const platform: PopRampSolid = {id: 'pop-platform', center: {x: 0, y: rise / 2, z}, size: {x: side, y: rise, z: side}};
  return {solids: [platform, wedge('pop-ramp-front', 'z', 1, 0, z - reach), wedge('pop-ramp-back', 'z', -1, 0, z + reach),
    wedge('pop-ramp-left', 'x', 1, -reach, z), wedge('pop-ramp-right', 'x', -1, reach, z)],
  rise, start: {x: 0, z, feet: surfaceHeight(platform, 0, z)}, ahead: half + length};
}

/** One wedge against the near wall, and where you start on it. */
function singleLayout(ramp: PopRampConfig): PopRampLayout {
  const {length, width} = ramp, rise = length * Math.tan(ramp.angle * DEG);
  const alongZ = ramp.facing === 'wall' || ramp.facing === 'away';
  // Slope direction along the axis: height grows towards -z (the balls) for 'wall', and towards the back for 'away'.
  const direction: 1 | -1 = ramp.facing === 'wall' || ramp.facing === 'left' ? -1 : 1;
  const axis = alongZ ? 'z' : 'x';
  const solid: PopRampSolid = {id: 'pop-ramp', center: {x: 0, y: rise / 2, z: POP_RAMP_BACK - (alongZ ? length : width) / 2},
    size: {x: alongZ ? width : length, y: rise, z: alongZ ? length : width},
    traversal: {kind: 'ramp', axis, rise, direction}};
  // The bottom edge is the end the slope rises away from; you start `run` metres up from it.
  const run = Math.min(Math.max(0, Math.min(1, ramp.start)) * length, Math.max(0, length - TOP_MARGIN));
  const low = solid.center[axis] - solid.size[axis] / 2, high = solid.center[axis] + solid.size[axis] / 2;
  const along = (direction === 1 ? low : high) + direction * run;
  const x = axis === 'x' ? along : solid.center.x, z = axis === 'z' ? along : solid.center.z;
  return {solids: [solid], rise, start: {x, z, feet: surfaceHeight(solid, x, z)}, ahead: z - (solid.center.z - solid.size.z / 2)};
}

const over = (solid: TerrainSolid, x: number, z: number) =>
  Math.abs(x - solid.center.x) <= solid.size.x / 2 + 1e-9 && Math.abs(z - solid.center.z) <= solid.size.z / 2 + 1e-9;

/** The height of the ground under a hull centred at (x, z): the highest surface its centre is over, else the floor. */
export function popRampFloorAt(solids: readonly TerrainSolid[], x: number, z: number): number {
  let height = 0;
  for (const solid of solids) if (over(solid, x, z)) height = Math.max(height, surfaceHeight(solid, x, z));
  return height;
}

/** The height of a solid's visible surface at (x, z): the plain slope, without the allowance for the hull that `feet` carries
 * (a standing hull rests on the surface under its uphill edge). */
export function popRampSurfaceAt(solid: TerrainSolid, x: number, z: number): number {
  const {slopeX, slopeZ, centerHeight} = rampSurface(solid);
  return centerHeight + slopeX * (x - solid.center.x) + slopeZ * (z - solid.center.z);
}

/** The visible ground at (x, z): the highest surface there with its unit normal, or the flat floor. */
export function popRampGroundAt(solids: readonly TerrainSolid[], x: number, z: number): {height: number; normal: Vec} {
  let ground = {height: 0, normal: {x: 0, y: 1, z: 0}};
  for (const solid of solids) {
    if (!over(solid, x, z)) continue;
    const height = popRampSurfaceAt(solid, x, z);
    if (height > ground.height) {
      const {slopeX, slopeZ} = rampSurface(solid);
      ground = {height, normal: normalize({x: slopeX ? -slopeX : 0, y: 1, z: slopeZ ? -slopeZ : 0})};
    }
  }
  return ground;
}

/** Distance along a unit ray to a solid's surface (its slope or top, its sides or its end), 0 from inside it, undefined for a
 * miss. A wedge or a box is convex, so this clips the ray against its six planes. */
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

/** The nearest of `rayRampDistance` over several solids. */
export function rayRampsDistance(origin: Vec, direction: Vec, solids: readonly TerrainSolid[]): number | undefined {
  let nearest: number | undefined;
  for (const solid of solids) {
    const distance = rayRampDistance(origin, direction, solid);
    if (distance !== undefined && (nearest === undefined || distance < nearest)) nearest = distance;
  }
  return nearest;
}
