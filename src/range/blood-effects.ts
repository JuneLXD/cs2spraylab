import * as THREE from 'three';
import type {Vec} from './actor-physics';

/**
 * The game's blood impact as hit feedback only: a short burst of droplets and two mist puffs at the hit point,
 * oriented by the bullet, gone within half a second. Nothing sticks to walls or floors (no decals, by request).
 * One pooled point cloud with a soft particle texture; a burst never allocates.
 */
const BURSTS = 16, DROPS = 12, MISTS = 2, PER = DROPS + MISTS, GRAVITY = 9.8, DRAG = 3.5;
const DROP = new THREE.Color('#4a0909'), MIST = new THREE.Color('#5a1010');

function softTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size - .5, dy = (y + .5) / size - .5, r = Math.min(1, Math.hypot(dx, dy) * 2);
    const alpha = r < .4 ? 1 : Math.max(0, 1 - (r - .4) / .6) ** 1.6;
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export class BloodEffects {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly tints: Float32Array;
  private readonly origins = new Float32Array(BURSTS * PER * 3);
  private readonly velocities = new Float32Array(BURSTS * PER * 3);
  private readonly lives = new Float32Array(BURSTS * PER);
  private readonly grow = new Float32Array(BURSTS * PER);
  private readonly born = new Float64Array(BURSTS).fill(-Infinity);
  private readonly material: THREE.ShaderMaterial;
  private readonly viewport = new THREE.Vector2();
  private next = 0;
  constructor(parent: THREE.Object3D, private readonly random: () => number = Math.random) {
    const count = BURSTS * PER;
    this.positions = new Float32Array(count * 3); this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count); this.tints = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: {map: {value: softTexture()}, scale: {value: 300}},
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint; uniform float scale;
        varying float vAlpha; varying vec3 vTint;
        void main() {
          vAlpha = alpha; vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = alpha > 0.0 ? size * scale / max(0.05, -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vTint, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'batched-blood'; this.points.frustumCulled = false; this.points.renderOrder = 2; this.points.visible = false;
    parent.add(this.points);
  }
  /** A hit at `point` from a bullet travelling along `direction`; `scale` grows the burst (a headshot). */
  burst(point: Vec, direction: Vec, now: number, scale = 1) {
    const burst = this.next; this.next = (burst + 1) % BURSTS;
    this.born[burst] = now;
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const dx = direction.x / length, dy = direction.y / length, dz = direction.z / length;
    // Two perpendicular axes for the exit cone.
    const ax = Math.abs(dx) < .9 ? 1 : 0, ay = ax ? 0 : 1;
    let px = ay * dz - 0 * dy, py = 0 * dx - ax * dz, pz = ax * dy - ay * dx;
    const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    for (let i = 0; i < PER; i++) {
      const index = burst * PER + i, at = index * 3, mist = i >= DROPS;
      const back = !mist && this.random() < .3, cone = mist ? 0 : (back ? .5 : .75) * this.random();
      const angle = this.random() * Math.PI * 2, spread = Math.sin(cone), along = Math.cos(cone) * (back ? -1 : 1);
      const speed = mist ? (i === DROPS ? .35 : -.2) : (back ? .8 + this.random() * 1.2 : 1.2 + this.random() * 2.2) * scale;
      const vx = (dx * along + (px * Math.cos(angle) + qx * Math.sin(angle)) * spread) * speed;
      const vy = (dy * along + (py * Math.cos(angle) + qy * Math.sin(angle)) * spread) * speed + (mist ? .12 : .4 * this.random());
      const vz = (dz * along + (pz * Math.cos(angle) + qz * Math.sin(angle)) * spread) * speed;
      const offset = mist ? (i === DROPS ? .04 : -.03) : 0;
      this.origins[at] = point.x + dx * offset; this.origins[at + 1] = point.y + dy * offset; this.origins[at + 2] = point.z + dz * offset;
      this.velocities[at] = vx; this.velocities[at + 1] = vy; this.velocities[at + 2] = vz;
      this.lives[index] = mist ? .42 + this.random() * .1 : .3 + this.random() * .2;
      this.sizes[index] = (mist ? .14 : .022 + this.random() * .026) * scale;
      this.grow[index] = mist ? .3 * scale : 0;
      const tint = mist ? MIST : DROP;
      this.tints[at] = tint.r; this.tints[at + 1] = tint.g; this.tints[at + 2] = tint.b;
      this.alphas[index] = mist ? .65 : 1;
      this.positions[at] = this.origins[at]; this.positions[at + 1] = this.origins[at + 1]; this.positions[at + 2] = this.origins[at + 2];
    }
    this.points.visible = true;
    this.touch();
  }
  get active() {return this.points.visible;}
  /** Advances every burst; `camera` and `renderer` size the points in world metres. */
  update(now: number, camera?: THREE.Camera, renderer?: THREE.WebGLRenderer) {
    if (camera && renderer) {
      renderer.getDrawingBufferSize(this.viewport);
      this.material.uniforms.scale.value = camera.projectionMatrix.elements[5] * this.viewport.y / 2;
    }
    let visible = false;
    for (let burst = 0; burst < BURSTS; burst++) {
      const age = now - this.born[burst];
      if (!Number.isFinite(age) || age < 0) continue;
      let alive = false;
      for (let i = 0; i < PER; i++) {
        const index = burst * PER + i, at = index * 3, life = this.lives[index];
        if (age >= life) {this.alphas[index] = 0; continue;}
        alive = true;
        const mist = i >= DROPS, t = age / life, travel = (1 - Math.exp(-DRAG * age)) / DRAG;
        this.positions[at] = this.origins[at] + this.velocities[at] * travel;
        this.positions[at + 1] = this.origins[at + 1] + this.velocities[at + 1] * travel - (mist ? 0 : .5 * GRAVITY * age * age);
        this.positions[at + 2] = this.origins[at + 2] + this.velocities[at + 2] * travel;
        this.alphas[index] = mist ? .65 * (1 - t) ** 1.5 : Math.max(0, 1 - t * t);
        if (mist) this.sizes[index] = .14 + this.grow[index] * Math.sqrt(t);
      }
      if (!alive) this.born[burst] = -Infinity; else visible = true;
    }
    this.points.visible = visible;
    if (visible || this.points.geometry.getAttribute('alpha').needsUpdate) this.touch();
  }
  private touch() {
    for (const name of ['position', 'size', 'alpha', 'tint']) (this.points.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() {this.born.fill(-Infinity); this.alphas.fill(0); this.points.visible = false; this.touch();}
  dispose() {
    this.points.removeFromParent(); this.points.geometry.dispose();
    (this.material.uniforms.map.value as THREE.Texture).dispose(); this.material.dispose();
  }
}
