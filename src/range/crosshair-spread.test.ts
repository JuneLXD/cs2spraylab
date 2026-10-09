import {describe, expect, it} from 'vitest';
import {DYNAMIC_SPREAD_LIMIT_PX, dynamicCrosshairGap, projectCone} from './crosshair-spread';
import {gameData} from './config';
import {VERTICAL_FOV} from './simulation';

describe('dynamic crosshair gap', () => {
  it('projects the accuracy cone with the HUD reference scale: 320 px per radian at 640x480 and 90 degrees', () => {
    expect(projectCone({inaccuracy: .01, spread: 0}, 480, VERTICAL_FOV)).toBeCloseTo(3.2, 6);
    // Scales with screen height, like YRES in the HUD code.
    expect(projectCone({inaccuracy: .01, spread: 0}, 1080, VERTICAL_FOV)).toBeCloseTo(3.2 * 1080 / 480, 6);
    // Spread adds to inaccuracy before projection.
    expect(projectCone({inaccuracy: .01, spread: .005}, 480, VERTICAL_FOV)).toBeCloseTo(4.8, 6);
    // The game truncates the offset to whole pixels.
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: .005}, 480, VERTICAL_FOV)).toBe(4);
  });
  it('gives the AK-47 a few pixels standing and tens of pixels running at 1080p', () => {
    const ak = gameData.weapons.ak47;
    const standing = dynamicCrosshairGap({inaccuracy: ak.stand, spread: ak.spread}, 1080, VERTICAL_FOV);
    const running = dynamicCrosshairGap({inaccuracy: ak.stand + ak.move, spread: ak.spread}, 1080, VERTICAL_FOV);
    expect(standing).toBeGreaterThanOrEqual(4); expect(standing).toBeLessThan(6);
    expect(running).toBeGreaterThan(120); expect(running).toBeLessThan(140);
  });
  it('eases the offset into the client\'s soft limit past three quarters of it, and never beyond it', () => {
    expect(DYNAMIC_SPREAD_LIMIT_PX).toBe(319);
    // 200 px is below the 239.25 px knee: untouched.
    expect(dynamicCrosshairGap({inaccuracy: 200 / 720, spread: 0}, 1080, VERTICAL_FOV)).toBe(200);
    // 360 px raw: 319 - 79.75 * e^(-(360 - 239.25) / 79.75) = 301.4.
    expect(dynamicCrosshairGap({inaccuracy: .5, spread: 0}, 1080, VERTICAL_FOV)).toBe(301);
    expect(dynamicCrosshairGap({inaccuracy: 1, spread: 1}, 4000, VERTICAL_FOV)).toBeLessThanOrEqual(319);
    // A custom cl_crosshair_dynamic_spread_limit of 64 caps at 128 px with its knee at 96.
    expect(dynamicCrosshairGap({inaccuracy: 90 / 720, spread: 0}, 1080, VERTICAL_FOV, 128)).toBe(90);
    expect(dynamicCrosshairGap({inaccuracy: .5, spread: 0}, 1080, VERTICAL_FOV, 128)).toBeLessThan(128);
  });
  it('clamps the cone to one radian and rejects degenerate inputs', () => {
    expect(projectCone({inaccuracy: 5, spread: 5}, 480, VERTICAL_FOV)).toBeCloseTo(320, 6);
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 0, VERTICAL_FOV)).toBe(0);
    expect(dynamicCrosshairGap({inaccuracy: .01, spread: 0}, 480, 0)).toBe(0);
    expect(dynamicCrosshairGap({inaccuracy: NaN, spread: NaN}, 480, VERTICAL_FOV)).toBe(0);
  });
});
