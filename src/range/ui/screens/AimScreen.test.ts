import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from '../../actor-physics';
import {aimReport, AimRecorder, type AimPlayer} from '../../aim-report';
import {aimReportStore} from '../../aim-report-store';
import {AimScreen} from './AimScreen';

const player = (patch: Partial<AimPlayer> = {}): AimPlayer => ({eye: {x: 0, y: 1.6, z: 0}, yaw: 0, pitch: 0, vx: 0, vz: 0, maxSpeed: 215 * UNIT,
  forward: 0, side: 0, airborne: false, walking: false, ducking: false, ...patch});

/** A short session: a flick to a target that appears, a hit, and a few shots while strafing. */
function session() {
  const recorder = new AimRecorder();
  let t = 0, yaw = 0;
  const step = (until: number, each?: () => void) => {while (t + 1e-9 < until) {t += 1 / 128; each?.(); recorder.frame(t, player({yaw}), t > .5 ? [{key: 'a', point: {x: Math.sin(8 * DEG) * 5, y: 1.6, z: -Math.cos(8 * DEG) * 5}, radius: .1}] : []);}};
  step(.75);
  step(.95, () => {const delta = 8 / 26; yaw -= delta * DEG; recorder.look(t, delta, 0);});
  step(1.1);
  recorder.hit(recorder.shot(t, player({yaw}), 'ak47'), 'a', true, true);
  for (let i = 0; i < 4; i++) recorder.shot(t, player({yaw, vx: 215 * UNIT, side: 1}), 'ak47', false);
  return aimReport(recorder, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
}

describe('Aim tab', () => {
  it('explains how to get a report before there is one', () => {
    aimReportStore.clear();
    const html = renderToStaticMarkup(createElement(AimScreen, {mode: 'pop'}));
    expect(html).toContain('No report yet');
    expect(html).toContain('Play any mode');
  });
  it('shows the latest session: tips, tiles, flicks, movement and clicks', () => {
    aimReportStore.clear();
    const report = session();
    aimReportStore.save(report);
    const html = renderToStaticMarkup(createElement(AimScreen, {mode: 'botz'}));
    expect(html).toContain('Aim Botz');
    expect(html).toContain('THIS MODE');
    expect(html).toContain('80% of your shots were fired while moving');
    for (const text of ['Hit rate', 'Time to hit', 'Reaction', 'Shots while moving', 'Where your time to hit goes', 'Shooting while moving', 'Clicks'])
      expect(html).toContain(text);
    expect(html).toContain('1 of 1 targets cleared');
    aimReportStore.clear();
  });
});
