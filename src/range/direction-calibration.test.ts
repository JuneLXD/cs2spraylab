import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {AimRecorder} from './aim-report';
import type {FlickRecord} from './aim-vector';
import {defaults, sanitizeSettings, type Settings} from './config';
import {activeDirectionProfile, directionCalibration, flickCondition, invertedAxes} from './direction-calibration';
import {DirectionStore, MAX_FLICK_RECORDS} from './direction-store';
import {mouseAngle} from './mouse-look';
import {popVariants} from './pop';
import {popCoreKeys, popVariantPatch} from './pop-presets';
import {DEG, Simulation} from './simulation';
import {gapText} from './ui/screens/DirectionCalibration';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
/** Classic Pop with one small ball, the USP and no spread: every flick goes to the one ball. */
const base = sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch('classic'), popCount: 1, popSize: 10, popDistance: 8, primaryEnabled: false, sidearm: 'usp', spread: false});
const profile = {rotation: 0, right: 1.1, left: .9, up: 1.05, down: .95};

/** A simulation whose shots reach the field and the aim report as the engine's popShot sends them, with calibration recording
 * as the engine sets it up. */
function setup(patch: Partial<Settings> = {}, seed = 1) {
  const sim = new Simulation(sanitizeSettings({...base, ...patch}), seeded(seed));
  sim.aimLog = new AimRecorder(seeded(seed + 1));
  sim.aimLog.calibration = directionCalibration(sim.settings);
  sim.onShot = shot => {
    for (const direction of shot.pelletDirections ?? [shot.direction]) {
      const hit = sim.pop!.hit(shot.origin, direction, shot.maxDistance, shot.at);
      if (hit) sim.aimLog!.hit(shot.aim, sim.popAimKey(hit.ball.id, hit.life), false, hit.popped);
    }
  };
  sim.active = true;
  wait(sim, 1.5);
  return sim;
}
const wait = (sim: Simulation, seconds: number) => {for (let t = 0; t < seconds - 1e-9; t += .004) sim.advance(.004);};
const aimAt = (sim: Simulation, p: {x: number; y: number; z: number}) => {
  const dx = p.x - sim.position.x, dy = p.y - sim.position.y, dz = p.z - sim.position.z;
  return {yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz))};
};
/** Once the weapon can fire again, snaps onto the ball and shoots it; the ball that replaces it is placed `right` and `up` degrees
 * from where you aim. */
function popAndPlace(sim: Simulation, right: number, up: number) {
  wait(sim, .3);
  const before = sim.pop!.balls[0], target = aimAt(sim, before);
  sim.yaw = target.yaw; sim.pitch = target.pitch;
  sim.pressTrigger(); sim.release('mouse');
  const next = sim.pop!.balls[0];
  expect(next.id).not.toBe(before.id);
  const yaw = sim.yaw - right * DEG, pitch = sim.pitch + up * DEG, toward = {x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch)};
  const along = (next.z - sim.position.z) / toward.z;
  next.x = sim.position.x + toward.x * along; next.y = sim.position.y + toward.y * along;
}
/** A real flick through the mouse: after `delay`, a minimum-jerk first movement `reach` of the way, a pause and a correction, counts
 * every 4 ms; then a snap onto the ball and a shot. */
function flickAndShoot(sim: Simulation, reach = .88, delay = .2) {
  const start = {yaw: sim.yaw, pitch: sim.pitch}, goal = aimAt(sim, sim.pop!.balls[0]), count = mouseAngle(1, sim.settings.sensitivity, sim.settings.mouseYaw);
  const jerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
  const at = (t: number) => t < delay ? 0 : t < delay + .18 ? reach * jerk((t - delay) / .18) : t < delay + .24 ? reach : reach + (1 - reach) * jerk(Math.min(1, (t - delay - .24) / .12));
  const settled: boolean[] = [];
  let previous = 0;
  for (let t = .004; t < delay + .4; t += .004) {
    const fraction = at(t), step = fraction - previous; previous = fraction;
    if (step > 0 && !settled.length) settled.push(sim.aimPlayer().settled!);
    sim.aim(-(goal.yaw - start.yaw) * step / count, -(goal.pitch - start.pitch) * step / count); sim.advance(.004);
  }
  wait(sim, .1);
  const target = aimAt(sim, sim.pop!.balls[0]); sim.yaw = target.yaw; sim.pitch = target.pitch;
  sim.pressTrigger(); sim.release('mouse'); sim.advance(.01);
  return settled[0];
}

