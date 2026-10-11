// Turns a CS2 map's exported physics (glTF) and entity lump into the duel engine's map data: axis-aligned collision
// boxes, spawns and standing spots for bots. The engine only collides against boxes, so the physics is voxelised:
//  1. surfaces are voxelised at VOXEL metres, keeping their surface material (player clips and pass-bullets separately);
//  2. air is flood-filled from the spawns, and everything the air cannot reach is solid (a crate's inside, outdoors);
//  3. the solid voxels around the air are merged greedily into boxes.
import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';

const UNIT = .0254, HULL = 72 * UNIT, HALF_WIDTH = 16 * UNIT;
export const mapMaterials = ['concrete', 'metal', 'wood', 'glass', 'grate'];
const CLIP = mapMaterials.length + 1, AIR = 255;

/** The exporter maps Source (x forward, y left, z up, inches) to glTF (x, y, z) = (y, z, x) in metres. */
export const fromSource = ([x, y, z]) => ({x: y * UNIT, y: z * UNIT, z: x * UNIT});
/** Source yaw t faces (sin t, cos t) in glTF; the engine's yaw faces (-sin, -cos): t + 180 degrees. */
export const yawFromSource = degrees => Math.atan2(-Math.sin(degrees * Math.PI / 180), -Math.cos(degrees * Math.PI / 180));

