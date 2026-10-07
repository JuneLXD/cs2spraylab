import {useEffect, useState} from 'react';
import {frameLimitRange} from './config';

/** Frame caps offered below the display's refresh rate. Browsers never draw faster than the display. */
export const FRAME_LIMIT_PRESETS = [30, 60, 75, 120, 144, 165, 240, 280, 360, 480, 540] as const;

/** Refresh rate from requestAnimationFrame timestamps, which browsers align with the display's refresh.
 * The median interval ignores frames dropped by a busy main thread. */
export function refreshRateFromTimestamps(timestamps: readonly number[]): number | null {
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]).filter(interval => interval > .5 && interval < 100)
    .sort((a, b) => a - b);
  if (intervals.length < 10) return null;
  const hz = Math.round(1000 / intervals[Math.floor(intervals.length / 2)]);
  return hz >= 20 && hz <= frameLimitRange[1] ? hz : null;
}

export function measureDisplayRate(frames = 90): Promise<number | null> {
  if (typeof requestAnimationFrame === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const timestamps: number[] = [];
    const sample = (time: number) => {
      timestamps.push(time);
      if (timestamps.length > frames) resolve(refreshRateFromTimestamps(timestamps));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** Measures while `active`, such as while the settings drawer is open and the range is paused. */
export function useDisplayRate(active: boolean) {
  const [hz, setHz] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void measureDisplayRate().then(value => {if (current && value) setHz(value);});
    return () => {current = false;};
  }, [active]);
  return hz;
}

/** 0 runs at the display's refresh rate. Caps at or above it would change nothing, so only lower ones are offered. */
export function frameLimitOptions(displayHz: number | null, current: number): number[] {
  const caps = FRAME_LIMIT_PRESETS.filter(limit => !displayHz || limit < displayHz);
  return [...new Set([0, ...caps, ...(current ? [current] : [])])].sort((a, b) => a - b);
}
