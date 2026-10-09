import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Quaternion, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {ViewAnimation} from './view-animation';
import fixture from './native-viewmodel-mount-fixture.json';

// Load the shipped geometry/animation without browser texture decoding.
async function loadRig(file: string) {
  const data = readFileSync(file), length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString());
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.materials; delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((name: string) => name !== 'EXT_texture_webp');
  // Retain the embedded BIN chunk to avoid fetch/progress-event dependencies in Node.
  const encoded = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binary = data.subarray(28 + length), glb = Buffer.alloc(28 + jsonLength + binary.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonLength, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  glb.fill(32, 20, 20 + jsonLength); encoded.copy(glb, 20);
  glb.writeUInt32LE(binary.length, 20 + jsonLength); glb.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(glb, 28 + jsonLength);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}

describe('native revolver graph composition and mount', () => {
  it.each(['revolver', 'revolver-legacy'])('%s keeps arms, fingers and weapon on the native charge pose after idle and fire/cancel', async id => {
    const assets = process.env.REAUDIT_VIEWMODEL_ASSET_DIR ?? 'public/revamp/models';
    const {scene, animations} = await loadRig(`${assets}/view-${id}.glb`);
    const view = new ViewAnimation(scene, animations);
    const checkCharge = () => {
      let previous = 0;
      for (const frame of fixture.frames) {
        view.update(0, 1, frame.time - previous, {charging: true, chargeDuration: fixture.chargeSeconds});
        previous = frame.time;
        scene.updateMatrixWorld(true);
        for (const [name, position] of Object.entries(frame.positions)) {
          const bone = scene.getObjectByName(name);
          expect(bone, name).toBeDefined();
          const error = bone!.getWorldPosition(new Vector3()).distanceTo(new Vector3().fromArray(position));
          expect(error, `${id} ${name} position at ${frame.time}`).toBeLessThan(fixture.toleranceMetres);
          const rotation = frame.rotations[name as keyof typeof frame.rotations];
          const angle = bone!.getWorldQuaternion(new Quaternion()).normalize().angleTo(new Quaternion().fromArray(rotation).normalize()) * 180 / Math.PI;
          expect(angle, `${id} ${name} rotation at ${frame.time}`).toBeLessThan(fixture.toleranceDegrees);
        }
      }
    };
    checkCharge();
    view.playFire('revolver'); view.update(0, 1, .05);
    view.cancel();
    checkCharge();
    view.dispose();
  });
});
