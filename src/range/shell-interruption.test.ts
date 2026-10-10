import {describe, expect, it} from 'vitest';
import {defaults} from './config';
import {tickAligned} from './actor-physics';
import {equipmentStats} from './equipment';
import {NativeReloadState} from './weapon-actions';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';

const shells = ['nova', 'xm1014', 'sawedoff'] as const;
function engine(kind: 'range' | 'duel', weapon: typeof shells[number] | 'mag7') {
  const range = kind === 'range' ? new Simulation({...defaults, mode: 'guided', weapon, spread: false, burst: 0}) : undefined;
  const duel = range ? undefined : new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 1, testArena(), weapon);
  const reload = range ? range.reloadState : duel!.actors[0].weapon.reload;
  const shots: number[] = [];
  if (range) {range.active = true; range.onShot = shot => shots.push(shot.at);}
  else {duel!.start(); duel!.actors[0].yaw = Math.PI;}
  const collect = () => {if (duel) for (const event of duel.drainEvents())
    if (event.kind === 'fire' && event.actorId === 0) shots.push(duel.time);};
  return {reload, shots,
    get time() {return range ? range.time : duel!.time;},
    to(at: number) {if (range) range.step(at - range.time); else duel!.step(at - duel!.time, true); collect();},
    startReload() {if (range) range.reload(false); else {duel!.command(0, {reloadPressed: true}); duel!.processInput();} collect();},
    press() {if (range) range.pressTrigger(); else {duel!.command(0, {fireHeld: true, firePressed: true}); duel!.processInput();} collect();},
    release() {if (range) range.release('mouse'); else {duel!.command(0, {fireHeld: false}); duel!.processInput();} collect();},
  };
}

describe('current native loaded-shell interruption', () => {
  it.each(shells)('%s keeps the absolute attack lock, then cancels directly without transferring ammo', weapon => {
    const state = new NativeReloadState(weapon); state.ammo = 2; state.start(10);
    const due = 10 + equipmentStats(weapon).reload;
    expect(state.attackReadyAt).toBe(due);
    state.advance(due - .001); const phase = state.phase;
    expect(state.interrupt()).toBe(false); expect(state.phase).toBe(phase);
    state.advance(due); expect(state.interrupt()).toBe(true);
    expect(state.active).toBe(false); expect(state.ammo).toBe(2); expect(state.reserve).toBe(32);
    expect(state.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-cancel']);
    expect(state.interrupt()).toBe(false);
  });
  for (const kind of ['range', 'duel'] as const) for (const weapon of shells) {
    it(`${kind} ${weapon}: an early held attack waits for the lock, without an outro delay`, () => {
      const sim = engine(kind, weapon); sim.reload.ammo = 2; sim.startReload();
      sim.to(.05); sim.press(); sim.to(.25);
      expect(sim.shots).toEqual([]); expect(sim.reload.active).toBe(true);
      const due = tickAligned(equipmentStats(weapon).reload); sim.to(due);
      expect(sim.shots).toEqual([due]); expect(sim.reload.active).toBe(false); expect(sim.reload.ammo).toBe(1);
    });
    it(`${kind} ${weapon}: a released early tap preserves reload; a later ready tap fires at its edge`, () => {
      const sim = engine(kind, weapon); sim.reload.ammo = 2; sim.startReload();
      sim.to(.05); sim.press(); sim.to(.06); sim.release();
      const at = equipmentStats(weapon).reload + .01; sim.to(at);
      expect(sim.shots).toEqual([]); expect(sim.reload.active).toBe(true);
      sim.press(); sim.release();
      expect(sim.shots).toHaveLength(1); expect(sim.shots[0]).toBeCloseTo(at, 12);
      expect(sim.reload.active).toBe(false); expect(sim.reload.ammo).toBe(1);
    });
    it(`${kind} ${weapon}: a ready input tap cancels and fires in the same call`, () => {
      const sim = engine(kind, weapon); sim.reload.ammo = 2; sim.startReload();
      const at = equipmentStats(weapon).reload + .1; sim.to(at); sim.press(); sim.release();
      expect(sim.shots).toEqual([at]); expect(sim.reload.active).toBe(false);
      expect(sim.reload.ammo).toBe(1); expect(sim.reload.reserve).toBe(32);
    });
  }
  for (const kind of ['range', 'duel'] as const) it(`${kind}: interruption cannot cancel before an existing pump cooldown`, () => {
    const sim = engine(kind, 'nova'); sim.reload.ammo = 4;
    sim.press(); sim.release(); sim.to(.01); sim.startReload();
    sim.to(.7); sim.press();
    expect(sim.shots).toEqual([0]); expect(sim.reload.active).toBe(true);
    const due = tickAligned(equipmentStats('nova').cycle); sim.to(due);
    expect(sim.shots).toEqual([0, due]); expect(sim.reload.active).toBe(false);
  });
  for (const kind of ['range', 'duel'] as const) it(`${kind}: MAG7 stays on the magazine path`, () => {
    const sim = engine(kind, 'mag7'); sim.reload.ammo = 1; sim.startReload();
    sim.to(.05); sim.press(); sim.to(.06); sim.release(); sim.to(.8);
    expect(sim.reload.active).toBe(true); expect(sim.shots).toEqual([]);
    sim.to(2.5); expect(sim.reload.active).toBe(false); expect(sim.shots).toEqual([]);
    sim.to(2.6); sim.press(); expect(sim.shots).toEqual([2.6]);
  });
});
