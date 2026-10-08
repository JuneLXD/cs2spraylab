import {describe, expect, it} from 'vitest';
import evidence from '../../docs/native-silent-reload-gate.json';
import timing from './native-reload-timing.json';
import {ReloadClock} from './reload-clock';
import {NativeReloadState} from './weapon-actions';
import type {Equipment} from './equipment';

describe('installed native reload gate', () => {
  it.each(Object.entries(evidence.cases))('%s agrees with offline native execution', (_name, samples) => {
    const clock = new ReloadClock(.5), first = samples[0];
    const windows = [{start: 0, end: 100}];
    clock.reset(first.time, first.held, first.section ? windows : []);
    let section = first.section;
    for (const sample of samples) {
      while (clock.now < sample.time - 1e-9) clock.advance(Math.min(sample.time, clock.nextBoundary));
      if (section !== sample.section) {section = sample.section; clock.phase(section ? windows : []);}
      clock.setHeld(sample.held);
      expect(clock.silent).toBe(sample.silent);
      expect(clock.rate).toBeCloseTo(sample.rate, 6);
    }
  });
  it('has the same result for long frames and fine samples through held reloads', () => {
    for (const id of Object.keys(timing.weapons) as Equipment[]) {
      const coarse = new NativeReloadState(id), fine = new NativeReloadState(id);
      for (const state of [coarse, fine]) {state.ammo = 0; state.start(0, true);}
      coarse.advance(40, true);
      for (let step = 1; step <= 4000; step++) fine.advance(step / 100, true);
      expect({ammo: coarse.ammo, reserve: coarse.reserve, active: coarse.active}).toEqual({ammo: fine.ammo, reserve: fine.reserve, active: fine.active});
      const a = coarse.drainActionEvents(), b = fine.drainActionEvents();
      expect(a.map(e => [e.kind, e.silent, e.ammo])).toEqual(b.map(e => [e.kind, e.silent, e.ammo]));
      a.forEach((event, i) => expect(event.at).toBeCloseTo(b[i].at, 7));
    }
  });
});
