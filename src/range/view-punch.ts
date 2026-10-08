import type {RecoilAngle} from './recoil';

const f = Math.fround;

/** CS2 build 2000927 camera-only shot kick, independent of aim-punch recovery.
 * 0x1515609 scales each recoil-table magnitude before sin/cos; 0x1525280
 * samples the accumulated camera angle with view_punch_decay = 18. */
export function viewPunchImpulse(angle: number, magnitude: number): RecoilAngle {
  const radians = f(angle * f(Math.PI / 180)), scale = f(f(magnitude) * f(.055));
  return {yaw: f(f(Math.sin(radians)) * scale), pitch: f(f(Math.cos(radians)) * scale)};
}

// Owned by the actor, so holstering a gun cannot freeze or clear its camera kick.
export class ViewPunch {
  private angle: RecoilAngle = {yaw: 0, pitch: 0};
  private at = 0;

  sample(time: number): RecoilAngle {
    const decay = f(Math.exp(-f(Math.max(0, time - this.at) * 18)));
    return {yaw: f(this.angle.yaw * decay), pitch: f(this.angle.pitch * decay)};
  }

  add(impulse: RecoilAngle, time: number) {
    const previous = this.sample(time);
    this.angle = {yaw: f(previous.yaw + impulse.yaw), pitch: f(previous.pitch + impulse.pitch)};
    this.at = time;
  }

  /** Dry, stationary-ground pitch branch at 0x158b920. Landing replaces
   * pitch, preserves decayed yaw, and shares the shot camera's decay. */
  land(fallSpeedUnits: number, time: number) {
    const speed = f(fallSpeedUnits);
    if (!(speed > 250 && speed <= 1024)) return;
    this.angle = {pitch: -Math.max(.75, f(speed * f(.001))), yaw: this.sample(time).yaw};
    this.at = time;
  }

  reset() {this.angle = {yaw: 0, pitch: 0}; this.at = 0;}
}
