import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ViewAnimation} from './view-animation';

function fixture(duration = 1, pickup = false) {
  const root = new THREE.Group(), hand = new THREE.Bone(); hand.name = 'hand'; root.add(hand);
  const names = ['idle', 'draw', 'fire', ...(pickup ? ['pickup'] : [])];
  const clips = names.map(name => new THREE.AnimationClip(name, duration, [
    new THREE.NumberKeyframeTrack('hand.position[x]', [0, duration], name === 'idle' ? [0, 0] : [0, duration]),
  ]));
  return {hand, animation: new ViewAnimation(root, clips)};
}

describe('ordinary draw authored clock', () => {
  it.each(['ak47', 'awp', 'nova', 'xm1014'])('%s keeps native clip seconds after a delayed attachment', equipment => {
    const duration = equipment === 'awp' ? 76 / 60 : 1;
    const remaining = duration - .25, f = fixture(duration);
    f.animation.playDraw(remaining);
    f.animation.update(0, 1, .125, {equipment});
    expect(f.hand.position.x).toBeCloseTo(.125, 7);
    f.animation.update(0, 1, .25, {equipment});
    expect(f.hand.position.x).toBeCloseTo(.375, 7);
    // Readiness and action interruption still own the existing lifetime.
    f.animation.update(0, 1, remaining, {equipment});
    expect(f.animation.activeAction).toBe('idle'); expect(f.hand.position.x).toBe(0);
    f.animation.playDraw(.75); f.animation.update(0, 1, .2, {equipment});
    f.animation.cancel(); f.animation.update(0, 1, .2, {equipment});
    expect(f.animation.activeAction).toBe('idle'); expect(f.hand.position.x).toBe(0);
    f.animation.dispose();
  });

  it('keeps other graph and pickup clocks separate from ordinary audited draws', () => {
    for (const equipment of ['deagle', undefined]) {
      const f = fixture(); f.animation.playDraw(.75);
      f.animation.update(0, 1, .375, {equipment});
      expect(f.hand.position.x).toBeCloseTo(.5, 7); f.animation.dispose();
    }
    for (const pickup of [false, true]) {
      const f = fixture(1, pickup); f.animation.playPickup(.75);
      f.animation.update(0, 1, .375, {equipment: 'ak47'});
      expect(f.hand.position.x).toBeCloseTo(.5, 7); f.animation.dispose();
    }
  });

  it('holds the authored endpoint without extending the requested action', () => {
    const f = fixture(); f.animation.playDraw(2);
    f.animation.update(0, 1, 1.5, {equipment: 'ak47'});
    expect(f.animation.activeAction).toBe('draw'); expect(f.hand.position.x).toBe(1);
    f.animation.update(0, 1, .5, {equipment: 'ak47'});
    expect(f.animation.activeAction).toBe('idle'); f.animation.dispose();
  });
});
