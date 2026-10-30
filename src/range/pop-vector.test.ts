import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import type {FlickRecord} from './aim-vector';
import {defaults, sanitizeSettings, type Settings} from './config';
import {DirectionStore, MAX_FLICK_RECORDS} from './direction-store';
import {mouseAngle} from './mouse-look';
import {popConfig} from './pop';
import {popCoreKeys, popVariantPatch} from './pop-presets';
import {VECTOR_BLOCK, VECTOR_REST, VECTOR_TIMEOUT, vectorReach, vectorSizes} from './pop-vector';
import {DEG, Simulation} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';
import {gapText} from './ui/screens/DirectionCalibration';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const base = sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch('vector'), primaryEnabled: false, sidearm: 'usp', spread: false});
const profile = {rotation: 0, right: 1.1, left: .9, up: 1.05, down: .95};
/** A simulation whose shots reach the field as the engine's popShot would send them. */
function setup(patch: Partial<Settings> = {}, seed = 1) {
  const sim = new Simulation(sanitizeSettings({...base, ...patch}), seeded(seed));
  sim.onShot = shot => {for (const direction of shot.pelletDirections ?? [shot.direction]) sim.pop!.hit(shot.origin, direction, shot.maxDistance, shot.at);};
  sim.active = true;
  return sim;
}
const aimAt = (sim: Simulation, p: {x: number; y: number; z: number}) => {
  const dx = p.x - sim.position.x, dy = p.y - sim.position.y, dz = p.z - sim.position.z;
  return {yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz))};
};
/** Rests on the center dot until a target appears (or `limit` seconds pass). */
function waitForTarget(sim: Simulation, limit = 2) {
  for (let t = 0; t < limit && !sim.pop!.balls.length; t += .004) {
    const center = aimAt(sim, sim.pop!.center!); sim.yaw = center.yaw; sim.pitch = center.pitch; sim.advance(.004);
  }
  return sim.pop!.balls[0];
}
/** A moment later, snaps onto the target and shoots it; one simulation step follows the shot. */
function shoot(sim: Simulation, wait = .1) {
  sim.advance(wait);
  const target = aimAt(sim, sim.pop!.balls[0]); sim.yaw = target.yaw; sim.pitch = target.pitch;
  sim.pressTrigger(); sim.release('mouse'); sim.advance(.01);
}
const drain = (sim: Simulation): FlickRecord[] => sim.pop!.vector!.drain();

