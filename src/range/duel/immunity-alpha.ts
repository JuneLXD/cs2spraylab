import * as THREE from 'three';

const KEY = 'spraylabImmune';
/**
 * CS2 draws a player with spawn protection translucent (sv_disable_immunity_alpha turns that off). Materials are
 * cloned the first time an actor turns immune and restored, and the clones disposed, when it ends.
 */
export function applyImmunityAlpha(root: THREE.Object3D, immune: boolean, opacity = .45) {
  if (!!root.userData[KEY] === immune) return;
  root.userData[KEY] = immune;
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (immune) {
      const live = mesh.material;
      const translucent = (Array.isArray(live) ? live : [live]).map(material => {
        const clone = material.clone(); clone.transparent = true; clone.opacity = opacity; clone.depthWrite = true; return clone;
      });
      mesh.userData.liveMaterial = live; mesh.material = Array.isArray(live) ? translucent : translucent[0];
    } else if (mesh.userData.liveMaterial) {
      const clones = mesh.material; mesh.material = mesh.userData.liveMaterial; delete mesh.userData.liveMaterial;
      for (const clone of Array.isArray(clones) ? clones : [clones]) clone.dispose();
    }
  });
}
