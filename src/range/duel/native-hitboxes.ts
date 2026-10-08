import type {Object3D} from 'three';
import type {Vec} from '../actor-physics';
import type {Hitgroup} from './types';
import type {HitCapsule} from './hitboxes';
import native from './native-hitboxes.json';

const definitions = native.hitboxes;
function transform(input: number[], out: Vec, e: number[]) {
  const x = input[0] * native.unitScale, y = input[1] * native.unitScale, z = input[2] * native.unitScale;
  out.x = e[0] * x + e[4] * y + e[8] * z + e[12];
  out.y = e[1] * x + e[5] * y + e[9] * z + e[13];
  out.z = e[2] * x + e[6] * y + e[10] * z + e[14];
}

/** Bone-local Source coordinates scale directly to the exported GLB's metres.
 * All 19 transforms are verified across the target and six agent exports.
 * Native group 8 (neck) shares chest damage, flinch and Kevlar protection.
 */
export class NativeHitboxPose {
  private buffers: HitCapsule[][];
  private current = 0;
  private constructor(private readonly bones: Object3D[]) {
    this.buffers = Array.from({length: 2}, () => definitions.map(d => ({start: {x: 0, y: 0, z: 0}, end: {x: 0, y: 0, z: 0},
      radius: d.radius * native.unitScale, group: d.group as Hitgroup, index: d.index})));
  }
  static bind(root: Object3D): NativeHitboxPose | undefined {
    const byName = new Map<string, Object3D>();
    root.traverse(node => {if ('isBone' in node && node.isBone) byName.set(node.name.toLowerCase(), node);});
    const bones = definitions.map(d => byName.get(d.bone.toLowerCase()));
    return bones.every((bone): bone is Object3D => !!bone) ? new NativeHitboxPose(bones) : undefined;
  }
  /** Call after scene matrix updates. The previous capture stays untouched until
   * the next frame is presented; two buffers avoid per-frame capsule allocation.
   */
  capture(): readonly HitCapsule[] {
    this.current ^= 1;
    const result = this.buffers[this.current];
    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i], bone = this.bones[i], matrix = bone.matrixWorld, e = matrix.elements;
      transform(definition.start, result[i].start, e); transform(definition.end, result[i].end, e);
      result[i].radius = definition.radius * native.unitScale * matrix.getMaxScaleOnAxis();
    }
    return result;
  }
}
