import {Matrix4, Quaternion, Vector3} from 'three';
import type {DeathBody} from './death-physics';

export type DeathLimb = {root: string; joint: string; tip: string; maxBend: number; maxSwing: number; maxTwist: number};
type Limb = DeathLimb & {a: number; b: number; c: number; direction: Vector3; normal: Vector3;
  swingCenter: Vector3; initialSwing: number; length: number};

/** Knees/elbows have a signed bend and a transported hinge axis. Distance limits
 * alone cannot distinguish a normal bend from a backwards or sideways one. */
export class LimbConstraints {
  private readonly limbs: Limb[];
  private readonly frame: number[];
  private readonly up = new Vector3();
  private readonly across = new Vector3();
  private readonly forward = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly swing = new Quaternion();
  private readonly limitedSwing = new Quaternion();
  private readonly reference = new Vector3();
  private readonly upper = new Vector3();
  private readonly lower = new Vector3();
  private readonly axis = new Vector3();
  private readonly bend = new Vector3();
  private readonly target = new Vector3();
  private readonly measuredNormal = new Vector3();

  constructor(definitions: readonly DeathLimb[], bodies: readonly DeathBody[], private readonly p: Float64Array,
    private readonly inverseMass: Float64Array) {
    const index = (name: string) => bodies.findIndex(body => body.name === name);
    this.frame = ['pelvis', 'neck_0', 'arm_upper_L', 'arm_upper_R'].map(index);
    if (definitions.length > 4 || (definitions.length && this.frame.some(i => i < 0))) throw new Error('Limb limits require a torso frame and at most four limbs.');
    this.updateFrame();
    const inverse = this.rotation.clone().invert();
    this.limbs = definitions.map(def => {
      const a = index(def.root), b = index(def.joint), c = index(def.tip);
      if (a < 0 || b < 0 || c < 0 || new Set([a, b, c]).size !== 3 ||
        !(def.maxBend > 0 && def.maxBend < Math.PI) || !(def.maxSwing > 0 && def.maxSwing < Math.PI) ||
        !(def.maxTwist >= 0 && def.maxTwist < Math.PI / 2))
        throw new Error('Limb limits require distinct joints and finite angles between zero and pi.');
      this.difference(b, a, this.upper).normalize();
      const length = this.difference(c, b, this.lower).length(); this.lower.normalize();
      this.axis.crossVectors(this.upper, this.lower);
      // A straight limb has no measured bend plane. Use the torso's lateral
      // axis; legs and arms flex in opposite directions.
      if (this.axis.lengthSq() < 1e-6) {
        this.axis.copy(this.across).addScaledVector(this.upper, -this.across.dot(this.upper));
        if (def.root.startsWith('arm_')) this.axis.negate();
      }
      if (this.axis.lengthSq() < 1e-8) this.axis.crossVectors(this.upper, this.forward);
      const direction = this.upper.clone().applyQuaternion(inverse);
      // Hips relax toward the body axis, not the captured crouch. A cone around
      // the crouched thigh can permanently hold a knee beside the chest.
      const swingCenter = def.root.startsWith('leg_') ? new Vector3(-1, 0, 0) : direction.clone();
      return {...def, a, b, c, length, direction, swingCenter, initialSwing: direction.angleTo(swingCenter),
        normal: this.axis.clone().normalize().applyQuaternion(inverse)};
    });
  }

  private difference(a: number, b: number, out: Vector3) {
    return out.set(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2]);
  }
  private updateFrame() {
    if (this.frame.some(i => i < 0)) return;
    const [origin, top, left, right] = this.frame;
    this.difference(top, origin, this.up).normalize();
    this.difference(right, left, this.across).normalize();
    this.forward.crossVectors(this.up, this.across).normalize();
    this.across.crossVectors(this.forward, this.up).normalize();
    this.rotation.setFromRotationMatrix(this.matrix.makeBasis(this.up, this.across, this.forward));
  }
  private orient(limb: Limb) {
    this.difference(limb.b, limb.a, this.upper).normalize();
    this.reference.copy(limb.direction).applyQuaternion(this.rotation);
    this.swing.setFromUnitVectors(this.reference, this.upper);
    this.axis.copy(limb.normal).applyQuaternion(this.rotation).applyQuaternion(this.swing).normalize();
    // Hips/shoulders can roll a little inside their sockets. Both downstream
    // bones share this roll; it must never become sideways knee/elbow flexion.
    this.difference(limb.c, limb.b, this.lower).normalize();
    this.measuredNormal.crossVectors(this.upper, this.lower);
    const bend = this.measuredNormal.length();
    if (bend > 1e-6 && this.measuredNormal.dot(this.axis) > 0) {
      this.measuredNormal.multiplyScalar(1 / bend);
      const twist = Math.atan2(this.target.crossVectors(this.axis, this.measuredNormal).dot(this.upper), this.axis.dot(this.measuredNormal));
      this.axis.applyAxisAngle(this.upper, Math.max(-limb.maxTwist, Math.min(limb.maxTwist, twist)) * Math.min(1, bend / .15));
    }
  }
  /** Same hinge frame drives both bones, preserving the skin's anatomical twist. */
  normal(root: string, out: Vector3) {
    const limb = this.limbs.find(value => value.root === root);
    if (!limb) return undefined;
    this.updateFrame(); this.orient(limb); return out.copy(this.axis);
  }
  solve() {
    this.updateFrame();
    let correction = 0;
    for (const limb of this.limbs) {
      this.orient(limb);
      this.reference.copy(limb.swingCenter).applyQuaternion(this.rotation);
      const angle = this.reference.angleTo(this.upper);
      // Admit the captured crouch throughout the fall. Tightening this cone on a
      // timer would straighten planted legs and lift the body before it lands.
      const maxSwing = Math.max(limb.maxSwing, limb.initialSwing);
      if (angle > maxSwing) {
        const length = this.difference(limb.b, limb.a, this.target).length();
        this.swing.setFromUnitVectors(this.reference, this.upper);
        this.limitedSwing.identity().slerp(this.swing, maxSwing / angle);
        this.target.copy(this.reference).applyQuaternion(this.limitedSwing).multiplyScalar(length).addScaledVector(this.upper, -length);
        correction += this.movePair(limb.a, limb.b, this.target);
        this.orient(limb);
      }
      this.difference(limb.c, limb.b, this.lower).normalize();
      this.bend.crossVectors(this.axis, this.upper).normalize();
      // atan2, rather than acos, distinguishes flexion from hyperextension.
      const flex = Math.atan2(this.lower.dot(this.bend), this.lower.dot(this.upper));
      const bounded = Math.max(0, Math.min(limb.maxBend, flex));
      this.target.copy(this.upper).multiplyScalar(Math.cos(bounded)).addScaledVector(this.bend, Math.sin(bounded)).multiplyScalar(limb.length);
      this.difference(limb.c, limb.b, this.lower); this.target.sub(this.lower);
      correction += this.movePair(limb.b, limb.c, this.target);
    }
    return correction;
  }
  private movePair(a: number, b: number, delta: Vector3) {
    const wa = this.inverseMass[a], wb = this.inverseMass[b], scale = .7 / (wa + wb);
    for (let k = 0; k < 3; k++) {
      const value = delta.getComponent(k) * scale;
      this.p[a * 3 + k] -= value * wa; this.p[b * 3 + k] += value * wb;
    }
    return delta.length();
  }
}
