import {describe, expect, it, vi} from 'vitest';
import {STEP, UNIT} from './actor-physics';
import {defaults, gameData} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';

describe('common-weapon shots after a supplied native release', () => {
  // The pinned native release fixtures cross their movement-zero boundary on
  // half-step 26 at these speeds. The preceding endpoint still has movement inaccuracy.
  for (const weapon of ['ak47', 'm4a4', 'm4a1s', 'glock', 'usp', 'deagle', 'awp'] as const) {
    it.each([25, 26])(`${weapon} fires using movement accuracy at release half-step %s`, steps => {
      const speed = gameData.weapons[weapon].speed;
      const range = new Simulation({...defaults, weapon, mode: 'spray', spread: true});
      const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
      const duel = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, weapon);
      duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});
      for (const [sim, actor] of [[range, range], [duel, duel.actors[0]]] as const) {
        sim.time = 1;
        Object.assign(actor, {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: speed * UNIT, z: 0},
          yaw: 0, pitch: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, grounded: true,
          movementTime: 1, friction: {command: 64, state: {active: false, savedFraction: 0, storedSpeed: 0,
            commandMarked: false, previousWish: {x: speed, z: 0}}}});
        for (let n = 0; n < steps; n++) sim.step(STEP);
      }
      expect(range.velocity).toEqual(duel.actors[0].velocity);
      for (const engine of ['range', 'duel'] as const) {
        const recovery = engine === 'range' ? range.recovery : duel.actors[0].weapon.recovery;
        const original = recovery.inaccuracy.bind(recovery);
        const observed: {penalty: number; cone: number; speedRatio: number}[] = [];
        const spy = vi.spyOn(recovery, 'inaccuracy').mockImplementation((...args) => {
          const cone = original(...args);
          observed.push({penalty: recovery.penalty, cone, speedRatio: args[0]});
          return cone;
        });
        const ammo = engine === 'range' ? range.loadedAmmo : duel.actors[0].weapon.ammo;
        if (engine === 'range') range.pressTrigger();
        else {duel.command(0, {fireHeld: true, firePressed: true}); duel.step(0);}
        expect(observed).toHaveLength(1);
        expect(observed[0].speedRatio).toBe(Math.hypot(range.velocity.x, range.velocity.z) / (speed * UNIT));
        if (steps === 25) expect(observed[0].cone).toBeGreaterThan(observed[0].penalty);
        else expect(observed[0].cone).toBe(observed[0].penalty);
        expect(engine === 'range' ? range.loadedAmmo : duel.actors[0].weapon.ammo).toBe(ammo - 1);
        spy.mockRestore();
      }
    });
  }
});
