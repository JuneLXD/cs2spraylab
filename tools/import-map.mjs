// Imports a CS2 workshop map (its .vpk) for the duel engine. Writes:
//  - src/range/duel/maps/<name>.json: collision boxes, spawns and bot spots (committed; see tools/map-collision.mjs);
//  - public/revamp/maps/<name>.glb: the rendered world (a local asset like the other game assets).
// Usage: node tools/import-map.mjs <workshop.vpk> [--game <CS2 install folder>] [--keep]
// Workshop maps lean on stock CS2 materials and props. Without --game those are missing, and surfaces get flat colours
// chosen from their names (a grey-box); with it they come with their textures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {listVpk, readVpkEntry, writeVpk} from './vpk.mjs';
import {buildMapCollision, writeMapCollision} from './map-collision.mjs';

const args = process.argv.slice(2), option = name => {const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1];};
const game = option('--game'), keep = args.includes('--keep');
const source = args.find(arg => !arg.startsWith('--'));
if (!source) throw new Error('Usage: node tools/import-map.mjs <workshop.vpk> [--game <CS2 install folder>] [--keep]');
const vrf = path.resolve(process.platform === 'win32' ? '.local-tools/vrf/Source2Viewer-CLI.exe' : '.local-tools/vrf-linux/Source2Viewer-CLI');
if (!fs.existsSync(vrf)) throw new Error(`Source 2 Viewer CLI missing at ${vrf} (ValveResourceFormat release 20.0)`);
const gameinfo = game && path.join(game, 'game/csgo/gameinfo.gi');
if (gameinfo && !fs.existsSync(gameinfo)) throw new Error(`No CS2 install at ${game}: ${gameinfo} is missing`);

// A workshop package holds the map's own .vpk next to its custom materials; merge both so every file resolves.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-map-'));
const outer = listVpk(source), nested = outer.find(entry => /^maps\/[^/]+\.vpk$/.test(entry.path) && !/skybox/.test(entry.path));
const files = new Map();
let name;
if (nested) {
  name = path.basename(nested.path, '.vpk');
  const inner = path.join(work, 'inner.vpk');
  fs.writeFileSync(inner, readVpkEntry(source, nested));
  for (const entry of outer) if (!entry.path.endsWith('.vpk')) files.set(entry.path, readVpkEntry(source, entry));
  for (const entry of listVpk(inner)) files.set(entry.path, readVpkEntry(inner, entry));
} else {
  for (const entry of outer) files.set(entry.path, readVpkEntry(source, entry));
  name = [...files.keys()].find(file => /^maps\/[^/]+\/world\.vwrld_c$/.test(file))?.split('/')[1];
}
if (!name || !files.has(`maps/${name}/world.vwrld_c`)) throw new Error(`${source} holds no compiled map world`);
const merged = path.join(work, 'merged.vpk');
writeVpk(merged, files);
console.log(`${name}: ${files.size} files${gameinfo ? '' : ' (no --game: stock CS2 materials will be grey-boxed)'}`);

