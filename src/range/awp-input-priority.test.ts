import {describe, expect, it} from 'vitest';
import {defaults, gameData} from './config';
import {Simulation} from './simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';

const cycle = gameData.weapons.awp.cycle;
const actor = {position: {x: 0, y: 1.6256, z: 0}, velocity: {x: 0, z: 0},
  yaw: 0, pitch: 0, feet: 0, grounded: true, verticalVelocity: 0};

describe('AWP primary input priority', () => {
  it.each([0, 1, 2])('fires before a simultaneous ready zoom input from level %i', zoom => {
    const weapon = new DuelWeaponState('awp', () => .5);
    if (zoom) weapon.actions.secondary(.4);
    if (zoom === 2) weapon.actions.secondary(.7);
    const shot = weapon.advance(1, 0, {...idleCommand(), firePressed: true, fireHeld: true,
      secondaryPressed: true, secondaryHeld: true}, actor);
    expect(shot).toBeDefined(); expect(weapon.ammo).toBe(4);
    expect(weapon.actions.pendingZoom).toBe(zoom > 0);
    weapon.advance(1 + cycle, cycle, idleCommand(), actor);
    expect(weapon.actions.zoom).toBe(zoom);
  });

  it.each(['range', 'duel'] as const)('%s blocks a zoom tap while a ready semiautomatic primary stays held', engine => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'awp', spread: false});
    const duel = new DuelWeaponState('awp', () => .5);
    const action = engine === 'range' ? range.actions : duel.actions;
    action.secondary(.4);
    if (engine === 'range') {range.active = true; range.step(1); range.pressTrigger(); range.step(cycle + .02); range.secondary();}
    else {duel.advance(1, 1, {...idleCommand(), fireHeld: true, firePressed: true}, actor);
      duel.advance(1 + cycle + .02, cycle + .02, {...idleCommand(), fireHeld: true, secondaryPressed: true}, actor);}
    expect(action.zoom).toBe(1);
    expect(engine === 'range' ? range.loadedAmmo : duel.ammo).toBe(4);
    // A later secondary input is eligible after releasing primary; no press is queued here.
    if (engine === 'range') {range.release('mouse'); range.secondary();}
    else duel.advance(1 + cycle + .02, 0, {...idleCommand(), secondaryPressed: true}, actor);
    expect(action.zoom).toBe(2);
  });

  it('falls through to eligible secondary when the supplied primary deadline has not passed', () => {
    // Native branch fixture, not a claim this S<P state is reached by ordinary AWP play.
    const weapon = new DuelWeaponState('awp', () => .5);
    weapon.nextShotAt = 2;
    expect(weapon.advance(1, 0, {...idleCommand(), fireHeld: true, secondaryPressed: true}, actor)).toBeUndefined();
    expect(weapon.actions.zoom).toBe(1); expect(weapon.ammo).toBe(5);
  });
});
