import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ViewAnimation} from './view-animation';

const cases = [
  ['m4a4', 34 / 30], ['m4a1s', 34 / 30],
  ['glock', 1], ['usp', 1], ['deagle', 1],
] as const;

function fixture(duration: number) {
  const root = new THREE.Group(), hand = new THREE.Bone();
  hand.name = 'hand'; root.add(hand);
  const clips = ['idle', 'draw', 'fire'].map(name => new THREE.AnimationClip(name, duration, [
    new THREE.NumberKeyframeTrack('hand.position[x]', [0, duration], name === 'idle' ? [0, 0] : [0, duration]),
  ]));
  return {hand, animation: new ViewAnimation(root, clips)};
}

describe('common-weapon ordinary draw clock', () => {
  it.each(cases)('%s does not rush the hand motion after a delayed model attachment', (equipment, duration) => {
    const f = fixture(duration), remaining = duration - .25;
    expect(f.animation.playDraw(remaining)).toBe(true);
    f.animation.update(0, 1, .125, {equipment});
    expect(f.hand.position.x).toBeCloseTo(.125, 7);
    f.animation.update(0, 1, .25, {equipment});
    expect(f.hand.position.x).toBeCloseTo(.375, 7);
    f.animation.update(0, 1, 0, {equipment});
    expect(f.hand.position.x).toBeCloseTo(.375, 7);
    // A rate correction must not extend the caller's existing readiness window.
    f.animation.update(0, 1, remaining, {equipment});
    expect(f.animation.activeAction).toBe('idle');
    expect(f.hand.position.x).toBe(0);
    f.animation.dispose();
  });

  it.each(cases)('%s keeps pickup reuse and firing interruption separate', (equipment, duration) => {
    const f = fixture(duration), remaining = duration - .25;
    f.animation.playPickup(remaining);
    f.animation.update(0, 1, remaining / 2, {equipment});
    expect(f.hand.position.x).toBeCloseTo(duration / 2, 7);
    f.animation.playDraw(remaining);
    f.animation.update(0, 1, .2, {equipment});
    expect(f.animation.playFire(equipment)).toBe(true);
    f.animation.update(0, 1, .1, {equipment});
    expect(f.animation.activeAction).toBe('fire');
    expect(f.hand.position.x).toBeCloseTo(.1, 7);
    f.animation.cancel();
    expect(f.animation.activeAction).toBe('idle');
    expect(f.hand.position.x).toBe(0);
    f.animation.dispose();
  });
});
