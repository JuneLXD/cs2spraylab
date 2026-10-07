import type {Crosshair} from '../config';
import {cvarAssignment, parseKeyValues, type KeyValues} from './console';

/**
 * The CS2 crosshair convars behind the trainer's crosshair, kept as the console
 * stores them and ordered by when each was last set. CS2 has two naming schemes
 * and the newest assignment wins:
 * - before the 22 Sept 2026 update: cl_crosshairsize / cl_crosshairthickness in
 *   1/480ths of the screen height, cl_crosshairgap as 4 + raw pixels;
 * - since: cl_crosshair_length / _gap / _thickness in pixels at
 *   cl_crosshair_screen_height, the resolution they were authored at.
 * screenHeight is the height CS2 renders at (cs2_video.txt setting.defaultresheight).
 */
export type Cs2Crosshair = {cvars: Record<string, string>; screenHeight: number};

const sizeCvars = ['cl_crosshairsize', 'cl_crosshairgap', 'cl_crosshairthickness',
  'cl_crosshair_length', 'cl_crosshair_gap', 'cl_crosshair_thickness', 'cl_crosshair_screen_height'];
export const crosshairCvarNames: ReadonlySet<string> = new Set([...sizeCvars, 'cl_crosshairstyle', 'cl_crosshairdot', 'cl_crosshair_t',
  'cl_crosshaircolor', 'cl_crosshaircolor_r', 'cl_crosshaircolor_g', 'cl_crosshaircolor_b', 'cl_crosshaircolor_a',
  'cl_crosshairalpha', 'cl_crosshairusealpha', 'cl_crosshair_drawoutline', 'cl_crosshair_outlinethickness', 'cl_crosshair_recoil']);
export const isCrosshairCvar = (name: string) => crosshairCvarNames.has(name.toLowerCase());

/** cl_crosshaircolor 0-4: red, green, yellow, blue, cyan. 5 uses cl_crosshaircolor_r/_g/_b. */
const presets = [[250, 50, 50], [50, 250, 50], [250, 250, 50], [50, 50, 250], [50, 250, 250]] as const;
/** Pre-update cl_crosshairstyle 0-5 in the current numbering. */
const legacyStyles = [0, 4, 2, 0, 4, 5] as const;
/** 0 Dynamic Cross, 1 Dynamic Circle, 2 Dynamic Cross (Legacy), 7 Dynamic Quadrant. */
const dynamicStyles = new Set([0, 1, 2, 7]);
export const crosshairLimits = {size: [0, 60], gap: [-10, 60], thickness: [.5, 20], outline: [0, 3], alpha: [.1, 1]} as const;

/** CS's rounding of scaled crosshair sizes: half to even. */
export const bround = (x: number) => {
  const floor = Math.floor(x);
  return Math.abs(x - floor - .5) < 1e-9 ? (floor % 2 ? floor + 1 : floor) : Math.round(x);
};
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, value));
const round2 = (value: number) => Math.round(value * 100) / 100;
const hex = (rgb: readonly number[]) => `#${rgb.map(value => Math.round(clamp(value, [0, 255])).toString(16).padStart(2, '0')).join('')}`;

export type CrosshairView = {crosshair: Crosshair; follow?: boolean; notes: string[]};

/**
 * Draws CS2 convars as the trainer's crosshair. cssHeight is the screen height
 * in CSS pixels (screen.height), so bars keep the size CS2 gives them on the
 * same monitor, including a lower or stretched CS2 resolution.
 */