export function parseEntities(text) {
  return text.split(/^====\d+====$/m).map(block => {
    const get = key => block.match(new RegExp(`^${key}\\s+(.+)$`, 'm'))?.[1]?.trim();
    const numbers = value => value?.replace(/[[\]",]/g, ' ').trim().split(/\s+/).map(Number);
    return {classname: get('classname')?.replace(/"/g, ''), origin: numbers(get('origin')), angles: numbers(get('angles'))};
  }).filter(entity => entity.classname);
}

const groupOf = name => /passbullets|playerclip/.test(name) ? CLIP : 1 + mapMaterials.indexOf(
  /glass/.test(name) ? 'glass' : /grate|chainlink/.test(name) ? 'grate' : /metal/.test(name) ? 'metal'
    : /wood|cardboard|crate|plastic|carpet|sheetrock/.test(name) ? 'wood' : 'concrete');

export async function buildMapCollision({physics, entities, voxel = .1, headroom = 4, margin = .5, below = 1.5}) {
  const spawns = parseEntities(entities).filter(entity => /^info_player_(terrorist|counterterrorist)$/.test(entity.classname))
    .map(entity => ({team: entity.classname.endsWith('counterterrorist') ? 'ct' : 't', ...fromSource(entity.origin), yaw: yawFromSource(entity.angles[1])}));
  if (!spawns.length) throw new Error('The map has no player spawns');

  const triangles = [];
  for (const node of (await new NodeIO().read(physics)).getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix(), group = groupOf(node.getName());
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices(), v = [0, 0, 0];
      const world = i => {position.getElement(i, v); return [0, 1, 2].map(a => m[a] * v[0] + m[4 + a] * v[1] + m[8 + a] * v[2] + m[12 + a]);};
      const count = indices ? indices.getCount() : position.getCount();
      for (let i = 0; i < count; i += 3) triangles.push({group, points: [0, 1, 2].map(k => world(indices ? indices.getScalar(i + k) : i + k))});
    }
  }

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const {points} of triangles) for (const p of points) for (let a = 0; a < 3; a++) {lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]);}
  // y = 0 (the usual floor) falls on a voxel boundary, so floors come out exact. The vertical range reaches `below`
  // metres under the lowest spawn and `headroom` above the highest: a workshop hall needs little, a competitive map
  // with sites above and below its spawns needs a lot more (see --headroom / --below in import-map.mjs).
  const min = [lo[0] - voxel, Math.floor((Math.min(...spawns.map(s => s.y)) - below) / voxel) * voxel, lo[2] - voxel];
  const max = [hi[0] + voxel, Math.max(...spawns.map(s => s.y)) + headroom, hi[2] + voxel];
  const [nx, ny, nz] = [0, 1, 2].map(a => Math.ceil((max[a] - min[a]) / voxel));
  const grid = new Uint8Array(nx * ny * nz), at = (x, y, z) => x + nx * (z + nz * y);
  const cell = (point, a) => Math.floor((point - min[a]) / voxel);

  // 1. Surfaces, sampled at under half a voxel. Solid materials win over clips sharing a voxel.
  for (const {group, points: [a, b, c]} of triangles) {
    if (Math.min(a[1], b[1], c[1]) > max[1] || Math.max(a[1], b[1], c[1]) < min[1]) continue;
    const edge = Math.max(Math.hypot(...b.map((n, k) => n - a[k])), Math.hypot(...c.map((n, k) => n - a[k])), Math.hypot(...c.map((n, k) => n - b[k])));
    const steps = Math.max(1, Math.ceil(edge / (voxel * .45)));
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
      const u = i / steps, w = j / steps, t = 1 - u - w;
      // A surface exactly on a voxel boundary (a floor at y = 0) belongs to the voxel below it, so floors are not raised.
      const x = cell(a[0] * t + b[0] * u + c[0] * w, 0), y = cell(a[1] * t + b[1] * u + c[1] * w - 1e-4, 1), z = cell(a[2] * t + b[2] * u + c[2] * w, 2);
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const index = at(x, y, z);
      if (!grid[index] || grid[index] === CLIP) grid[index] = group;
    }
  }

  // 2. Air from the spawns; then unreached space takes the nearest surface's label (a crate's inside is wood).
  const queue = new Int32Array(grid.length), steps6 = [1, -1, nx, -nx, nx * nz, -nx * nz];
  const flood = (head, tail, open, fill) => {
    while (head < tail) {
      const index = queue[head++], x = index % nx, z = Math.floor(index / nx) % nz, y = Math.floor(index / (nx * nz));
      for (let k = 0; k < 6; k++) {
        if ((k === 0 && x === nx - 1) || (k === 1 && x === 0) || (k === 2 && z === nz - 1) || (k === 3 && z === 0) || (k === 4 && y === ny - 1) || (k === 5 && y === 0)) continue;
        const next = index + steps6[k];
        if (open(grid[next])) {grid[next] = fill(index); queue[tail++] = next;}
      }
    }
  };
  let tail = 0;
  for (const spawn of spawns) {
    const index = at(cell(spawn.x, 0), cell(spawn.y + .3, 1), cell(spawn.z, 2));
    if (!grid[index]) {grid[index] = AIR; queue[tail++] = index;}
  }
  flood(0, tail, label => label === 0, () => AIR);
  const air = tail;
  tail = 0;
  for (let index = 0; index < grid.length; index++) if (grid[index] && grid[index] !== AIR) queue[tail++] = index;
  flood(0, tail, label => label === 0, index => grid[index]);

  // 3. Greedy boxes inside the air's bounds plus a margin. Solids merge across materials (a box takes its most common
  // material); clips merge separately, since they stop movement but not bullets.
  const airLo = [nx, ny, nz], airHi = [0, 0, 0];
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (grid[at(x, y, z)] === AIR) {
    airLo[0] = Math.min(airLo[0], x); airLo[1] = Math.min(airLo[1], y); airLo[2] = Math.min(airLo[2], z);
    airHi[0] = Math.max(airHi[0], x); airHi[1] = Math.max(airHi[1], y); airHi[2] = Math.max(airHi[2], z);
  }
  const pad = Math.round(margin / voxel), dims = [nx, ny, nz];
  const crop = [0, 1, 2].map(a => [Math.max(0, airLo[a] - pad), Math.min(dims[a] - 1, airHi[a] + pad)]);
  const kind = label => label === AIR || !label ? 0 : label === CLIP ? 2 : 1;
  const used = new Uint8Array(grid.length), boxes = [];
  for (let y = crop[1][0]; y <= crop[1][1]; y++) for (let z = crop[2][0]; z <= crop[2][1]; z++) for (let x = crop[0][0]; x <= crop[0][1]; x++) {
    const group = kind(grid[at(x, y, z)]);
    if (!group || used[at(x, y, z)]) continue;
    const same = (i, j, k) => i <= crop[0][1] && j <= crop[1][1] && k <= crop[2][1] && !used[at(i, j, k)] && kind(grid[at(i, j, k)]) === group;
    let x2 = x; while (same(x2 + 1, y, z)) x2++;
    let z2 = z; grow: while (true) {for (let i = x; i <= x2; i++) if (!same(i, y, z2 + 1)) break grow; z2++;}
    let y2 = y; rise: while (true) {for (let k = z; k <= z2; k++) for (let i = x; i <= x2; i++) if (!same(i, y2 + 1, k)) break rise; y2++;}
    const votes = new Map();
    for (let j = y; j <= y2; j++) for (let k = z; k <= z2; k++) for (let i = x; i <= x2; i++) {
      used[at(i, j, k)] = 1; votes.set(grid[at(i, j, k)], (votes.get(grid[at(i, j, k)]) ?? 0) + 1);
    }
    const label = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    boxes.push([x, y, z, x2 + 1, y2 + 1, z2 + 1, label === CLIP ? -1 : label - 1]);
  }

  // Standing spots for bots, every 0.5 m: a hull of air on top of something solid. A player clip counts as a floor
  // too: competitive maps smooth their stairs, rocks and ledges with clip brushes that players walk on. The hull is
  // rounded to whole voxels (1.0 x 1.8 m at 20 cm) rather than rounded up: a doorway or passage a player fits through
  // must keep its spots, or the map's walkable area falls apart into patches.
  const spots = [], every = Math.max(1, Math.round(.5 / voxel)), half = Math.max(1, Math.round(HALF_WIDTH / voxel)), tall = Math.max(1, Math.round(HULL / voxel));
  const isAir = (x, y, z) => x >= 0 && z >= 0 && x < nx && z < nz && y < ny && grid[at(x, y, z)] === AIR;
  for (let z = half; z < nz - half; z += every) for (let x = half; x < nx - half; x += every) for (let y = 1; y < ny - tall; y++) {
    const below = grid[at(x, y - 1, z)];
    if (!isAir(x, y, z) || below === AIR) continue;
    let clear = true;
    for (let j = y; j < y + tall && clear; j++) for (let k = z - half; k <= z + half && clear; k++) for (let i = x - half; i <= x + half && clear; i++) clear = isAir(i, j, k);
    if (clear) spots.push([min[0] + (x + .5) * voxel, min[1] + y * voxel, min[2] + (z + .5) * voxel]);
  }

  // Each spawn stands on whatever is below it.
  const feetBelow = spawn => {
    const x = cell(spawn.x, 0), z = cell(spawn.z, 2);
    for (let y = Math.min(ny - 1, cell(spawn.y, 1)); y > 0; y--) if (grid[at(x, y - 1, z)] !== AIR && grid[at(x, y, z)] === AIR) return min[1] + y * voxel;
    return 0;
  };
  const round = (n, places = 3) => +n.toFixed(places);
  const toMetres = (index, a) => round(min[a] + index * voxel);
  return {
    voxel, origin: min.map(n => round(n)), materials: mapMaterials,
    bounds: {minX: toMetres(crop[0][0], 0), maxX: toMetres(crop[0][1] + 1, 0), minZ: toMetres(crop[2][0], 2), maxZ: toMetres(crop[2][1] + 1, 2)},
    spawns: spawns.map(spawn => ({team: spawn.team, x: round(spawn.x), y: round(feetBelow(spawn)), z: round(spawn.z), yaw: round(spawn.yaw, 4)})),
    spots: spots.map(spot => spot.map(n => round(n, 2))),
    boxes,
    stats: {triangles: triangles.length, airVoxels: air, boxes: boxes.length, spots: spots.length},
  };
}

export function writeMapCollision(file, data) {
  fs.writeFileSync(file, `${JSON.stringify({...data, stats: undefined})}\n`);
}
