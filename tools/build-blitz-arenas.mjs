// Builds Blitz arenas for an imported CS2 map from its collision data (tools/import-map.mjs): positions you stand at,
// each with a set of "swingers", bots that wait out of your sight and then swing into view from different angles.
// Usage: node tools/build-blitz-arenas.mjs <map name> [--arenas 24] [--seed 7] [--out <file>]
// Reads src/range/duel/maps/<map>.json and writes src/range/duel/maps/<map>.blitz.json. A swinger is a pair of standing
// spots: a hold spot you cannot see from the arena and a peek spot 0.5-1.5 m away that you can, 5-30 m from you. An
// arena needs peeks from at least four of twelve 30-degree sectors around you; arenas are spread at least 10 m apart.
import fs from 'node:fs';

const args = process.argv.slice(2), option = (name, fallback) => {const i = args.indexOf(name); return i < 0 ? fallback : args.splice(i, 2)[1];};
const arenaCount = Number(option('--arenas', 24)), seed = Number(option('--seed', 7));
const name = args.find(arg => !arg.startsWith('--'));
if (!name) throw new Error('Usage: node tools/build-blitz-arenas.mjs <map name> [--arenas 24] [--seed 7] [--out <file>]');
const out = option('--out', `src/range/duel/maps/${name}.blitz.json`);
const data = JSON.parse(fs.readFileSync(`src/range/duel/maps/${name}.json`, 'utf8'));

export const EYE = 64 * .0254;
export const RANGE = {min: 5, max: 30}, PEEK = {min: .5, max: 1.5}, SECTORS = 12, MIN_SECTORS = 4, SPREAD = 10, SWINGERS_PER_ARENA = 10;

/** Deterministic random stream (mulberry32). */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};
}

/** Shot-blocking voxels of the map (player clips let bullets and sight through), for exact line-of-sight tests. */
export function solidGrid(map) {
  let nx = 0, ny = 0, nz = 0;
  for (const [, , , x2, y2, z2] of map.boxes) {nx = Math.max(nx, x2); ny = Math.max(ny, y2); nz = Math.max(nz, z2);}
  const grid = new Uint8Array(nx * ny * nz), at = (x, y, z) => x + nx * (z + nz * y);
  for (const [x1, y1, z1, x2, y2, z2, material] of map.boxes) {
    if (material < 0) continue;
    for (let y = y1; y < y2; y++) for (let z = z1; z < z2; z++) grid.fill(1, at(x1, y, z), at(x2, y, z));
  }
  const toCell = (value, axis) => (value - map.origin[axis]) / map.voxel;
  /** Whether nothing solid lies on the segment between two points (metres). */
  const clear = (a, b) => {
    const p = [toCell(a.x, 0), toCell(a.y, 1), toCell(a.z, 2)], q = [toCell(b.x, 0), toCell(b.y, 1), toCell(b.z, 2)];
    const cell = p.map(Math.floor), end = q.map(Math.floor), step = [0, 1, 2].map(k => q[k] > p[k] ? 1 : -1);
    const delta = [0, 1, 2].map(k => Math.abs(q[k] - p[k]));
    const tMax = [0, 1, 2].map(k => delta[k] < 1e-12 ? Infinity : ((step[k] > 0 ? cell[k] + 1 - p[k] : p[k] - cell[k]) / delta[k]));
    const tDelta = [0, 1, 2].map(k => delta[k] < 1e-12 ? Infinity : 1 / delta[k]);
    const inside = () => cell[0] >= 0 && cell[1] >= 0 && cell[2] >= 0 && cell[0] < nx && cell[1] < ny && cell[2] < nz;
    for (let guard = 0; guard < 100000; guard++) {
      if (inside() && grid[at(cell[0], cell[1], cell[2])]) return false;
      if (cell[0] === end[0] && cell[1] === end[1] && cell[2] === end[2]) return true;
      const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (tMax[k] > 1) return true;
      cell[k] += step[k]; tMax[k] += tDelta[k];
    }
    return true;
  };
  return {clear, nx, ny, nz};
}