describe('Direction calibration in every mode, on the range', () => {
  it('records a real flick in classic Pop through the mouse, with and without the profile', () => {
    for (const on of [false, true]) {
      const sim = setup(on ? {directionProfile: profile, directionProfileOn: true} : {}, 4);
      popAndPlace(sim, 6, -3); wait(sim, 1);
      expect(flickAndShoot(sim)).toBe(true);
      const [flick] = sim.aimLog!.drainCalibration();
      expect(flick).toMatchObject({valid: true, condition: on ? 'on' : 'off', shots: 1, corrections: 1, dir: 15});
      expect(flick.tx).toBeCloseTo(6, 1); expect(flick.ty).toBeCloseTo(3, 1); expect(flick.amp).toBeCloseTo(Math.hypot(6, 3), 1);
      expect(Math.hypot(flick.mx, flick.my) / Math.hypot(flick.tx, flick.ty)).toBeCloseTo(.88, 1);
      expect(flick.radius).toBeCloseTo(Math.atan(.05 / 8) / DEG, 2);
      if (on) {
        expect(flick.profile).toEqual([0, 1.1, .9, 1.05, .95]);
        expect(flick.px).toBeCloseTo(flick.mx * 1.1, 3); expect(flick.py).toBeCloseTo(flick.my * .95, 3);
      } else {expect(flick.px).toBe(flick.mx); expect(flick.profile).toBeUndefined();}
      // Nothing is recorded with recording off.
      const off = setup({...(on ? {directionProfile: profile, directionProfileOn: true} : {}), directionCalibrate: false}, 4);
      expect(off.aimLog!.calibration).toBeUndefined();
      popAndPlace(off, 6, -3); wait(off, 1); flickAndShoot(off);
      expect(off.aimLog!.drainCalibration()).toEqual([]);
    }
  });

  it('waits for recoil to settle: a flick started while the Deagle still kicks is not a calibration flick', () => {
    const sim = setup({sidearm: 'deagle'});
    popAndPlace(sim, -7, 4);
    expect(flickAndShoot(sim, .88, .1)).toBe(false);
    expect(sim.aimLog!.drainCalibration()).toEqual([]);
    const targets = sim.aimLog!.targets;
    expect(targets[targets.length - 1]?.flick).toMatchObject({valid: true});
    // The ball that replaced it, after a wait.
    popAndPlace(sim, 5, 5); wait(sim, 1.5);
    expect(flickAndShoot(sim)).toBe(true);
    expect(sim.aimLog!.drainCalibration()).toHaveLength(1);
  });

  it('applies the profile to mouse counts before the sensitivity', () => {
    const sim = setup({directionProfile: profile, directionProfileOn: true}), count = mouseAngle(1, 1, .022);
    sim.yaw = sim.pitch = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-110 * count, 9);
    sim.yaw = 0; sim.aim(-100, 0); expect(sim.yaw).toBeCloseTo(90 * count, 9);
    sim.pitch = 0; sim.aim(0, -100); expect(sim.pitch).toBeCloseTo(105 * count, 9);
    sim.settings = {...sim.settings, directionStrength: 0}; sim.yaw = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-100 * count, 9);
    sim.settings = {...sim.settings, directionProfileOn: false, directionStrength: 1}; sim.yaw = 0; sim.aim(100, 0); expect(sim.yaw).toBeCloseTo(-100 * count, 9);
  });

  it('lets the blind A/B test switch the profile, and files each flick by its hidden block', () => {
    const sim = setup({directionProfile: profile, directionTest: true}, 6);
    for (let i = 0; i < 3; i++) {
      const testOn = sim.aimLog!.testOn;
      expect(sim.directionProfileNow()).toEqual(testOn ? profile : undefined);
      popAndPlace(sim, i % 2 ? 6 : -6, 4); wait(sim, 1); flickAndShoot(sim);
      expect(sim.aimLog!.drainCalibration()[0].condition).toBe(testOn ? 'test-on' : 'test-off');
    }
    // Without recording the test cannot run, so the profile follows its own switch.
    sim.settings = {...sim.settings, directionCalibrate: false};
    expect(sim.directionProfileNow()).toBeUndefined();
  });
});

