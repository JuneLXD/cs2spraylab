import {describe, expect, it} from 'vitest';
import {equipmentStats, SHELL_RELOAD_START, SHELL_RELOAD_FINISH} from './equipment';
import {NativeReloadState} from './weapon-actions';
import evidence from '../../docs/native-gameplay-evidence.json';
import followup from '../../docs/native-reload-followup-evidence.json';
import liveGate from '../../docs/native-reload-gate-live.json';
import emptyLive from '../../docs/native-empty-reload-live.json';
import type {Equipment} from './equipment';

describe('reserve-aware reload phases', () => {
  it.each(liveGate.reloads)('matches fresh native $mode insertion and completion', sample => {
    const reload = new NativeReloadState('m4a4'); reload.ammo = sample.ammoBefore; reload.start(0, true);
    let insertion = 0;
    const edges = [...sample.inputEdges];
    while (reload.active) {
      const at = Math.min(reload.nextEventAt, edges[0]?.at ?? Infinity);
      const edge = edges[0]?.at === at ? edges.shift() : undefined;
      const ammo = reload.ammo;
      reload.advance(at, edge?.held);
      if (reload.ammo > ammo) insertion = at;
    }
    const ended = reload.drainActionEvents().find(event => event.kind === 'reload-end')!.at;
    expect(Math.abs(insertion - sample.insertSeconds)).toBeLessThan(2 * liveGate.demoTickSeconds);
    expect(Math.abs(ended - sample.endSeconds)).toBeLessThan(2 * liveGate.demoTickSeconds);
  });
  it.each(followup.reloads.filter(sample=>sample.mode==='normal'))('$weapon empty=$empty matches the follow-up insertion and cancellation evidence',sample=>{
    const reload=new NativeReloadState(sample.weapon as Equipment);reload.ammo=sample.ammoBefore;
    const insert=sample.clipInsertFrame/sample.clipFramesPerSecond;
    expect(Math.abs(sample.insertGameTime-sample.startGameTime-insert)).toBeLessThanOrEqual(followup.demoTickSeconds);
    expect(Math.abs(sample.endGameTime-sample.startGameTime-reload.stats.reload)).toBeLessThanOrEqual(followup.demoTickSeconds);
    reload.start(10);reload.advance(10+insert-.001);expect(reload.ammo).toBe(sample.ammoBefore);
    reload.advance(10+insert);expect(reload.ammo).toBe(sample.ammoAfter);expect(reload.active).toBe(true);
    reload.cancel();expect(reload.ammo).toBe(sample.ammoAfter);
  });
  it.each(evidence.reloads)('$weapon matches the recorded insertion and separate attack lock', sample => {
    const reload = new NativeReloadState(sample.weapon as Equipment); reload.ammo = sample.ammoBefore;
    const reserve = reload.reserve, insertAt = sample.clipInsertFrame / sample.clipFramesPerSecond;
    expect(Math.abs(sample.insertGameTime - sample.startGameTime - insertAt)).toBeLessThanOrEqual(evidence.demoTickSeconds);
    expect(Math.abs(sample.nextAttackGameTime - sample.startGameTime - reload.stats.reload)).toBeLessThan(.001);
    expect(reload.start(10)).toBe(true);
    expect(reload.nextEventAt).toBeCloseTo(10 + insertAt);
    reload.advance(10 + insertAt - .001); expect(reload.ammo).toBe(sample.ammoBefore);
    reload.advance(10 + insertAt); expect(reload.ammo).toBe(sample.ammoAfter);
    expect(reload.reserve).toBe(reserve - reload.stats.magazine);
    expect(reload.active).toBe(true); expect(reload.until).toBeCloseTo(10 + reload.stats.reload);
    expect(reload.nextEventAt).toBe(reload.until);
    reload.advance(reload.until - .001); expect(reload.active).toBe(true);
    reload.advance(reload.until); expect(reload.active).toBe(false);
    expect(reload.ammo).toBe(sample.ammoAfter); expect(reload.reserve).toBe(reserve - reload.stats.magazine);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-end']);
    expect(reload.drainActionEvents()).toEqual([]);
  });
  it.each(evidence.deagleCancellation)('retains the native ammo after a Deagle holster at $holsterGameTime', sample => {
    const reload = new NativeReloadState('deagle'); reload.ammo = sample.ammoBefore;
    const reserve = reload.reserve;
    reload.start(sample.startGameTime); reload.advance(sample.holsterGameTime); reload.cancel();
    reload.advance(sample.returnGameTime + 10);
    expect(reload.ammo).toBe(sample.ammoAfter);
    expect(reload.reserve).toBe(reserve - sample.reserveClipsConsumed * reload.stats.magazine);
    expect(reload.active).toBe(false); expect(reload.until).toBe(0);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-cancel']);
  });
  it('commits exactly one magazine across a long step, and handles a partial saved reserve', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 11; reload.reserve = 9;
    reload.start(10); reload.advance(100); reload.advance(101);
    expect(reload.ammo).toBe(9); expect(reload.reserve).toBe(0); expect(reload.start(102)).toBe(false);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-end']);
  });
  it('cancels magazine reloads without minting or losing ammo', () => {
    const reload = new NativeReloadState('mag7'); reload.ammo = 2;
    reload.start(0); reload.advance(1); reload.cancel(); reload.advance(100);
    expect(reload.ammo).toBe(2); expect(reload.reserve).toBe(15);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-cancel']);
  });
  it('delays held silence, integrates preceding work and disallows re-entry after release', () => {
    const reload = new NativeReloadState('ak47'); reload.ammo = 0;
    reload.start(0, true); expect(reload.silent).toBe(false);
    reload.advance(.199, true); expect(reload.silent).toBe(false);
    reload.advance(.2, true); expect(reload.silent).toBe(true);
    reload.advance(1, false); expect(reload.progress * reload.phaseDuration).toBeCloseTo(.6);
    const deadline = 1 + (reload.stats.reload - .6) / .99;
    expect(reload.until).toBeCloseTo(deadline);
    reload.advance(1.5, true); expect(reload.silent).toBe(false); expect(reload.until).toBeCloseTo(deadline);
    const insert = 1 + (1.1 - .6) / .99;
    reload.advance(insert - .001); expect(reload.ammo).toBe(0);
    reload.advance(insert); expect(reload.ammo).toBe(30);
    reload.advance(deadline); expect(reload.active).toBe(false); expect(reload.reserve).toBe(60);
  });
  it('matches the recorded held M4 insertion and end within two native samples', () => {
    const sample = followup.reloads.find(row => row.mode === 'held')!;
    const reload = new NativeReloadState('m4a4'); reload.ammo = sample.ammoBefore; reload.start(0, true);
    const insertion = .2 + (41 / 30 - .2) * 2;
    expect(Math.abs(insertion - (sample.insertGameTime - sample.startGameTime))).toBeLessThan(2 * followup.demoTickSeconds);
    expect(Math.abs(reload.until - (sample.endGameTime - sample.startGameTime))).toBeLessThan(2 * followup.demoTickSeconds);
    reload.advance(insertion - .001); expect(reload.ammo).toBe(sample.ammoBefore);
    reload.advance(insertion); expect(reload.ammo).toBe(30); expect(reload.silent).toBe(true);
    const end = reload.until;
    reload.advance(.2 + (62 / 30 - .2) * 2); expect(reload.silent).toBe(false);
    expect(reload.until).toBeCloseTo(end); reload.advance(end); expect(reload.active).toBe(false);
  });
  it.each(emptyLive.reloads)('matches live Deagle insertion with empty=$empty', sample => {
    const insert = sample.clipInsertFrame / sample.clipFramesPerSecond;
    expect(Math.abs(insert - sample.insertSeconds)).toBeLessThan(emptyLive.demoTickSeconds);
    const reload = new NativeReloadState('deagle'); reload.ammo = sample.ammoBefore; reload.start(0);
    reload.advance(insert - .001); expect(reload.ammo).toBe(sample.ammoBefore);
    reload.advance(insert); expect(reload.ammo).toBe(sample.ammoAfter); expect(reload.active).toBe(true);
    expect(Math.abs(reload.until - sample.endSeconds)).toBeLessThan(emptyLive.demoTickSeconds);
  });
  it('a short tap and later hold keep normal timing', () => {
    const reload = new NativeReloadState('m4a4'); reload.ammo = 4; reload.start(0, true);
    reload.advance(.05, false); reload.advance(.45, true);
    expect(reload.silent).toBe(false); expect(reload.until).toBeCloseTo(reload.stats.reload);
    reload.advance(reload.until, true); expect(reload.active).toBe(false);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-end']);
  });
  it.each(['nova', 'xm1014', 'sawedoff'] as const)('%s inserts shells individually and finishes after interruption', id => {
    const reload = new NativeReloadState(id); reload.ammo = 0;
    reload.start(0); expect(reload.interrupt()).toBe(false);
    reload.advance(SHELL_RELOAD_START); expect(reload.phase).toBe('shell'); expect(reload.ammo).toBe(0);
    const insertedAt = SHELL_RELOAD_START + equipmentStats(id).reload;
    reload.advance(insertedAt); expect(reload.ammo).toBe(1); expect(reload.reserve).toBe(31);
    expect(reload.interrupt()).toBe(true); expect(reload.phase).toBe('finish');
    reload.advance(insertedAt + SHELL_RELOAD_FINISH); expect(reload.active).toBe(false);
    reload.advance(100); expect(reload.ammo).toBe(1); expect(reload.reserve).toBe(31);
    expect(reload.drainActionEvents().map(e => e.kind)).toEqual(['reload-start', 'reload-shell', 'reload-end']);
  });
  it('preserves loaded shells on holster and processes a whole reload across a long step', () => {
    const reload = new NativeReloadState('nova'); reload.ammo = 3;
    reload.start(0); reload.advance(SHELL_RELOAD_START + reload.stats.reload); reload.cancel();
    expect(reload.ammo).toBe(4); expect(reload.reserve).toBe(31);
    reload.start(10); reload.advance(100); expect(reload.ammo).toBe(8); expect(reload.reserve).toBe(27);
  });
  it('retains actual phase deadlines when a long frame crosses several shell inserts',()=>{
    const reload=new NativeReloadState('nova');reload.ammo=6;reload.start(10);reload.advance(20);
    const events=reload.drainActionEvents();
    expect(events.map(e=>e.kind)).toEqual(['reload-start','reload-shell','reload-shell','reload-end']);
    expect(events[1].at).toBeCloseTo(10+SHELL_RELOAD_START+reload.stats.reload);
    expect(events[2].at).toBeCloseTo(10+SHELL_RELOAD_START+2*reload.stats.reload);
    expect(events[3].at).toBeCloseTo(10+SHELL_RELOAD_START+2*reload.stats.reload+SHELL_RELOAD_FINISH);
  });
  it('does not create reloads for full guns, knives, Zeus or exhausted reserves', () => {
    for (const id of ['ak47', 'knife', 'zeus'] as const) expect(new NativeReloadState(id).start(0)).toBe(false);
    const empty = new NativeReloadState('nova'); empty.ammo = 0; empty.reserve = 0;
    expect(empty.start(0)).toBe(false);
  });
  it('does not restart the retained empty-start finish approximation on repeated requests', () => {
    const reload = new NativeReloadState('nova'); reload.ammo = 0; reload.start(0);
    const inserted = SHELL_RELOAD_START + reload.stats.reload;
    reload.advance(inserted); reload.interrupt();
    reload.advance(inserted + .1); reload.interrupt(); expect(reload.until).toBeCloseTo(inserted + SHELL_RELOAD_FINISH);
    reload.advance(inserted + SHELL_RELOAD_FINISH); expect(reload.active).toBe(false); expect(reload.ammo).toBe(1);
  });
  it('restores loud playback before completion when the authored silent section ends', () => {
    const reload = new NativeReloadState('mag7'); reload.ammo = 0; reload.start(0, true);
    reload.advance(reload.until, false);
    const events = reload.drainActionEvents();
    expect(events[events.length - 1]).toMatchObject({kind: 'reload-end', silent: false});
    expect(reload.silent).toBe(false);
  });
  it('rejects invalid silent speed coefficients', () => {
    for (const speed of [0, .5, Infinity, NaN]) expect(() => new NativeReloadState('nova', speed)).toThrow();
  });
});
