import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {prepareMapPresentation, optimizeMapPresentation} from './prepare-map-presentation.mjs';

function fixture(forceUv2 = false) {
  const doc = new Document(), buffer = doc.createBuffer();
  const attribute = (values, type) => doc.createAccessor().setBuffer(buffer).setType(type).setArray(new Float32Array(values));
  const material = doc.createMaterial('crate').setExtras({vmat: {IntParams: {F_FORCE_UV2: +forceUv2}}});
  const uv = attribute([0, 0, 1, 0, 0, 1], 'VEC2');
  const lightUv = attribute([.10001, .20001, .10004, .20001, .10001, .20004], 'VEC2');
  const primitive = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', attribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 'VEC3'))
    .setAttribute('TEXCOORD_0', uv).setAttribute('TEXCOORD_1', forceUv2 ? uv.clone() : lightUv);
  if (forceUv2) primitive.setAttribute('TEXCOORD_2', lightUv);
  doc.createScene().addChild(doc.createNode('node000_crate').setMesh(doc.createMesh().addPrimitive(primitive)));
  return {doc, primitive, lightUv};
}

test('UV2 crate surfaces retain the separate third-channel lightmap', () => {
  const {doc, primitive, lightUv} = fixture(true), surface = primitive.getAttribute('TEXCOORD_1');
  prepareMapPresentation(doc);
  assert.equal(primitive.getAttribute('TEXCOORD_0'), surface);
  assert.equal(primitive.getAttribute('TEXCOORD_1'), lightUv);
  assert.equal(primitive.getAttribute('TEXCOORD_2'), null);
  assert.equal(primitive.getMaterial().getExtras().nativeLightmap, true);
});

test('recovers the compiled linear roof-beam tint from the adapted material', () => {
  const {doc, primitive} = fixture();
  primitive.getMaterial().setName('web_joist_001').setBaseColorFactor([.025423843, .021319529, .017180525, 1]);
  prepareMapPresentation(doc);
  const factor = primitive.getMaterial().getBaseColorFactor();
  [.173439, .157281, .139022].forEach((expected, index) => assert.ok(Math.abs(factor[index] - expected) < .00001));
});

test('optimization and GLB roundtrip keep small lighting charts distinct', async () => {
  const {doc, lightUv} = fixture(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'map-uv-test-'));
  try {
    const expected = Array.from(lightUv.getArray()); prepareMapPresentation(doc);
    const file = path.join(directory, 'map.glb'); await optimizeMapPresentation(doc, file);
    await MeshoptDecoder.ready;
    const result = await new NodeIO().registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({'meshopt.decoder': MeshoptDecoder}).read(file);
    const primitive = result.getRoot().listMeshes()[0].listPrimitives()[0];
    const uv = primitive.getAttribute('TEXCOORD_1'); assert.ok(uv);
    const actual = [];
    for (let i = 0; i < uv.getCount(); i++) actual.push(uv.getElement(i, []));
    for (let i = 0; i < expected.length; i += 2) assert.ok(actual.some(pair =>
      Math.abs(pair[0] - expected[i]) <= 1 / 65535 && Math.abs(pair[1] - expected[i + 1]) <= 1 / 65535));
    assert.equal(new Set(actual.map(pair => pair.join(','))).size, 3);
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});
