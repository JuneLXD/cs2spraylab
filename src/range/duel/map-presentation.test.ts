import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {applyMapPresentation} from './map-presentation';
import {disposeResources} from './render-resources';

afterEach(() => vi.restoreAllMocks());

function bakedScene() {
  const geometry = new THREE.PlaneGeometry();
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  const material = new THREE.MeshStandardMaterial();
  material.userData.nativeLightmap = true;
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  return {scene, material};
}

describe('imported map lighting resources', () => {
  it('keeps one shared bake and disposes both atlases once when leaving the map', async () => {
    const {scene, material} = bakedScene(), light = new THREE.Texture(), shadow = new THREE.Texture();
    material.userData.nativeOverlay = 1;
    const lightDispose = vi.spyOn(light, 'dispose'), shadowDispose = vi.spyOn(shadow, 'dispose');
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValueOnce(light).mockResolvedValueOnce(shadow);
    await applyMapPresentation(scene, 'aim_redline');
    expect(material.lightMap).toBe(light); expect(light.channel).toBe(1);
    expect(light.flipY).toBe(false); expect(light.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.transparent).toBe(true); expect(material.depthWrite).toBe(false); expect(material.polygonOffset).toBe(true);
    disposeResources([scene]);
    expect(lightDispose).toHaveBeenCalledOnce(); expect(shadowDispose).toHaveBeenCalledOnce();
  });

  it('releases a successful atlas when its companion fails to download', async () => {
    const {scene} = bakedScene(), light = new THREE.Texture(), dispose = vi.spyOn(light, 'dispose');
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValueOnce(light).mockRejectedValueOnce(new Error('404'));
    await expect(applyMapPresentation(scene, 'aim_redline')).rejects.toThrow('lighting is unavailable');
    expect(dispose).toHaveBeenCalledOnce();
    disposeResources([scene]);
  });

  it('rejects an optimized map that lost the baked UVs before downloading anything', async () => {
    const {scene} = bakedScene();
    (scene.children[0] as THREE.Mesh).geometry.deleteAttribute('uv1');
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync');
    await expect(applyMapPresentation(scene, 'aim_redline')).rejects.toThrow('UVs');
    expect(load).not.toHaveBeenCalled(); disposeResources([scene]);
  });

  it('does not require the new atlases for legacy or other maps', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync');
    await applyMapPresentation(new THREE.Group(), 'aim_redline');
    const {scene} = bakedScene(); await applyMapPresentation(scene, 'another-map');
    expect(load).not.toHaveBeenCalled(); disposeResources([scene]);
  });
});
