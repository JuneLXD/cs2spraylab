/** Self-contained (config.ts imports it): degrees to radians. */
const DEG = Math.PI / 180;

/** Direction calibration. Corsair's PureVector (made with Aimlabs) writes eight per-direction DPI values into the mouse after
 * five SpiderShot rounds and never shows them. Pop's Direction Calibration measures the same thing in the open: where the
 * first movement of every flick lands, by direction and size, with confidence intervals. The profile it fits is the exact
 * pipeline Raw Accel's signed driver applies, so a profile proven here can run in CS2: a rotation, then separate multipliers
 * for right, left, up and down movement. A smooth 16-direction model is fitted alongside, and cross-validation says how much of
 * your directional error the four-direction profile captures; a blind A/B test says whether it actually helps.
 *
 * Mouse space: x is counts to the right, y counts toward you (down), as Windows and the browser report them. Vectors are the
 * degrees of view rotation those counts produce. A flick's `dir` is a screen direction, counted counterclockwise from screen
 * right in sixteenths of a turn. */

export type Point = {x: number; y: number};
/** Multipliers for movement to the right, left, up (away from you) and down, after rotating the input by `rotation` degrees
 * (positive turns rightward movement downward on screen, as Raw Accel's "Degrees of rotation" does). */
export type DirectionProfile = {rotation: number; right: number; left: number; up: number; down: number};
export const neutralDirectionProfile: DirectionProfile = {rotation: 0, right: 1, left: 1, up: 1, down: 1};
/** A correction, not a new sensitivity: every multiplier within -20% to +25%, the rotation within 10 degrees. */
export const directionLimits = {rotation: 10, gain: [.8, 1.25]} as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clampTo = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export function sanitizeDirectionProfile(raw: unknown): DirectionProfile {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const gain = (value: unknown) => finite(value) ? round(clampTo(value, directionLimits.gain[0], directionLimits.gain[1])) : 1;
  return {rotation: finite(source.rotation) ? round(clampTo(source.rotation, -directionLimits.rotation, directionLimits.rotation), 2) : 0,
    right: gain(source.right), left: gain(source.left), up: gain(source.up), down: gain(source.down)};
}
export const isNeutralProfile = (profile: DirectionProfile) =>
  profile.rotation === 0 && profile.right === 1 && profile.left === 1 && profile.up === 1 && profile.down === 1;
/** The profile at a strength between 0 (no change) and 1: multipliers as powers, the rotation in proportion. */
export function scaleProfile(profile: DirectionProfile, strength: number): DirectionProfile {
  const s = clampTo(strength, 0, 1);
  return {rotation: profile.rotation * s, right: profile.right ** s, left: profile.left ** s, up: profile.up ** s, down: profile.down ** s};
}
export const profileNumbers = (profile: DirectionProfile) => [profile.rotation, profile.right, profile.left, profile.up, profile.down].map(value => round(value));

/** Mouse counts after the profile, in Raw Accel's order (`modify` in common/rawaccel.hpp): rotate the input with the same
 * formula, then scale; the left and up multipliers apply to negative x and y after the rotation. */
export function applyDirectionProfile(dx: number, dy: number, profile: DirectionProfile, strength = 1): [number, number] {
  const p = strength === 1 ? profile : scaleProfile(profile, strength);
  let x = dx, y = dy;
  if (p.rotation) {const r = p.rotation * DEG, c = Math.cos(r), s = Math.sin(r); [x, y] = [x * c - y * s, x * s + y * c];}
  return [x * (x < 0 ? p.left : p.right), y * (y < 0 ? p.up : p.down)];
}

/** The profile as Raw Accel settings.json fields (the key names of its wrapper.cpp): Output DPI carries the right multiplier,
 * the three ratios the other directions, and the rotation is the same angle. `outputDpi` is the Output DPI you play at now
 * (1000 if you never changed it). */
export function rawAccelFields(profile: DirectionProfile, outputDpi = 1000) {
  return {'Output DPI': round(outputDpi * profile.right, 2),
    'Y/X output DPI ratio (vertical sens multiplier)': round(profile.down / profile.right),
    'L/R output DPI ratio (left sens multiplier)': round(profile.left / profile.right),
    'U/D output DPI ratio (up sens multiplier)': round(profile.up / profile.down),
    'Degrees of rotation': round(profile.rotation, 2)};
}

/** Whether a flick ran with the profile applied; 'test-*' flicks belong to the blind A/B test. */
export type FlickCondition = 'off' | 'on' | 'test-off' | 'test-on';
/** One flick as stored. `at` is when (ms since 1970); `dir` its screen direction (0-15) and `amp` its size; `radius` the target's
 * radius (all degrees). In mouse space: `tx/ty` the movement the target needed, `mx/my` where the first movement ended without the
 * profile and `px/py` with it. `reaction` and `total` are seconds from the target appearing to the movement starting and to the
 * hit; `corrections` counts the pushes after the first movement and `shots` the shots fired. `profile` lists the applied rotation
 * and right/left/up/down multipliers; `flip` marks an inverted axis (1 x, 2 y). `reason` says why an invalid flick was set aside. */