// Source 2 Viewer reports missing dependencies on stderr and still exports what it can.
const run = (...extra) => {
  const result = spawnSync(vrf, ['-i', merged, ...extra], {encoding: 'utf8', maxBuffer: 1e8});
  if (result.status !== 0) throw new Error(`Source 2 Viewer failed: ${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
};
const missing = new Set();
const exported = (filter, out, ...extra) => {
  // An existing folder keeps the package's paths; otherwise a single match is written to that path as a file.
  fs.mkdirSync(path.join(work, out), {recursive: true});
  const log = run('-f', filter, '-d', '-o', path.join(work, out), ...extra, ...(gameinfo ? ['--game', gameinfo] : []));
  for (const match of log.matchAll(/Failed to load "([^"]+)"/g)) missing.add(match[1].replace(/\\/g, '/'));
};
exported(`maps/${name}/world.vwrld_c`, 'render', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt');
exported(`maps/${name}/world_physics.vmdl_c`, 'physics', '--gltf_export_format', 'glb');
exported(`maps/${name}/entities/default_ents.vents_c`, 'entities');
if (missing.size) console.log(`${missing.size} referenced files are not in the package${gameinfo ? ' or the game' : ''}, e.g. ${[...missing].slice(0, 3).join(', ')}`);

// Collision, spawns and spots.
const data = await buildMapCollision({
  physics: path.join(work, `physics/maps/${name}/world_physics_physics.glb`),
  entities: fs.readFileSync(path.join(work, `entities/maps/${name}/entities/default_ents.vents`), 'utf8'),
});
fs.mkdirSync('src/range/duel/maps', {recursive: true});
writeMapCollision(`src/range/duel/maps/${name}.json`, {name, ...data});
console.log(`collision: ${data.stats.boxes} boxes from ${data.stats.triangles} triangles, ${data.spawns.length} spawns, ${data.stats.spots} spots`);

// The rendered world: decals and shadow-only casters dropped, the map's own lights dropped (the engine lights the
// scene), and any surface without a material grey-boxed by its name.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(work, `render/maps/${name}/world.glb`));
const greyBox = [
  [/overlay|blocklight|_shadow\b/, null],
  [/shipping_container/, '#7a3328', .45],
  [/chainlink/, '#7d8584', .5, .35],
  [/window|glass|blinds/, '#a7c2c9', .1, .3],
  [/cardboard|food_box|food_crates/, '#97774c'],
  [/crate|pallet|wood|plywood|drywall/, '#a3895f'],
  [/brick/, '#8a4535'],
  [/concrete_floor|concretefloor|metal_floor|floor_plate/, '#958e7c'],
  [/blacktop|asphalt|snow/, '#5b5f61'],
  [/tree|branch/, '#56684a'],
  [/bulbs_on|light_on|fluorescent_light_on|emergency_light|illuminated|floodlight/, '#fff4d6', 0, 1, true],
  [/wire|cable/, '#2b2b2b'],
  [/tarp/, '#6f7a5a'],
  [/barrel|plastic|garbage/, '#4f6d7a'],
  [/concrete|cinder|building|ceiling|wall|template/, '#b2ab9a'],
  [/metal|pipe|joist|ibeam|duct|hvac|stairs|ladder|door|trim|gate|forklift|truck|trolley|toolbox|panel|camera|sign|pole|light|gutter|sprinkler/, '#7f827d', .35],
  [/./, '#9a9587'],
];
const root = doc.getRoot(), materials = new Map();
for (const light of root.listExtensionsUsed().filter(extension => extension.extensionName === 'KHR_lights_punctual')) light.dispose();
for (const node of root.listNodes()) {
  const label = node.getName().toLowerCase(), mesh = node.getMesh();
  const [, color, metalness = 0, opacity = 1, emissive = false] = greyBox.find(([pattern]) => pattern.test(label));
  if (!color) {node.dispose(); continue;}
  for (const primitive of mesh?.listPrimitives() ?? []) {
    if (primitive.getMaterial()?.getBaseColorTexture()) continue;
    const key = `${color}:${metalness}:${opacity}:${emissive}`;
    if (!materials.has(key)) {
      const [r, g, b] = [1, 3, 5].map(i => (parseInt(color.slice(i, i + 2), 16) / 255) ** 2.2);
      const material = doc.createMaterial(`grey-box ${color}`).setBaseColorFactor([r, g, b, opacity]).setRoughnessFactor(.85).setMetallicFactor(metalness);
      if (opacity < 1) material.setAlphaMode('BLEND').setDoubleSided(true);
      if (emissive) material.setEmissiveFactor([r, g, b]);
      materials.set(key, material);
    }
    primitive.setMaterial(materials.get(key));
  }
}
const staged = path.join(work, 'staged.glb'), output = `public/revamp/maps/${name}.glb`;
await io.write(staged, doc);
fs.mkdirSync(path.dirname(output), {recursive: true});
execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', staged, output, '--compress', 'meshopt',
  '--texture-compress', 'webp', '--texture-size', '1024', '--flatten', 'true', '--join', 'true', '--join-named', 'true',
  '--instance', 'false', '--simplify', 'false'], {stdio: 'pipe'});
console.log(`render: ${output} ${(fs.statSync(output).size / 1e6).toFixed(1)} MB`);
if (keep) console.log(`work files kept in ${work}`); else fs.rmSync(work, {recursive: true, force: true});
