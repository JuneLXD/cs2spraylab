import {Euler, Quaternion, Vector3} from 'three';
import {DEG, UNIT} from './actor-physics';
import {applyViewmodelRecoil, type recoilView} from './view-recoil';

const f = Math.fround, step = f(.1), pitchLimit = f(89.999);

/** Native HUD air state, separate from velocity bob and look sway.
 * Advances once per displayed HUD update, even with zero frame delta.
 * Evidence and prediction/lifecycle limits: docs/reaudit-viewmodel-air.md.
 */
export class ViewmodelAir {
  amount = 0;
  private readonly angles = new Euler(0, 0, 0, 'YXZ');
  private readonly inverseCamera = new Quaternion();
  private readonly offset = new Vector3();

  reset() { this.amount = 0; }

  apply(model: {position: Vector3; quaternion: Quaternion}, view: ReturnType<typeof recoilView>, grounded: boolean) {
    const difference = f((grounded ? 0 : 2) - this.amount);
    this.amount = f(this.amount + Math.max(-step, Math.min(step, difference)));
    // Native pitch is positive down; the air adjustment and clamp precede
    // physical aim punch. The original camera stays unchanged on both paths.
    const sourcePitch = f(f(-view.pitch / DEG) - f(this.amount * f(.2)));
    const modelPitch = -Math.max(-pitchLimit, Math.min(pitchLimit, sourcePitch)) * DEG;
    applyViewmodelRecoil(model.quaternion, view, modelPitch);
    this.inverseCamera.setFromEuler(this.angles.set(view.pitch, view.yaw, view.roll)).invert();
    this.offset.set(0, -f(this.amount * f(.4)) * UNIT, 0).applyQuaternion(this.inverseCamera);
    model.position.add(this.offset);
  }
}
