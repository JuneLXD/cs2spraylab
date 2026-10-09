import {describe, expect, it} from 'vitest';
import {dynamicCrosshairGap} from './crosshair-spread';
import {gameData} from './config';
import {VERTICAL_FOV} from './simulation';

describe('dynamic crosshair gap', () => {
  it('projects the accuracy cone with the HUD reference scale: 320 px per radian at 640x480 and 90 degrees', () => {
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 480, VERTICAL_FOV)).toBeCloseTo(3.2, 6);
    // Scales with screen height, like YRES in the HUD code.
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 1080, VERTICAL_FOV)).toBeCloseTo(3.2 * 1080 / 480, 6);
    // Spread adds to inaccuracy before projection.
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: .005}, 480, VERTICAL_FOV)).toBeCloseTo(4.8, 6);
  });
  it('gives the AK-47 a few pixels standing and tens of pixels running at 1080p', () => {
    const ak = gameData.weapons.ak47;
    const standing = dynamicCrosshairGap({inaccuracy: ak.stand, spread: ak.spread}, 1080, VERTICAL_FOV);
    const running = dynamicCrosshairGap({inaccuracy: ak.stand + ak.move, spread: ak.spread}, 1080, VERTICAL_FOV);
    expect(standing).toBeGreaterThan(4); expect(standing).toBeLessThan(6);
    expect(running).toBeGreaterThan(120); expect(running).toBeLessThan(140);
  });
  it('clamps the cone to one radian and rejects degenerate inputs', () => {
    expect(dynamicCrosshairGap({inaccuracy: 5, spread: 5}, 480, VERTICAL_FOV)).toBeCloseTo(320, 6);
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 0, VERTICAL_FOV)).toBe(0);
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 480, 0)).toBe(0);
    expect(dynamicCrosshairGap({inaccuracy: NaN, spread: NaN}, 480, VERTICAL_FOV)).toBe(0);
  });
});
