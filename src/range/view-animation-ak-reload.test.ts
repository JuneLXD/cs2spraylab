import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ViewAnimation} from './view-animation';
import {NativeReloadState} from './weapon-actions';

// Linear, synchronized bone tracks make the evaluated pose an independent
// readout of authored seconds, including mixer weighting at either end.
function fixture() {
  const root = new THREE.Group(), hand = new THREE.Bone(), weapon = new THREE.Bone();
  hand.name = 'hand'; weapon.name = 'weapon'; root.add(hand, weapon);
  const clipDuration = 73 / 30;
  const clips = ['idle', 'reload', 'reload-empty'].map(name => new THREE.AnimationClip(name, name === 'idle' ? 0 : clipDuration, [
    new THREE.NumberKeyframeTrack('hand.position[x]', name === 'idle' ? [0] : [0, clipDuration], name === 'idle' ? [0] : [0, clipDuration]),
    new THREE.NumberKeyframeTrack('weapon.position[x]', name === 'idle' ? [0] : [0, clipDuration], name === 'idle' ? [1] : [1, 1 + clipDuration]),
  ]));
  return {hand, weapon, clipDuration, animation: new ViewAnimation(root, clips)};
}

describe('AK magazine reload authored clock', () => {
  it.each([false, true])('reaches the insertion pose when ammo changes (empty=%s)', empty => {
    const f = fixture(), state = new NativeReloadState('ak47');
    state.ammo = empty ? 0 : 1; expect(state.start(0, false)).toBe(true);
    const readyAt = state.until, ammoBefore = state.ammo;
    expect(readyAt).toBeCloseTo(74 / 30, 6);
    let previous = 0;
    for (const elapsed of [0, .03, .5, 1.1]) {
      state.advance(elapsed, false);
      const snapshot = {ammo: state.ammo, reserve: state.reserve, until: state.until, phase: state.phase};
      f.animation.update(state.until - elapsed, state.phaseDuration, elapsed - previous, {
        equipment: 'ak47', reloadPhase: state.phase, reloadProgress: state.progress, reloadEmpty: state.empty,
      });
      const expectedHand = elapsed === .03 ? .015 : elapsed;
      expect(f.hand.position.x).toBeCloseTo(expectedHand, 6);
      expect(f.weapon.position.x - f.hand.position.x).toBeCloseTo(1, 6);
      expect({ammo: state.ammo, reserve: state.reserve, until: state.until, phase: state.phase}).toEqual(snapshot);
      expect(state.ammo).toBe(elapsed < 1.1 ? ammoBefore : 30);
      expect(state.active).toBe(true); expect(state.until).toBe(readyAt);
      previous = elapsed;
    }
    f.animation.dispose();
  });

  it('holds the authored endpoint through the existing tail fade and clears at readiness', () => {
    const f = fixture(), state = new NativeReloadState('ak47');
    state.ammo = 1; state.start(0, false);
    const readyAt = state.until;
    for (const elapsed of [f.clipDuration, readyAt - 1 / 128]) {
      state.advance(elapsed, false);
      f.animation.update(state.until - elapsed, state.phaseDuration, 0, {
        equipment: 'ak47', reloadPhase: state.phase, reloadProgress: state.progress,
      });
      // The pose is already at the clip endpoint; only the pre-existing fade
      // into idle changes across the remaining mechanical lock.
      expect(f.hand.position.x).toBeCloseTo(f.clipDuration * (readyAt - elapsed) / .08, 6);
      expect(f.weapon.position.x - f.hand.position.x).toBeCloseTo(1, 6);
      expect(state.active).toBe(true); expect(state.attackReadyAt).toBe(readyAt);
    }
    state.advance(readyAt, false);
    f.animation.update(0, state.phaseDuration, 0, {equipment: 'ak47', reloadPhase: state.phase});
    expect(state.active).toBe(false); expect(state.ammo).toBe(30);
    expect(f.animation.activeAction).toBe('idle'); expect(f.hand.position.x).toBe(0);
    f.animation.dispose();
  });

  it('preserves proportional sampling for other magazine weapons and legacy callers', () => {
    for (const options of [{equipment: 'awp', reloadPhase: 'magazine' as const}, {equipment: 'ak47'}, {}]) {
      const f = fixture();
      f.animation.update(2, 4, 0, {...options, reloadProgress: .5});
      expect(f.hand.position.x).toBeCloseTo(f.clipDuration / 2, 6);
      expect(f.weapon.position.x - f.hand.position.x).toBeCloseTo(1, 6);
      f.animation.dispose();
    }
  });
});
