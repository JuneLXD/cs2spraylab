import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from '../../actor-physics';
import {aimReport, AimRecorder, type AimPlayer} from '../../aim-report';
import {aimReportStore} from '../../aim-report-store';
import type {FlickRecord} from '../../aim-vector';
import {defaults} from '../../config';
import {directionStore} from '../../direction-store';
import {AimScreen} from './AimScreen';

const player = (patch: Partial<AimPlayer> = {}): AimPlayer => ({eye: {x: 0, y: 1.6, z: 0}, yaw: 0, pitch: 0, vx: 0, vz: 0, maxSpeed: 215 * UNIT,
  forward: 0, side: 0, airborne: false, walking: false, ducking: false, ...patch});
const render = (mode: string) => renderToStaticMarkup(createElement(AimScreen, {mode, settings: defaults, update: () => {}}));

/** A short session: a flick to a target that appears, a hit, and a few shots while strafing. */
function session() {
  const recorder = new AimRecorder();
  let t = 0, yaw = 0;
  const step = (until: number, each?: () => void) => {while (t + 1e-9 < until) {t += 1 / 128; each?.(); recorder.frame(t, player({yaw}), t > .5 ? [{key: 'a', point: {x: Math.sin(8 * DEG) * 5, y: 1.6, z: -Math.cos(8 * DEG) * 5}, radius: .1}] : []);}};
  step(.75);
  step(.95, () => {const delta = 8 / 26; yaw -= delta * DEG; recorder.look(t, delta, 0);});
  step(1.1);
  recorder.hit(recorder.shot(t, player({yaw}), 'ak47'), 'a', true, true);
  for (let i = 0; i < 4; i++) recorder.shot(t, player({yaw, vx: 215 * UNIT, side: 1}), 'ak47', i + 1);
  return aimReport(recorder, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
}
/** Direction Calibration flicks that land 10% short, 4 per direction at 8 degrees. */
const calibration = (): FlickRecord[] => Array.from({length: 64}, (_, i) => {
  const dir = i % 16, angle = dir * Math.PI / 8, tx = 8 * Math.cos(angle), ty = -8 * Math.sin(angle);
  return {at: i, dir, amp: 8, radius: .57, tx, ty, mx: tx * .9, my: ty * .9, px: tx * .9, py: ty * .9, reaction: .2, total: .5, corrections: 1, shots: 1, condition: 'off', valid: true};
});

describe('Aim tab', () => {
  it('explains how to get a report before there is one', () => {
    aimReportStore.clear(); directionStore.clear();
    const html = render('pop');
    expect(html).toContain('No report yet');
    expect(html).toContain('Play any mode');
    expect(html).not.toContain('Direction profile');
  });
  it('shows the latest session: tips, tiles, every panel and the downloads', () => {
    aimReportStore.clear(); directionStore.clear();
    aimReportStore.save(session());
    const html = render('botz');
    expect(html).toContain('Aim Botz');
    expect(html).toContain('THIS MODE');
    expect(html).toContain('80% of your shots were fired while moving');
    for (const text of ['Hit rate', 'Time to hit', 'Reaction', 'Shots while moving', 'Throughput', 'Targets per minute', 'Where your time to hit goes', 'Shooting while moving',
      'Clicks and misses', 'Pace and consistency', 'Flicks by direction', 'Bursts and sprays', 'Download report', 'Download data', 'Download all reports'])
      expect(html).toContain(text);
    expect(html).toContain('1 of 1 target cleared');
    expect(html).toContain('5 shots');
    aimReportStore.clear();
  });
  it('holds Direction Calibration\'s results: the chart, the fitted profile and the blind test, even with no session report', () => {
    aimReportStore.clear(); directionStore.clear();
    directionStore.add(calibration());
    const empty = render('pop');
    expect(empty).toContain('No report yet'); expect(empty).toContain('Direction profile');
    aimReportStore.save(session());
    const html = render('pop');
    for (const text of ['Direction profile', '64 calibration flicks recorded', 'every Direction Calibration flick in this browser', 'sl-direction-chart', 'Use fitted profile',
      'Apply profile in SprayLab', 'Blind A/B test', 'Per-direction numbers'])
      expect(html).toContain(text);
    aimReportStore.clear(); directionStore.clear();
  });
});