export function crosshairFromCvars({cvars, screenHeight}: Cs2Crosshair, cssHeight: number): CrosshairView {
  const order = Object.keys(cvars), has = (name: string) => name in cvars;
  const number = (name: string, fallback: number) => {
    const raw = cvars[name]?.trim(), value = raw === undefined ? NaN : /^true$/i.test(raw) ? 1 : /^false$/i.test(raw) ? 0 : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const flag = (name: string, fallback: boolean) => has(name) ? number(name, 0) !== 0 : fallback;
  const newer = (current: string, legacy: string) => has(current) && (!has(legacy) || order.indexOf(current) > order.indexOf(legacy));
  const unit = screenHeight / 480, authored = number('cl_crosshair_screen_height', screenHeight) || screenHeight, k = screenHeight / authored;
  const pixelThickness = newer('cl_crosshair_thickness', 'cl_crosshairthickness'), pixelLength = newer('cl_crosshair_length', 'cl_crosshairsize');
  const pixelGap = newer('cl_crosshair_gap', 'cl_crosshairgap');
  const thickness = pixelThickness ? Math.max(1, Math.round(number('cl_crosshair_thickness', 1) * k)) : Math.max(1, bround(number('cl_crosshairthickness', .5) * unit));
  const length = pixelLength ? Math.max(0, Math.round(number('cl_crosshair_length', 0) * k)) : Math.max(0, bround(number('cl_crosshairsize', 5) * unit));
  // The current renderer draws an odd thickness's gap one pixel closer than the legacy one did.
  const gap = pixelGap ? Math.round(number('cl_crosshair_gap', 0) * k) - thickness % 2 : Math.trunc(4 + number('cl_crosshairgap', 1));
  const rawStyle = Math.round(number('cl_crosshairstyle', 4));
  const style = rawStyle > 5 || pixelThickness || pixelLength || pixelGap ? clamp(rawStyle, [0, 9]) : legacyStyles[clamp(rawStyle, [0, 5])];
  const preset = has('cl_crosshaircolor') ? Math.round(number('cl_crosshaircolor', 5)) : 5;
  const rgb = preset >= 0 && preset < 5 ? presets[preset] : (['r', 'g', 'b'] as const).map(c => number(`cl_crosshaircolor_${c}`, c === 'g' ? 250 : 50));
  const latestAlpha = Math.max(order.indexOf('cl_crosshairalpha'), order.indexOf('cl_crosshairusealpha'));
  const pixelAlpha = has('cl_crosshaircolor_a') && order.indexOf('cl_crosshaircolor_a') > latestAlpha;
  const additive = !pixelAlpha && !flag('cl_crosshairusealpha', true);
  const alpha = pixelAlpha ? number('cl_crosshaircolor_a', 255) : additive ? 200 : number('cl_crosshairalpha', 200);
  // CS2 now draws a fixed 1 px outline (2 = half outline); legacy outline thickness no longer applies.
  const outline = Math.round(number('cl_crosshair_drawoutline', 1));
  const scale = cssHeight / screenHeight, notes: string[] = [];
  if (style === 1 || style === 3) notes.push('circle styles are drawn as a cross');
  if (style === 7 || style === 9) notes.push('quadrant styles are drawn as a cross');
  if (style === 8) notes.push('the square style is drawn as a cross');
  if (additive) notes.push('additive blending is shown as 78% opacity');
  return {crosshair: {
    color: hex(rgb), size: style === 6 ? 0 : clamp(round2(length * scale), crosshairLimits.size), gap: clamp(round2(gap * scale), crosshairLimits.gap),
    thickness: clamp(round2(thickness * scale), crosshairLimits.thickness), outline: outline <= 0 ? 0 : clamp(round2((outline === 2 ? .5 : 1) * scale), crosshairLimits.outline),
    alpha: clamp(round2(alpha / 255), crosshairLimits.alpha), dot: flag('cl_crosshairdot', false) || style === 6, t: flag('cl_crosshair_t', false),
    dynamic: dynamicStyles.has(style),
  }, follow: has('cl_crosshair_recoil') ? flag('cl_crosshair_recoil', false) : undefined, notes};
}

/** The current (pixel) convars for a crosshair edited in the trainer. */
export function cvarsFromCrosshair(crosshair: Crosshair, screenHeight: number, cssHeight: number): Cs2Crosshair {
  const toPixels = screenHeight / cssHeight, thickness = Math.max(1, Math.round(crosshair.thickness * toPixels));
  const [r, g, b] = [1, 3, 5].map(index => parseInt(crosshair.color.slice(index, index + 2), 16));
  return {screenHeight, cvars: {
    cl_crosshairstyle: crosshair.dynamic ? '0' : '4', cl_crosshair_length: String(Math.round(crosshair.size * toPixels)),
    cl_crosshair_thickness: String(thickness), cl_crosshair_gap: String(Math.round(crosshair.gap * toPixels) + thickness % 2),
    cl_crosshair_screen_height: String(screenHeight), cl_crosshaircolor: '5',
    cl_crosshaircolor_r: String(r), cl_crosshaircolor_g: String(g), cl_crosshaircolor_b: String(b),
    cl_crosshaircolor_a: String(Math.round(crosshair.alpha * 255)), cl_crosshairdot: crosshair.dot ? '1' : '0', cl_crosshair_t: crosshair.t ? '1' : '0',
    cl_crosshair_drawoutline: crosshair.outline <= 0 ? '0' : crosshair.outline < 1 ? '2' : '1',
  }};
}

/** Sets one crosshair convar from a console command; undefined if the command is not one. */
export function applyCrosshairCommand(source: Cs2Crosshair, args: readonly string[]): Cs2Crosshair | undefined {
  const assignment = cvarAssignment(args, name => source.cvars[name]);
  if (!assignment || !isCrosshairCvar(assignment.name) || !validValue(assignment.value)) return;
  const cvars = {...source.cvars};
  delete cvars[assignment.name];
  cvars[assignment.name] = assignment.value.trim();
  return {...source, cvars};
}

const validValue = (value: string) => value.trim().length <= 16 && /^(-?\d*\.?\d+|true|false)$/i.test(value.trim());

export function sanitizeCs2Crosshair(raw: unknown): Cs2Crosshair | undefined {
  if (!raw || typeof raw !== 'object') return;
  const {cvars, screenHeight} = raw as Partial<Cs2Crosshair>;
  if (!cvars || typeof cvars !== 'object' || typeof screenHeight !== 'number' || !Number.isFinite(screenHeight)) return;
  const clean = Object.fromEntries(Object.entries(cvars).filter(([name, value]) => isCrosshairCvar(name) && typeof value === 'string' && validValue(value))
    .map(([name, value]) => [name.toLowerCase(), value.trim()]));
  return Object.keys(clean).length ? {cvars: clean, screenHeight: Math.round(clamp(screenHeight, [240, 4320]))} : undefined;
}

/** setting.defaultresheight from cs2_video.txt: the height CS2 renders at. */
export function videoHeight(text: string) {
  const values = parseKeyValues(text), video = Object.entries(values).find(([key]) => key.toLowerCase() === 'video.cfg')?.[1];
  const height = video && typeof video === 'object' ? Number((video as KeyValues)['setting.defaultresheight']) : NaN;
  return Number.isFinite(height) && height >= 240 && height <= 4320 ? Math.round(height) : undefined;
}
