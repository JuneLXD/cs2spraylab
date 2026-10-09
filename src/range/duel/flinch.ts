import type {Vec} from '../actor-physics';
import {pistolIds} from '../config';
import type {Equipment} from '../equipment';
import type {Hitgroup} from './types';

export type FlinchSide = 'front' | 'left' | 'right' | 'rear';
export type FlinchFamily = 'rifle' | 'pistol' | 'knife';

/** The world-model animation family CS2 picks flinch variants by: knife, pistol, or the rifle default. */
export function flinchFamily(equipment: Equipment): FlinchFamily {
  return equipment === 'knife' ? 'knife' : pistolIds.some(id => id === equipment) ? 'pistol' : 'rifle';
}

/**
 * Where the shooter stands relative to the victim's facing (yaw as the engine uses it: forward is
 * (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)). Front and rear win on ties.
 */
export function attackSide(victimYaw: number, victim: Vec, shooter: Vec): FlinchSide {
  const dx = shooter.x - victim.x, dz = shooter.z - victim.z;
  const forward = -dx * Math.sin(victimYaw) - dz * Math.cos(victimYaw);
  const right = dx * Math.cos(victimYaw) - dz * Math.sin(victimYaw);
  if (Math.abs(forward) >= Math.abs(right)) return forward >= 0 ? 'front' : 'rear';
  return right > 0 ? 'right' : 'left';
}

/** Which limb a point on the body belongs to: the victim's right side is positive lateral. */
export function limbSide(victimYaw: number, victim: Vec, point: Vec): 'left' | 'right' {
  const dx = point.x - victim.x, dz = point.z - victim.z;
  return dx * Math.cos(victimYaw) - dz * Math.sin(victimYaw) >= 0 ? 'right' : 'left';
}

/**
 * The native clip for a hit: head and chest flinch by attack side, the stomach only from the rear,
 * arms and legs by the limb that was hit. Each exists for the rifle (no suffix), pistol and knife families.
 */
export function flinchClipName(group: Hitgroup, side: FlinchSide, limb: 'left' | 'right', family: FlinchFamily = 'rifle') {
  const suffix = family === 'rifle' ? '' : `_${family}`;
  const variant = side === 'front' ? '' : `_${side}`;
  const stem = group === 'head' ? `flinch_head${variant}`
    : group === 'chest' ? `flinch_chest${variant}`
    : group === 'stomach' ? `flinch_stomach${side === 'rear' ? '_rear' : ''}`
    : group === 'arm' ? `flinch_arm_${limb}` : `flinch_leg_${limb}`;
  return `${stem}${suffix}`;
}

/** Fallbacks when a pack lacks a variant: the family-less clip, then the plain front clip of the group. */
export function flinchCandidates(group: Hitgroup, side: FlinchSide, limb: 'left' | 'right', family: FlinchFamily) {
  const names = [flinchClipName(group, side, limb, family), flinchClipName(group, side, limb, 'rifle'),
    flinchClipName(group, 'front', limb, family), flinchClipName(group, 'front', limb, 'rifle')];
  return names.filter((name, index) => names.indexOf(name) === index);
}
