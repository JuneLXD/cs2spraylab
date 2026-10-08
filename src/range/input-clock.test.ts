import {describe, expect, it} from 'vitest';
import {InputClock, inputTimestamp} from './input-clock';

describe('shared input and render clock', () => {
  it('does not count elapsed input time twice when the rAF timestamp is older', () => {
    const clock = new InputClock(), elapsed: number[] = [];
    clock.reset(100);
    for (const time of [103, 102, 104, 104, 108]) clock.advance(time, dt => elapsed.push(dt));
    expect(elapsed).toEqual([.003, .001, .004]);
  });
  it('does not catch up paused time and bounds a genuine stall', () => {
    const clock = new InputClock(), elapsed: number[] = [];
    clock.reset(100); clock.reset(10000);
    clock.advance(10002, dt => elapsed.push(dt));
    clock.advance(20000, dt => elapsed.push(dt));
    clock.advance(20002, dt => elapsed.push(dt));
    expect(elapsed).toEqual([.002, .25, .002]);
  });
  it('normalizes synthetic, epoch, invalid and future event timestamps', () => {
    expect(inputTimestamp(996, 1000)).toBe(996);
    for (const timestamp of [0, NaN, -1, 1001, 1700000000000]) expect(inputTimestamp(timestamp, 1000)).toBe(1000);
  });
});
