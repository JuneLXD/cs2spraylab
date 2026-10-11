import {describe, expect, it} from 'vitest';
import {UNIT} from '../actor-physics';
import {fitsTerrain} from '../actor-collision';
import {traceSolid} from './geometry';
import {freeSpawnPose} from './simulation';
import {arenaFloor, arenaTerrainNear} from './traversal';
import {workshopArena, type WorkshopData} from './workshop';
import ancient from './maps/de_ancient.json';

const fixture = (): WorkshopData => ({name: 'detail-fixture', voxel: 1, origin: [-2, -2, -2],
  materials: ['concrete', 'metal', 'wood'], bounds: {minX: -10, maxX: 10, minZ: -10, maxZ: 10},
  spawns: [], spots: [], boxes: [[0, 0, 0, 4, 4, 4, 2]],
  detailRegions: [{id: 'native', origin: [-1, -1, -1], dimensions: [2, 2, 2], voxel: 1, boxes: []}]});

describe('local native collision detail', () => {
  it('subtracts only the refined volume, retaining disjoint surrounding solid pieces and material', () => {
    const arena = workshopArena('aim_redline', fixture());
    expect(arena.solids).toHaveLength(6);
    expect(arena.solids.reduce((volume, solid) => volume + solid.size.x * solid.size.y * solid.size.z, 0)).toBe(56);
    expect(arena.solids.every(solid => solid.material === 'wood')).toBe(true);
    for (const a of arena.solids) for (const b of arena.solids) if (a !== b)
      expect((['x', 'y', 'z'] as const).some(axis => Math.abs(a.center[axis] - b.center[axis]) >= (a.size[axis] + b.size[axis]) / 2)).toBe(true);
    expect(traceSolid({x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}, arena).distance).toBe(1);
  });

  it('preserves pass-bullets on split coarse clips and distinguishes fine solid material', () => {
    const data = fixture(); data.boxes[0][6] = -1;
    data.detailRegions![0].boxes = [[0, 0, 0, 1, 2, 2, -1], [1, 0, 0, 2, 2, 2, 1]];
    const arena = workshopArena('aim_redline', data);
    expect(arena.solids.filter(solid => solid.shotBlocking === false)).toHaveLength(7);
    expect(arena.solids.filter(solid => solid.material === 'metal')).toHaveLength(1);
    expect(traceSolid({x: -3, y: 0, z: 0}, {x: 1, y: 0, z: 0}, arena).distance).toBe(3);
  });

  it('clears the three native poses that the coarse corridor voxels trapped, with the full native hull', () => {
    const arena = workshopArena('de_ancient', ancient as unknown as WorkshopData);
    const positions = [
      {x: 29.7623166754, y: 2.50951873, z: -39.4992262084},
      {x: -7.6041126048, y: 3.504645772, z: 15.471108377},
      {x: -7.6013127628, y: 3.5081467302, z: 15.0894525998},
    ];
    for (const spawn of positions) {
      const pose = freeSpawnPose(spawn, arena), eye = {...pose, y: pose.y + 64 * UNIT};
      expect(Math.hypot(pose.x - spawn.x, pose.y - spawn.y, pose.z - spawn.z)).toBeLessThanOrEqual(.5 + 1e-8);
      expect(fitsTerrain(eye, pose.y, 72 * UNIT,
        {solids: arenaTerrainNear(arena, eye), floor: arenaFloor(arena), bounds: arena}), JSON.stringify(spawn)).toBe(true);
    }
  });
});