describe('Direction Calibration exercise', () => {
  it('waits for a settled rest on the center dot before each target', () => {
    const sim = setup();
    expect(sim.pop!.balls).toEqual([]); expect(sim.pop!.center).toBeDefined();
    sim.yaw = 3 * DEG; for (let t = 0; t < 1; t += .004) sim.advance(.004);
    expect(sim.pop!.balls).toEqual([]); expect(sim.pop!.centerProgress).toBe(0);
    const start = sim.time, ball = waitForTarget(sim);
    expect(ball).toBeDefined(); expect(sim.pop!.precisionPhase).toBe('target');
    expect(sim.time - start).toBeGreaterThanOrEqual(VECTOR_REST[0] - .01); expect(sim.time - start).toBeLessThanOrEqual(VECTOR_REST[1] + .02);
  });

  it('places every target at an exact angle from center and covers each direction and size once per round', () => {
    const sim = setup(), seen = new Set<string>(), sizes = vectorSizes(vectorReach(sim.pop!.config));
    expect(sizes).toEqual([4, 8, 12]);
    for (let i = 0; i < 48; i++) {
      const ball = waitForTarget(sim), look = {yaw: sim.yaw, pitch: sim.pitch}, target = aimAt(sim, ball);
      const right = -(target.yaw - look.yaw) / DEG, up = (target.pitch - look.pitch) / DEG;
      shoot(sim);
      const [flick] = drain(sim);
      seen.add(`${flick.dir}:${flick.amp}`);
      expect(Math.hypot(right, up)).toBeCloseTo(flick.amp, 1);
      expect(Math.atan2(up, right)).toBeCloseTo(Math.atan2(Math.sin(flick.dir * Math.PI / 8), Math.cos(flick.dir * Math.PI / 8)), 1);
      // The stored target is the needed movement in mouse space: counts right, counts toward you.
      expect(flick.tx).toBeCloseTo(right, 3); expect(flick.ty).toBeCloseTo(-up, 3);
      expect(flick.radius).toBeCloseTo(Math.atan(.05 / Math.hypot(ball.x - sim.position.x, ball.y - sim.position.y, ball.z - sim.position.z)) / DEG, 3);
      expect(flick.valid).toBe(false); expect(flick.reason).toBe('no movement');
    }
    expect(seen.size).toBe(48); expect(sim.pop!.vector!.flicks).toBe(48); expect(sim.pop!.pops).toBe(48);
  });

  it('records a real flick through the mouse, with and without the profile', () => {
    for (const on of [false, true]) {
      const sim = setup(on ? {directionProfile: profile, directionProfileOn: true} : {}, 4), ball = waitForTarget(sim);
      const start = {yaw: sim.yaw, pitch: sim.pitch}, goal = aimAt(sim, ball), count = mouseAngle(1, sim.settings.sensitivity, sim.settings.mouseYaw);
      // 200 ms reaction, a minimum-jerk first movement 88% of the way, a pause and a correction; counts every 4 ms.
      const jerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
      const at = (t: number) => t < .2 ? 0 : t < .38 ? .88 * jerk((t - .2) / .18) : t < .44 ? .88 : .88 + .12 * jerk(Math.min(1, (t - .44) / .12));
      let previous = 0;
      for (let t = .004; t < .6; t += .004) {
        const fraction = at(t), step = fraction - previous; previous = fraction;
        sim.aim(-(goal.yaw - start.yaw) * step / count, -(goal.pitch - start.pitch) * step / count); sim.advance(.004);
      }
      shoot(sim);
      const [flick] = drain(sim);
      expect(flick.valid).toBe(true); expect(flick.condition).toBe(on ? 'on' : 'off'); expect(flick.shots).toBe(1);
      expect(flick.reaction).toBeGreaterThan(.18); expect(flick.reaction).toBeLessThan(.24);
      expect(Math.hypot(flick.mx, flick.my) / Math.hypot(flick.tx, flick.ty)).toBeCloseTo(.88, 1);
      expect(flick.corrections).toBe(1);
      if (on) {
        expect(flick.profile).toEqual([0, 1.1, .9, 1.05, .95]);
        expect(flick.px).toBeCloseTo(flick.mx * (flick.mx < 0 ? .9 : 1.1), 3); expect(flick.py).toBeCloseTo(flick.my * (flick.my < 0 ? 1.05 : .95), 3);
      } else {expect(flick.px).toBe(flick.mx); expect(flick.profile).toBeUndefined();}
    }
  });

  it('applies the profile to mouse counts before the sensitivity', () => {
    const sim = setup({directionProfile: profile, directionProfileOn: true}), count = mouseAngle(1, 1, .022);
    sim.yaw = sim.pitch = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-110 * count, 9);
    sim.yaw = 0; sim.aim(-100, 0); expect(sim.yaw).toBeCloseTo(90 * count, 9);
    sim.pitch = 0; sim.aim(0, -100); expect(sim.pitch).toBeCloseTo(105 * count, 9);
    sim.settings = {...sim.settings, directionStrength: 0}; sim.yaw = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-100 * count, 9);
    sim.settings = {...sim.settings, directionProfileOn: false, directionStrength: 1}; sim.yaw = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-100 * count, 9);
  });

  it('withdraws a target left too long or one whose profile setting changed', () => {
    const sim = setup();
    waitForTarget(sim);
    for (let t = 0; t < VECTOR_TIMEOUT + .1; t += .01) sim.advance(.01);
    expect(sim.pop!.balls).toEqual([]);
    expect(drain(sim)[0]).toMatchObject({valid: false, reason: 'timeout'});
    waitForTarget(sim);
    sim.settings = {...sim.settings, directionProfile: profile, directionProfileOn: true}; sim.advance(.01);
    expect(sim.pop!.balls).toEqual([]); expect(drain(sim)[0].reason).toBe('profile changed');
  });

  it('holds the next target until recoil has settled', () => {
    const sim = setup({sidearm: 'deagle'});
    waitForTarget(sim); shoot(sim); drain(sim);
    expect(Math.hypot(sim.recoil.yaw, sim.recoil.pitch)).toBeGreaterThan(.05);
    let checked = 0;
    for (let t = 0; t < 3 && !sim.pop!.balls.length; t += .004) {
      const center = aimAt(sim, sim.pop!.center!); sim.yaw = center.yaw; sim.pitch = center.pitch; sim.advance(.004);
      if (sim.pop!.balls.length) {expect(Math.hypot(sim.recoil.yaw, sim.recoil.pitch)).toBeLessThan(.05); checked++;}
    }
    expect(checked).toBe(1);
  });

  it('runs the blind test in balanced blocks and only then applies the profile', () => {
    const sim = setup({directionProfile: profile, directionTest: true}, 6), conditions: string[] = [];
    for (let i = 0; i < VECTOR_BLOCK * 4; i++) {
      waitForTarget(sim);
      expect(!!sim.directionProfileNow()).toBe(sim.pop!.vector!.testOn);
      shoot(sim); conditions.push(drain(sim)[0].condition);
    }
    const blocks = [0, 1, 2, 3].map(b => conditions.slice(b * VECTOR_BLOCK, (b + 1) * VECTOR_BLOCK));
    for (const block of blocks) expect(new Set(block).size).toBe(1);
    expect(new Set([blocks[0][0], blocks[1][0]])).toEqual(new Set(['test-on', 'test-off']));
    expect(new Set([blocks[2][0], blocks[3][0]])).toEqual(new Set(['test-on', 'test-off']));
    sim.reset(); expect(sim.pop!.vector!.flicks).toBe(0); expect(sim.pop!.balls).toEqual([]);
  });
});