export type FlickRecord = {at: number; dir: number; amp: number; radius: number; tx: number; ty: number; mx: number; my: number; px: number; py: number;
  reaction: number; total: number; corrections: number; shots: number; condition: FlickCondition; profile?: number[]; flip?: number; valid: boolean; reason?: string};
const conditions: readonly FlickCondition[] = ['off', 'on', 'test-off', 'test-on'];

/** Stored flicks: malformed entries are dropped and every number must be finite. */
export function sanitizeFlickRecords(raw: unknown): FlickRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: FlickRecord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const numbers = ['at', 'dir', 'amp', 'radius', 'tx', 'ty', 'mx', 'my', 'px', 'py', 'reaction', 'total', 'corrections', 'shots'] as const;
    if (!numbers.every(key => finite(r[key])) || !conditions.includes(r.condition as FlickCondition) || typeof r.valid !== 'boolean') continue;
    if (!Number.isInteger(r.dir) || (r.dir as number) < 0 || (r.dir as number) > 15 || !((r.amp as number) > 0)) continue;
    const profile = Array.isArray(r.profile) && r.profile.length === 5 && r.profile.every(finite) ? r.profile as number[] : undefined;
    records.push({...Object.fromEntries(numbers.map(key => [key, r[key] as number])) as unknown as Pick<FlickRecord, typeof numbers[number]>,
      condition: r.condition as FlickCondition, valid: r.valid, ...(profile ? {profile} : {}),
      ...(r.flip === 1 || r.flip === 2 || r.flip === 3 ? {flip: r.flip} : {}), ...(typeof r.reason === 'string' ? {reason: r.reason.slice(0, 40)} : {})});
  }
  return records;
}

/** One mouse event during a flick, in mouse-space degrees: what its counts would have turned the view without the profile
 * (`bx`, `by`) and what they did with it (`ox`, `oy`). `t` is simulation seconds. */
export type FlickEvent = {t: number; bx: number; by: number; ox: number; oy: number};
export type FlickAnalysis = {valid: boolean; reason?: string; reaction: number; peak: number; base: Point; out: Point; corrections: number};

/** Grid step (s), the event gap assumed when there is only one event (one 60 Hz frame) and the least smoothing (grid steps, 8 ms). */
const GRID = .002, FRAME = 1 / 60, SIGMA = 4;

/** Splits a flick into its first movement and the corrections after it, from the mouse events between the target appearing
 * (`spawn`) and the hit (`end`). The movement is resampled every 2 ms (each event's movement spread over the time since the
 * previous one, at most the typical gap between events) and smoothed in proportion to that gap (at least 8 ms). The first movement
 * is the first push past 30% of the largest; it starts when the crosshair last left its resting place (1% of the distance)
 * before that push's peak
 * and ends where speed falls below 10% of the peak, or at an earlier dip below half of it that a new push follows. Set aside: no clear
 * movement, already moving when the target appeared, a start under 80 ms (anticipated) and a first movement that went far off
 * (under 20% or over 250% of the distance, or more than 45 degrees off). */
export function analyzeFlick(spawn: number, end: number, target: Point, events: readonly FlickEvent[]): FlickAnalysis {
  const amplitude = Math.hypot(target.x, target.y), segment = segmentMovement(spawn, end, amplitude, events);
  const {reaction, peak} = segment;
  const fail = (reason: string): FlickAnalysis => ({valid: false, reason, reaction, peak, base: {x: 0, y: 0}, out: {x: 0, y: 0}, corrections: 0});
  if (!segment.valid) return fail(segment.reason ?? 'unknown');
  const {out} = segment, ux = target.x / amplitude, uy = target.y / amplitude;
  const along = (out.x * ux + out.y * uy) / amplitude;
  if (along < .2 || along > 2.5) return fail('far off');
  if (Math.abs(Math.atan2(ux * out.y - uy * out.x, ux * out.x + uy * out.y)) > 45 * DEG) return fail('wrong direction');
  return {valid: true, reaction, peak, base: segment.base, out, corrections: segment.corrections};
}

/** A first movement found by `segmentMovement`: when it started (`reaction`, seconds after `spawn`) and ended (`stop`, simulation
 * seconds), its peak speed (degrees per second), where it ended without (`base`) and with (`out`) the profile, and the corrections
 * after it. */
