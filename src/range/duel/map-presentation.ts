import * as THREE from 'three';

/** Installed aim_redline irradiance, encoded as linear RGBM to retain HDR values. */
export async function applyMapPresentation(scene: THREE.Object3D, name: string) {
  if (name !== 'aim_redline') return;
  const materials = new Set<THREE.MeshStandardMaterial>();
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.nativeLightmap && !object.geometry.getAttribute('uv1')) {
        throw new Error('Imported map is missing its baked-lighting UVs. Reimport the map.');
      }
      materials.add(material);
    }
  });
  // Older/grey-box imports still work without requiring lighting assets.
  if (![...materials].some(material => material.userData.nativeLightmap)) return;
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.allSettled([
    loader.loadAsync('/maps/aim_redline-lightmap.webp?v=2'),
    loader.loadAsync('/maps/aim_redline-sun-shadow.webp?v=2'),
  ]);
  if (loaded.some(result => result.status === 'rejected')) {
    for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose();
    throw new Error('Imported map lighting is unavailable. Reimport the map.');
  }
  const [lightmap, shadow] = loaded.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
  lightmap.colorSpace = THREE.NoColorSpace;
  lightmap.flipY = false; lightmap.channel = 1;
  lightmap.wrapS = lightmap.wrapT = THREE.ClampToEdgeWrapping;
  lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
  shadow.colorSpace = THREE.NoColorSpace; shadow.flipY = false;
  shadow.generateMipmaps = false; shadow.minFilter = THREE.LinearFilter;
  // disposeResources owns lightMap; release the custom shader texture with it.
  lightmap.addEventListener('dispose', () => shadow.dispose());
  for (const material of materials) {
    if (material.userData.nativeOverlay) {
      material.transparent = true; material.depthWrite = false;
      material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
      if (material.userData.nativeOverlay === 3) material.blending = THREE.MultiplyBlending;
    }
    if (!material.userData.nativeLightmap) continue;
    material.lightMap = lightmap; material.lightMapIntensity = Math.PI;
    material.onBeforeCompile = shader => {
      shader.uniforms.nativeSunShadow = {value: shadow};
      shader.fragmentShader = 'uniform sampler2D nativeSunShadow;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', `
        // Static surfaces are lit by the map's bake, not the generic arena sun.
        reflectedLight.directDiffuse = vec3(0.0);
        reflectedLight.directSpecular = vec3(0.0);
        irradiance = vec3(0.0);
        #ifdef USE_LIGHTMAP
          vec4 baked = texture2D(lightMap, vLightMapUv);
          irradiance = baked.rgb * baked.a * 16.0 * lightMapIntensity;
          // Approximate the missing reflection probes with local baked radiance.
          radiance = irradiance / PI;
          // RE_IndirectDiffuse already includes the bake; do not count it again.
          iblIrradiance = vec3(0.0);
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          float sun = max(0.0, dot(worldNormal, vec3(-0.27321, 0.79864, -0.53622)));
          float visibility = 1.0 - texture2D(nativeSunShadow, vLightMapUv).r;
          irradiance += vec3(sun * visibility);
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'native-map-rgbm-sun-2';
    material.needsUpdate = true;
  }
}
