import {describe, expect, it} from 'vitest';
import {analyzeFlick, applyDirectionProfile, compareDirectionModels, compareProfileTest, directionProfileFile, directionReport, directionStats,
  fitDirectionProfile, flickLanding, isNeutralProfile, modelExtent, neutralDirectionProfile, rawAccelFields, sanitizeDirectionProfile, sanitizeFlickRecords,
  scaleProfile, summarizeFlicks, type DirectionProfile, type FlickCondition, type FlickEvent, type FlickRecord, type Point} from './aim-vector';

const DEG = Math.PI / 180;
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gaussian = (random: () => number) => () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const rotate = (p: Point, degrees: number): Point => ({x: p.x * Math.cos(degrees * DEG) - p.y * Math.sin(degrees * DEG), y: p.x * Math.sin(degrees * DEG) + p.y * Math.cos(degrees * DEG)});
/** Mouse-space target for a screen direction (no inverted axes): x right, y toward you. */
const targetOf = (dir: number, amp: number): Point => ({x: amp * Math.cos(dir * Math.PI / 8), y: -amp * Math.sin(dir * Math.PI / 8)});
/** The movement that lands exactly on `t` through `profile` (its inverse). */
const inverse = (t: Point, profile: DirectionProfile): Point =>
  rotate({x: t.x / (t.x < 0 ? profile.left : profile.right), y: t.y / (t.y < 0 ? profile.up : profile.down)}, -profile.rotation);

function record(dir: number, amp: number, m: Point, extra: Partial<FlickRecord> = {}): FlickRecord {
  const t = targetOf(dir, amp);
  return {at: 0, dir, amp, radius: .57, tx: t.x, ty: t.y, mx: m.x, my: m.y, px: m.x, py: m.y, reaction: .2, total: .5, corrections: 1, shots: 1,
    condition: 'off', valid: true, ...extra};
}
/** Calibration rounds of a simulated player whose first movements land through `truth` exactly, plus multiplicative distance noise
 * and angular noise. `bend` reshapes the gain by movement direction beyond what any four-direction profile can express. */
function player(truth: DirectionProfile, rounds: number, noise = .08, turnNoise = 2, seed = 3, bend?: (angle: number) => number): FlickRecord[] {
  const normal = gaussian(seeded(seed)), records: FlickRecord[] = [];
  for (let round = 0; round < rounds; round++) for (let dir = 0; dir < 16; dir++) for (const amp of [4, 8, 12]) {
    let m = inverse(targetOf(dir, amp), truth);
    if (bend) {const g = bend(Math.atan2(m.y, m.x)); m = {x: m.x / g, y: m.y / g};}
    const scale = Math.exp(normal() * noise);
    m = rotate({x: m.x * scale, y: m.y * scale}, normal() * turnNoise);
    records.push(record(dir, amp, m));
  }
  return records;
}
const normalized = (p: DirectionProfile) => {
  const scale = Math.sqrt(p.right * p.left);
  return {rotation: p.rotation, right: Math.sqrt(p.right / p.left), left: Math.sqrt(p.left / p.right), up: p.up / scale, down: p.down / scale};
};

/** A synthetic flick: rest for `reaction`, a minimum-jerk first movement covering `extent` of the target (turned by `turn` degrees),
 * a pause, then a minimum-jerk correction onto the target. Mouse events every `step` seconds; `gain` maps base to output deltas. */
function flick(target: Point, {extent = .88, turn = 0, reaction = .2, duration = .18, pause = .06, correction = .12, step = .004, lead = 0,
  gain = (x: number, y: number): [number, number] => [x, y]} = {}) {
  const spawn = 10, primary = rotate({x: target.x * extent, y: target.y * extent}, turn), jerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
  const position = (t: number): Point => {
    if (t < reaction) return lead ? {x: primary.x * lead * (reaction - t) * -1, y: 0} : {x: 0, y: 0};
    if (t < reaction + duration) {const s = jerk((t - reaction) / duration); return {x: primary.x * s, y: primary.y * s};}
    if (t < reaction + duration + pause) return primary;
    const s = jerk(Math.min(1, (t - reaction - duration - pause) / correction));
    return {x: primary.x + (target.x - primary.x) * s, y: primary.y + (target.y - primary.y) * s};
  };
  const end = spawn + reaction + duration + pause + correction + .03, events: FlickEvent[] = [];
  let last = position(0);
  for (let t = step; spawn + t <= end + 1e-9; t += step) {
    const p = position(t), bx = p.x - last.x, by = p.y - last.y, [ox, oy] = gain(bx, by);
    if (bx || by) events.push({t: spawn + t, bx, by, ox, oy});
    last = p;
  }
  return {spawn, end, events};
}

