import {describe, expect, it} from 'vitest';
import {frameLimitRange, sanitizeSettings} from './config';
import {FRAME_LIMIT_PRESETS, frameLimitOptions, refreshRateFromTimestamps} from './display-rate';

/** requestAnimationFrame timestamps at `hz`, skipping the frames in `dropped`. */
const frames = (hz: number, count = 60, dropped = new Set<number>()) => {
  const out: number[] = [];
  for (let i = 0, time = 1000; i < count; i++, time += 1000 / hz) if (!dropped.has(i)) out.push(time);
  return out;
};

describe('display refresh rate', () => {
  it.each([60, 144, 240, 360, 500])('measures a %i Hz display from frame timestamps', hz => {
    expect(refreshRateFromTimestamps(frames(hz))).toBe(hz);
  });
  it('rounds fractional rates and ignores frames dropped by a busy main thread', () => {
    expect(refreshRateFromTimestamps(frames(59.94))).toBe(60);
    expect(refreshRateFromTimestamps(frames(500, 90, new Set([5, 6, 20, 41, 42, 43, 70])))).toBe(500);
  });
  it('needs enough frames and rejects implausible rates', () => {
    expect(refreshRateFromTimestamps(frames(500, 8))).toBeNull();
    expect(refreshRateFromTimestamps(frames(5))).toBeNull();
    expect(refreshRateFromTimestamps(frames(4000))).toBeNull();
  });
});

describe('frame limit options and settings', () => {
  it('offers caps below a 500 Hz display, with Display refresh rate as the maximum', () => {
    expect(frameLimitOptions(500, 0)).toEqual([0, 30, 60, 75, 120, 144, 165, 240, 280, 360, 480]);
  });
  it('leaves out caps a slower display could never reach', () => {
    expect(frameLimitOptions(144, 0)).toEqual([0, 30, 60, 75, 120]);
  });
  it('offers every preset before the display is measured, and always keeps the saved cap', () => {
    expect(frameLimitOptions(null, 0)).toEqual([0, ...FRAME_LIMIT_PRESETS]);
    expect(frameLimitOptions(144, 480)).toEqual([0, 30, 60, 75, 120, 480]);
  });
  it('accepts uncapped or any whole cap from 30 to 1000 FPS and falls back otherwise', () => {
    for (const frameLimit of [0, 30, 480, 500, 1000]) expect(sanitizeSettings({frameLimit}).frameLimit).toBe(frameLimit);
    for (const frameLimit of [10, 29, 1001, 47.5, NaN, '240', null]) expect(sanitizeSettings({frameLimit}).frameLimit).toBe(0);
    expect(sanitizeSettings({frameLimit: 7, quality: 'performance'}).frameLimit).toBe(60);
    expect(frameLimitRange).toEqual([30, 1000]);
  });
});
