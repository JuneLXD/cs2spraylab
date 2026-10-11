import * as THREE from 'three';

/** Imported map irradiance, encoded as linear RGBM to retain HDR values. */
export async function applyMapPresentation(scene: THREE.Object3D, name: string, maxAnisotropy = 1) {
  const lighting = scene.userData.nativeMapLighting;
  const materials = new Set<THREE.MeshStandardMaterial>();
  const textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && !textures.has(value)) {
        textures.add(value);
        value.anisotropy = Math.min(8, maxAnisotropy); value.needsUpdate = true;
      }
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const channel = material.userData.nativeLightmapUv ?? 1;
      if (material.userData.nativeLightmap && !object.geometry.getAttribute(`uv${channel}`)) {
        throw new Error('Imported map is missing its baked-lighting UVs. Reimport the map.');
      }
      materials.add(material);
    }
  });
  if (!lighting && name !== 'aim_redline') return;
  // Older/grey-box imports still work without requiring lighting assets.
  if (![...materials].some(material => material.userData.nativeLightmap)) return;
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.allSettled([
    loader.loadAsync(`/maps/${name}-lightmap.webp?v=2`),
    loader.loadAsync(`/maps/${name}-sun-shadow.webp?v=2`),
  ]);
  if (loaded.some(result => result.status === 'rejected')) {
    for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose();
    throw new Error('Imported map lighting is unavailable. Reimport the map.');
  }
  const [lightmap, shadow] = loaded.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
  lightmap.colorSpace = THREE.NoColorSpace;
  lightmap.flipY = false;
  lightmap.wrapS = lightmap.wrapT = THREE.ClampToEdgeWrapping;
  lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
  shadow.colorSpace = THREE.NoColorSpace; shadow.flipY = false;
  shadow.generateMipmaps = false; shadow.minFilter = THREE.LinearFilter;
  // A map can use UV1 on props and UV2 on layered world surfaces. Each sampler
  // has its own channel but shares the image and GPU source; load the atlas once.
  const channelMaps = new Map<number, THREE.Texture>();
  const channels = new Set([...materials].filter(material => material.userData.nativeLightmap)
    .map(material => material.userData.nativeLightmapUv ?? 1));
  let remaining = channels.size;
  for (const channel of channels) {
    const texture = channelMaps.size ? lightmap.clone() : lightmap;
    texture.channel = channel;
    texture.addEventListener('dispose', () => {if (--remaining === 0) shadow.dispose();});
    channelMaps.set(channel, texture);
  }
  const sunDirection = new THREE.Vector3().fromArray(lighting?.sunDirection ?? [-.27321, .79864, -.53622]);
  const sunColor = new THREE.Vector3().fromArray(lighting?.sunColor ?? [1, 1, 1]);
  const sunShadowMask = new THREE.Vector4().fromArray(lighting?.sunShadowMask ?? [1, 0, 0, 0]);
  for (const material of materials) {
    if (material.userData.nativeOverlay) {
      material.transparent = true; material.depthWrite = false;
      material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
      if (material.userData.nativeOverlay === 3) material.blending = THREE.MultiplyBlending;
    }
    if (!material.userData.nativeLightmap) continue;
    material.lightMap = channelMaps.get(material.userData.nativeLightmapUv ?? 1)!; material.lightMapIntensity = Math.PI;
    material.onBeforeCompile = shader => {
      shader.uniforms.nativeSunShadow = {value: shadow};
      shader.uniforms.nativeSunDirection = {value: sunDirection};
      shader.uniforms.nativeSunColor = {value: sunColor};
      // Source 2's diffuse light is already Lambert-normalized. Three applies 1/PI.
      shader.uniforms.nativeSunScale = {value: lighting ? Math.PI : 1};
      shader.uniforms.nativeSunShadowMask = {value: sunShadowMask};
      shader.fragmentShader = `uniform sampler2D nativeSunShadow;
        uniform vec3 nativeSunDirection;
        uniform vec3 nativeSunColor;
        uniform float nativeSunScale;
        uniform vec4 nativeSunShadowMask;\n` + shader.fragmentShader;
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
          float sun = max(0.0, dot(worldNormal, nativeSunDirection));
          float visibility = clamp(1.0 - dot(texture2D(nativeSunShadow, vLightMapUv), nativeSunShadowMask), 0.0, 1.0);
          irradiance += nativeSunColor * sun * visibility * nativeSunScale;
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'native-map-rgbm-sun-3';
    material.needsUpdate = true;
  }
}
