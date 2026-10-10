import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {NativeReloadState} from './weapon-actions';
import {ActionSoundTimeline, nativeSoundTimelines, type SoundTimelines} from './sound-model';

const manifest = JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8'));
const clipout = 'Weapon_DEagle.Clipout';
function fixture(timelines: SoundTimelines, held = false, empty = false) {
  const reload = new NativeReloadState('deagle'); reload.ammo = empty ? 0 : 6; reload.start(0, held);
  const audio = new ActionSoundTimeline(timelines);
  const step = (at: number, down = held) => {
    reload.advance(at, down);
    audio.sync({id: 0, equipment: 'deagle', alive: true, local: true, reloading: reload.active,
      silent: reload.silent, reloadEmpty: reload.empty, reloadPhase: reload.phase,
      reloadDuration: reload.phaseDuration, reloadProgress: reload.progress}, at);
    return audio.update(at);
  };
  step(0); return {reload, step};
}

describe.each([['hearing', nativeSoundTimelines], ['browser', manifest.timelines]] as const)('current Deagle %s reload events', (_name, timelines) => {
  it('emits the normal magazine-removal cue at native frame 10 and preserves insertion', () => {
    const {reload, step} = fixture(timelines);
    expect(step(4 / 30)).toEqual([]);
    expect(step(10 / 30 - .0001)).toEqual([]);
    expect(step(10 / 30).map(cue => manifest.events[cue.key].source)).toEqual([clipout]);
    expect(step(10 / 30)).toEqual([]);
    step(23 / 30 - .0001); expect(reload.ammo).toBe(6);
    step(23 / 30); expect(reload.ammo).toBe(7);
    expect(reload.until).toBeCloseTo(2.2, 9);
  });
  it('suppresses the moved cue while held and retains silence through native frame 50', () => {
    const {reload, step} = fixture(timelines, true);
    expect(step(4 / 30)).toEqual([]);
    expect(step(.2)).toEqual([]); expect(reload.silent).toBe(true);
    expect(step(.2 + (10 / 30 - .2) * 2)).toEqual([]);
    step(.2 + (49 / 30 - .2) * 2); expect(reload.silent).toBe(true);
    const exit = .2 + (50 / 30 - .2) * 2;
    step(exit); expect(reload.silent).toBe(false);
    expect(reload.until).toBeCloseTo(exit + (2.2 - 50 / 30) / .99, 9);
  });
  it('does not replay the skipped cue after releasing a held reload', () => {
    const {step} = fixture(timelines, true);
    expect(step(.2)).toEqual([]);
    expect(step(.5, false)).toEqual([]);
    expect(step(.7, false).some(cue => manifest.events[cue.key].source === clipout)).toBe(false);
  });
  it('keeps the native empty-reload cue and earlier silent-window endpoint', () => {
    const normal = fixture(timelines, false, true);
    expect(normal.step(.2).map(cue => manifest.events[cue.key].source)).toEqual([clipout]);
    const held = fixture(timelines, true, true);
    held.step(.2); held.step(.2 + (49 / 30 - .2) * 2);
    expect(held.reload.silent).toBe(false);
    expect(held.reload.until).toBeCloseTo(.2 + (49 / 30 - .2) * 2 + (2.2 - 49 / 30) / .99, 9);
  });
});
