// Builds public/revamp/models/duel-flinch.glb: the game's world-model flinch clips (shared/flinch_*, rifle default
// plus the _pistol and _knife variants) exported from the installed CS2 with Source 2 Viewer, as an animation-only
// pack on the worldmodel skeleton. The clips are additive deltas (RelativeToFrame, bind pose base) and keep the
// exporter's `additive` extras, which DuelEngine turns into Three's additive blend mode.
// Usage: CS2_PATH=<install> [SOURCE2VIEWER=<cli>] node tools/build-duel-flinch.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {dedup, prune, resample} from '@gltf-transform/functions';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = process.env.SOURCE2VIEWER || path.resolve(process.platform === 'win32'
  ? '.local-tools/vrf/Source2Viewer-CLI.exe' : '.local-tools/vrf-linux/Source2Viewer-CLI');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
export const flinchStems = ['flinch_head', 'flinch_head_left', 'flinch_head_right', 'flinch_head_rear',
  'flinch_chest', 'flinch_chest_left', 'flinch_chest_right', 'flinch_chest_rear', 'flinch_stomach', 'flinch_stomach_rear',
  'flinch_arm_left', 'flinch_arm_right', 'flinch_leg_left', 'flinch_leg_right'];
export const flinchFamilies = ['', '_pistol', '_knife'];
const names = flinchStems.flatMap(stem => flinchFamilies.map(family => `${stem}${family}`));

const work = path.resolve('research/duel-flinch');
fs.mkdirSync(work, {recursive: true});
const exported = path.join(work, 'ctm_sas-flinch.glb');
if (!fs.existsSync(exported) || process.argv.includes('--refresh')) {
  if (!fs.existsSync(vpk)) throw new Error(`No game package at ${vpk}; set CS2_PATH.`);
  execFileSync(cli, ['-i', vpk, '-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', exported, '-d', '--gltf_export_format', 'glb',
    '--gltf_export_animations', '--gltf_animation_list', names.join(',')], {stdio: 'pipe', maxBuffer: 50e6});
  fs.rmSync(exported.replace(/\.glb$/, '_physics.glb'), {force: true});
}
const io = new NodeIO();
const document = await io.read(exported), root = document.getRoot();
const audit = [];
for (const clip of root.listAnimations()) {
  const name = clip.getName().split('/').pop();
  if (!clip.getName().includes('/world/shared/flinch_') || !names.includes(name)) {clip.dispose(); continue;}
  // Only bones the clip actually moves are kept: a delta that stays at identity adds nothing.
  let seconds = 0, kept = 0, peak = 0;
  for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler(), input = sampler.getInput().getArray(), output = sampler.getOutput().getArray();
    seconds = Math.max(seconds, input[input.length - 1]);
    const size = channel.getTargetPath() === 'rotation' ? 4 : 3;
    let magnitude = 0;
    for (let i = 0; i < output.length; i += size) {
      magnitude = Math.max(magnitude, size === 4
        ? Math.hypot(output[i], output[i + 1], output[i + 2]) : Math.hypot(output[i], output[i + 1], output[i + 2]));
    }
    // Root, pelvis and weapon-anchor tracks come out absolute rather than as deltas, and a flinch is rotation only.
    const bone = channel.getTargetNode()?.getName() ?? '';
    if (channel.getTargetPath() !== 'rotation' || magnitude < 1e-5 || /^(?:root_motion|pelvis|wpn|wpnPivot)$|AIM|jiggle/.test(bone)) {
      channel.dispose(); sampler.dispose(); continue;
    }
    kept++; peak = Math.max(peak, magnitude);
  }
  audit.push({name, seconds: Number(seconds.toFixed(4)), channels: kept, peak: Number(peak.toFixed(4)), additive: !!clip.getExtras()?.additive});
}
for (const node of root.listNodes()) node.setMesh(null).setCamera(null).setSkin(null);
for (const resource of [...root.listMeshes(), ...root.listTextures(), ...root.listMaterials(), ...root.listSkins()]) resource.dispose();
await document.transform(resample({tolerance: 1e-4}), dedup(), prune());
const output = path.resolve('public/revamp/models/duel-flinch.glb');
fs.mkdirSync(path.dirname(output), {recursive: true});
await io.write(output, document);
const bytes = fs.statSync(output).size;
if (bytes > 1.5 * 1048576) throw new Error(`duel-flinch.glb is ${bytes} bytes; expected a small animation-only pack.`);
const missing = names.filter(name => !audit.some(clip => clip.name === name));
fs.writeFileSync('research/duel-flinch-audit.json', JSON.stringify({schema: 1, bytes,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
  source: 'agents/models/ctm_sas/ctm_sas.vmdl_c with animation/anims/world/shared/flinch_* via Source2Viewer-CLI --gltf_export_animations',
  clips: audit, missing}, null, 2));
console.log(`${audit.length} flinch clips, ${(bytes / 1024).toFixed(0)} KiB: ${output}; missing ${missing.length}`);
