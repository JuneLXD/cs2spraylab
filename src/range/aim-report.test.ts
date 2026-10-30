import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from './actor-physics';
import {aimReport, AimRecorder, type AimPlayer, type AimTarget} from './aim-report';
import {AimReportStore, MAX_AIM_REPORTS, sanitizeAimReports} from './aim-report-store';

const RUN = 215 * UNIT;
/** A point `right` and `up` degrees from straight ahead (yaw 0, pitch 0), `distance` metres from the eye. */
const pointAt = (right: number, up: number, distance = 5) => ({x: Math.sin(right * DEG) * Math.cos(up * DEG) * distance,
  y: 1.6 + Math.sin(up * DEG) * distance, z: -Math.cos(right * DEG) * Math.cos(up * DEG) * distance});
const minimumJerk = (s: number) => {const u = Math.min(1, Math.max(0, s)); return u ** 3 * (10 - 15 * u + 6 * u * u);};

/** A recorder driven at 128 Hz: the crosshair turns with each mouse event, and every step reports you and the targets. */
class Rig {
  recorder = new AimRecorder(); t = 0; yaw = 0; pitch = 0; state: Partial<AimPlayer> = {}; targets: AimTarget[] = [];
  get player(): AimPlayer {
    return {eye: {x: 0, y: 1.6, z: 0}, yaw: this.yaw, pitch: this.pitch, vx: 0, vz: 0, maxSpeed: RUN, forward: 0, side: 0,
      airborne: false, walking: false, ducking: false, ...this.state};
  }
  look(x: number, y: number) {this.yaw -= x * DEG; this.pitch -= y * DEG; this.recorder.look(this.t, x, y);}
  run(until: number, each?: (t: number) => void) {
    while (this.t + 1e-9 < until) {this.t = Math.min(until, this.t + 1 / 128); each?.(this.t); this.recorder.frame(this.t, this.player, this.targets);}
  }
  /** A smooth movement of (x, y) degrees from `from` to `to`, one mouse event per step. */
  flick(x: number, y: number, from: number, to: number) {
    let done = 0;
    this.run(to, t => {const next = minimumJerk((t - from) / (to - from)); if (next > done) {this.look(x * (next - done), y * (next - done)); done = next;}});
  }
  fire(first = true) {return this.recorder.shot(this.t, this.player, 'ak47', first);}
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
