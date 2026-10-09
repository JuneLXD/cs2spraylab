import {describe, expect, it} from 'vitest';
import {followCrosshairDirection, followCrosshairOffset} from './crosshair-follow';
import {DEG} from './actor-physics';
import native from './native-follow-crosshair-fixture.json';

describe('native follow-recoil crosshair', () => {
  it('matches the native predictable-recoil direction at level, turned and elevated aim', () => {
    for (const row of native.directions) {
      const actual = followCrosshairDirection(row.yawDegrees * DEG, row.pitchDegrees * DEG, row.recoil);
      for (const axis of ['x', 'y', 'z'] as const) expect(actual[axis]).toBeCloseTo(row.direction[axis], 6);
    }
  });
  it('matches all 30 retained native projected-coordinate samples', () => {
    for (const row of native.samples) {
      const [width, height] = row.viewport, [x, y] = row.ndc;
      expect(followCrosshairOffset({x, y}, width, height)).toEqual({x: row.offset[0], y: row.offset[1]});
    }
  });

  it('keeps a tiny recovery tail centered independently on each axis', () => {
    const result = followCrosshairOffset({x: .5 / 960, y: 20.25 / 540}, 1920, 1080);
    expect(result).toEqual({x: 0, y: -20});
  });
});