describe('Direction profile: Raw Accel pipeline', () => {
  it('scales each half-axis after rotating, as Raw Accel does', () => {
    const profile = {rotation: 0, right: 1.1, left: .9, up: 1.2, down: .95};
    expect(applyDirectionProfile(10, 0, profile)).toEqual([11, 0]);
    expect(applyDirectionProfile(-10, 0, profile)).toEqual([-9, 0]);
    expect(applyDirectionProfile(0, -10, profile)).toEqual([0, -12]);
    expect(applyDirectionProfile(0, 10, profile)[1]).toBeCloseTo(9.5);
    // Positive rotation turns rightward movement toward you (down on screen), before the down multiplier applies.
    const [x, y] = applyDirectionProfile(10, 0, {...profile, rotation: 90});
    expect(x).toBeCloseTo(0); expect(y).toBeCloseTo(9.5);
    expect(applyDirectionProfile(3, -4, neutralDirectionProfile)).toEqual([3, -4]);
  });

  it('blends with strength and reports the same profile as Raw Accel fields', () => {
    const profile = {rotation: 2, right: 1.04, left: .96, up: 1.1, down: 1.02};
    expect(applyDirectionProfile(10, -10, profile, 0)).toEqual([10, -10]);
    const half = scaleProfile(profile, .5);
    expect(half.right).toBeCloseTo(Math.sqrt(1.04)); expect(half.rotation).toBe(1);
    const fields = rawAccelFields(profile, 800);
    // Raw Accel: x *= dpi; y *= dpi * yx; then negative x *= lr, negative y *= ud.
    const raw = (x: number, y: number) => {
      const r = fields['Degrees of rotation'] * DEG, rx = x * Math.cos(r) - y * Math.sin(r), ry = x * Math.sin(r) + y * Math.cos(r), dpi = fields['Output DPI'] / 800;
      let ox = rx * dpi, oy = ry * dpi * fields['Y/X output DPI ratio (vertical sens multiplier)'];
      if (ox < 0) ox *= fields['L/R output DPI ratio (left sens multiplier)'];
      if (oy < 0) oy *= fields['U/D output DPI ratio (up sens multiplier)'];
      return [ox, oy];
    };
    for (const [x, y] of [[10, 0], [-10, 0], [0, 10], [0, -10], [7, -3], [-5, 6]]) {
      const ours = applyDirectionProfile(x, y, profile), theirs = raw(x, y);
      expect(theirs[0]).toBeCloseTo(ours[0], 3); expect(theirs[1]).toBeCloseTo(ours[1], 3);
    }
  });

  it('keeps applied profiles a correction, not a new sensitivity', () => {
    expect(sanitizeDirectionProfile({rotation: 40, right: 3, left: .1, up: 'x', down: Number.NaN})).toEqual({rotation: 10, right: 1.25, left: .8, up: 1, down: 1});
    expect(sanitizeDirectionProfile(undefined)).toEqual(neutralDirectionProfile);
    expect(isNeutralProfile(sanitizeDirectionProfile({}))).toBe(true);
  });
});

