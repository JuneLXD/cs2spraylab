import {describe, expect, it} from 'vitest';
import {defaults, gameData} from './config';
import {Simulation} from './simulation';
import {WeaponActions} from './weapon-actions';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';

const cycle = gameData.weapons.awp.cycle;
const actor = {position: {x: 0, y: 1.6256, z: 0}, velocity: {x: 0, z: 0},
  yaw: 0, pitch: 0, feet: 0, grounded: true, verticalVelocity: 0};

describe('AWP ordinary attack and rescope clocks', () => {
  it.each([1, 2])('retains the scheduled cycle and a future secondary clock at zoom %i', level => {
    const action = new WeaponActions('awp');
    action.secondary(.5);
    if (level === 2) action.secondary(.85);
    action.afterShot(1.003);
    action.advance(2.458, 2.458, 4);
    const secondary = action.secondaryReadyAt;
    action.afterShot(2.46875, 2.458);
    expect(action.nextEventAt).toBeCloseTo(3.913, 9);
    expect(action.secondaryReadyAt).toBeCloseTo(Math.max(secondary, 2.458) + cycle, 9);
    expect(action.zoom).toBe(0);
    expect(action.fovAt(2.46875 + .05)).toBe(90);
  });

  it('checks the current primary deadline and starts a late FOV transition at the processing call', () => {
    const action = new WeaponActions('awp');
    action.secondary(0); action.afterShot(1);
    const ready = 1 + cycle + .2;
    action.advance(1 + cycle, ready, 4);
    expect(action.zoom).toBe(0); expect(action.pendingZoom).toBe(true);
    action.advance(ready + .025, ready, 4);
    expect(action.zoom).toBe(1); expect(action.pendingZoom).toBe(false);
    expect(action.fovAt(ready + .025)).toBe(90);
    expect(action.fovAt(ready + .05)).toBeCloseTo(82.1875, 8);
    expect(action.fovAt(ready + .125)).toBeCloseTo(40, 8);
  });

  it('consumes an empty-magazine rescope without reviving it on a later refill', () => {
    const action = new WeaponActions('awp');
    action.secondary(0); action.afterShot(1);
    action.advance(1 + cycle - .001, 1 + cycle, 0);
    expect(action.pendingZoom).toBe(true);
    action.advance(1 + cycle, 1 + cycle, 0);
    expect(action.zoom).toBe(0); expect(action.pendingZoom).toBe(false);
    action.advance(4, 1 + cycle, 5);
    expect(action.zoom).toBe(0); expect(action.fovAt(4)).toBe(90);
  });

  it.each(['range', 'duel'] as const)('%s supplies the actual ammo gate after the last shot', engine => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'awp', spread: false});
    const duel = new DuelWeaponState('awp', () => .5);
    const state = engine === 'range' ? range.reloadState : duel.reload;
    const action = engine === 'range' ? range.actions : duel.actions;
    state.ammo = 1; state.reserve = 0;
    action.secondary(0);
    if (engine === 'range') {range.active = true; range.step(1); range.pressTrigger(); range.release('mouse');}
    else expect(duel.advance(1, 1, {...idleCommand(), firePressed: true}, actor)).toBeDefined();
    expect(action.pendingZoom).toBe(true);
    if (engine === 'range') range.step(cycle);
    else duel.advance(1 + cycle, cycle, idleCommand(), actor);
    expect(action.pendingZoom).toBe(false); expect(action.zoom).toBe(0);
  });

  it.each(['range', 'duel'] as const)('%s preserves processing time for a delayed automatic scope transition', engine => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'awp', spread: false});
    const duel = new DuelWeaponState('awp', () => .5);
    const action = engine === 'range' ? range.actions : duel.actions;
    action.secondary(0);
    if (engine === 'range') {range.active = true; range.step(1); range.pressTrigger(); range.release('mouse'); range.step(cycle + .025);}
    else {duel.advance(1, 1, {...idleCommand(), firePressed: true}, actor); duel.advance(1 + cycle + .025, cycle + .025, idleCommand(), actor);}
    expect(action.zoom).toBe(1);
    expect(action.fovAt(1 + cycle + .025)).toBe(90);
    expect(action.fovAt(1 + cycle + .125)).toBeCloseTo(40, 8);
  });
});
