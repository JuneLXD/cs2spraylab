import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clipTriangle, physicsCollisionLabel, regionGrid, voxelizeDetailRegion} from './refine-map-collision.mjs';

test('native collision groups keep materials and player clips, excluding grenade-only clips', () => {
  assert.equal(physicsCollisionLabel('physics_group', {SurfaceProperty: 'metal', InteractAs: []}), 2);
  assert.equal(physicsCollisionLabel('physics_npcclip_playerclip', {InteractAs: ['npcclip', 'playerclip']}), 6);
  assert.equal(physicsCollisionLabel('physics_csgo_grenadeclip', {InteractAs: ['csgo_grenadeclip']}), 0);
  assert.throws(() => physicsCollisionLabel('unknown', {InteractAs: ['new_unsupported_clip']}), /Unsupported/);
});

test('large native triangles are clipped before sampling and local grid allocation is bounded', () => {
  const triangles = clipTriangle([[-100, 0, -100], [100, 0, -100], [0, 0, 100]], [-1, -1, -1], [1, 1, 1]);
  assert.ok(triangles.length >= 2);
  for (const triangle of triangles) for (const vertex of triangle) for (const coordinate of vertex)
    assert.ok(coordinate >= -1 && coordinate <= 1);
  assert.throws(() => regionGrid({id: 'too-big', voxel: .001, min: [0, 0, 0], max: [100, 100, 100]}), /bounded/);
});

test('native surfaces recover air hidden by coarse rounding without using spawn locations', () => {
  const region = regionGrid({id: 'floor', voxel: .1, min: [-1, -.2, -1], max: [1, 2, 1]});
  const triangles = [[[-1, 0, -1], [1, 0, -1], [1, 0, 1]], [[-1, 0, -1], [1, 0, 1], [-1, 0, 1]]]
    .map(points => ({label: 2, points}));
  // Coarse floor occupies through y=.2. The exported native floor is at y=0.
  const coarse = {origin: [-1, -.2, -1], voxel: .2, boxes: [[0, 0, 0, 10, 2, 10, 1]]};
  const result = voxelizeDetailRegion(region, triangles, coarse);
  assert.ok(result.boxes.length > 0);
  assert.equal(Math.max(...result.boxes.map(box => region.origin[1] + box[4] * region.voxel)), 0);
  assert.ok(result.boxes.every(box => box[6] === 1));
});
