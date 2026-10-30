import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from './actor-physics';
import {aimReport, AimRecorder, CALIBRATION_AMP, DIRECTION_TEST_BLOCK, type AimPlayer, type AimTarget} from './aim-report';
import type {FlickCondition} from './aim-vector';
import {AimReportStore, MAX_AIM_REPORTS, sanitizeAimReports} from './aim-report-store';

const RUN = 215 * UNIT;
/** A point `right` and `up` degrees from straight ahead (yaw 0, pitch 0), `distance` metres from the eye. */
const pointAt = (right: number, up: number, distance = 5) => ({x: Math.sin(right * DEG) * Math.cos(up * DEG) * distance,
  y: 1.6 + Math.sin(up * DEG) * distance, z: -Math.cos(right * DEG) * Math.cos(up * DEG) * distance});
const minimumJerk = (s: number) => {const u = Math.min(1, Math.max(0, s)); return u ** 3 * (10 - 15 * u + 6 * u * u);};

/** A recorder driven at 128 Hz: the crosshair turns with each mouse event, and every step reports you and the targets. */
class Rig {
  recorder = new AimRecorder(); t = 0; yaw = 0; pitch = 0; state: Partial<AimPlayer> = {}; targets: AimTarget[] = [];
  /** With a condition, mouse events carry what Direction Calibration needs (no profile: the same movement); without, they are as touch input. */
  mouse?: FlickCondition;
  get player(): AimPlayer {
    return {eye: {x: 0, y: 1.6, z: 0}, yaw: this.yaw, pitch: this.pitch, vx: 0, vz: 0, maxSpeed: RUN, forward: 0, side: 0,
      airborne: false, walking: false, ducking: false, ...this.state};
  }
  look(x: number, y: number) {this.yaw -= x * DEG; this.pitch -= y * DEG; this.recorder.look(this.t, x, y, this.mouse ? {x, y, condition: this.mouse} : undefined);}
  run(until: number, each?: (t: number) => void) {
    while (this.t + 1e-9 < until) {this.t = Math.min(until, this.t + 1 / 128); each?.(this.t); this.recorder.frame(this.t, this.player, this.targets);}
  }
  /** A smooth movement of (x, y) degrees from `from` to `to`, one mouse event per step. */
  flick(x: number, y: number, from: number, to: number) {
    let done = 0;
    this.run(to, t => {const next = minimumJerk((t - from) / (to - from)); if (next > done) {this.look(x * (next - done), y * (next - done)); done = next;}});
  }
  fire(n = 0) {return this.recorder.shot(this.t, this.player, 'ak47', n);}
}

