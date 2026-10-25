import {DataTexture, LinearFilter, MeshMatcapMaterial, RGBAFormat, SRGBColorSpace} from 'three';

/** A small neutral matcap gives balls readable roundness even under Pop's intentionally dim room lighting. */
export function createPopSphereMaterial() {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  const light = [-.45, .65, .61], length = Math.hypot(...light), half = [-.28, .4, .87], halfLength = Math.hypot(...half);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let nx = x / (size - 1) * 2 - 1, ny = y / (size - 1) * 2 - 1;
    const radius = Math.hypot(nx, ny);
    if (radius > 1) {nx /= radius; ny /= radius;}
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const diffuse = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / length);
    const specular = Math.pow(Math.max(0, (nx * half[0] + ny * half[1] + nz * half[2]) / halfLength), 48);
    const value = Math.round(Math.min(1, .2 + .66 * diffuse + .4 * specular) * 255), i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const matcap = new DataTexture(pixels, size, size, RGBAFormat);
  matcap.colorSpace = SRGBColorSpace; matcap.minFilter = matcap.magFilter = LinearFilter; matcap.needsUpdate = true;
  return new MeshMatcapMaterial({color: '#ff6a4d', matcap, fog: false});
}
