import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import {prepareMapPresentation, optimizeMapPresentation, restoreMapTextureAlpha} from './prepare-map-presentation.mjs';
import {projectFloorDecals} from './project-map-decals.mjs';

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

test('translucent lightmapped overlays retain their native alpha without an alpha-test flag', async () => {
  const {doc, primitive} = fixture(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'map-alpha-test-'));
  try {
    primitive.getMaterial().setExtras({vmat: {ShaderName: 'csgo_lightmappedgeneric.vfx',
      IntParams: {F_OVERLAY: 1, F_TRANSLUCENT: 1}, TextureParams: {g_tColor: 'floor-paint.vtex'}}});
    prepareMapPresentation(doc);
    const material = primitive.getMaterial();
    assert.equal(material.getExtras().nativeOverlay, 1); assert.equal(material.getAlphaMode(), 'BLEND');
    const file = path.join(directory, 'paint.png');
    await sharp(Buffer.from([180, 170, 100, 0, 180, 170, 100, 186]), {raw: {width: 2, height: 1, channels: 4}}).png().toFile(file);
    await restoreMapTextureAlpha(doc, source => {assert.equal(source, 'floor-paint.vtex'); return file;});
    const rgba = await sharp(material.getBaseColorTexture().getImage()).raw().toBuffer();
    assert.equal(rgba[3], 0); assert.equal(rgba[7], 186);
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});

function floorDecalFixture({height = .3937, wall = false} = {}) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const attribute = (values, type) => doc.createAccessor().setBuffer(buffer).setType(type).setArray(new Float32Array(values));
  const add = (name, positions, uv, material) => {
    const primitive = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', attribute(positions, 'VEC3')).setAttribute('TEXCOORD_1', attribute(uv, 'VEC2'));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh().addPrimitive(primitive))); return primitive;
  };
  const floor = add('node000_floor', [0, 0, 0, 2, 0, 0, 0, 0, 2], [.1, .2, .9, .2, .1, .8], doc.createMaterial('concrete_floor'));
  const overlay = add('node000_overlay', [.25, height, .25, .5, wall ? height + 1 : height, .25, .25, height, .5],
    [0, 0, 0, 0, 0, 0], doc.createMaterial('road_striping').setAlphaMode('BLEND').setExtras({vmat: {IntParams: {F_OVERLAY: 1}}}));
  return {doc, floor, overlay};
}

test('seats raised floor paint without disturbing its own lighting charts or the receiver geometry', () => {
  const {doc, floor, overlay} = floorDecalFixture(), original = overlay.getAttribute('POSITION');
  const lighting = overlay.getAttribute('TEXCOORD_1'), originalLighting = Array.from(lighting.getArray());
  const floorBefore = Array.from(floor.getAttribute('POSITION').getArray());
  assert.equal(projectFloorDecals(doc).projectedFloorDecals, 1);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(overlay.getAttribute('POSITION').getElement(i, [])[1] - .001) < 1e-6);
  assert.equal(overlay.getAttribute('TEXCOORD_1'), lighting);
  assert.deepEqual(Array.from(lighting.getArray()), originalLighting);
  assert.ok(Math.abs(original.getElement(0, [])[1] - .3937) < 1e-6);
  assert.deepEqual(Array.from(floor.getAttribute('POSITION').getArray()), floorBefore);
  assert.equal(projectFloorDecals(doc).projectedFloorDecals, 0);
});

test('does not project wall decals or decals without a nearby receiving floor', () => {
  for (const options of [{wall: true}, {height: 2}]) {
    const {doc, overlay} = floorDecalFixture(options), original = overlay.getAttribute('POSITION');
    assert.equal(projectFloorDecals(doc).projectedFloorDecals, 0);
    assert.equal(overlay.getAttribute('POSITION'), original);
  }
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
