import {Euler, Quaternion} from 'three';
import {DEG} from './actor-physics';
import type {RecoilAngle} from './recoil';

export const AIM_PUNCH_CAMERA_SCALE = .45;
export const AIM_PUNCH_VIEWMODEL_SCALE = .325;

// Current native camera and HUD-model paths share combined physical aim punch.
// The model adds its share to the already composed camera's WORLD angles.
// See docs/reaudit-viewmodel-recoil.md; timing and other procedural motion are separate.
export function recoilView(yaw: number, pitch: number, recoil: RecoilAngle & {roll?: number}, kick?: RecoilAngle) {
  return {yaw: yaw - (recoil.yaw * AIM_PUNCH_CAMERA_SCALE + (kick?.yaw ?? 0)) * DEG,
    pitch: pitch + (recoil.pitch * AIM_PUNCH_CAMERA_SCALE + (kick?.pitch ?? 0)) * DEG,
    roll: (recoil.roll ?? 0) * AIM_PUNCH_CAMERA_SCALE * DEG,
    weaponYaw: -recoil.yaw * DEG * AIM_PUNCH_VIEWMODEL_SCALE,
    weaponPitch: recoil.pitch * DEG * AIM_PUNCH_VIEWMODEL_SCALE,
    weaponRoll: (recoil.roll ?? 0) * DEG * AIM_PUNCH_VIEWMODEL_SCALE};
}

const angles = new Euler(0, 0, 0, 'YXZ'), inverseCamera = new Quaternion();

// The weapon scene has a stationary camera. Convert native world-angle addition
// to that scene's camera-relative rotation; subtracting Euler angles loses the
// pitch/yaw coupling and roll when looking up/down. Scratch objects allocate once.
export function applyViewmodelRecoil(target: Quaternion, view: ReturnType<typeof recoilView>, modelPitch = view.pitch) {
  inverseCamera.setFromEuler(angles.set(view.pitch, view.yaw, view.roll)).invert();
  target.setFromEuler(angles.set(modelPitch + view.weaponPitch,
    view.yaw + view.weaponYaw, view.roll + view.weaponRoll)).premultiply(inverseCamera);
}
