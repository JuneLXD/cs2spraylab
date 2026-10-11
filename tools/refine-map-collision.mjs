// Rebuild selected collision volumes from native physics without changing the authored spawn coordinates.
// Usage: node tools/refine-map-collision.mjs <physics.glb> <collision.json> <regions.json>
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {mapMaterials} from './map-collision.mjs';

const CLIP = mapMaterials.length + 1, AIR = 255;
const material = name => 1 + mapMaterials.indexOf(/glass/.test(name) ? 'glass' : /grate|chainlink/.test(name) ? 'grate'
  : /metal/.test(name) ? 'metal' : /wood|cardboard|crate|plastic|carpet|sheetrock/.test(name) ? 'wood' : 'concrete');

export function physicsCollisionLabel(name, extras = {}) {
  const flags = extras.InteractAs ?? [];
  if (flags.length && !flags.some(flag => ['solid', 'window', 'playerclip', 'npcclip', 'passbullets'].includes(flag))) {
    if (flags.every(flag => ['csgo_grenadeclip', 'blocklight', 'blocksound'].includes(flag))) return 0;
    throw new Error(`Unsupported physics interaction: ${flags.join(', ')}`);
  }
  return /passbullets|playerclip|npcclip/.test(name) ? CLIP : material(extras.SurfaceProperty ?? name);
}

// Clipping before sampling bounds the work even for native triangles spanning the whole map.
export function clipTriangle(points, min, max) {
  let polygon = points;
  for (let axis = 0; axis < 3; axis++) for (const [edge, sign] of [[min[axis], 1], [max[axis], -1]]) {
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = (a[axis] - edge) * sign, db = (b[axis] - edge) * sign;
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push(a.map((v, k) => v + (b[k] - v) * t));
      }
    }
    polygon = next;
  }
  return polygon.slice(1, -1).map((_, i) => [polygon[0], polygon[i + 1], polygon[i + 2]]);
}

export function regionGrid(spec) {
  const {id, voxel} = spec;
  if (!id || !Number.isFinite(voxel) || voxel <= 0) throw new Error('Invalid collision detail region');
  const origin = spec.min.map(n => Math.floor(n / voxel) * voxel);
  const dimensions = spec.max.map((n, i) => Math.ceil((n - origin[i]) / voxel));
  if (dimensions.some(n => !Number.isSafeInteger(n) || n <= 0) || dimensions.reduce((a, b) => a * b, 1) > 20_000_000)
    throw new Error(`Region ${id} exceeds the bounded local grid`);
  return {id, voxel, origin, dimensions};
}

/** Native surface voxels plus enclosed solid interiors. Existing open coarse cells seed the air flood;
 * an authored player/bot position never clears a voxel or decides whether a surface is solid. */
