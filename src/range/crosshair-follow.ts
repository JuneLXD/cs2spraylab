import {DEG} from './actor-physics';
import type {RecoilAngle} from './recoil';

/** Follow recoil uses the predictable weapon punch; damage remains in the camera. */
export function followCrosshairDirection(yaw: number, pitch: number, recoil: RecoilAngle) {
  const aimYaw = yaw - recoil.yaw * DEG, aimPitch = pitch + recoil.pitch * DEG;
  return {x: -Math.sin(aimYaw) * Math.cos(aimPitch), y: Math.sin(aimPitch), z: -Math.cos(aimYaw) * Math.cos(aimPitch)};
}

/** Native HUD pixel conversion after projecting the predicted recoil direction.
 * The client uses float arithmetic, ceilings, and a one-pixel deadband per axis.
 * Offsets are relative to the CSS 50% origin, including odd viewport dimensions.
 */
export function followCrosshairOffset(projected: {x: number; y: number}, width: number, height: number) {
  const f = Math.fround;
  const x = Math.ceil(f(width * f(.5 * f(1 + f(projected.x)))));
  const y = Math.ceil(f(height - f(height * f(.5 * f(1 + f(projected.y))))));
  const centerX = width / 2, centerY = height / 2;
  return {
    x: (Math.abs(x - centerX) > 1 ? x : Math.trunc(centerX)) - centerX,
    y: (Math.abs(y - centerY) > 1 ? y : Math.trunc(centerY)) - centerY,
  };
}
