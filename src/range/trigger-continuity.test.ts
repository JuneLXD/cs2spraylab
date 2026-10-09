import {describe, expect, it} from 'vitest';
import {tickAligned} from './actor-physics';
import {defaults} from './config';
import {Simulation, type Shot} from './simulation';

const make = () => {
  const sim = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', burst: 0, spread: false});
  const shots: Shot[] = []; sim.active = true; sim.onShot = shot => shots.push(shot);
  return {sim, shots};
};
const runTo = (sim: Simulation, time: number) => {
  while (sim.time + sim.accumulator < time - 1e-9) sim.advance(Math.min(.125, time - sim.time - sim.accumulator));
};

describe('physical range trigger across weapon transitions', () => {
  it.each(['before', 'during'] as const)('resumes a trigger pressed %s magazine reload on the ready server tick', press => {
    const {sim, shots} = make(); sim.reloadState.ammo = 5;
    if (press === 'before') sim.pressTrigger();
    sim.reload(); const before = shots.length, due = sim.reloadState.until;
    if (press === 'during') {runTo(sim, .25); expect(sim.pressTrigger()).toBe(false);}
    runTo(sim, tickAligned(due) - 1 / 128); expect(shots).toHaveLength(before);
    runTo(sim, tickAligned(due)); expect(shots).toHaveLength(before + 1);
    expect(shots[before].at).toBeCloseTo(tickAligned(due), 9);
    expect(sim.nextShot).toBeCloseTo(due + sim.stats.cycle, 9);
    runTo(sim, tickAligned(due + sim.stats.cycle)); expect(shots).toHaveLength(before + 2);
  });
  it.each(['before', 'during'] as const)('resumes a trigger pressed %s deploy, preserving its readiness schedule', press => {
    const {sim, shots} = make();
    if (press === 'before') sim.pressTrigger();
    runTo(sim, .023); sim.flushInput(); sim.equip(2); sim.equip(1);
    const before = shots.length, due = sim.equipReadyAt;
    if (press === 'during') expect(sim.pressTrigger()).toBe(false);
    runTo(sim, tickAligned(due) - 1 / 128); expect(shots).toHaveLength(before);
    runTo(sim, tickAligned(due)); expect(shots).toHaveLength(before + 1);
    expect(shots[before].at).toBeCloseTo(tickAligned(due), 9);
    expect(sim.nextShot).toBeCloseTo(due + sim.stats.cycle, 9);
  });
  it('keeps a held trigger through empty-magazine automatic reload', () => {
    const {sim, shots} = make(); sim.reloadState.ammo = 1;
    sim.pressTrigger(); runTo(sim, .125); const due = sim.reloadState.until;
    expect(sim.reloadState.active).toBe(true); expect(shots).toHaveLength(1);
    runTo(sim, tickAligned(due)); expect(shots).toHaveLength(2);
    expect(shots[1].at).toBeCloseTo(tickAligned(due), 9); expect(sim.loadedAmmo).toBe(29);
  });
  it.each(['reload', 'deploy', 'cycle'] as const)('drops a trigger released before %s is ready', transition => {
    const {sim, shots} = make();
    if (transition === 'reload') {sim.reloadState.ammo = 5; sim.reload();}
    else if (transition === 'deploy') {sim.equip(2); sim.equip(1);}
    else {sim.pressTrigger(); sim.release('mouse'); runTo(sim, .03);}
    const before = shots.length;
    sim.pressTrigger(); sim.release('mouse'); runTo(sim, 3.5);
    expect(shots).toHaveLength(before);
  });
  it.each(['cancel', 'reset', 'configure'] as const)('%s clears a waiting physical trigger', action => {
    const {sim, shots} = make(); sim.reloadState.ammo = 5; sim.reload(); sim.pressTrigger();
    if (action === 'configure') sim.configure({...sim.settings}); else sim[action]();
    sim.active = true; runTo(sim, 4); expect(shots).toHaveLength(0);
  });
  it('uses the revised deadline when a held reload changes speed', () => {
    const {sim, shots} = make(); sim.reloadState.ammo = 5; sim.reload(true); sim.pressTrigger();
    runTo(sim, 1); sim.reloadHeld = false;
    sim.step(0); const due = sim.reloadState.until;
    runTo(sim, tickAligned(due) - 1 / 128); expect(shots).toHaveLength(0);
    runTo(sim, tickAligned(due)); expect(shots).toHaveLength(1);
    expect(sim.nextShot).toBeCloseTo(due + sim.stats.cycle, 9);
  });
  it('does not turn a configured practice burst into an endless automatic spray', () => {
    const {sim, shots} = make(); sim.configure({...sim.settings, burst: 3});
    sim.pressTrigger(); runTo(sim, 2); expect(shots).toHaveLength(3);
  });
  it('does not fire again after release during automatic reload', () => {
    const {sim, shots} = make(); sim.reloadState.ammo = 1;
    sim.pressTrigger(); runTo(sim, .125); sim.release('mouse'); runTo(sim, 4);
    expect(shots).toHaveLength(1); expect(sim.loadedAmmo).toBe(30);
  });
});
