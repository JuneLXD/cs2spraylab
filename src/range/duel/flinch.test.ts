import {describe, expect, it} from 'vitest';
import {attackSide, flinchCandidates, flinchClipName, flinchFamily, limbSide} from './flinch';

describe('native flinch selection', () => {
  it('picks the family the game picks: knife, pistol, or the rifle default', () => {
    expect(flinchFamily('knife')).toBe('knife');
    expect(flinchFamily('glock')).toBe('pistol'); expect(flinchFamily('deagle')).toBe('pistol');
    expect(flinchFamily('ak47')).toBe('rifle'); expect(flinchFamily('nova')).toBe('rifle'); expect(flinchFamily('zeus')).toBe('rifle');
  });
  it('reads the attack side from the victim facing: front and rear win on ties', () => {
    const victim = {x: 0, y: 0, z: 0};
    // yaw 0 faces -z; the engine aims with yaw = atan2(-dx, -dz).
    expect(attackSide(0, victim, {x: 0, y: 0, z: -5})).toBe('front');
    expect(attackSide(0, victim, {x: 0, y: 0, z: 5})).toBe('rear');
    expect(attackSide(0, victim, {x: 5, y: 0, z: 0})).toBe('right');
    expect(attackSide(0, victim, {x: -5, y: 0, z: 0})).toBe('left');
    expect(attackSide(0, victim, {x: 5, y: 0, z: -5})).toBe('front');
    // Turned to face +x, a shooter at +x is in front and one at -z is on the left.
    const yaw = Math.atan2(-1, -0);
    expect(attackSide(yaw, victim, {x: 5, y: 0, z: 0})).toBe('front');
    expect(attackSide(yaw, victim, {x: 0, y: 0, z: -5})).toBe('left');
  });
  it('names the limb by the hit point on the victim\'s right or left', () => {
    const victim = {x: 2, y: 0, z: 3};
    expect(limbSide(0, victim, {x: 2.2, y: 1, z: 3})).toBe('right');
    expect(limbSide(0, victim, {x: 1.8, y: 1, z: 3})).toBe('left');
    expect(limbSide(Math.PI, victim, {x: 2.2, y: 1, z: 3})).toBe('left');
  });
  it('maps hit groups and sides to the game\'s clip names with family suffixes', () => {
    expect(flinchClipName('head', 'front', 'left')).toBe('flinch_head');
    expect(flinchClipName('head', 'rear', 'left', 'pistol')).toBe('flinch_head_rear_pistol');
    expect(flinchClipName('chest', 'left', 'right', 'knife')).toBe('flinch_chest_left_knife');
    expect(flinchClipName('stomach', 'left', 'left')).toBe('flinch_stomach');
    expect(flinchClipName('stomach', 'rear', 'left')).toBe('flinch_stomach_rear');
    expect(flinchClipName('arm', 'rear', 'right', 'pistol')).toBe('flinch_arm_right_pistol');
    expect(flinchClipName('leg', 'front', 'left')).toBe('flinch_leg_left');
  });
  it('falls back from a family variant to the rifle clip and then to the front clip', () => {
    expect(flinchCandidates('head', 'right', 'left', 'knife')).toEqual(['flinch_head_right_knife', 'flinch_head_right', 'flinch_head_knife', 'flinch_head']);
    expect(flinchCandidates('leg', 'front', 'right', 'rifle')).toEqual(['flinch_leg_right']);
  });
});