describe('Direction Calibration settings', () => {
  it('sanitizes its controls and the profile, and keeps the reach above the floor', () => {
    const clean = sanitizeSettings({popVariant: 'vector', popVectorReach: 50, directionStrength: .33, directionProfile: {right: 9}, directionProfileOn: 'yes', directionTest: 1});
    expect(clean.popVariant).toBe('vector'); expect(clean.popVectorReach).toBe(20); expect(clean.directionStrength).toBe(.35);
    expect(clean.directionProfile.right).toBe(1.25); expect(clean.directionProfileOn).toBe(false); expect(clean.directionTest).toBe(false);
    expect(sanitizeSettings({}).popVectorReach).toBe(12);
    expect(vectorReach(popConfig({...base, popDistance: 20}))).toBeLessThan(4);
    expect(vectorReach(popConfig(base))).toBe(12);
    expect(popCoreKeys).toContain('popVectorReach');
    expect(popVariantPatch('vector')).toMatchObject({popVariant: 'vector', popDistance: 5, popSize: 10, popCount: 1});
    expect(rangeDrillDefaults('pop').popVectorReach).toBe(12);
  });

  it('shows the calibration controls and points to the Aim tab for the results', () => {
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings: base, update: () => {}}));
    expect(html).toContain('Direction Calibration'); expect(html).toContain('Largest flick'); expect(html).toContain('Pause between flicks');
    expect(html).toContain('calibration flicks recorded'); expect(html).toContain('are in the Aim tab');
    // The results themselves (chart, profile, blind test) moved to the Aim tab: see AimScreen.test.ts.
    expect(html).not.toContain('Blind A/B test'); expect(html).not.toContain('Balls at once');
  });

  it('words the gap report by which model wins out of sample', () => {
    // The live probe's simulated player: the four-direction model beats the sixteen-direction one under cross-validation.
    const axisWins = gapText({raw: .0916, iso: .0906, axis: .0818, full: .0837, fixable: .0069, share: 1});
    expect(axisWins).toContain('from 9.1% to 8.2%'); expect(axisWins).toContain('gets all of it');
    expect(axisWins).not.toContain('could add the rest'); expect(axisWins).toContain('The remaining 8.2%');
    const fullWins = gapText({raw: .1, iso: .09, axis: .085, full: .07, fixable: .02, share: .43});
    expect(fullWins).toContain('from 9.0% to 7.0%'); expect(fullWins).toContain('8.5%, 43% of that improvement; finer directional control could add the rest');
    expect(fullWins).toContain('The remaining 7.0%');
    expect(gapText({raw: .1, iso: .09, axis: .0905, full: .0899, fixable: .0001})).toContain('No reliable direction pattern');
  });

  it('stores flicks across sessions, newest kept', () => {
    const data = new Map<string, string>(), storage = {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {data.set(key, value);}};
    const flick: FlickRecord = {at: 1, dir: 0, amp: 8, radius: .5, tx: 8, ty: 0, mx: 7, my: 0, px: 7, py: 0, reaction: .2, total: .5, corrections: 1, shots: 1, condition: 'off', valid: true};
    const store = new DirectionStore(storage);
    store.add([flick, {...flick, at: 2}]);
    expect(new DirectionStore(storage).getSnapshot()).toEqual({records: [flick, {...flick, at: 2}], persisted: true});
    store.add(Array.from({length: MAX_FLICK_RECORDS}, (_, i) => ({...flick, at: 10 + i})));
    expect(store.getSnapshot().records).toHaveLength(MAX_FLICK_RECORDS); expect(store.getSnapshot().records[0].at).toBe(10);
    store.clear(); expect(new DirectionStore(storage).getSnapshot().records).toEqual([]);
    const memory = new DirectionStore(undefined); memory.add([flick]);
    expect(memory.getSnapshot()).toEqual({records: [flick], persisted: false});
  });
});
