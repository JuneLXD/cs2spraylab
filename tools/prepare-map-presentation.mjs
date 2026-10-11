import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {dedup, flatten, join, weld, prune, textureCompress, meshopt} from '@gltf-transform/functions';
import {MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';
import {projectFloorDecals} from './project-map-decals.mjs';

// Preserve native baked-UV geometry and visible overlays before GLB optimization.
export function prepareMapPresentation(doc, {lightmap = true} = {}) {
  const root = doc.getRoot(), baked = new Map(), surfaceUvs = new Map(), paintColors = new Map();
  let mapped = 0, overlays = 0, restoredSurfaceUvs = 0, restoredFoliage = 0;
  for (const material of root.listMaterials()) {
    const native = material.getExtras().vmat;
    if (/^csgo_(?:black_unlit|unlitgeneric)\.vfx$/.test(native?.ShaderName ?? '')) {
      material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
      if (native.ShaderName === 'csgo_black_unlit.vfx') material.setBaseColorFactor([0, 0, 0, 1]);
    }
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
      const native = material?.getExtras().vmat;
      const environment = /^csgo_environment(?:_blend)?\.vfx$/.test(native?.ShaderName ?? '');
      // csgo_environment.vert.slang: UV1 and UV2 are both surface coordinates;
      // the separately named vLightmapUV becomes TEXCOORD_2 in VRF's export.
      // Restore the base layer's authored UV selection and transform before optimization.
      if (environment && !primitive.getExtras().nativeSurfaceUvRestored) {
        const selected = native.IntParams?.g_nUVSet1 ?? 1;
        const source = primitive.getAttribute(selected === 2 ? 'TEXCOORD_1' : 'TEXCOORD_0');
        if (source && selected !== 0) { // Biplanar mapping requires a different shader.
          const vector = (key, fallback) => native.VectorParams?.[key]?.slice(0, 2) ?? fallback;
          const scale = vector('g_vTexCoordScale1', [1, 1]), center = vector('g_vTexCoordCenter1', [.5, .5]);
          const offset = vector('g_vTexCoordOffset1', [0, 0]), rotation = (native.FloatParams?.g_flTexCoordRotation1 ?? 0) * Math.PI / 180;
          const key = JSON.stringify([scale, center, offset, rotation]);
          const variants = surfaceUvs.get(source) ?? new Map(); surfaceUvs.set(source, variants);
          if (!variants.has(key)) {
            const uv = source.clone(), value = [], cos = Math.cos(rotation), sin = Math.sin(rotation);
            for (let i = 0; i < source.getCount(); i++) {
              source.getElement(i, value);
              const x = (value[0] - center[0]) * scale[0], y = (value[1] - center[1]) * scale[1];
              uv.setElement(i, [cos * x - sin * y + center[0] + offset[0], sin * x + cos * y + center[1] + offset[1]]);
            }
            variants.set(key, uv);
          }
          primitive.setAttribute('TEXCOORD_0', variants.get(key)); restoredSurfaceUvs++;
        }
        // The fourth component is a paint strength, not surface opacity.
        const paint = primitive.getAttribute('COLOR_0');
        if (paint?.getType() === 'VEC4') {
          if (!paintColors.has(paint)) {
            const colors = paint.clone(), value = [];
            for (let i = 0; i < paint.getCount(); i++) {
              paint.getElement(i, value);
              colors.setElement(i, [...value.slice(0, 3).map(channel => 1 + (channel - 1) * value[3]), 1]);
            }
            paintColors.set(paint, colors);
          }
          primitive.setAttribute('COLOR_0', paintColors.get(paint));
        }
        primitive.setExtras({...primitive.getExtras(), nativeSurfaceUvRestored: true});
      }
      // csgo_foliage uses COLOR0 for sway/flutter, never as an albedo multiplier.
      if (native?.ShaderName === 'csgo_foliage.vfx' && primitive.getAttribute('COLOR_0')) {
        primitive.setAttribute('COLOR_0', null); restoredFoliage++;
      }
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
      // Only compiled world geometry has the map atlas. Aggregated environment props
      // with just two UVs have no bake: their second channel is still a surface UV.
      const channel = !primitive.getExtras().nativeUvRestored && (environment || native?.IntParams?.F_SECONDARY_UV) ? 2 : 1;
      if (!lightmap || !material || !/^(?:node\d+_|n\d+_lr\d+_)/.test(name) ||
          !primitive.getAttribute(`TEXCOORD_${channel}`)) continue;
      const variants = baked.get(material) ?? new Map(); baked.set(material, variants);
      if (!variants.has(channel)) variants.set(channel, material.clone().setExtras({
        ...material.getExtras(), nativeLightmap: true, nativeLightmapUv: channel,
      }));
      primitive.setMaterial(variants.get(channel)); mapped++;
    }
  }
  return {mapped, overlays, restoredSurfaceUvs, restoredFoliage, ...projectFloorDecals(doc)};
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
