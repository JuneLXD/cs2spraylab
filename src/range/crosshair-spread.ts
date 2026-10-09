// Dynamic crosshair gap from the live accuracy cone, as the CS2 client does it
// (verified on build 2000930, see docs/native-gameplay-comparison.md, eighth pass):
// the cone (inaccuracy + spread, tangent units) is projected to screen pixels at
// the current field of view, eased into a soft limit, and truncated to whole
// pixels. At the default 4:3 90-degree view the projection is the cone times
// half the screen height over tan(vfov/2), the CS:GO HUD's 320 px per radian at
// 640x480 scaled by height.
import {DEG} from './actor-physics';

export type CrosshairSpread = {inaccuracy: number; spread: number};

/** CS2's cl_crosshair_dynamic_spread_limit default (255) plus its 64 px baseline: the soft limit of the offset. */
export const DYNAMIC_SPREAD_LIMIT_PX = 255 + 64;

/** The cone projected to pixels of a canvas `height` tall, before the limit. */
export function projectCone(cone: CrosshairSpread, height: number, verticalFovDegrees: number) {
  const angle = Math.max(0, Math.min(1, (cone.inaccuracy || 0) + (cone.spread || 0)));
  if (!(height > 0) || !(verticalFovDegrees > 0) || verticalFovDegrees >= 180) return 0;
  return angle * (height / 2) / Math.tan(verticalFovDegrees * DEG / 2);
}

/** Screen-space half-gap added by the current cone, in whole pixels of a canvas `height` tall: past three quarters
 * of the limit the game eases the offset in with limit - (limit - knee) * e^(-(px - knee) / (limit - knee)). */
export function dynamicCrosshairGap(cone: CrosshairSpread, height: number, verticalFovDegrees: number, limit = DYNAMIC_SPREAD_LIMIT_PX) {
  let px = projectCone(cone, height, verticalFovDegrees);
  const knee = limit * .75;
  if (px > knee) px = limit - (limit - knee) * Math.exp(-(px - knee) / (limit - knee));
  return Math.trunc(Math.min(px, limit));
}
