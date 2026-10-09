// Dynamic crosshair gap from the live accuracy cone, as the CS HUD does:
// the cone (inaccuracy + spread, in radians) is projected to screen pixels
// at the current field of view, so the lines move exactly as far as the
// bullets can land. Reference formula: (inaccuracy + spread) * 320 / tan(fov/2)
// in 640x480 pixels, scaled by screen height / 480; at the default 90-degree
// 4:3 field of view that is the cone times half the screen height / tan(vfov/2).
import {DEG} from './actor-physics';

export type CrosshairSpread = {inaccuracy: number; spread: number};

/** Screen-space half-gap added by the current cone, in pixels of a canvas `height` tall. */
export function dynamicCrosshairGap(cone: CrosshairSpread, height: number, verticalFovDegrees: number) {
  const angle = Math.max(0, Math.min(1, (cone.inaccuracy || 0) + (cone.spread || 0)));
  if (!(height > 0) || !(verticalFovDegrees > 0) || verticalFovDegrees >= 180) return 0;
  return angle * (height / 2) / Math.tan(verticalFovDegrees * DEG / 2);
}