export type MovementSegment = {valid: boolean; reason?: string; reaction: number; peak: number; stop: number; base: Point; out: Point; corrections: number};
/** The segmentation behind `analyzeFlick`, for a flick of `amplitude` degrees, without the checks that need the target's direction.
 * `anticipation` is the shortest believable reaction (s): a start sooner than that after a target appears was a guess. Pass 0 when
 * the target was already in view, so a flick that starts the moment the previous target dies is not set aside. */
export function segmentMovement(spawn: number, end: number, amplitude: number, events: readonly FlickEvent[], anticipation = .08): MovementSegment {
  const fail = (reason: string, reaction = 0, peak = 0): MovementSegment => ({valid: false, reason, reaction, peak, stop: spawn, base: {x: 0, y: 0}, out: {x: 0, y: 0}, corrections: 0});
  if (!(amplitude > 0)) return fail('no target');
  if (!(end > spawn)) return fail('instant');
  const cells = Math.min(3000, Math.ceil((end - spawn) / GRID) + 1);
  const partial = Array.from({length: 4}, () => new Float64Array(cells)), step = Array.from({length: 4}, () => new Float64Array(cells));
  // Pointer events come once per displayed frame, so how often they came sets both how far back each one's movement is spread
  // and how much the path is smoothed: at a low frame rate a continuous flick must not fall apart into separate pushes.
  const within = events.filter(event => event.t >= spawn - 1e-9 && event.t <= end + 1e-9), gaps: number[] = [];
  for (let k = 1; k < within.length; k++) if (within[k].t - within[k - 1].t > 1e-6) gaps.push(within[k].t - within[k - 1].t);
  const interval = Math.min(.1, Math.max(GRID, gaps.length ? median(gaps) : FRAME)), sigma = Math.max(SIGMA, Math.round(interval * .75 / GRID));
  let previous = spawn;
  for (const event of within) {
    const start = Math.max(previous, event.t - interval, spawn), duration = event.t - start, deltas = [event.bx, event.by, event.ox, event.oy];
    previous = Math.max(previous, event.t);
    const first = Math.max(0, Math.ceil((start - spawn) / GRID - 1e-9)), last = Math.min(cells - 1, Math.floor((event.t - spawn) / GRID + 1e-9));
    for (let i = first; i <= last; i++) {
      const fraction = duration > 1e-9 ? Math.min(1, (spawn + i * GRID - start) / duration) : 1;
      for (let k = 0; k < 4; k++) partial[k][i] += deltas[k] * fraction;
    }
    if (last + 1 < cells) for (let k = 0; k < 4; k++) step[k][last + 1] += deltas[k];
  }
  const raw = partial.map((values, k) => {
    let sum = 0;
    const position = new Float64Array(cells);
    for (let i = 0; i < cells; i++) {sum += step[k][i]; position[i] = sum + values[i];}
    return position;
  });
  const [bx, by, ox, oy] = raw.map(position => smooth(position, sigma));
  const speed = new Float64Array(cells);
  for (let i = 1; i < cells - 1; i++) speed[i] = Math.hypot(bx[i + 1] - bx[i - 1], by[i + 1] - by[i - 1]) / (2 * GRID);
  if (cells > 2) {speed[0] = speed[1]; speed[cells - 1] = speed[cells - 2];}
  let largest = 0;
  for (let i = 1; i < cells; i++) if (speed[i] > speed[largest]) largest = i;
  if (speed[largest] < Math.max(3, amplitude * 1.5)) return fail('no movement', 0, speed[largest]);
  let early = 0;
  for (let i = 0; i < Math.min(cells, 6); i++) early = Math.max(early, speed[i]);
  if (early > speed[largest] * .25) return fail('moving at start', 0, speed[largest]);
  // The first movement is the first push past 30% of the largest one, up to its own peak: after a badly aimed first movement
  // the correction can be the bigger of the two.
  let top = 0;
  while (top < cells - 1 && speed[top] < speed[largest] * .3) top++;
  while (top < cells - 1 && speed[top + 1] >= speed[top]) top++;
  const peak = speed[top];
  // The reaction ends when the crosshair last left its resting place before that peak (1% of the distance, at least 0.05
  // degrees), read from the path before smoothing so that a low frame rate does not pull it earlier.
  const still = Math.max(amplitude * .01, .05);
  let onset = top;
  while (onset > 0 && Math.hypot(raw[0][onset - 1], raw[1][onset - 1]) > still) onset--;
  const reaction = onset * GRID;
  if (reaction < anticipation) return fail('anticipated', reaction, peak);
  let stop = cells - 1;
  for (let i = top + 1; i < cells - 1; i++) {
    if (speed[i] < peak * .1) {stop = i; break;}
    if (speed[i] < peak * .5 && speed[i] <= speed[i - 1] && speed[i] <= speed[i + 1]) {
      let rise = speed[i];
      for (let j = i + 1; j < Math.min(cells, i + 30); j++) rise = Math.max(rise, speed[j]);
      if (rise >= speed[i] + peak * .1) {stop = i; break;}
    }
  }
  // Each later push past 12% of the peak (hysteresis at 60% of that) is one correction.
  const high = Math.max(peak * .12, 2), low = high * .6;
  let corrections = 0, moving = false;
  for (let i = stop + 1; i < cells; i++) {
    if (!moving && speed[i] > high) {corrections++; moving = true;} else if (moving && speed[i] < low) moving = false;
  }
  return {valid: true, reaction, peak, stop: spawn + stop * GRID, base: {x: bx[stop], y: by[stop]}, out: {x: ox[stop], y: oy[stop]}, corrections};
}