describe('aim report flicks', () => {
  it('splits a flick to a target that appeared into reaction, first movement, adjusting and confirming', () => {
    const rig = new Rig();
    rig.run(.5);
    rig.targets = [{key: 'a', point: pointAt(10, 0), radius: .03}];
    rig.run(.75);
    rig.flick(9, 0, .75, .95);
    rig.run(1.05);
    rig.flick(1, 0, 1.05, 1.12);
    rig.run(1.2);
    rig.recorder.hit(rig.fire(), 'a', false, true);
    const flick = rig.recorder.done[0].flick!;
    expect(flick).toMatchObject({valid: true, fresh: true, inside: false, corrections: 1});
    expect(flick.amp).toBeCloseTo(10, 1);
    expect(flick.along).toBeCloseTo(.9, 1);
    expect(flick.error).toBeCloseTo(.1, 1);
    expect(flick.before).toBeGreaterThan(.24); expect(flick.before).toBeLessThan(.3);
    // The target is first in view at the step after 0.5 s.
    expect(flick.total).toBeCloseTo(1.2 - (.5 + 1 / 128), 6);
    expect(flick.confirm).toBeGreaterThan(.04); expect(flick.confirm).toBeLessThan(.12);
    expect(flick.before + flick.flick + flick.adjust + (flick.confirm ?? 0)).toBeCloseTo(flick.total, 9);
    const report = aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47'})!;
    expect(report).toMatchObject({shots: 1, hits: 1, targets: 1, cleared: 1, firstShot: 1, flicks: 1, fresh: 1});
    expect(report.reaction).toBeCloseTo(flick.before, 9);
    expect(report.landing).toMatchObject({inside: 0, past: 0, short: 1});
    expect(report.landing!.bias).toBeCloseTo(-.1, 1);
    expect(report.sizes).toEqual([expect.objectContaining({label: '5–12°', n: 1})]);
  });

  it('starts the next flick at the previous kill and does not call a quick start anticipation', () => {
    const rig = new Rig();
    rig.run(.25);
    rig.targets = [{key: 'a', point: pointAt(8, 0), radius: .05}, {key: 'b', point: pointAt(2, 4), radius: .05}];
    rig.run(.5);
    rig.flick(8, 0, .5, .7);
    rig.run(.8);
    rig.recorder.hit(rig.fire(), 'a', false, true);
    rig.targets = rig.targets.filter(target => target.key === 'b');
    // Six degrees left and four up, 23 ms after the kill.
    rig.flick(-6, -4, .823, 1.02);
    rig.run(1.1);
    rig.recorder.hit(rig.fire(), 'b', false, true);
    const flick = rig.recorder.done[1].flick!;
    expect(flick).toMatchObject({valid: true, fresh: false, inside: true});
    expect(flick.before).toBeLessThan(.08);
    expect(flick.total).toBeCloseTo(1.1 - .8, 6);
    expect(flick.along).toBeCloseTo(1, 1);
  });

  it('measures a moving target where the first movement ended, not where it started', () => {
    const rig = new Rig();
    rig.run(.25);
    // The target starts 10 degrees right and drifts right at 10 degrees per second.
    const at = (t: number) => pointAt(10 + Math.max(0, t - .5) * 10, 0);
    rig.targets = [{key: 'a', point: at(.5), radius: .03}];
    rig.run(.5);
    rig.run(.75, t => {rig.targets = [{key: 'a', point: at(t), radius: .03}];});
    // A first movement of 14.5 degrees lands where the target is at 0.95 s, 4.5 degrees past where it was at the start.
    let done = 0;
    rig.run(.95, t => {rig.targets = [{key: 'a', point: at(t), radius: .03}]; const next = minimumJerk((t - .75) / .2); rig.look(14.5 * (next - done), 0); done = next;});
    rig.recorder.hit(rig.fire(), 'a', false, true);
    const flick = rig.recorder.done[0].flick!;
    expect(flick.valid).toBe(true);
    expect(flick.amp).toBeCloseTo(14.5, 0);
    expect(flick.along).toBeCloseTo(1, 1);
    expect(flick.error).toBeLessThan(.03);
  });

  it('does not time a flick whose wait began with the session, but still shows where it landed', () => {
    const rig = new Rig();
    rig.targets = [{key: 'a', point: pointAt(6, 0), radius: .05}, {key: 'b', point: pointAt(-4, 2), radius: .05}];
    rig.run(2);
    rig.flick(6, 0, 2, 2.2); rig.run(2.3);
    rig.recorder.hit(rig.fire(), 'a', false, true);
    rig.targets = rig.targets.filter(target => target.key === 'b');
    rig.flick(-10, -2, 2.32, 2.52); rig.run(2.6);
    rig.recorder.hit(rig.fire(), 'b', false, true);
    const [a, b] = rig.recorder.done;
    expect(a.flick).toMatchObject({valid: true, timed: false}); expect(b.flick).toMatchObject({valid: true, timed: true, fresh: false});
    const report = aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47'})!;
    expect(report).toMatchObject({flicks: 2, hitTimes: 1, phases: {n: 1}});
    expect(report.timeToHit).toBeCloseTo(.3, 6);
    expect(report.landing!.inside).toBe(1);
  });

  it('counts a target the crosshair was already on as placed, not as a flick', () => {
    const rig = new Rig();
    rig.run(.25);
    rig.targets = [{key: 'a', point: pointAt(.2, 0), radius: .1}];
    rig.run(.5);
    rig.recorder.hit(rig.fire(), 'a', true, true);
    const report = aimReport(rig.recorder, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
    expect(rig.recorder.done[0].flick).toMatchObject({valid: false, reason: 'already on target'});
    expect(report).toMatchObject({placed: 1, flicks: 0, heads: 1});
    expect(report.placement).toBeCloseTo(.2, 2);
    // Pop's flick exercises put targets away from the crosshair on purpose: no placement there.
    const pop = aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47', placement: false})!;
    expect(pop.placement).toBeUndefined(); expect(pop.placed).toBeUndefined();
  });
});

describe('aim report movement at the shot', () => {
  /** Strafing right at full speed, then a stop from `at`: `counter` taps the opposite key for 80 ms. */
  const strafe = (counter: boolean, stopAt: number, shotAt: number) => {
    const rig = new Rig();
    rig.run(stopAt, () => {rig.state = {vx: RUN, side: 1};});
    const decay = counter ? .08 : .2;
    rig.run(shotAt, t => {
      const speed = RUN * Math.max(0, 1 - (t - stopAt) / decay);
      rig.state = {vx: speed, side: counter && t - stopAt < .08 ? -1 : 0};
    });
    const index = rig.fire();
    rig.run(shotAt + .3, t => {rig.state = {vx: RUN * Math.max(0, 1 - (t - stopAt) / decay), side: 0};});
    return rig.recorder.shots[index];
  };

  it('calls a stop with the opposite key a counter-strafe and times the shot from accuracy', () => {
    const shot = strafe(true, .5, .6);
    expect(shot).toMatchObject({state: 'stopped', stop: {kind: 'counter'}});
    expect(shot.stop!.since).toBeCloseTo(.1, 1);
    // 34% of the speed is left after 52.8 ms of an 80 ms stop.
    expect(shot.stop!.accurate).toBeGreaterThan(.03); expect(shot.stop!.accurate).toBeLessThan(.06);
  });
  it('marks a shot before the stop is done as early, by how much once you are accurate', () => {
    const shot = strafe(false, .5, .6);
    expect(shot).toMatchObject({state: 'moving', stop: {kind: 'release'}});
    // Releasing takes 132 ms to reach 34% here: 32 ms too early.
    expect(shot.stop!.accurate).toBeLessThan(-.02); expect(shot.stop!.accurate).toBeGreaterThan(-.045);
  });
  it('separates running, jumping and standing shots', () => {
    const rig = new Rig();
    rig.run(.4, () => {rig.state = {vx: RUN, side: 1};});
    const running = rig.recorder.shots[rig.fire()];
    rig.state = {vx: RUN * .5, airborne: true};
    const air = rig.recorder.shots[rig.fire()];
    rig.run(1.5, () => {rig.state = {};});
    const standing = rig.recorder.shots[rig.fire()];
    expect(running).toMatchObject({state: 'moving', stop: {kind: 'none'}});
    expect(air.state).toBe('air'); expect(air.stop).toBeUndefined();
    expect(standing.state).toBe('standing'); expect(standing.stop).toBeUndefined();
  });
  it('measures the target crossing the crosshair at a click, so tracking a moving target counts as settled', () => {
    const rig = new Rig(), at = (t: number) => pointAt(t * 20, 0);
    rig.run(.1);
    rig.run(.6, t => {
      rig.targets = [{key: 'a', point: at(t), radius: .05}];
      const yaw = -t * 20 * DEG;
      rig.look(-(yaw - rig.yaw) / DEG, 0);
    });
    const tracked = rig.recorder.shots[rig.fire()];
    const still = new Rig();
    still.run(.6, t => {still.targets = [{key: 'a', point: at(t), radius: .05}]; still.yaw = -t * 20 * DEG;});
    still.run(.65, t => {still.targets = [{key: 'a', point: at(t), radius: .05}];});
    const behind = still.recorder.shots[still.fire()];
    expect(tracked.target).toBe('a');
    expect(tracked.cross).toBeLessThan(1);
    expect(behind.cross).toBeCloseTo(20, 0);
  });
});

describe('aim report summary and tips', () => {
  it('turns moving and airborne shots into the first tips, with the evidence', () => {
    const rig = new Rig();
    rig.run(.5, () => {rig.state = {vx: RUN, side: 1};});
    for (let i = 0; i < 8; i++) rig.fire();
    rig.state = {airborne: true};
    rig.fire(); rig.fire();
    rig.run(2, () => {rig.state = {};});
    for (let i = 0; i < 10; i++) rig.recorder.hit(rig.fire(), 'none', false, false);
    const report = aimReport(rig.recorder, {mode: 'spray', label: 'Free spray', weapon: 'ak47'})!;
    expect(report.movement).toMatchObject({moving: {shots: 8, hits: 0}, air: {shots: 2}, standing: {shots: 10, hits: 10}});
    expect(report.tips.map(tip => tip.title)).toEqual(['2 shots fired in the air', '40% of your shots were fired while moving']);
    expect(report.tips[1].detail).toContain('they hit 0%, standing or stopped shots 100%');
  });
  it('has no report before a shot or a hit', () => {
    const rig = new Rig();
    rig.targets = [{key: 'a', point: pointAt(5, 0), radius: .05}];
    rig.run(1);
    expect(aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47'})).toBeUndefined();
  });
});

describe('aim report: more metrics', () => {
  /** A point `right` and `up` degrees from where the rig looks now, 8 m away. */
  const ahead = (rig: Rig, right: number, up: number) => {
    const yaw = rig.yaw - right * DEG, pitch = rig.pitch + up * DEG, distance = 8;
    return {x: -Math.sin(yaw) * Math.cos(pitch) * distance, y: 1.6 + Math.sin(pitch) * distance, z: -Math.cos(yaw) * Math.cos(pitch) * distance};
  };

  it('splits a spray by bullet, crouched shots, and misses with the crosshair on the target', () => {
    const rig = new Rig();
    rig.targets = [{key: 'a', point: pointAt(0, 0), radius: .1}];
    rig.run(.3);
    rig.state = {ducking: true};
    for (let n = 0; n < 12; n++) {
      const index = rig.fire(n);
      if (n < 3) rig.recorder.hit(index, 'a', false, false);
      rig.run(rig.t + .1);
    }
    const report = aimReport(rig.recorder, {mode: 'spray', label: 'Free spray', weapon: 'ak47'})!;
    expect(report.bullets).toEqual([{label: '1st', shots: 1, hits: 1}, {label: '2nd–3rd', shots: 2, hits: 2}, {label: '4th–10th', shots: 7, hits: 0}, {label: '11th on', shots: 2, hits: 0}]);
    expect(report.misses).toEqual({n: 9, on: 9, off: 0});
    expect(report.stance).toEqual({crouched: {shots: 12, hits: 3}, walking: {shots: 0, hits: 0}});
    expect(report.tips.map(tip => tip.title)).toContain('Most misses came with the crosshair on the target');
  });

  it('groups flicks by direction and measures throughput, top speed, spread and the two halves', () => {
    const rig = new Rig();
    rig.run(.5);
    const ways: [number, number][] = [[8, 0], [0, 8], [-8, 0], [0, -8], [6, 6], [8, 0], [0, 8], [-8, 0], [0, -8], [-6, -6]];
    ways.forEach(([right, up], i) => {
      rig.targets = [{key: `t${i}`, point: ahead(rig, right, up), radius: .05}];
      const start = rig.t, reaction = .22 + (i % 3) * .02, duration = .18 + (i >= 5 ? -.04 : 0);
      rig.run(start + reaction);
      rig.flick(right, -up, start + reaction, start + reaction + duration);
      rig.run(rig.t + .05);
      rig.recorder.hit(rig.fire(), `t${i}`, false, true);
      rig.targets = [];
      rig.run(rig.t + .6);
    });
    const report = aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47', placement: false})!;
    expect(report.flicks).toBe(10);
    expect(report.directions!.map(entry => [entry.label, entry.n])).toEqual([['Right', 2], ['Up-right', 1], ['Up', 2], ['Left', 2], ['Down-left', 1], ['Down', 2]]);
    // log2(8 / 0.716 + 1) ≈ 3.6 bits over about 0.21 s (first half) and 0.18 s (second half) of movement: synthetic flicks are fast.
    expect(report.throughput).toBeGreaterThan(15); expect(report.throughput).toBeLessThan(23);
    expect(report.peak).toBeGreaterThan(50);
    expect(report.spread!.reaction![0]).toBeLessThanOrEqual(report.reaction!); expect(report.spread!.reaction![1]).toBeGreaterThanOrEqual(report.reaction!);
    expect(report.spread!.scatter).toBeLessThan(.02);
    // The second half's flicks were 40 ms quicker.
    expect(report.halves!.first.flicks).toBe(5); expect(report.halves!.second.time!).toBeLessThan(report.halves!.first.time!);
    expect(report.perMinute).toBeCloseTo(10 / report.seconds * 60, 6);
  });

  it('times counter-strafes separately for strafing left and right', () => {
    const rig = new Rig();
    const stop = (way: 1 | -1, decay: number) => {
      const from = rig.t;
      rig.run(from + .5, () => {rig.state = {vx: way * RUN, side: way};});
      const at = rig.t;
      rig.run(at + .15, () => {const left = Math.max(0, 1 - (rig.t - at) / decay); rig.state = {vx: way * RUN * left, side: rig.t - at < decay ? -way : 0};});
      rig.fire();
      rig.run(rig.t + .8, () => {rig.state = {};});
    };
    for (let i = 0; i < 4; i++) {stop(1, .08); stop(-1, .14);}
    const report = aimReport(rig.recorder, {mode: 'precision', label: 'Counterstrafing practice', weapon: 'ak47'})!;
    expect(report.sides!.right).toMatchObject({n: 4, early: 0}); expect(report.sides!.left).toMatchObject({n: 4, early: 0});
    // 34% of the speed is left after 66% of the stop: 53 ms stopping from the right, 92 ms from the left.
    expect(report.sides!.right!.toAccurate!).toBeLessThan(report.sides!.left!.toAccurate!);
    expect(report.tips.map(tip => tip.title)).toContain('Your stops from strafing left are slower');
  });
});

/** A calibration rig: recording on, a target appearing `right` and `up` degrees away (radius in metres at 5 m), a 90% first
 * movement and a correction, then a shot on it. Returns the calibration flicks kept. */
function calibrated(rig: Rig, right: number, up: number, options: {radius?: number; on?: boolean} = {}) {
  const start = rig.t, key = `t${start}`;
  rig.run(start + .25);
  rig.targets = [{key, point: pointAt(right, up), radius: options.radius ?? .03}];
  rig.run(start + .5);
  rig.flick(right * .9, -up * .9, start + .5, start + .7);
  rig.run(start + .8);
  rig.flick(right * .1, -up * .1, start + .8, start + .87);
  rig.run(start + .95);
  if (options.on === false) {rig.yaw += 2 * DEG; rig.run(start + .96);}
  rig.recorder.hit(rig.fire(), key, false, true);
  rig.targets = [];
  rig.yaw = rig.pitch = 0;
  return rig.recorder.drainCalibration();
}
const calibrationRig = (flip = 0) => {const rig = new Rig(); rig.recorder.calibration = {flip}; rig.mouse = 'off'; rig.run(.1); return rig;};

describe('Direction calibration from every mode', () => {
  it('keeps a clean flick in mouse space: where the target was and where the first movement ended', () => {
    const [flick] = calibrated(calibrationRig(), 10, 0);
    expect(flick).toMatchObject({valid: true, condition: 'off', dir: 0, shots: 1, corrections: 1});
    expect(flick.amp).toBeCloseTo(10, 1); expect(flick.tx).toBeCloseTo(10, 1); expect(flick.ty).toBeCloseTo(0, 2);
    expect(flick.mx / flick.tx).toBeCloseTo(.9, 1); expect(flick.px).toBe(flick.mx); expect(flick.radius).toBeCloseTo(Math.atan(.03 / 5) / DEG, 3);
    expect(flick).not.toHaveProperty('flip'); expect(flick).not.toHaveProperty('profile');
    // Up on screen is toward the top: away from you in mouse space (negative y), screen direction 4 of 16.
    const [up] = calibrated(calibrationRig(), 0, 8);
    expect(up.dir).toBe(4); expect(up.ty).toBeCloseTo(-8, 1); expect(up.my / up.ty).toBeCloseTo(.9, 1);
    // With both axes inverted the mouse moves the other way for the same target, and the record says so.
    const [inverted] = calibrated(calibrationRig(3), 10, 0);
    expect(inverted.flip).toBe(3); expect(inverted.tx).toBeCloseTo(-10, 1); expect(inverted.mx / inverted.tx).toBeCloseTo(.9, 1); expect(inverted.dir).toBe(0);
  });

  it('keeps the profile it was made with, and how it stood', () => {
    const rig = calibrationRig(); rig.recorder.calibration = {flip: 0, profile: [0, 1.1, .9, 1, 1]}; rig.mouse = 'on';
    const [flick] = calibrated(rig, 10, 0);
    expect(flick).toMatchObject({condition: 'on', profile: [0, 1.1, .9, 1, 1]});
    rig.mouse = 'off';
    expect(calibrated(rig, 10, 0)[0]).not.toHaveProperty('profile');
  });

  it('sets aside flicks that do not measure your aim cleanly', () => {
    // Recording off, touch input, a hit with the crosshair off the target.
    const off = calibrationRig(); off.recorder.calibration = undefined;
    expect(calibrated(off, 10, 0)).toEqual([]);
    const touch = calibrationRig(); touch.mouse = undefined;
    expect(calibrated(touch, 10, 0)).toEqual([]);
    expect(calibrated(calibrationRig(), 10, 0, {on: false})).toEqual([]);
    // Too small, too large, or a target too big for the flick.
    expect(calibrated(calibrationRig(), CALIBRATION_AMP[0] * .8, 0)).toEqual([]);
    expect(calibrated(calibrationRig(), CALIBRATION_AMP[1] + 5, 0)).toEqual([]);
    expect(calibrated(calibrationRig(), 10, 0, {radius: .25})).toEqual([]);
    // The profile changed during the first movement.
    const changed = calibrationRig(), start = changed.t;
    changed.run(start + .25); changed.targets = [{key: 'c', point: pointAt(10, 0), radius: .03}];
    changed.run(start + .5);
    let done = 0;
    changed.run(start + .7, t => {
      if (t > start + .6) changed.mouse = 'on';
      const next = minimumJerk((t - start - .5) / .2); if (next > done) {changed.look(9 * (next - done), 0); done = next;}
    });
    changed.run(start + .95); changed.recorder.hit(changed.fire(), 'c', false, true);
    expect(changed.recorder.done[0].flick).toMatchObject({valid: true});
    expect(changed.recorder.drainCalibration()).toEqual([]);
    // Held fire: the crosshair touching the target clears it, which cuts the first movement short.
    const held = calibrationRig(), at = held.t;
    held.run(at + .25); held.targets = [{key: 'h', point: pointAt(10, 0), radius: .03}];
    held.run(at + .5); held.flick(10, 0, at + .5, at + .7);
    for (let i = 0; i < 12; i++) {held.t += 1 / 128; held.recorder.frame(held.t, held.player, held.targets, true);}
    expect(held.recorder.targets.find(track => track.key === 'h')?.flick).toMatchObject({valid: true});
    expect(held.recorder.drainCalibration()).toEqual([]);
  });

  it('needs recoil to have settled before the first movement started', () => {
    const rig = calibrationRig(), start = rig.t;
    rig.state = {settled: false};
    rig.run(start + .25); rig.targets = [{key: 'r', point: pointAt(10, 0), radius: .03}];
    rig.run(start + .5);
    // Still kicking as the movement starts (about 20 ms in, when the crosshair has moved 1% of the way).
    let done = 0;
    rig.run(start + .7, t => {if (t > start + .53) rig.state = {}; const next = minimumJerk((t - start - .5) / .2); if (next > done) {rig.look(9 * (next - done), 0); done = next;}});
    rig.run(start + .95);
    rig.recorder.hit(rig.fire(), 'r', false, true);
    expect(rig.recorder.done[0].flick).toMatchObject({valid: true});
    expect(rig.recorder.drainCalibration()).toEqual([]);
    // Settled long before; a shot that misses while adjusting kicks only after the first movement ended.
    const later = calibrationRig(), at = later.t;
    later.run(at + .25); later.targets = [{key: 's', point: pointAt(10, 0), radius: .03}];
    later.run(at + .5); later.flick(9, 0, at + .5, at + .7);
    later.state = {settled: false}; later.run(at + .8); later.state = {};
    later.flick(1, 0, at + .8, at + .87); later.run(at + .95);
    later.recorder.hit(later.fire(), 's', false, true);
    expect(later.recorder.drainCalibration()).toHaveLength(1);
  });

  it('runs the blind test in hidden blocks: whole blocks with or without the profile, in balanced pairs, anew each session', () => {
    let seed = 7;
    const rig = new Rig(); rig.recorder = new AimRecorder(() => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    rig.recorder.calibration = {flip: 0, profile: [0, 1.1, .9, 1, 1]}; rig.run(.1);
    const conditions: FlickCondition[] = [];
    for (let i = 0; i < DIRECTION_TEST_BLOCK * 4; i++) {
      rig.mouse = rig.recorder.testOn ? 'test-on' : 'test-off';
      const [flick] = calibrated(rig, i % 2 ? 8 : -8, i % 3 ? 4 : -4);
      conditions.push(flick.condition);
    }
    const blocks = [0, 1, 2, 3].map(b => conditions.slice(b * DIRECTION_TEST_BLOCK, (b + 1) * DIRECTION_TEST_BLOCK));
    for (const block of blocks) expect(new Set(block).size).toBe(1);
    expect(new Set([blocks[0][0], blocks[1][0]])).toEqual(new Set(['test-on', 'test-off']));
    expect(new Set([blocks[2][0], blocks[3][0]])).toEqual(new Set(['test-on', 'test-off']));
    rig.recorder.restart();
    expect(rig.recorder.calibrated).toBe(0);
  });

  it('counts the session\'s calibration flicks in its report while recording', () => {
    const rig = calibrationRig();
    calibrated(rig, 10, 0); calibrated(rig, -6, 5);
    expect(aimReport(rig.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47'})!.calibration).toBe(2);
    const off = new Rig(); off.run(.1); calibrated(off, 10, 0);
    expect(aimReport(off.recorder, {mode: 'pop', label: 'Pop', weapon: 'ak47'})).not.toHaveProperty('calibration');
  });
});

describe('aim report store: older reports', () => {
  it('keeps reports saved before the later metrics, and drops a malformed new field', () => {
    const rig = new Rig();
    rig.run(.25); rig.targets = [{key: 'a', point: pointAt(.1, 0), radius: .1}]; rig.run(.5);
    rig.recorder.hit(rig.fire(), 'a', false, true);
    const report = aimReport(rig.recorder, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
    const {bullets, stance, misses, directions, halves, spread, perMinute, throughput, peak, sides, ...older} = report;
    void [bullets, stance, misses, directions, halves, spread, perMinute, throughput, peak, sides];
    expect(sanitizeAimReports([older])).toEqual([older]);
    expect(sanitizeAimReports([{...report, bullets: [{label: '1st', shots: 1, hits: 2}]}])).toEqual([]);
    expect(sanitizeAimReports([{...report, spread: {reaction: [1]}}])).toEqual([]);
  });
});

describe('aim report store', () => {
  const sample = () => {
    const rig = new Rig();
    rig.run(.25); rig.targets = [{key: 'a', point: pointAt(.1, 0), radius: .1}]; rig.run(.5);
    rig.recorder.hit(rig.fire(), 'a', false, true);
    return aimReport(rig.recorder, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
  };
  it('keeps one copy per session, newest first, and survives a reload', () => {
    const data = new Map<string, string>(), storage = {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {data.set(key, value);}};
    const store = new AimReportStore(storage), first = sample(), second = sample();
    store.save(first); store.save(second); store.save({...first, shots: 5, hits: 5});
    expect(store.getSnapshot().reports.map(report => [report.id, report.shots])).toEqual([[first.id, 5], [second.id, 1]]);
    expect(new AimReportStore(storage).getSnapshot()).toMatchObject({persisted: true, reports: [{id: first.id}, {id: second.id}]});
    for (let i = 0; i < MAX_AIM_REPORTS + 5; i++) store.save({...first, id: `r${i}`});
    expect(store.getSnapshot().reports).toHaveLength(MAX_AIM_REPORTS);
  });
  it('drops malformed reports', () => {
    const good = sample();
    expect(sanitizeAimReports([good, {...good, weapon: 'laser'}, {...good, firstShot: 2}, {...good, movement: {}}, {...good, tips: [{tone: 'bad'}]}, null]))
      .toEqual([good]);
    expect(sanitizeAimReports('nope')).toEqual([]);
  });
});
