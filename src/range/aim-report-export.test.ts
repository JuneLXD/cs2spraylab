import {describe, expect, it} from 'vitest';
import {DEG, UNIT} from './actor-physics';
import {aimReport, AimRecorder, type AimPlayer} from './aim-report';
import {aimReportData, aimReportFileName, aimReportHtml} from './aim-report-export';
import {directionReport, neutralDirectionProfile, type FlickRecord} from './aim-vector';

const player = (patch: Partial<AimPlayer> = {}): AimPlayer => ({eye: {x: 0, y: 1.6, z: 0}, yaw: 0, pitch: 0, vx: 0, vz: 0, maxSpeed: 215 * UNIT,
  forward: 0, side: 0, airborne: false, walking: false, ducking: false, ...patch});
function report(label = 'Aim Botz') {
  const recorder = new AimRecorder();
  let t = 0, yaw = 0;
  const step = (until: number, each?: () => void) => {while (t + 1e-9 < until) {t += 1 / 128; each?.(); recorder.frame(t, player({yaw}), t > .5 ? [{key: 'a', point: {x: Math.sin(8 * DEG) * 5, y: 1.6, z: -Math.cos(8 * DEG) * 5}, radius: .1}] : []);}};
  step(.75);
  step(.95, () => {const delta = 8 / 26; yaw -= delta * DEG; recorder.look(t, delta, 0);});
  step(1.1);
  recorder.hit(recorder.shot(t, player({yaw}), 'ak47'), 'a', true, true);
  for (let i = 0; i < 4; i++) recorder.shot(t, player({yaw, vx: 215 * UNIT, side: 1}), 'ak47', i + 1);
  return aimReport(recorder, {mode: 'botz', label, weapon: 'ak47'})!;
}
const calibration = (): FlickRecord[] => Array.from({length: 64}, (_, i) => {
  const dir = i % 16, angle = dir * Math.PI / 8, tx = 8 * Math.cos(angle), ty = -8 * Math.sin(angle);
  return {at: i, dir, amp: 8, radius: .57, tx, ty, mx: tx * .9, my: ty * .9, px: tx * .9, py: ty * .9, reaction: .2, total: .5, corrections: 1, shots: 1, condition: 'off', valid: true};
});
const direction = () => ({report: directionReport(calibration()), gap: 'No reliable direction pattern: test wording.', applied: neutralDirectionProfile, on: false, strength: 1});

describe('downloadable aim report', () => {
  it('writes a complete page with every section and the tips', () => {
    const value = report(), html = aimReportHtml(value);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const text of ['SPRAYLAB AIM REPORT', '<h1>Aim Botz</h1>', 'AK-47', 'Flicks', 'Pace and consistency', 'Shooting while moving', 'Clicks and misses',
      '80% of your shots were fired while moving', 'Hit rate', 'Throughput'])
      expect(html).toContain(text);
    expect(html).not.toContain('Direction profile');
    expect(html).not.toContain('went into Direction calibration');
    expect(aimReportHtml({...value, calibration: 3})).toContain('3 of this session&#39;s flicks went into Direction calibration.');
  });
  it('escapes what it writes', () => {
    const html = aimReportHtml(report('<script>alert(1)</script> & co'));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });
  it('adds the direction section: the chart, the fit, the gap report and the 16 directions', () => {
    const html = aimReportHtml(report(), direction());
    for (const text of ['Direction profile', '<svg class="chart"', 'Fitted profile', 'No reliable direction pattern: test wording.', 'By direction', 'Right, up-right', '64 calibration flicks',
      'from every mode'])
      expect(html).toContain(text);
    // Turns of no direction read 0.0°, never -0.0°, and every label stays inside the chart.
    expect(html).not.toContain('-0.0°');
    const labels = [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
    expect(labels).toHaveLength(4);
    for (const [x, y] of labels) {expect(x).toBeGreaterThan(15); expect(x).toBeLessThan(285); expect(y).toBeGreaterThan(5); expect(y).toBeLessThan(295);}
  });
  it('saves the numbers as data, with the direction analysis when there is one', () => {
    const value = report(), data = aimReportData(value, direction());
    expect(data).toMatchObject({format: 'spraylab-aim-report', version: 1, report: value, directionCalibration: {calibrationFlicks: 64, gap: 'No reliable direction pattern: test wording.'}});
    expect(data.directionCalibration!.byDirection).toHaveLength(16);
    expect(data.directionCalibration!.byDirection[2]).toMatchObject({dir: 2, name: 'Up-right', n: 4});
    expect(JSON.parse(JSON.stringify(aimReportData(value)))).not.toHaveProperty('directionCalibration');
  });
  it('names the files after the session', () => {
    const value = {...report('Pop · Direction Calibration'), started: '2026-10-29T18:05:42.000Z'};
    expect(aimReportFileName(value, 'html')).toBe('spraylab-aim-report-pop-direction-calibration-2026-10-29-18-05.html');
    expect(aimReportFileName(value, 'json')).toBe('spraylab-aim-report-pop-direction-calibration-2026-10-29-18-05.json');
  });
});