/** Spots bucketed per metre for radius queries. */
export function spotIndex(spots) {
  const cells = new Map(), key = (x, z) => `${Math.floor(x)}:${Math.floor(z)}`;
  spots.forEach((spot, index) => {const k = key(spot[0], spot[2]); (cells.get(k) ?? cells.set(k, []).get(k)).push(index);});
  return {
    within: (x, z, radius) => {
      const found = [];
      for (let i = Math.floor(x - radius); i <= Math.floor(x + radius); i++) for (let j = Math.floor(z - radius); j <= Math.floor(z + radius); j++)
        for (const index of cells.get(`${i}:${j}`) ?? []) {
          const spot = spots[index];
          if (Math.hypot(spot[0] - x, spot[2] - z) <= radius) found.push(index);
        }
      return found;
    },
  };
}

/** Where a player can stand and walk from the spawns, found on the voxel grid itself rather than from the importer's
 * standing spots (those sit on a 0.6 m lattice that misses narrow stairways, and include the tops of clip volumes).
 * A cell is standable when its floor voxel is solid (clips included) and a hull, HALF x HALF around it and TALL up,
 * is air. The flood from the spawn cells steps to the eight neighbours up to two voxels up or down (the step height).
 * Returns spots [x, feet, z] in metres on a 0.6 m lattice of the reached cells. */
export function walkableSpots(map) {
  let nx = 0, ny = 0, nz = 0;
  for (const [, , , x2, y2, z2] of map.boxes) {nx = Math.max(nx, x2); ny = Math.max(ny, y2); nz = Math.max(nz, z2);}
  const occupied = new Uint8Array(nx * ny * nz), at = (x, y, z) => x + nx * (z + nz * y);
  for (const [x1, y1, z1, x2, y2, z2] of map.boxes) for (let y = y1; y < y2; y++) for (let z = z1; z < z2; z++) occupied.fill(1, at(x1, y, z), at(x2, y, z));
  const half = Math.max(1, Math.round(16 * .0254 / map.voxel)), tall = Math.max(1, Math.round(72 * .0254 / map.voxel));
  const step = Math.max(1, Math.round(18 * .0254 / map.voxel));
  // The hull may overlap the next riser of a stair below knee height (the step height): only the centre column must be
  // free there, the full footprint above it. Otherwise no stair or slope is ever climbable.
  const clear = (x, y, z) => {
    if (x - half < 0 || z - half < 0 || x + half >= nx || z + half >= nz || y + tall > ny) return false;
    for (let j = y; j < y + tall; j++) {
      const reach = j < y + step ? 0 : half;
      for (let k = z - reach; k <= z + reach; k++) for (let i = x - reach; i <= x + reach; i++) if (occupied[at(i, j, k)]) return false;
    }
    return true;
  };
  const standable = (x, y, z) => y > 0 && y < ny && occupied[at(x, y - 1, z)] === 1 && !occupied[at(x, y, z)] && clear(x, y, z);
  // The engine stands actors with the full hull from the feet (fitsTerrain) and nudges them otherwise: spots that
  // pass that test too are "strict", and arenas and swingers use only those so nobody is moved after placement.
  const strictClear = (x, y, z) => {
    if (x - half < 0 || z - half < 0 || x + half >= nx || z + half >= nz || y + tall > ny) return false;
    for (let j = y; j < y + tall; j++) for (let k = z - half; k <= z + half; k++) for (let i = x - half; i <= x + half; i++) if (occupied[at(i, j, k)]) return false;
    return true;
  };
  const reached = new Uint8Array(nx * ny * nz), queue = [];
  const cell = (value, axis) => Math.floor((value - map.origin[axis]) / map.voxel);
  for (const spawn of map.spawns) {
    const x = cell(spawn.x, 0), z = cell(spawn.z, 2), y0 = cell(spawn.y, 1);
    for (let y = y0 - 2; y <= y0 + 4; y++) if (standable(x, y, z) && !reached[at(x, y, z)]) {reached[at(x, y, z)] = 1; queue.push(x, y, z); break;}
  }
  let count = 0;
  while (queue.length) {
    const z = queue.pop(), y = queue.pop(), x = queue.pop();
    count++;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      for (let dy = -step; dy <= step; dy++) {
        const i = x + dx, j = y + dy, k = z + dz;
        if (i < 0 || k < 0 || j < 1 || i >= nx || k >= nz || j >= ny || reached[at(i, j, k)] || !standable(i, j, k)) continue;
        reached[at(i, j, k)] = 1; queue.push(i, j, k);
      }
    }
  }
  const stride = Math.max(1, Math.round(.6 / map.voxel)), spots = [], strict = [];
  for (let y = 1; y < ny; y++) for (let z = 0; z < nz; z += stride) for (let x = 0; x < nx; x += stride)
    if (reached[at(x, y, z)]) {
      spots.push([+(map.origin[0] + (x + .5) * map.voxel).toFixed(2), +(map.origin[1] + y * map.voxel).toFixed(2), +(map.origin[2] + (z + .5) * map.voxel).toFixed(2)]);
      strict.push(strictClear(x, y, z));
    }
  return {spots, strict, cells: count};
}

