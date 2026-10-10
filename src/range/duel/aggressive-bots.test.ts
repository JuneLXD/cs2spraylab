import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import type {BotBehavior} from './config';
import {testArena, type Arena} from './geometry';
import {randomStream} from './rng';
import {createBotTraits} from './skill';
import {TacticalBrain} from './tactics';
import type {DuelActorSnapshot} from './types';

/** The regression arena: a centre wall, and entry/flank/camp/off-angle lanes on both sides. */
const map = (): Arena => ({...testArena(),
  solids: [{center: {x: 0, y: 1.5, z: 0}, size: {x: 6, y: 3, z: 1}}],
  lanes: ([-1, 1] as const).flatMap(side => (['entry', 'flank', 'camp', 'offAngle'] as const).map(role => {
    const x = side * (role === 'camp' ? 3.8 : role === 'flank' ? 9 : 5);
    const z = role === 'camp' ? -8 : -5;
    return {side, role, anchor: {x, y: 0, z}, edge: {x: x + side * .2, y: 0, z},
      retreat: {x: role === 'camp' ? side * 2 : x, y: 0, z: role === 'camp' ? z : z - 1.5}};
  })),
});
/** Where each behavior's opening lane (side +1 for actor 1) puts it: aggressive entry, patient flank, holder camp. */
const anchors: Record<Exclude<BotBehavior, 'mixed'>, {x: number; z: number}> = {aggressive: {x: 5, z: -5}, patient: {x: 9, z: -5}, holder: {x: 3.8, z: -8}};
const actor = (at: {x: number; z: number}): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy',
  position: {x: at.x, y: 64 * UNIT, z: at.z}, feet: 0, grounded: true, velocity: {x: 0, z: 0},
  yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0, health: 100, armor: 100,
  helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
const make = (behavior: Exclude<BotBehavior, 'mixed'>, seed: number) => new TacticalBrain(
  {...createBotTraits(8, seed, 1), recognitionMedianMs: 120}, behavior, 1, randomStream(seed, 'aggressive-bots'), map(), 8, 'ak47', 1);

describe('aggressive duel bots never hold', () => {
  it('leaves its angle within a fraction of a second of reaching it, where a patient bot settles first', () => {
    const actsAt = (behavior: 'aggressive' | 'patient', seed: number) => {
      const brain = make(behavior, seed), bot = actor(anchors[behavior]);
      for (let tick = 0; tick < 4 / STEP; tick++) {
        const time = tick * STEP;
        brain.perceive({time, self: bot, visible: null}); brain.command(bot, time);
        if (brain.phase !== 'approach' && brain.phase !== 'setup') return time;
      }
      return Infinity;
    };
    for (const seed of [3, 7, 11, 19, 42]) {
      expect(actsAt('aggressive', seed), `seed ${seed}`).toBeLessThan(.2);
      expect(actsAt('patient', seed), `seed ${seed}`).toBeGreaterThan(.6);
    }
  });

  it('chases the last sighting when a burst loses its target, where a holder resets to cover', () => {
    const run = (behavior: 'aggressive' | 'holder', seed: number) => {
      const brain = make(behavior, seed), bot = actor(anchors[behavior]);
      const seen = {x: 5, y: 64 * UNIT, z: 8}, during = new Set<string>(), after = new Set<string>(), intents = new Set<string>();
      for (let tick = 0; tick < 4 / STEP; tick++) {
        const time = tick * STEP;
        const visible = time < 1 ? {id: 0, position: seen, aimPoint: seen} : null;
        brain.perceive({time, self: bot, visible}); brain.command(bot, time);
        if (time >= .4 && time < 1) during.add(brain.phase);
        if (time >= 1) {after.add(brain.phase); intents.add(brain.decisionSnapshot().intent);}
      }
      return {during, after, intents, goal: brain['searchGoal'] as {x: number; z: number} | undefined};
    };
    for (const seed of [3, 7, 11]) {
      const aggressive = run('aggressive', seed);
      expect([...aggressive.during], `seed ${seed}`).toEqual(['attack']);
      expect(aggressive.after.has('push'), `seed ${seed}`).toBe(true);
      expect(aggressive.intents.has('seek')).toBe(true);
      expect(aggressive.goal).toMatchObject({x: 5, z: 8});
      const holder = run('holder', seed);
      expect([...holder.during]).toEqual(['attack']);
      expect(holder.after.has('push')).toBe(false);
      expect(holder.after.has('return')).toBe(true);
    }
  });

  it('goes searching as soon as it is back at cover without contact, where a holder sets up again', () => {
    const after = (behavior: 'aggressive' | 'holder', seed: number) => {
      const brain = make(behavior, seed), lane = brain['lane'] as {retreat: {x: number; z: number}};
      const bot = actor(lane.retreat);
      brain.phase = 'return';
      brain.perceive({time: 2, self: bot, visible: null}); brain.command(bot, 2);
      return brain.phase;
    };
    for (const seed of [3, 7, 11, 19]) {
      expect(after('aggressive', seed), `seed ${seed}`).toBe('push');
      expect(['setup', 'approach']).toContain(after('holder', seed));
    }
  });
});