/** Gaussian smoothing over grid steps; the flick starts from rest and its last position holds after the hit. */
function smooth(values: Float64Array, sigma: number) {
  const radius = sigma * 3, kernel = Array.from({length: radius * 2 + 1}, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((sum, value) => sum + value, 0), smoothed = new Float64Array(values.length), last = values.length - 1;
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {const j = i + k; sum += kernel[k + radius] * (j < 0 ? 0 : values[Math.min(j, last)]);}
    smoothed[i] = sum / total;
  }
  return smoothed;
}

type Sample = {m: Point; t: Point; w: number};
/** A model maps the first movement (mouse space, without the profile) to where it would land. */
type AxisModel = DirectionProfile;
/** The full-resolution comparison: the four-direction profile, then a smooth correction over the direction of the corrected
 * movement (a turn and a Fourier gain up to the third harmonic, 16 directions' worth of shape without one free number per
 * direction). It can do everything the four-direction profile does and more, so the gap between them is what finer
 * directional control (an Interception driver or PureVector's firmware) could add. */
export type FullModel = {axis: DirectionProfile; rotation: number; coefficients: number[]};
type IsoModel = {rotation: number; scale: number};
/** Fits use the latest calibration flicks: enough to be precise, recent enough to be you now. */
export const MIN_FIT = 48, RECOMMENDED_FLICKS = 144, MAX_FIT = 480;
const HUBER = .25, GOLDEN = .6180339887, HARMONICS = 3, RIDGE = .02, PRIOR_GAIN = .05, PRIOR_ROTATION = 1.5;

const sampleOf = (record: FlickRecord): Sample => ({m: {x: record.mx, y: record.my}, t: {x: record.tx, y: record.ty}, w: 1 / (record.amp * record.amp)});
const squaredError = (p: Point, sample: Sample) => ((p.x - sample.t.x) ** 2 + (p.y - sample.t.y) ** 2) * sample.w;

/** Least squares for the four multipliers at one rotation: each half-axis is a one-number fit, solved in closed form. */
function axisFit(samples: readonly Sample[], weights: readonly number[] | undefined, rotation: number): AxisModel & {sse: number} {
  const r = rotation * DEG, c = Math.cos(r), s = Math.sin(r), sums = new Float64Array(12);
  for (let j = 0; j < samples.length; j++) {
    const {m, t, w} = samples[j], x = m.x * c - m.y * s, y = m.x * s + m.y * c, weight = w * (weights?.[j] ?? 1);
    const ix = x < 0 ? 3 : 0, iy = y < 0 ? 9 : 6;
    sums[ix] += weight * x * t.x; sums[ix + 1] += weight * x * x; sums[ix + 2] += weight * t.x * t.x;
    sums[iy] += weight * y * t.y; sums[iy + 1] += weight * y * y; sums[iy + 2] += weight * t.y * t.y;
  }
  let sse = 0;
  const gain = (k: number) => {
    const g = sums[k + 1] > 1e-12 ? clampTo(sums[k] / sums[k + 1], .2, 5) : 1;
    sse += sums[k + 2] - 2 * g * sums[k] + g * g * sums[k + 1];
    return g;
  };
  return {rotation, right: gain(0), left: gain(3), down: gain(6), up: gain(9), sse};
}
/** The rotation (within the limit) and multipliers that make first movements land closest to their targets. */
function axisSearch(samples: readonly Sample[], weights?: readonly number[]): AxisModel {
  let best = axisFit(samples, weights, 0);
  for (let rotation = -directionLimits.rotation; rotation <= directionLimits.rotation; rotation += 2) {
    const fit = axisFit(samples, weights, rotation);
    if (fit.sse < best.sse) best = fit;
  }
  let low = Math.max(-directionLimits.rotation, best.rotation - 2), high = Math.min(directionLimits.rotation, best.rotation + 2);
  for (let i = 0; i < 18; i++) {
    const a = high - (high - low) * GOLDEN, b = low + (high - low) * GOLDEN;
    if (axisFit(samples, weights, a).sse < axisFit(samples, weights, b).sse) high = b; else low = a;
  }
  const refined = axisFit(samples, weights, (low + high) / 2);
  return refined.sse < best.sse ? refined : best;
}
const axisPredict = (model: AxisModel, m: Point): Point => {const [x, y] = applyDirectionProfile(m.x, m.y, model); return {x, y};};