const bearingOf = (from, to) => (Math.atan2(to[0] - from[0], -(to[2] - from[2])) * 180 / Math.PI + 360) % 360;
const sectorOf = bearing => Math.floor(bearing / (360 / SECTORS)) % SECTORS;
/** The engine's yaw faces (-sin yaw, -cos yaw): the yaw that looks from `from` toward `to`. */
export const yawToward = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** Every hold/peek pair that can swing a player standing at `spot`, with its bearing and distance. The peek is visible
 * from the eye; the hold is hidden from it and from four eyes 0.3 m around it, so a small step does not reveal it.
 * Both are strict (full-hull) spots, so the engine places the swinger exactly there. */
export function swingersFor(spots, index, grid, spot, strict) {
  const eye = {x: spot[0], y: spot[1] + EYE, z: spot[2]}, pairs = [];
  const eyes = [eye, {...eye, x: eye.x + .3}, {...eye, x: eye.x - .3}, {...eye, z: eye.z + .3}, {...eye, z: eye.z - .3}];
  const visible = new Map(), hidden = new Map();
  const sees = i => {
    if (!visible.has(i)) visible.set(i, grid.clear(eye, {x: spots[i][0], y: spots[i][1] + EYE, z: spots[i][2]}));
    return visible.get(i);
  };
  const hides = i => {
    if (!hidden.has(i)) hidden.set(i, eyes.every(from => !grid.clear(from, {x: spots[i][0], y: spots[i][1] + EYE, z: spots[i][2]})));
    return hidden.get(i);
  };
  for (const i of index.within(spot[0], spot[2], RANGE.max)) {
    const peek = spots[i], distance = Math.hypot(peek[0] - spot[0], peek[2] - spot[2]);
    if (distance < RANGE.min || !strict[i] || !sees(i)) continue;
    let hold, holdGap = Infinity;
    for (const j of index.within(peek[0], peek[2], PEEK.max)) {
      const candidate = spots[j], gap = Math.hypot(candidate[0] - peek[0], candidate[2] - peek[2]);
      if (gap < PEEK.min || Math.abs(candidate[1] - peek[1]) > .45 || !strict[j] || !hides(j)) continue;
      // The nearest hidden spot: the shortest swing into view.
      if (gap < holdGap) {hold = candidate; holdGap = gap;}
    }
    if (!hold) continue;
    pairs.push({hold: {x: hold[0], y: hold[1], z: hold[2]}, peek: {x: peek[0], y: peek[1], z: peek[2]},
      distance: +distance.toFixed(2), bearing: +bearingOf(spot, peek).toFixed(1)});
  }
  return pairs;
}

/** Up to `count` swingers spread around the clock: sectors are served in turn, nearest-to-mid-range first, and two
 * swingers never share a 2 m patch. */
export function pickSwingers(pairs, count, random = Math.random) {
  const bySector = new Map();
  for (const pair of pairs) (bySector.get(sectorOf(pair.bearing)) ?? bySector.set(sectorOf(pair.bearing), []).get(sectorOf(pair.bearing))).push(pair);
  const prefer = pair => Math.abs(pair.distance - 13) + random() * 4;
  for (const list of bySector.values()) list.sort((a, b) => prefer(a) - prefer(b));
  const sectors = [...bySector.keys()].sort(() => random() - .5), chosen = [];
  while (chosen.length < count && sectors.some(sector => bySector.get(sector).length)) {
    for (const sector of sectors) {
      const list = bySector.get(sector);
      while (list.length) {
        const pair = list.shift();
        if (chosen.some(other => Math.hypot(other.peek.x - pair.peek.x, other.peek.z - pair.peek.z) < 2)) continue;
        chosen.push(pair); break;
      }
      if (chosen.length >= count) break;
    }
  }
  return chosen;
}