describe('Flick analysis', () => {
  it('finds the reaction, the first movement and the correction', () => {
    const target = targetOf(2, 8), {spawn, end, events} = flick(target);
    const result = analyzeFlick(spawn, end, target, events);
    expect(result.valid).toBe(true);
    // The crosshair leaves its resting place (1% of the distance) a little after the movement begins.
    expect(result.reaction).toBeGreaterThan(.2); expect(result.reaction).toBeLessThan(.24);
    expect(Math.hypot(result.base.x, result.base.y) / 8).toBeCloseTo(.88 * .995, 1);
    expect(result.corrections).toBe(1);
    expect(flickLanding(record(2, 8, result.out)).along).toBeGreaterThan(.86);
    expect(flickLanding(record(2, 8, result.out)).along).toBeLessThan(.89);
  });

  it('measures overshoot and turn, and the profiled movement separately', () => {
    const target = targetOf(5, 12), {spawn, end, events} = flick(target, {extent: 1.15, turn: 6, gain: (x, y) => applyDirectionProfile(x, y, {rotation: 0, right: 1, left: 1, up: 1.1, down: 1})});
    const result = analyzeFlick(spawn, end, target, events), base = record(5, 12, result.base);
    expect(result.valid).toBe(true);
    expect(flickLanding(base).along).toBeCloseTo(1.15 * Math.cos(6 * DEG), 1);
    // Mouse space y points toward you, so a +6 degree mouse-space turn is clockwise on screen.
    expect(flickLanding(base).angle).toBeCloseTo(-6, 0);
    expect(result.out.y).toBeCloseTo(result.base.y * 1.1, 5); expect(result.out.x).toBeCloseTo(result.base.x, 5);
  });

  it('holds up with 60 Hz batched events and a blended correction', () => {
    const target = targetOf(12, 4), {spawn, end, events} = flick(target, {step: 1 / 60, pause: 0, extent: .8});
    const result = analyzeFlick(spawn, end, target, events);
    expect(result.valid).toBe(true);
    const along = flickLanding(record(12, 4, result.out)).along;
    expect(along).toBeGreaterThan(.74); expect(along).toBeLessThan(.9);
  });

  it('keeps a flick whole at a 20 Hz event rate, with a fair reaction time', () => {
    const target = targetOf(9, 8), {spawn, end, events} = flick(target, {step: .05});
    const result = analyzeFlick(spawn, end, target, events);
    expect(result.valid).toBe(true);
    expect(result.reaction).toBeGreaterThan(.15); expect(result.reaction).toBeLessThan(.26);
    const along = flickLanding(record(9, 8, result.out)).along;
    expect(along).toBeGreaterThan(.75); expect(along).toBeLessThan(1.01);
  });

  it('sets aside anticipated, already-moving, missing and wild flicks', () => {
    const target = targetOf(0, 8);
    const early = flick(target, {reaction: .03});
    expect(analyzeFlick(early.spawn, early.end, target, early.events).reason).toBe('anticipated');
    const moving = flick(target, {reaction: .2, lead: 3});
    expect(analyzeFlick(moving.spawn, moving.end, target, moving.events).reason).toBe('moving at start');
    expect(analyzeFlick(10, 11, target, []).reason).toBe('no movement');
    const wild = flick(target, {extent: 3});
    expect(analyzeFlick(wild.spawn, wild.end, target, wild.events).reason).toBe('far off');
    const wrong = flick(target, {turn: 70});
    expect(analyzeFlick(wrong.spawn, wrong.end, target, wrong.events).reason).toBe('wrong direction');
  });
});

describe('Direction profile fit', () => {
  it('recovers a four-direction profile and its rotation from noisy flicks', () => {
    const truth = {rotation: 2, right: 1.04, left: .96, up: 1.08, down: 1.02}, fit = fitDirectionProfile(player(truth, 4))!;
    const expected = normalized(truth);
    expect(fit.n).toBe(192);
    for (const key of ['right', 'left', 'up', 'down'] as const) expect(Math.abs(fit.fitted[key] / expected[key] - 1)).toBeLessThan(.025);
    expect(fit.fitted.rotation).toBeCloseTo(2, 0);
    expect(fit.scale).toBeCloseTo(Math.sqrt(1.04 * .96), 1);
    // With this much evidence the shrinkage changes little.
    expect(Math.abs(fit.profile.up / fit.fitted.up - 1)).toBeLessThan(.01);
    expect(fit.se.asymmetry).toBeGreaterThan(0); expect(fit.se.asymmetry).toBeLessThan(.02);
  });

  it('leaves your sensitivity alone and does not turn noise into a correction', () => {
    const short = player(neutralDirectionProfile, 4).map(r => ({...r, mx: r.mx / 1.1, my: r.my / 1.1, px: r.px / 1.1, py: r.py / 1.1}));
    const fit = fitDirectionProfile(short)!;
    expect(fit.scale).toBeCloseTo(1.1, 1);
    for (const key of ['right', 'left', 'up', 'down'] as const) expect(Math.abs(fit.profile[key] - 1)).toBeLessThan(.03);
    expect(Math.abs(fit.profile.rotation)).toBeLessThan(.6);
    // Few, noisy flicks: the applied profile is pulled further toward no change than the raw fit.
    const noisy = fitDirectionProfile(player(neutralDirectionProfile, 1, .25, 6, 9))!;
    const distance = (p: DirectionProfile) => Math.abs(Math.log(p.up)) + Math.abs(Math.log(p.down)) + Math.abs(Math.log(p.right));
    expect(distance(noisy.profile)).toBeLessThan(distance(noisy.fitted));
    expect(fitDirectionProfile(player(neutralDirectionProfile, 1).slice(0, 47))).toBeUndefined();
  });

  it('says how much of a direction pattern the four-direction profile captures', () => {
    const axis = compareDirectionModels(player({rotation: 0, right: 1.06, left: .94, up: 1.12, down: 1}, 4, .05, 1))!;
    expect(axis.iso).toBeGreaterThan(axis.axis); expect(axis.share).toBeGreaterThan(.8);
    expect(axis.raw).toBeGreaterThanOrEqual(axis.iso - 1e-9);
    // Overshooting only along one diagonal pair is a shape no right/left/up/down multipliers can make.
    const diagonal = compareDirectionModels(player(neutralDirectionProfile, 4, .05, 1, 3, angle => Math.exp(.12 * Math.sin(2 * angle))))!;
    expect(diagonal.fixable).toBeGreaterThan(.02); expect(diagonal.share).toBeLessThan(.35);
    const even = compareDirectionModels(player(neutralDirectionProfile, 4))!;
    expect(even.fixable).toBeLessThan(.006);
  });
});