/** Weighted circular mean of how far each first movement turned from its target's direction (degrees, within the limit). */
function turn(samples: readonly Sample[], weights?: readonly number[]) {
  let s = 0, c = 0;
  samples.forEach(({m, t}, j) => {const d = Math.atan2(t.y, t.x) - Math.atan2(m.y, m.x), w = weights?.[j] ?? 1; s += w * Math.sin(d); c += w * Math.cos(d);});
  return clampTo(Math.atan2(s, c) / DEG, -directionLimits.rotation, directionLimits.rotation);
}
function isoFit(samples: readonly Sample[], weights?: readonly number[]): IsoModel {
  let sum = 0, total = 0;
  samples.forEach(({m, t}, j) => {const length = Math.hypot(m.x, m.y); if (length < 1e-9) return; const w = weights?.[j] ?? 1; sum += w * Math.log(Math.hypot(t.x, t.y) / length); total += w;});
  return {rotation: turn(samples, weights), scale: Math.exp(total ? sum / total : 0)};
}
const rotate = (m: Point, degrees: number, scale = 1): Point => {
  const r = degrees * DEG, c = Math.cos(r), s = Math.sin(r);
  return {x: (m.x * c - m.y * s) * scale, y: (m.x * s + m.y * c) * scale};
};
const isoPredict = (model: IsoModel, m: Point) => rotate(m, model.rotation, model.scale);
const basis = (angle: number) => {
  const values = [1];
  for (let k = 1; k <= HARMONICS; k++) values.push(Math.cos(k * angle), Math.sin(k * angle));
  return values;
};
function fullFit(samples: readonly Sample[], weights?: readonly number[]): FullModel {
  const axis = axisSearch(samples, weights), corrected = samples.map(sample => ({...sample, m: axisPredict(axis, sample.m)}));
  const size = 1 + 2 * HARMONICS, normal = Array.from({length: size}, () => new Array<number>(size).fill(0)), rhs = new Array<number>(size).fill(0);
  let total = 0;
  corrected.forEach(({m, t}, j) => {
    const length = Math.hypot(m.x, m.y);
    if (length < 1e-9) return;
    const w = weights?.[j] ?? 1, b = basis(Math.atan2(m.y, m.x)), y = Math.log(Math.hypot(t.x, t.y) / length);
    for (let a = 0; a < size; a++) {rhs[a] += w * b[a] * y; for (let k = 0; k < size; k++) normal[a][k] += w * b[a] * b[k];}
    total += w;
  });
  // A light ridge keeps the shape from chasing noise in directions with few flicks.
  for (let a = 1; a < size; a++) normal[a][a] += RIDGE * total;
  return {axis, rotation: turn(corrected, weights), coefficients: solve(normal, rhs)};
}
/** The full model's smooth gain on top of the four-direction profile, for a corrected movement in `angle` (radians, mouse space). */
const fullGain = (model: FullModel, angle: number) => Math.exp(basis(angle).reduce((sum, value, k) => sum + value * model.coefficients[k], 0));
const fullPredict = (model: FullModel, m: Point) => {const a = axisPredict(model.axis, m); return rotate(a, model.rotation, fullGain(model, Math.atan2(a.y, a.x)));};

/** Gaussian elimination with partial pivoting; a singular system leaves the shape flat. */
function solve(matrix: number[][], rhs: number[]) {
  const n = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return new Array<number>(n).fill(0);
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const f = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}
/** One Huber reweighting pass: flicks that landed more than 25% of their distance from where the model expects count less. */
function robustly<M>(samples: readonly Sample[], fit: (weights?: readonly number[]) => M, predict: (model: M, m: Point) => Point): M {
  const model = fit();
  return fit(samples.map(sample => {const e = Math.sqrt(squaredError(predict(model, sample.m), sample)); return e <= HUBER ? 1 : HUBER / e;}));
}
const random32 = (seed: number) => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/** The fitted profile split into what it changes: the horizontal sensitivity it implies (`scale`, never applied: that is your
 * sensitivity), the left/right balance, up and down relative to horizontal, and the rotation. Logs of multipliers. */
function parameters(model: AxisModel) {
  const scale = Math.sqrt(model.right * model.left);
  return {scale, asymmetry: Math.log(model.right / model.left) / 2, up: Math.log(model.up / scale), down: Math.log(model.down / scale), rotation: model.rotation};
}
type Parameters = ReturnType<typeof parameters>;
const profileOf = (p: Pick<Parameters, 'asymmetry' | 'up' | 'down' | 'rotation'>): DirectionProfile =>
  ({rotation: p.rotation, right: Math.exp(p.asymmetry), left: Math.exp(-p.asymmetry), up: Math.exp(p.up), down: Math.exp(p.down)});