export function voxelizeDetailRegion(region, triangles, coarse) {
  const {voxel, origin: min, dimensions: [nx, ny, nz]} = region;
  const max = [nx, ny, nz].map((n, k) => min[k] + n * voxel), length = nx * ny * nz;
  const grid = new Uint8Array(length), coarseSolid = new Uint8Array(length);
  const at = (x, y, z) => x + nx * (z + nz * y);
  const cell = (point, axis) => Math.floor((point - min[axis]) / voxel);
  let sampledTriangles = 0;
  for (const {label, points} of triangles) for (const [a, b, c] of clipTriangle(points, min, max)) {
    sampledTriangles++;
    const edge = Math.max(Math.hypot(...b.map((n, k) => n - a[k])), Math.hypot(...c.map((n, k) => n - a[k])), Math.hypot(...c.map((n, k) => n - b[k])));
    const steps = Math.max(1, Math.ceil(edge / (voxel * .45)));
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
      const u = i / steps, w = j / steps, t = 1 - u - w;
      const x = cell(a[0] * t + b[0] * u + c[0] * w, 0);
      const y = cell(a[1] * t + b[1] * u + c[1] * w - 1e-5, 1);
      const z = cell(a[2] * t + b[2] * u + c[2] * w, 2);
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const index = at(x, y, z);
      if (!grid[index] || grid[index] === CLIP) grid[index] = label;
    }
  }
  if (!sampledTriangles) throw new Error(`Region ${region.id} contains no native collision`);

  for (const box of coarse.boxes) {
    const lo = box.slice(0, 3).map((n, k) => coarse.origin[k] + n * coarse.voxel);
    const hi = box.slice(3, 6).map((n, k) => coarse.origin[k] + n * coarse.voxel);
    if (lo.some((n, k) => n >= max[k]) || hi.some((n, k) => n <= min[k])) continue;
    const first = lo.map((n, k) => Math.max(0, Math.ceil((n - min[k]) / voxel - .5)));
    const end = hi.map((n, k) => Math.min([nx, ny, nz][k], Math.ceil((n - min[k]) / voxel - .5)));
    for (let y = first[1]; y < end[1]; y++) for (let z = first[2]; z < end[2]; z++)
      coarseSolid.fill(1, at(first[0], y, z), at(end[0], y, z));
  }
  const queue = new Int32Array(length), directions = [1, -1, nx, -nx, nx * nz, -nx * nz];
  const flood = (tail, air) => {
    for (let head = 0; head < tail; head++) {
      const index = queue[head], x = index % nx, z = Math.floor(index / nx) % nz, y = Math.floor(index / (nx * nz));
      for (let k = 0; k < 6; k++) {
        if ((k === 0 && x === nx - 1) || (k === 1 && x === 0) || (k === 2 && z === nz - 1) || (k === 3 && z === 0) || (k === 4 && y === ny - 1) || (k === 5 && y === 0)) continue;
        const next = index + directions[k];
        if (!grid[next]) {grid[next] = air ? AIR : grid[index]; queue[tail++] = next;}
      }
    }
    return tail;
  };
  let tail = 0;
  for (let i = 0; i < length; i++) if (!grid[i] && !coarseSolid[i]) {grid[i] = AIR; queue[tail++] = i;}
  if (!tail) throw new Error(`Region ${region.id} has no known open air`);
  const airVoxels = flood(tail, true);
  tail = 0;
  for (let i = 0; i < length; i++) if (grid[i] && grid[i] !== AIR) queue[tail++] = i;
  flood(tail, false);

  // Keep labels distinct: a playerclip can stop movement without stopping shots, and material must survive merging.
  const used = new Uint8Array(length), boxes = [];
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const label = grid[at(x, y, z)];
    if (!label || label === AIR || used[at(x, y, z)]) continue;
    const same = (i, j, k) => i < nx && j < ny && k < nz && !used[at(i, j, k)] && grid[at(i, j, k)] === label;
    let x2 = x; while (same(x2 + 1, y, z)) x2++;
    let z2 = z; grow: while (true) {for (let i = x; i <= x2; i++) if (!same(i, y, z2 + 1)) break grow; z2++;}
    let y2 = y; rise: while (true) {for (let k = z; k <= z2; k++) for (let i = x; i <= x2; i++) if (!same(i, y2 + 1, k)) break rise; y2++;}
    for (let j = y; j <= y2; j++) for (let k = z; k <= z2; k++) used.fill(1, at(x, j, k), at(x2 + 1, j, k));
    boxes.push([x, y, z, x2 + 1, y2 + 1, z2 + 1, label === CLIP ? -1 : label - 1]);
  }
  return {...region, boxes, stats: {sampledTriangles, airVoxels, boxes: boxes.length}};
}

export async function refineMapCollision(physics, coarse, specs) {
  const regions = specs.map(regionGrid), triangles = regions.map(() => []);
  const document = await new NodeIO().read(physics);
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const label = physicsCollisionLabel(node.getName(), node.getExtras()); if (!label) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices(), v = [0, 0, 0];
      const world = i => {position.getElement(i, v); return [0, 1, 2].map(a => m[a] * v[0] + m[4 + a] * v[1] + m[8 + a] * v[2] + m[12 + a]);};
      const count = indices ? indices.getCount() : position.getCount();
      for (let i = 0; i < count; i += 3) {
        const points = [0, 1, 2].map(k => world(indices ? indices.getScalar(i + k) : i + k));
        for (let r = 0; r < regions.length; r++) {
          const {origin, dimensions, voxel} = regions[r];
          if ([0, 1, 2].some(k => Math.max(...points.map(p => p[k])) < origin[k] || Math.min(...points.map(p => p[k])) > origin[k] + dimensions[k] * voxel)) continue;
          triangles[r].push({label, points});
        }
      }
    }
  }
  return regions.map((region, i) => voxelizeDetailRegion(region, triangles[i], coarse));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [physics, collisionPath, specsPath] = process.argv.slice(2);
  if (!physics || !collisionPath || !specsPath) throw new Error('Usage: node tools/refine-map-collision.mjs <physics.glb> <collision.json> <regions.json>');
  const coarse = JSON.parse(fs.readFileSync(collisionPath, 'utf8'));
  const detailRegions = await refineMapCollision(physics, coarse, JSON.parse(fs.readFileSync(specsPath, 'utf8')));
  for (const region of detailRegions) console.log(region.id, region.stats);
  fs.writeFileSync(collisionPath, JSON.stringify({...coarse, detailRegions: detailRegions.map(({stats, ...region}) => region)}) + '\n');
}
