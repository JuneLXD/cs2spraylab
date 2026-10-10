import {describe, expect, it} from 'vitest';
import {defaults, gameData, type Weapon} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';

const weapons = ['ak47', 'm4a4', 'm4a1s', 'awp', 'glock', 'usp', 'deagle'] as const;
const engines = ['range', 'duel'] as const;
function make(engine: typeof engines[number], weapon: Weapon) {
  const range = engine === 'range' ? new Simulation({...defaults, weapon, mode: 'guided', spread: false, burst: 0}, () => .5) : undefined;
  const duel = range ? undefined : new DuelSimulation(sanitizeDuelConfig({botCount: 1, roundSeconds: 60}), 1, testArena(), weapon);
  const sim = range ?? duel!, state = range?.reloadState ?? duel!.actors[0].weapon.reload;
  const actions = range?.actions ?? duel!.actors[0].weapon.actions;
  if (range) range.active = true;
  else {duel!.start(); duel!.actors[0].yaw = Math.PI; duel!.command(1, {fireHeld: false});}
  return {sim, state, actions,
    at(time: number) {
      while (sim.time < time - 1e-10) {
        const dt = Math.min(1 / 128, time - sim.time);
        if (range) range.step(dt); else duel!.step(dt, true);
      }
    },
    fire(down: boolean) {
      if (range) {if (down) range.pressTrigger(); else range.release('mouse');}
      else {duel!.command(0, {fireHeld: down, firePressed: down}); duel!.processInput();}
    },
    reload(down: boolean) {
      if (range) {range.reloadHeld = down; if (down) range.reload(true);}
      else {duel!.command(0, {reloadHeld: down, reloadPressed: down}); duel!.processInput();}
    },
    secondaryHeld(down: boolean) {
      if (range) range.secondaryHeld = down;
      else duel!.command(0, {secondaryHeld: down});
    },
  };
}

for (const engine of engines) describe(`${engine} native common-weapon reload input`, () => {
  for (const weapon of weapons) {
    it(`${weapon}: drops R released before the firing cycle ends`, () => {
      const b = make(engine, weapon);
      b.fire(true); b.at(1 / 128); b.fire(false);
      b.at(1 / 32); b.reload(true);
      expect(b.state.active).toBe(false);
      b.at(3 / 64); b.reload(false); b.at(4);
      expect(b.state.active).toBe(false);
      expect(b.state.ammo).toBe(gameData.weapons[weapon].magazine - 1);
    });
    it(`${weapon}: retries held R at readiness without queuing a released tap`, () => {
      const b = make(engine, weapon), due = gameData.weapons[weapon].cycle;
      b.fire(true); b.at(1 / 128); b.fire(false);
      b.at(1 / 32); b.reload(true); b.at(due - .001);
      expect(b.state.active).toBe(false);
      b.at(due);
      expect(b.state.active).toBe(true);
      expect(b.state.startedAt).toBeCloseTo(due, 9);
      expect(b.state.ammo).toBe(gameData.weapons[weapon].magazine - 1);
    });
    it(`${weapon}: accepts a new R press exactly at the firing deadline`, () => {
      const b = make(engine, weapon), due = gameData.weapons[weapon].cycle;
      b.fire(true); b.at(1 / 128); b.fire(false); b.at(due); b.reload(true);
      expect(b.state.active).toBe(true);
      expect(b.state.startedAt).toBeCloseTo(due, 9);
    });
    it(`${weapon}: held primary takes priority over R, including semiautomatic weapons`, () => {
      const b = make(engine, weapon);
      b.fire(true); b.at(1 / 32); b.reload(true); b.at(.8);
      expect(b.state.active).toBe(false);
      b.fire(false); b.at(2);
      expect(b.state.active).toBe(true);
    });
    it(`${weapon}: eligible held secondary consumes R even when it has no action`, () => {
      const b = make(engine, weapon); b.state.ammo--;
      b.secondaryHeld(true); b.reload(true);
      expect(b.state.active).toBe(false);
      b.secondaryHeld(false); b.at(1 / 128);
      expect(b.state.active).toBe(true);
    });
    it(`${weapon}: secondary in cooldown does not block an otherwise ready reload`, () => {
      const b = make(engine, weapon); b.state.ammo--;
      b.actions.secondaryReadyAt = .3;
      b.secondaryHeld(true); b.reload(true);
      expect(b.state.active).toBe(true);
    });
  }
  it('Glock finishes its pending burst before held R can reload', () => {
    const b = make(engine, 'glock');
    b.actions.secondary(0); b.at(.4); b.fire(true);
    b.at(.4 + 1 / 128); b.fire(false); b.reload(true);
    b.at(.7);
    expect(b.state.ammo).toBe(gameData.weapons.glock.magazine - 3);
    expect(b.state.active).toBe(false);
    b.at(.4 + gameData.weapons.glock.burstCycle);
    expect(b.state.active).toBe(true);
  });
});
