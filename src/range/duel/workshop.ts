import type {SurfaceMaterial} from './environment';
import type {Arena, Solid, WorkshopSpawn} from './geometry';

/** Collision, spawns and bot spots of an imported CS2 map, as written by tools/import-map.mjs. Boxes are in voxels from
 * `origin`; material -1 marks a player clip or pass-bullets brush, which stops movement but not bullets. */
type CollisionBox = [number, number, number, number, number, number, number];
export type CollisionDetailRegion = {id: string; voxel: number; origin: [number, number, number];
  dimensions: [number, number, number]; boxes: CollisionBox[]};
export type WorkshopData = {name: string; voxel: number; origin: [number, number, number]; materials: SurfaceMaterial[];
  bounds: {minX: number; maxX: number; minZ: number; maxZ: number}; spawns: WorkshopSpawn[];
  spots: [number, number, number][]; boxes: CollisionBox[];
  /** Small native-physics rebuilds replacing coarse collision inside these complete volumes. */
  detailRegions?: CollisionDetailRegion[]};

export const workshopMaps = {
  // The T spawns look at a wall of crates. From the north end you see down the whole hall: floor, crates and catwalk.
  aim_redline: {credits: 'BOT Reed', model: '/maps/aim_redline.glb?v=lighting-3', aimBotz: {x: 11, z: -28, yaw: Math.PI},
    load: () => import('./maps/aim_redline.json')},
  // Valve's Ancient from the installed game (tools/import-map.mjs with --voxel .2 --headroom 16 --below 8), for Blitz.
  de_ancient: {credits: 'Valve', model: '/maps/de_ancient.glb?v=2', aimBotz: undefined,
    load: () => import('./maps/de_ancient.json')},
} as const;
export type WorkshopMapId = keyof typeof workshopMaps;

/** Remove the intersection as at most six disjoint boxes, retaining every part outside the refined volume. */
function subtractRegion(solid: Solid, min: number[], max: number[], regionId: string): Solid[] {
  const axes = ['x', 'y', 'z'] as const;
  const lo = axes.map(axis => solid.center[axis] - solid.size[axis] / 2);
  const hi = axes.map(axis => solid.center[axis] + solid.size[axis] / 2);
  const cutLo = lo.map((n, i) => Math.max(n, min[i])), cutHi = hi.map((n, i) => Math.min(n, max[i]));
  if (cutLo.some((n, i) => n >= cutHi[i] - 1e-10)) return [solid];
  const result: Solid[] = [];
  const piece = (a: number[], b: number[]) => result.push({...solid, id: `${solid.id}:${regionId}:${result.length}`,
    center: {x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2},
    size: {x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2]}});
  for (let axis = 0; axis < 3; axis++) {
    if (lo[axis] < cutLo[axis] - 1e-10) {const end = [...hi]; end[axis] = cutLo[axis]; piece(lo, end);}
    if (hi[axis] > cutHi[axis] + 1e-10) {const start = [...lo]; start[axis] = cutHi[axis]; piece(start, hi);}
    lo[axis] = cutLo[axis]; hi[axis] = cutHi[axis];
  }
  return result;
}

export function workshopArena(id: WorkshopMapId, data: WorkshopData): Arena {
  const {voxel, origin: [ox, oy, oz]} = data;
  const boxes = (values: CollisionBox[], voxel: number, [ox, oy, oz]: number[], prefix: string): Solid[] => values.map(([x1, y1, z1, x2, y2, z2, material], index) => ({
    id: `${prefix}-${index}`, material: material < 0 ? 'concrete' : data.materials[material],
    center: {x: ox + (x1 + x2) / 2 * voxel, y: oy + (y1 + y2) / 2 * voxel, z: oz + (z1 + z2) / 2 * voxel},
    size: {x: (x2 - x1) * voxel, y: (y2 - y1) * voxel, z: (z2 - z1) * voxel},
    ...(material < 0 ? {shotBlocking: false} : {})}));
  let solids = boxes(data.boxes, voxel, [ox, oy, oz], id);
  for (const region of data.detailRegions ?? []) {
    const max = region.origin.map((n, i) => n + region.dimensions[i] * region.voxel);
    solids = solids.flatMap(solid => subtractRegion(solid, region.origin, max, region.id));
    solids = solids.concat(boxes(region.boxes, region.voxel, region.origin, `${id}-${region.id}`));
  }
  return {...data.bounds, solids, design: id,
    workshop: {name: id, credits: workshopMaps[id].credits, model: workshopMaps[id].model, aimBotz: workshopMaps[id].aimBotz,
      spawns: data.spawns, spots: data.spots, floor: oy}};
}

/** Loads a map's data (a separate chunk) and builds its arena. */
export async function loadWorkshopArena(id: WorkshopMapId): Promise<Arena> {
  const module = await workshopMaps[id].load();
  return workshopArena(id, (module.default ?? module) as unknown as WorkshopData);
}