export function buildArenas(map, {count = arenaCount, seed: seedValue = seed, log = () => {}} = {}) {
  const random = mulberry(seedValue), grid = solidGrid(map);
  const walkable = walkableSpots(map), spots = walkable.spots, strict = walkable.strict, index = spotIndex(spots);
  log(`${walkable.cells} voxel cells are walkable from the spawns: ${spots.length} spots on a 0.6 m lattice, ${strict.filter(Boolean).length} with the full hull (the importer listed ${map.spots.length})`);
  const candidates = [];
  const started = Date.now();
  spots.forEach((spot, i) => {
    // Every third spot of the half-metre grid: enough to find every open position, a third of the ray budget.
    if (!strict[i] || (Math.round(spot[0] * 2) + Math.round(spot[2] * 2)) % 3 !== 0) return;
    if (index.within(spot[0], spot[2], RANGE.max).length < 40) return;
    const pairs = swingersFor(spots, index, grid, spot, strict);
    const sectors = new Set(pairs.map(pair => sectorOf(pair.bearing)));
    if (sectors.size < MIN_SECTORS) return;
    candidates.push({spot, pairs, score: sectors.size * 10 + Math.min(pairs.length, 30)});
    if (candidates.length % 200 === 0) log(`${candidates.length} candidates from ${i + 1}/${spots.length} spots, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  });
  candidates.sort((a, b) => b.score - a.score);
  const arenas = [];
  for (const candidate of candidates) {
    if (arenas.length >= count) break;
    if (arenas.some(arena => Math.hypot(arena.spot[0] - candidate.spot[0], arena.spot[2] - candidate.spot[2]) < SPREAD)) continue;
    arenas.push(candidate);
  }
  const nearestSpawn = spot => [...map.spawns].sort((a, b) => Math.hypot(a.x - spot[0], a.z - spot[2]) - Math.hypot(b.x - spot[0], b.z - spot[2]))[0];
  return {
    map: map.name, seed: seedValue, candidates: candidates.length, walkableSpots: spots.length, walkableCells: walkable.cells,
    arenas: arenas.map((arena, i) => {
      const swingers = pickSwingers(arena.pairs, SWINGERS_PER_ARENA, random);
      // Face the middle of the swingers' bearings, so the first swing is near your crosshair rather than behind you.
      const mean = Math.atan2(swingers.reduce((sum, s) => sum + Math.sin(s.bearing * Math.PI / 180), 0), swingers.reduce((sum, s) => sum + Math.cos(s.bearing * Math.PI / 180), 0));
      const facing = {x: arena.spot[0] + Math.sin(mean), z: arena.spot[2] - Math.cos(mean)};
      return {id: `arena-${String(i + 1).padStart(2, '0')}`, name: `Arena ${i + 1}`, side: nearestSpawn(arena.spot).team,
        player: {x: arena.spot[0], y: arena.spot[1], z: arena.spot[2], yaw: +yawToward({x: arena.spot[0], z: arena.spot[2]}, facing).toFixed(4)},
        sectors: new Set(arena.pairs.map(pair => sectorOf(pair.bearing))).size, swingers};
    }),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const result = buildArenas(data, {log: console.log});
  fs.writeFileSync(out, `${JSON.stringify(result)}\n`);
  console.log(`${result.arenas.length} arenas from ${result.candidates} candidates -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
  for (const arena of result.arenas) console.log(`${arena.id} ${arena.side} (${arena.player.x}, ${arena.player.y}, ${arena.player.z}) sectors ${arena.sectors} swingers ${arena.swingers.length} at ${arena.swingers.map(s => `${s.distance}m/${Math.round(s.bearing)}°`).join(' ')}`);
}