describe('Direction calibration settings', () => {
  it('works out the profile in use, how a flick is filed and the inverted axes', () => {
    const s = {...base, directionProfile: profile};
    expect(activeDirectionProfile(s, true)).toBeUndefined();
    expect(activeDirectionProfile({...s, directionProfileOn: true}, false)).toEqual(profile);
    expect(flickCondition(s, true)).toBe('off'); expect(flickCondition({...s, directionProfileOn: true}, false)).toBe('on');
    const testing = {...s, directionTest: true};
    expect(activeDirectionProfile(testing, true)).toEqual(profile); expect(activeDirectionProfile(testing, false)).toBeUndefined();
    expect(flickCondition(testing, true)).toBe('test-on'); expect(flickCondition(testing, false)).toBe('test-off');
    expect(flickCondition({...testing, directionCalibrate: false}, true)).toBe('off');
    // A neutral profile is never in use, and never tested.
    expect(activeDirectionProfile({...base, directionProfileOn: true, directionTest: true}, true)).toBeUndefined();
    expect(invertedAxes(base)).toBe(0); expect(invertedAxes({...base, invertX: true})).toBe(1); expect(invertedAxes({...base, invertY: true})).toBe(2);
    expect(invertedAxes({...base, mouseYaw: -.022, sensitivityYScale: -1})).toBe(3);
    expect(directionCalibration({...base, directionCalibrate: false})).toBeUndefined();
    expect(directionCalibration(base)).toEqual({flip: 0});
    expect(directionCalibration({...base, invertY: true, directionProfile: profile, directionStrength: .5})).toEqual({flip: 2,
      profile: [0, Math.round(1.1 ** .5 * 1e4) / 1e4, Math.round(.9 ** .5 * 1e4) / 1e4, Math.round(1.05 ** .5 * 1e4) / 1e4, Math.round(.95 ** .5 * 1e4) / 1e4]});
  });

  it('sanitizes the settings, records by default, and opens a setup saved in the old Pop exercise as Classic Pop', () => {
    const clean = sanitizeSettings({popVariant: 'vector', popSize: 10, popCount: 1, popDistance: 5, popSpacing: 2, directionStrength: .33, directionProfile: {right: 9},
      directionProfileOn: 'yes', directionTest: 1});
    expect(clean).toMatchObject({popVariant: 'classic', popSize: defaults.popSize, popCount: defaults.popCount, popDistance: defaults.popDistance, popSpacing: 2,
      directionCalibrate: true, directionStrength: .35, directionProfileOn: false, directionTest: false});
    expect(clean.directionProfile.right).toBe(1.25);
    expect(sanitizeSettings({}).directionCalibrate).toBe(true); expect(sanitizeSettings({directionCalibrate: false}).directionCalibrate).toBe(false);
    // Other exercises keep their own balls.
    expect(sanitizeSettings({popVariant: 'wide', popSize: 10, popDistance: 5})).toMatchObject({popVariant: 'wide', popSize: 10, popDistance: 5});
    expect(popVariants.map(variant => variant.id)).not.toContain('vector');
    expect(popCoreKeys).not.toContain('popVectorReach');
  });

  it('leaves Pop\'s setup to Pop: no calibration controls there', () => {
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings: base, update: () => {}}));
    expect(html).toContain('Classic Pop');
    for (const text of ['Direction Calibration', 'Largest flick', 'calibration flicks', 'Blind A/B test']) expect(html).not.toContain(text);
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
