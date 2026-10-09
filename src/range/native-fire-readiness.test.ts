import {describe, expect, it} from 'vitest';
import fixture from './native-fire-readiness-fixture.json';
import {WeaponActions} from './weapon-actions';

describe('native R8 windup deadline', () => {
  it('preserves the command fraction while adding the native thirteen ticks', () => {
    for (const sample of fixture.windup) {
      const action = new WeaponActions('revolver');
      const start = (sample.command.tick + sample.command.ratio) * fixture.tickInterval;
      const ready = (sample.ready.tick + sample.ready.ratio) * fixture.tickInterval;
      expect(action.chargeTrigger(start, true)).toBeCloseTo(ready, 10);
      // Continuing to hold does not restart the windup.
      expect(action.chargeTrigger(start + .1, true)).toBeCloseTo(ready, 10);
    }
  });
  it('requires a new complete windup after release and keeps alternate fire immediate', () => {
    const action = new WeaponActions('revolver');
    action.chargeTrigger(0, true);
    expect(action.chargeTrigger(.1, false)).toBe(Infinity);
    expect(action.chargeTrigger(1, true)).toBe(1 + fixture.windupSeconds);
    action.alternateFire = true;
    expect(action.chargeTrigger(2, true)).toBe(2);
    expect(action.charging).toBe(false);
  });
});