describe('Direction report', () => {
  it('summarizes directions with intervals and model curves', () => {
    const truth = {rotation: 0, right: 1, left: 1, up: 1.12, down: 1.12}, records = player(truth, 3, .06, 1);
    const stats = directionStats(records);
    expect(stats.map(stat => stat.n)).toEqual(new Array(16).fill(9));
    // Up and down flicks fall about 11% short; right and left land on target.
    expect(stats[4].extent).toBeCloseTo(1 / 1.12, 1); expect(stats[0].extent).toBeCloseTo(1, 1);
    expect(stats[4].low).toBeLessThan(stats[4].extent); expect(stats[4].high).toBeGreaterThan(stats[4].extent);
    const report = directionReport(records);
    expect(report.fit).toBeDefined(); expect(report.full).toBeDefined();
    expect(modelExtent({fit: report.fit!}, Math.PI / 2)).toBeCloseTo(stats[4].extent, 1);
    expect(modelExtent({full: report.full!}, Math.PI / 2)).toBeCloseTo(stats[4].extent, 1);
    const summary = summarizeFlicks(records);
    expect(summary.valid).toBe(144); expect(summary.bias).toBeLessThan(0);
    const file = directionProfileFile(report, report.fit!.profile, 1);
    expect(file.format).toBe('spraylab-direction-profile'); expect(file.profile.up).toBeCloseTo(report.fit!.profile.up, 3);
    expect(file.rawAccel['Y/X output DPI ratio (vertical sens multiplier)']).toBeCloseTo(report.fit!.profile.down / report.fit!.profile.right, 3);
  });

  it('compares the blind test with an interval', () => {
    const times = Array.from({length: 64}, (_, i) => .45 + (i % 8) * .02);
    const test = (on: number, condition: FlickCondition, total: number) => record(0, 8, {x: 8 * on, y: 0}, {condition, total});
    const faster = compareProfileTest([...times.map(t => test(1, 'test-on', t * .88)), ...times.map(t => test(1, 'test-off', t))]);
    expect(faster.ready).toBe(true); expect(faster.time!.estimate).toBeCloseTo(.88, 2); expect(faster.time!.high).toBeLessThan(1);
    const same = compareProfileTest([...times.map(t => test(1, 'test-on', t)), ...times.map(t => test(1, 'test-off', t))]);
    expect(same.time!.low).toBeLessThan(1); expect(same.time!.high).toBeGreaterThan(1);
    expect(compareProfileTest(times.slice(0, 10).map(t => test(1, 'test-on', t)))).toEqual({on: 10, off: 0, ready: false});
  });

  it('only keeps well-formed stored flicks', () => {
    const good = record(3, 8, {x: 1, y: 2}, {profile: [0, 1, 1, 1, 1], flip: 2});
    expect(sanitizeFlickRecords([good, {...good, dir: 16}, {...good, amp: 0}, {...good, condition: 'maybe'}, {...good, tx: Infinity}, null, 'x'])).toEqual([good]);
    expect(sanitizeFlickRecords({})).toEqual([]);
  });
});