/** `fitted` is the best four-direction profile for your calibration flicks; `profile` is what to apply: each part shrunk toward
 * no change by its own uncertainty (bootstrap standard errors against a prior of 5% per multiplier and 1.5 degrees of rotation),
 * so noise never becomes a correction. `scale` is the horizontal sensitivity multiplier the flicks imply, reported, not applied. */
export type DirectionFit = {n: number; fitted: DirectionProfile; profile: DirectionProfile; scale: number;
  se: {rotation: number; asymmetry: number; up: number; down: number}};
export function fitDirectionProfile(records: readonly FlickRecord[], resamples = 40, seed = 1): DirectionFit | undefined {
  const samples = calibrationFlicks(records).map(sampleOf);
  if (samples.length < MIN_FIT) return undefined;
  const fit = (list: readonly Sample[]) => parameters(robustly(list, weights => axisSearch(list, weights), axisPredict));
  const estimate = fit(samples), random = random32(seed), draws: Parameters[] = [];
  for (let b = 0; b < resamples; b++) draws.push(fit(samples.map(() => samples[Math.floor(random() * samples.length)])));
  const sd = (key: keyof Parameters) => {
    const mean = draws.reduce((sum, draw) => sum + draw[key], 0) / draws.length;
    return Math.sqrt(draws.reduce((sum, draw) => sum + (draw[key] - mean) ** 2, 0) / Math.max(1, draws.length - 1));
  };
  const se = {rotation: sd('rotation'), asymmetry: sd('asymmetry'), up: sd('up'), down: sd('down')};
  const shrink = (value: number, error: number, prior: number) => value * prior * prior / (prior * prior + error * error);
  return {n: samples.length, scale: estimate.scale, se, fitted: sanitizeDirectionProfile(profileOf(estimate)),
    profile: sanitizeDirectionProfile(profileOf({asymmetry: shrink(estimate.asymmetry, se.asymmetry, PRIOR_GAIN), up: shrink(estimate.up, se.up, PRIOR_GAIN),
      down: shrink(estimate.down, se.down, PRIOR_GAIN), rotation: shrink(estimate.rotation, se.rotation, PRIOR_ROTATION)}))};
}

/** Out-of-sample error (5-fold cross-validation) of where first movements land, as RMS fractions of the flick distance: as they
 * are (`raw`), after the best sensitivity and rotation change alone (`iso`), after the four-direction profile (`axis`) and after the
 * full-resolution model (`full`: that profile plus a smooth correction). `fixable` is what direction-dependent sensitivity could
 * remove beyond `iso`; `share` the part of it the four-direction profile captures (undefined when there is no reliable directional
 * pattern to capture). */
