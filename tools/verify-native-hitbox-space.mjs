/** Verify Source hitbox space against installed GLB exports; no mesh/image decoding. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Matrix4, Vector3, Quaternion} from 'three';
import {parseKv3} from './kv3.mjs';
const root = path.resolve(import.meta.dirname, '..');
const blocks = process.argv[2];
if (!blocks) throw new Error('Usage: node tools/verify-native-hitbox-space.mjs <Source2Viewer MDAT block dump> [--write]');
const raw = fs.readFileSync(blocks, 'utf8');
const meshes = [...raw.matchAll(/--- Data for block "MDAT" ---\s*([\s\S]*?)(?=\n--- Data for block|$)/g)].map(m => parseKv3(m[1]));
const hitboxes = meshes[0].m_hitboxsets[0].value.m_HitBoxes;
const boneData = new Map(meshes.flatMap(m => m.m_skeleton?.m_bones ?? []).map(b => [b.m_boneName.toLowerCase(), b]));
const conversion = new Matrix4().set(0, .0254, 0, 0, 0, 0, .0254, 0, .0254, 0, 0, 0, 0, 0, 0, 1);
const expected = hitboxes.map(h => {
  if (h.m_nShapeType !== 2 || h.m_bTranslationOnly) throw new Error('Revalidate changed native shape');
  const a = boneData.get(h.m_sBoneName.toLowerCase()).m_invBindPose;
  const matrix = conversion.clone().multiply(new Matrix4().set(...a.slice(0, 4), ...a.slice(4, 8), ...a.slice(8, 12), 0, 0, 0, 1).invert());
  return {bone: h.m_sBoneName, matrix, start: new Vector3(...h.m_vMinBounds).applyMatrix4(matrix).toArray(),
    end: new Vector3(...h.m_vMaxBounds).applyMatrix4(matrix).toArray(), radius: h.m_flShapeRadius * .0254};
});
const results = [];
for (const name of ['target', ...fs.readdirSync(path.join(root, 'public/revamp/models')).filter(n => n.startsWith('agent-') && n.endsWith('.glb')).map(n => n.slice(0, -4))]) {
  const bytes = fs.readFileSync(path.join(root, `public/revamp/models/${name}.glb`));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const parents = new Map(), worlds = new Map();
  doc.nodes.forEach((node, i) => node.children?.forEach(child => parents.set(child, i)));
  function world(i) {
    if (worlds.has(i)) return worlds.get(i);
    const n = doc.nodes[i], m = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
      new Vector3(...n.translation ?? [0, 0, 0]), new Quaternion(...n.rotation ?? [0, 0, 0, 1]), new Vector3(...n.scale ?? [1, 1, 1]));
    if (parents.has(i)) m.premultiply(world(parents.get(i)));
    worlds.set(i, m); return m;
  }
  let maxPositionError = 0, maxLocalMapError = 0;
  for (const h of expected) {
    const index = doc.nodes.findIndex(n => n.name?.toLowerCase() === h.bone.toLowerCase());
    if (index < 0) throw new Error(`${name}: missing ${h.bone}`);
    const exported = world(index), local = exported.clone().invert().multiply(h.matrix);
    maxPositionError = Math.max(maxPositionError, new Vector3().setFromMatrixPosition(exported).distanceTo(new Vector3().setFromMatrixPosition(h.matrix)));
    maxLocalMapError = Math.max(maxLocalMapError, ...local.elements.map((v, i) => Math.abs(v - (i === 15 ? 1 : [0, 5, 10].includes(i) ? .0254 : 0))));
  }
  if (maxPositionError > .00003 || maxLocalMapError > .00003) throw new Error(`${name}: export space changed`);
  results.push({model: name, sha256: createHash('sha256').update(bytes).digest('hex'), maxPositionError, maxLocalMapError});
}
const report = {method: 'Native inverse bind matrices reconstructed from all MDAT meshes, transformed Source (x,y,z) -> GLB (y,z,x) in metres, compared against exported node hierarchies. Runtime local capsule endpoints need only the 0.0254 unit scale.',
  blockDumpSha256: createHash('sha256').update(raw).digest('hex'), results, capsules: expected.map(({matrix, ...row}) => row)};
const fixture = path.join(root, 'src/range/duel/native-hitbox-space-fixture.json');
if (process.argv.includes('--write')) fs.writeFileSync(fixture, JSON.stringify(report, null, 2) + '\n');
else if (JSON.stringify(JSON.parse(fs.readFileSync(fixture))) !== JSON.stringify(report)) throw new Error('Hitbox space fixture differs');
console.log(`Verified ${hitboxes.length} native capsules across ${results.length} exported models`);
