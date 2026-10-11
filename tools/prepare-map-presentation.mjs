import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, flatten, join, weld, prune, textureCompress, meshopt} from '@gltf-transform/functions';
import {MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';
import {projectFloorDecals} from './project-map-decals.mjs';

// Preserve native baked-UV geometry and visible overlays before GLB optimization.
export function prepareMapPresentation(doc, {lightmap = true} = {}) {
  const root = doc.getRoot(), baked = new Map();
  let mapped = 0, overlays = 0;
  for (const material of root.listMaterials()) {
    const native = material.getExtras().vmat;
    // Compiled static draw-call tints are already linear. VRF 20 applies gamma again.
    if (material.getName() === 'web_joist_001') {
      const factor = material.getBaseColorFactor();
      material.setBaseColorFactor([...factor.slice(0, 3).map(value => value <= .0031308
        ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055), factor[3]]);
    }
    if (native?.ShaderName === 'csgo_static_overlay.vfx' || native?.IntParams?.F_OVERLAY) {
      const mode = native.IntParams?.F_BLEND_MODE ?? 1;
      material.setAlphaMode('BLEND');
      material.setBaseColorFactor([...material.getBaseColorFactor().slice(0, 3), native.FloatParams?.g_flOpacityScale ?? 1]);
      material.setExtras({...material.getExtras(), nativeOverlay: mode});
      // Exported overlay emissive textures have no native emission when brightness is zero.
      if (!native.FloatParams?.g_flSelfIllumBrightness) material.setEmissiveFactor([0, 0, 0]).setEmissiveTexture(null);
      overlays++;
    }
    if (native?.IntParams?.F_SELF_ILLUM) {
      const brightness = native.FloatParams?.g_flSelfIllumBrightness ?? 1;
      const tint = native.VectorParams?.g_vSelfIllumTint ?? [1, 1, 1];
      material.setEmissiveFactor(tint.slice(0, 3).map(value => value * Math.min(1, brightness)));
    }
  }
  for (const node of root.listNodes()) {
    const name = node.getName();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const material = primitive.getMaterial();
      // These crates use their second UV set for the surface, and the third for the bake.
      // Normalise the layout before joining meshes; the runtime can then share one atlas.
      if (material?.getExtras().vmat?.IntParams?.F_FORCE_UV2 && !primitive.getExtras().nativeUvRestored) {
        const surface = primitive.getAttribute('TEXCOORD_1');
        if (surface) {
          primitive.setAttribute('TEXCOORD_0', surface);
          primitive.setAttribute('TEXCOORD_1', primitive.getAttribute('TEXCOORD_2'));
          primitive.setAttribute('TEXCOORD_2', null);
          primitive.setExtras({...primitive.getExtras(), nativeUvRestored: true});
        }
      }
      if (!lightmap || !material || !name.startsWith('node000') || !primitive.getAttribute('TEXCOORD_1')) continue;
      if (!baked.has(material)) baked.set(material, material.clone().setExtras({...material.getExtras(), nativeLightmap: true}));
      primitive.setMaterial(baked.get(material)); mapped++;
    }
  }
  return {mapped, overlays, ...projectFloorDecals(doc)};
}

/** The adapted glTF color images lose the alpha channel on some Source 2 materials. A texture that cannot be extracted
 * (a stock map's shared props sometimes resolve only through other packages) keeps the adapted image. */
export async function restoreMapTextureAlpha(doc, extract) {
  const textures = new Map();
  let restored = 0, missing = 0;
  for (const material of doc.getRoot().listMaterials()) {
    const native = material.getExtras().vmat;
    const source = native?.TextureParams?.g_tColor;
    if (!source || !(native.IntParams?.F_ALPHA_TEST || native.IntParams?.F_TRANSLUCENT || material.getExtras().nativeOverlay)) continue;
    if (!textures.has(source)) {
      const file = extract(source);
      if (!file) {missing++; textures.set(source, null); continue;}
      const image = fs.readFileSync(file);
      textures.set(source, (await sharp(image).metadata()).hasAlpha
        ? doc.createTexture(source).setMimeType('image/png').setImage(image) : null);
    }
    const texture = textures.get(source);
    if (texture) {material.setBaseColorTexture(texture); restored++;}
  }
  return {restoredAlphaMaterials: restored, missingAlphaTextures: missing};
}

/** 12-bit UV quantization shifts small baked charts into neighbouring charts. */
export async function optimizeMapPresentation(doc, output) {
  sharp.concurrency(2);
  await MeshoptEncoder.ready;
  await doc.transform(dedup(), flatten(), join({keepNamed: false}), weld(),
    prune({keepAttributes: true}),
    textureCompress({encoder: sharp, targetFormat: 'webp', resize: [1024, 1024]}),
    meshopt({encoder: MeshoptEncoder, quantizeTexcoord: 16}));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder': MeshoptEncoder});
  await io.write(output, doc);
}
