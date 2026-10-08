import type {SurfaceMaterial} from './environment';
import type {Arena, Solid, WorkshopSpawn} from './geometry';

/** Collision, spawns and bot spots of an imported CS2 map, as written by tools/import-map.mjs. Boxes are in voxels from
 * `origin`; material -1 marks a player clip or pass-bullets brush, which stops movement but not bullets. */
export type WorkshopData = {name: string; voxel: number; origin: [number, number, number]; materials: SurfaceMaterial[];
  bounds: {minX: number; maxX: number; minZ: number; maxZ: number}; spawns: WorkshopSpawn[];
  spots: [number, number, number][]; boxes: [number, number, number, number, number, number, number][]};

export const workshopMaps = {
  // The T spawns look at a wall of crates. From the north end you see down the whole hall: floor, crates and catwalk.
  aim_redline: {credits: 'BOT Reed', model: '/maps/aim_redline.glb', aimBotz: {x: 11, z: -28, yaw: Math.PI},
    load: () => import('./maps/aim_redline.json')},
} as const;
export type WorkshopMapId = keyof typeof workshopMaps;

export function workshopArena(id: WorkshopMapId, data: WorkshopData): Arena {
  const {voxel, origin: [ox, oy, oz]} = data;
  const solids: Solid[] = data.boxes.map(([x1, y1, z1, x2, y2, z2, material], index) => ({
    id: `${id}-${index}`, material: material < 0 ? 'concrete' : data.materials[material],
    center: {x: ox + (x1 + x2) / 2 * voxel, y: oy + (y1 + y2) / 2 * voxel, z: oz + (z1 + z2) / 2 * voxel},
    size: {x: (x2 - x1) * voxel, y: (y2 - y1) * voxel, z: (z2 - z1) * voxel},
    ...(material < 0 ? {shotBlocking: false} : {})}));
  return {...data.bounds, solids, design: id,
    workshop: {name: id, credits: workshopMaps[id].credits, model: workshopMaps[id].model, aimBotz: workshopMaps[id].aimBotz,
      spawns: data.spawns, spots: data.spots}};
}

/** Loads a map's data (a separate chunk) and builds its arena. */
export async function loadWorkshopArena(id: WorkshopMapId): Promise<Arena> {
  const module = await workshopMaps[id].load();
  return workshopArena(id, (module.default ?? module) as unknown as WorkshopData);
}