export type ModelComparison = {raw: number; iso: number; axis: number; full: number; fixable: number; share?: number};
export function compareDirectionModels(records: readonly FlickRecord[], seed = 2): ModelComparison | undefined {
  const samples = calibrationFlicks(records).map(sampleOf);
  if (samples.length < MIN_FIT) return undefined;
  const random = random32(seed), order = samples.map((_, j) => j);
  for (let i = order.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
  const fold = new Array<number>(samples.length);
  order.forEach((j, position) => {fold[j] = position % 5;});
  const sums = {raw: 0, iso: 0, axis: 0, full: 0};
  samples.forEach(sample => {sums.raw += squaredError(sample.m, sample);});
  for (let f = 0; f < 5; f++) {
    const train = samples.filter((_, j) => fold[j] !== f), test = samples.filter((_, j) => fold[j] === f);
    const iso = robustly(train, weights => isoFit(train, weights), isoPredict), axis = robustly(train, weights => axisSearch(train, weights), axisPredict);
    const full = robustly(train, weights => fullFit(train, weights), fullPredict);
    for (const sample of test) {
      sums.iso += squaredError(isoPredict(iso, sample.m), sample); sums.axis += squaredError(axisPredict(axis, sample.m), sample);
      sums.full += squaredError(fullPredict(full, sample.m), sample);
    }
  }
  const n = samples.length, rms = (sum: number) => Math.sqrt(sum / n);
  const result = {raw: rms(sums.raw), iso: rms(sums.iso), axis: rms(sums.axis), full: rms(sums.full)};
  const fixable = Math.max(0, result.iso - result.full);
  return {...result, fixable, ...(fixable >= .002 ? {share: clampTo((sums.iso - sums.axis) / (sums.iso - sums.full), 0, 1)} : {})};
}
/** The full-resolution model fitted to all calibration flicks, for drawing its curve. */
export function fitFullModel(records: readonly FlickRecord[]): FullModel | undefined {
  const samples = calibrationFlicks(records).map(sampleOf);
  return samples.length < MIN_FIT ? undefined : robustly(samples, weights => fullFit(samples, weights), fullPredict);
}

/** The calibration flicks: accepted ones without the profile, the latest `MAX_FIT`. */
export const calibrationFlicks = (records: readonly FlickRecord[]) => records.filter(record => record.valid && record.condition === 'off').slice(-MAX_FIT);

/** How one flick's first movement landed: `along` is how far it went toward the target as a fraction of the distance (1 = exactly,
 * above 1 overshot), `angle` how far it turned from the target's direction on screen (degrees, counterclockwise positive),
 * `error` how far from the target it ended (fraction of the distance) and `perfect` whether it ended inside the target. */
export function flickLanding(record: FlickRecord) {
  const amplitude = Math.hypot(record.tx, record.ty), ux = record.tx / amplitude, uy = record.ty / amplitude;
  const fx = (record.flip ?? 0) & 1 ? -1 : 1, fy = (record.flip ?? 0) & 2 ? -1 : 1;
  const sx = ux * fx, sy = -uy * fy, qx = record.px * fx, qy = -record.py * fy, miss = Math.hypot(record.px - record.tx, record.py - record.ty);
  return {along: (record.px * ux + record.py * uy) / amplitude, angle: Math.atan2(sx * qy - sy * qx, sx * qx + sy * qy) / DEG,
    error: miss / amplitude, perfect: miss <= record.radius};
}

const T95 = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
/** The two-sided 95% Student t quantile. */
const t95 = (df: number) => df < 1 ? Infinity : df <= 30 ? T95[Math.ceil(df) - 1] : 1.96 + 2.4 / df;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const variance = (values: readonly number[]) => {const m = mean(values); return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length - 1);};
const median = (values: readonly number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** One screen direction: flicks, the typical distance its first movements covered (geometric mean of `along`) with a 95%
 * interval, the mean turn (degrees), the shares that landed inside the target, past it and short of it, and median times (s). */
export type DirectionStat = {dir: number; n: number; extent: number; low: number; high: number; angle: number; perfect: number; over: number; under: number; reaction: number; total: number};
export function directionStats(records: readonly FlickRecord[]): DirectionStat[] {
  return Array.from({length: 16}, (_, dir) => {
    const list = records.filter(record => record.valid && record.dir === dir), landings = list.map(flickLanding), n = list.length;
    const logs = landings.map(landing => Math.log(Math.max(landing.along, 1e-3))), m = mean(logs), half = n > 1 ? t95(n - 1) * Math.sqrt(variance(logs) / n) : Infinity;
    const perfect = landings.filter(landing => landing.perfect).length, over = landings.filter(landing => !landing.perfect && landing.along > 1).length;
    return {dir, n, extent: n ? Math.exp(m) : 1, low: n > 1 ? Math.exp(m - half) : 0, high: n > 1 ? Math.exp(m + half) : Infinity,
      angle: mean(landings.map(landing => landing.angle)), perfect: n ? perfect / n : 0, over: n ? over / n : 0, under: n ? (n - perfect - over) / n : 0,
      reaction: median(list.map(record => record.reaction)), total: median(list.map(record => record.total))};
  });
}

/** All accepted flicks of a set at once: the shares inside/past/short, median reaction and target times (s), mean corrections,
 * the share hit with the first shot, the overall distance bias (geometric mean of `along`, minus 1), mean turn and RMS error. */
export type FlickSummary = {flicks: number; valid: number; perfect: number; over: number; under: number; reaction: number; total: number;
  corrections: number; firstShot: number; bias: number; angle: number; error: number};
export function summarizeFlicks(records: readonly FlickRecord[]): FlickSummary {
  const valid = records.filter(record => record.valid), landings = valid.map(flickLanding), n = valid.length || 1;
  const perfect = landings.filter(landing => landing.perfect).length, over = landings.filter(landing => !landing.perfect && landing.along > 1).length;
  return {flicks: records.length, valid: valid.length, perfect: perfect / n, over: over / n, under: (valid.length - perfect - over) / n,
    reaction: median(valid.map(record => record.reaction)), total: median(valid.map(record => record.total)),
    corrections: mean(valid.map(record => record.corrections)), firstShot: valid.filter(record => record.shots === 1).length / n,
    bias: valid.length ? Math.exp(mean(landings.map(landing => Math.log(Math.max(landing.along, 1e-3))))) - 1 : 0,
    angle: mean(landings.map(landing => landing.angle)), error: Math.sqrt(mean(landings.map(landing => landing.error ** 2)))};
}

/** A difference with its 95% interval. */
export type Interval = {estimate: number; low: number; high: number};
/** The blind A/B test: accepted flicks with and without the profile. `time` is the ratio of typical times to hit (with/without,
 * below 1 is faster) and `error` the change in how far first movements ended from their targets (fraction of the distance),
 * each with a Welch 95% interval once both sides have `TEST_FLICKS`. */
export type ProfileTest = {on: number; off: number; ready: boolean; time?: Interval; error?: Interval; firstShot?: {on: number; off: number}};
export const TEST_FLICKS = 32;
function welch(a: readonly number[], b: readonly number[]): Interval {
  const va = variance(a) / a.length, vb = variance(b) / b.length, se = Math.sqrt(va + vb), estimate = mean(a) - mean(b);
  const df = se > 0 ? (va + vb) ** 2 / (va * va / Math.max(1, a.length - 1) + vb * vb / Math.max(1, b.length - 1)) : a.length + b.length - 2;
  return {estimate, low: estimate - t95(df) * se, high: estimate + t95(df) * se};
}
export function compareProfileTest(records: readonly FlickRecord[]): ProfileTest {
  const on = records.filter(record => record.valid && record.condition === 'test-on'), off = records.filter(record => record.valid && record.condition === 'test-off');
  const ready = on.length >= TEST_FLICKS && off.length >= TEST_FLICKS;
  if (!ready) return {on: on.length, off: off.length, ready};
  const time = welch(on.map(record => Math.log(record.total)), off.map(record => Math.log(record.total)));
  return {on: on.length, off: off.length, ready, time: {estimate: Math.exp(time.estimate), low: Math.exp(time.low), high: Math.exp(time.high)},
    error: welch(on.map(record => flickLanding(record).error), off.map(record => flickLanding(record).error)),
    firstShot: {on: on.filter(record => record.shots === 1).length / on.length, off: off.filter(record => record.shots === 1).length / off.length}};
}

/** Everything the results panel shows: calibration flicks by direction and overall, the same with your profile on, the fit,
 * the model comparison, the full-resolution curve and the blind test. */
export type DirectionReport = {calibration: FlickRecord[]; summary: FlickSummary; directions: DirectionStat[]; profiled: DirectionStat[];
  fit?: DirectionFit; comparison?: ModelComparison; full?: FullModel; test: ProfileTest};
export function directionReport(records: readonly FlickRecord[]): DirectionReport {
  const calibration = calibrationFlicks(records), profiled = records.filter(record => record.valid && record.condition === 'on').slice(-MAX_FIT);
  return {calibration, summary: summarizeFlicks(calibration), directions: directionStats(calibration), profiled: directionStats(profiled),
    fit: fitDirectionProfile(calibration), comparison: compareDirectionModels(calibration), full: fitFullModel(calibration), test: compareProfileTest(records)};
}

/** The mouse-space direction (radians) of a screen direction (`dir` in sixteenths of a turn) for a given axis inversion. */
export const mouseAngleOf = (dir: number, flip = 0) => {
  const angle = dir * Math.PI / 8;
  return Math.atan2(-Math.sin(angle) * ((flip & 2) ? -1 : 1), Math.cos(angle) * ((flip & 1) ? -1 : 1));
};
/** How far a first movement toward screen `angle` (radians) would go, as a fraction of the distance, according to a model: the
 * four-direction profile with its implied horizontal scale, or the full model. For drawing their curves over the measurements. */
export function modelExtent(model: {fit: DirectionFit} | {full: FullModel}, angle: number, flip = 0): number {
  const fx = flip & 1 ? -1 : 1, fy = flip & 2 ? -1 : 1, mouse = Math.atan2(-Math.sin(angle) * fy, Math.cos(angle) * fx);
  if ('full' in model) {
    const source = mouse - (model.full.axis.rotation + model.full.rotation) * DEG, p = fullPredict(model.full, {x: Math.cos(source), y: Math.sin(source)});
    return 1 / Math.hypot(p.x, p.y);
  }
  const {fitted, scale} = model.fit, source = mouse - fitted.rotation * DEG, [x, y] = applyDirectionProfile(Math.cos(source), Math.sin(source), fitted);
  return 1 / (Math.hypot(x, y) * scale);
}

/** The profile file the background app reads: what to apply, its Raw Accel fields, and the evidence behind it. */
export function directionProfileFile(report: DirectionReport, applied: DirectionProfile, strength: number, outputDpi = 1000) {
  const effective = scaleProfile(applied, strength), rounded = (profile: DirectionProfile) => Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, round(value)]));
  return {format: 'spraylab-direction-profile', version: 1, created: new Date().toISOString(), flicks: report.fit?.n ?? 0, strength: round(strength, 2),
    profile: rounded(effective), rawAccel: rawAccelFields(effective, outputDpi),
    ...(report.fit ? {fitted: rounded(report.fit.fitted), standardErrors: Object.fromEntries(Object.entries(report.fit.se).map(([key, value]) => [key, round(value)])),
      horizontalScale: round(report.fit.scale)} : {}),
    ...(report.comparison ? {comparison: Object.fromEntries(Object.entries(report.comparison).map(([key, value]) => [key, round(value)]))} : {})};
}
