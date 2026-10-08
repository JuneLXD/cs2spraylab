import {DEG} from './actor-physics';
import type {RecoilAngle} from './recoil';

// Native camera composition (build 2000927, 0x152be73): full camera kick plus
// 0.45 of physical aim punch. Both are presentation only. Weapon model motion
// remains an approximation; the separate .22 model fraction is not measured.
export function recoilView(yaw: number, pitch: number, recoil: RecoilAngle, kick?: RecoilAngle) {
  return {yaw: yaw - (recoil.yaw * .45 + (kick?.yaw ?? 0)) * DEG,
    pitch: pitch + (recoil.pitch * .45 + (kick?.pitch ?? 0)) * DEG,
    weaponYaw: -recoil.yaw * DEG * .22, weaponPitch: recoil.pitch * DEG * .22};
}
