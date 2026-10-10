import {describe, expect, it} from 'vitest';
import fixture from './native-fov-fixture.json';
import {ScopeTransition, interpolateScopeFov, scopeSensitivity, ironSightFov} from './scope-transition';
import {WeaponActions} from './weapon-actions';
import {gameData, defaults} from './config';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';
import {Simulation} from './simulation';

describe('native scope transitions', () => {
  it('matches the hash-pinned native camera arithmetic at all 45 sampled points', () => {
    expect(fixture.build).toBe(2000927);
    for (const row of fixture.samples) {
      expect(interpolateScopeFov(row.start, row.target, row.elapsed, row.duration)).toBeCloseTo(row.fov, 4);
    }
  });
  it('matches native sensitivity arithmetic, including whole-degree steps and unscoped ratio bypass', () => {
    for (const row of fixture.sensitivity.samples) {
      expect(scopeSensitivity(row.fov, row.zoomRatio)).toBeCloseTo(row.scale, 6);
    }
    const action = new WeaponActions('awp');
    action.secondary(1);
    expect(action.sensitivityAt(1, .75)).toBe(1);
    expect(action.sensitivityAt(1.0125, .75)).toBeCloseTo(82 / 90 * .75);
    expect(action.sensitivityAt(1.05, .75)).toBeCloseTo(40 / 90 * .75);
    action.holster(); expect(action.sensitivityAt(2, .75)).toBe(1);
    // Zooming out: the target FOV is 90 again, so sensitivity is back to full while the camera is still widening.
    const out = new WeaponActions('awp');
    out.secondary(1); out.secondary(1.5); out.secondary(2);
    expect(out.zoom).toBe(0); expect(out.fovAt(2.0125)).toBeLessThan(89);
    expect(out.sensitivityAt(2.0125, .75)).toBe(1);
    // Zooming in still follows the transition, and the second level follows it from the first.
    const deeper = new WeaponActions('awp');
    deeper.secondary(1); deeper.secondary(1.5);
    expect(deeper.zoom).toBe(2); expect(deeper.sensitivityAt(1.5125, .75)).toBeCloseTo(Math.max(10, Math.trunc(deeper.fovAt(1.5125))) / 90 * .75);
  });
  it('matches the distinct native iron-sight FOV bias at each sampled amount', () => {
    for (const row of fixture.ironSight.samples) expect(ironSightFov(row.progress, 45)).toBeCloseTo(row.fov, 5);
  });
  it('restarts interrupted transitions from the integer camera FOV', () => {
    const transition = new ScopeTransition();
    transition.to(40, 1, .05);
    expect(transition.at(1.0125)).toBeCloseTo(82.1875, 6);
    transition.to(90, 1.0125, .05);
    expect(transition.at(1.0125)).toBe(82);
    expect(transition.at(1.0375)).toBeCloseTo(86, 6);
  });
  it.each(['awp', 'ssg08', 'g3sg1', 'scar20'] as const)('%s matches the measured sniper scope cycle', id => {
    const action = new WeaponActions(id), data = gameData.weapons[id];
    action.secondary(0);
    expect(action.fovAt(0)).toBe(90);
    expect(action.fovAt(.025)).toBeCloseTo((90 + data.zoomFov[0]) / 2);
    expect(action.fovAt(.05)).toBe(data.zoomFov[0]);
    expect(action.secondary(.299)).toBe(false);
    expect(action.secondary(.3)).toBe(true);
    expect(action.fovAt(.35)).toBeCloseTo(data.zoomFov[1], 6);
    action.secondary(.6);
    const start = id === 'awp' ? 66 : 67;
    expect(action.fovAt(.6)).toBe(start);
    expect(action.fovAt(.625)).toBeCloseTo((start + 90) / 2);
    expect(action.fovAt(.651)).toBe(90);
  });
  it.each(['aug', 'sg553'] as const)('%s uses 100 ms scope-in and 125 ms scope-out without the sniper jump', id => {
    const action = new WeaponActions(id), target = gameData.weapons[id].zoomFov[0];
    action.secondary(0);
    expect(action.fovAt(.05)).toBeCloseTo(90 + (target - 90) * .2);
    expect(action.fovAt(.1)).toBe(target);
    action.secondary(.3);
    expect(action.fovAt(.3)).toBe(target);
    expect(action.fovAt(.3625)).toBeCloseTo(90 + (target - 90) * .2);
    expect(action.fovAt(.425)).toBe(90);
  });
  it.each(['awp', 'ssg08'] as const)('%s unzooms normally after a shot and resumes with the measured 100 ms transition', id => {
    const action = new WeaponActions(id), target = gameData.weapons[id].zoomFov[0];
    action.secondary(0); action.afterShot(1);
    expect(action.fovAt(1)).toBe(target);
    expect(action.fovAt(1.025)).toBeCloseTo((90 + target) / 2);
    const resume = 1 + gameData.weapons[id].alternate.cycle;
    expect(action.nextEventAt).toBe(resume);
    action.advance(resume + .025);
    expect(action.zoom).toBe(1);
    // The verified AWP camera setter starts at the processing call. The SSG's
    // existing approximation is outside this focused correction.
    const start = id === 'awp' ? resume + .025 : resume;
    expect(action.fovAt(start + .025)).toBeCloseTo(90 + (target - 90) * .15625);
    expect(action.fovAt(start + .1)).toBeCloseTo(target);
    action.holster(); action.advance(resume + 1);
    expect(action.nextEventAt).toBe(Infinity); expect(action.fovAt(resume + 1)).toBe(90);
  });
  it.each(['awp', 'ssg08', 'g3sg1', 'scar20', 'aug', 'sg553'] as const)('%s can quickscope before the camera finishes zooming in both simulations', id => {
    const range = new Simulation({...defaults, mode: 'spray', weapon: id, spread: false});
    const duel = new DuelWeaponState(id, () => .5);
    const actor = {position: {x: 0, y: 1.6256, z: 0}, velocity: {x: 0, z: 0},
      yaw: 0, pitch: 0, feet: 0, grounded: true, verticalVelocity: 0};
    const shots: number[] = []; range.onShot = shot => shots.push(shot.at);
    range.actions.secondary(0); range.start();
    expect(shots).toEqual([0]);
    // Separate scope and fire inputs. An atomic AWP command with both buttons
    // gives primary priority and does not zoom before its shot.
    duel.advance(0, 0, {...idleCommand(), secondaryPressed: true}, actor);
    const shot = duel.advance(0, 0, {...idleCommand(), firePressed: true}, actor);
    expect(shot).toBeDefined();
    const until = .3 + gameData.weapons[id].alternate.cycle;
    for (const action of [range.actions, duel.actions]) {
      expect(action.secondaryReadyAt).toBeCloseTo(until);
      expect(action.secondary(until - .001)).toBe(false);
      action.advance(until);
      expect(action.secondary(until)).toBe(true);
    }
  });
});
