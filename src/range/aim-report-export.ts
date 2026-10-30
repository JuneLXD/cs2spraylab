import {ACCURATE_SPEED, type AimBucket, type AimGroup, type AimReport} from './aim-report';
import {DIRECTION_NAMES, isNeutralProfile, type DirectionProfile, type DirectionReport} from './aim-vector';
import {equipmentNames} from './equipment';

/** The aim report as files to keep or share: a readable page (self-contained HTML that prints well) and the numbers as JSON. Both
 * carry the session's report and, when you have Direction Calibration flicks, the direction section of the Aim tab: where first
 * movements land in 16 directions, the fitted profile, the gap report and the blind test. Built from the same numbers the tab shows. */

/** The Aim tab's direction section: Direction Calibration's analysis of every calibration flick in this browser, the gap report's
 * wording, and the profile in use. */
export type DirectionSection = {report: DirectionReport; gap?: string; applied: DirectionProfile; on: boolean; strength: number};

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]!);
/** A number with `digits` decimals, never "-0.0". */
const fixed = (value: number, digits: number) => {const text = value.toFixed(digits); return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;};
const percent = (value: number, digits = 0) => `${fixed(value * 100, digits)}%`;
const degrees = (value: number) => `${fixed(value, 1)}°`;
const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const rate = (bucket: AimBucket) => bucket.shots ? percent(bucket.hits / bucket.shots) : '–';
const signed = (value: number) => Math.abs(value) < .005 ? 'on target' : `${percent(Math.abs(value))} ${value < 0 ? 'short' : 'past'}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const when = (iso: string) => new Date(iso).toLocaleString([], {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});

/** A file name for the report: what was played and when it started. */
export function aimReportFileName(report: AimReport, extension: 'html' | 'json') {
  const slug = report.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  return `spraylab-aim-report-${slug}-${report.started.slice(0, 16).replace(/[T:]/g, '-')}.${extension}`;
}

/** The report and the direction section as plain data (format `spraylab-aim-report`, version 1). */
export function aimReportData(report: AimReport, direction?: DirectionSection) {
  return {format: 'spraylab-aim-report', version: 1, exported: new Date().toISOString(), report,
    ...(direction ? {directionCalibration: {calibrationFlicks: direction.report.summary.valid, summary: direction.report.summary,
      byDirection: direction.report.directions.map(stat => ({...stat, name: DIRECTION_NAMES[stat.dir]})),
      ...(direction.report.fit ? {fit: direction.report.fit} : {}), ...(direction.report.comparison ? {comparison: direction.report.comparison} : {}),
      ...(direction.gap ? {gap: direction.gap} : {}), test: direction.report.test,
      applied: {profile: direction.applied, on: direction.on, strength: direction.strength}}} : {})};
}

const table = (head: readonly string[], rows: readonly (readonly string[])[]) => `<table><thead><tr>${head.map(cell => `<th>${escape(cell)}</th>`).join('')}</tr></thead><tbody>${
  rows.map(row => `<tr>${row.map((cell, index) => index ? `<td>${escape(cell)}</td>` : `<th>${escape(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
/** Stacked shares with their values written out beside the colours. */
const bar = (parts: readonly {name: string; value: number; text: string; color: string}[]) => {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return `<div class="bar">${parts.filter(part => part.value > 0).map(part => `<i style="width:${(part.value / total * 100).toFixed(2)}%;background:${part.color}"></i>`).join('')}</div>
<p class="legend">${parts.map(part => `<span><b style="background:${part.color}"></b>${escape(part.name)} <strong>${escape(part.text)}</strong></span>`).join('')}</p>`;
};
const groups = (title: string, list: readonly AimGroup[]) => table([title, 'Flicks', 'First movement', 'Typical miss', 'Time to hit'],
  list.map(entry => [entry.label, String(entry.n), signed(entry.bias), percent(entry.error), entry.time ? ms(entry.time) : '–']));
const section = (title: string, body: string) => `<section><h2>${escape(title)}</h2>${body}</section>`;
const note = (text: string) => `<p class="note">${escape(text)}</p>`;
const colors = {grey: '#8b96a1', blue: '#4f86c6', amber: '#d29b2f', green: '#3c9a3e', red: '#d9443c'};

/** Direction Calibration's chart: where first movements landed in each of 16 directions, on rings at 0.8, 1 (on target) and 1.2
 * of the flick distance, with 95% intervals. */
function directionChart(report: DirectionReport) {
  // Rings end 115 units out and the labels sit at 132, inside the 300-unit box.
  const size = 300, c = size / 2, radius = (extent: number) => 25 + (Math.min(1.4, Math.max(.6, extent)) - .6) / .8 * 90;
  const point = (angle: number, extent: number) => [c + radius(extent) * Math.cos(angle), c - radius(extent) * Math.sin(angle)].map(value => value.toFixed(1));
  const rings = [.8, 1, 1.2].map(extent => `<circle cx="${c}" cy="${c}" r="${radius(extent).toFixed(1)}" fill="none" stroke="${extent === 1 ? '#5b6670' : '#c9d0d6'}" stroke-width="${extent === 1 ? 1.5 : 1}"${extent === 1 ? '' : ' stroke-dasharray="2 4"'}/>`).join('');
  const spokes = Array.from({length: 16}, (_, dir) => {const [x, y] = point(dir * Math.PI / 8, 1.4); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#e3e7ea"/>`;}).join('');
  const labels = ([['Right', 0], ['Up', Math.PI / 2], ['Left', Math.PI], ['Down', Math.PI * 1.5]] as const).map(([label, angle]) => {
    return `<text x="${(c + 132 * Math.cos(angle)).toFixed(1)}" y="${(c - 132 * Math.sin(angle)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
  }).join('');
  const marks = report.directions.filter(stat => stat.n > 0).map(stat => {
    const angle = stat.dir * Math.PI / 8, [x, y] = point(angle, stat.extent), [lx, ly] = point(angle, stat.low), [hx, hy] = point(angle, stat.high);
    return `${stat.n > 1 ? `<line x1="${lx}" y1="${ly}" x2="${hx}" y2="${hy}" stroke="#6b7680" stroke-width="1.5" stroke-linecap="round"/>` : ''}<circle cx="${x}" cy="${y}" r="3.5" fill="#1d2329"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Where first movements landed in each direction">${rings}${spokes}${labels}${marks}</svg>`;
}

function directionHtml(direction: DirectionSection) {
  const {report, gap, applied, on, strength} = direction, {summary, fit, test} = report;
  const fitted = fit ? table(['Direction', 'Fitted', '± 95%', 'To apply', 'In use'], ([['Right', 'right', 'asymmetry'], ['Left', 'left', 'asymmetry'], ['Up', 'up', 'up'],
    ['Down', 'down', 'down']] as const).map(([label, key, error]) => [label, `×${fit.fitted[key].toFixed(3)}`, percent(1.96 * fit.se[error], 1), `×${fit.profile[key].toFixed(3)}`,
    `×${applied[key].toFixed(3)}`]).concat([['Rotation', degrees(fit.fitted.rotation), degrees(1.96 * fit.se.rotation), degrees(fit.profile.rotation),
    degrees(applied.rotation)]])) : note(`The profile needs 48 calibration flicks; ${summary.valid} so far.`);
  const time = test.time;
  return `<div class="columns"><div>${directionChart(report)}
${note(`${summary.valid} calibration flicks (every Direction Calibration flick in this browser, not only this session). First movements: ${percent(summary.perfect)} inside the target, ${percent(summary.over)} past it, ${percent(summary.under)} short; typical miss ${percent(summary.error, 1)} of the flick; reaction ${ms(summary.reaction)}, time to hit ${ms(summary.total)}.`)}
${gap ? note(gap) : ''}</div><div><h3>Fitted profile</h3>${fitted}
${note(`Profile in use: ${isNeutralProfile(applied) ? 'none' : `${on ? 'on' : 'off'} in SprayLab at ${Math.round(strength * 100)}% strength`}.`)}
${note(test.ready && time && test.error ? `Blind A/B test: with the profile your time to hit was ${percent(time.estimate - 1, 1)} (95% interval ${percent(time.low - 1, 1)} to ${percent(time.high - 1, 1)}) and first movements ended ${percent(test.error.estimate, 1)} of the distance ${test.error.estimate <= 0 ? 'closer' : 'further'}.`
    : `Blind A/B test: ${test.on} flicks with the profile and ${test.off} without; the comparison needs 32 of each.`)}</div></div>
<h3>By direction</h3>${table(['Direction', 'Flicks', 'Distance (1 = on target)', 'Turn', 'Inside / past / short', 'Time to hit'], report.directions.map(stat => [DIRECTION_NAMES[stat.dir], String(stat.n),
  stat.n ? stat.extent.toFixed(3) : '–', stat.n ? degrees(stat.angle) : '–', stat.n ? `${percent(stat.perfect)} / ${percent(stat.over)} / ${percent(stat.under)}` : '–', stat.n ? ms(stat.total) : '–']))}`;
}

/** The report as a self-contained page: the same sections as the Aim tab, with every number written out. */
export function aimReportHtml(report: AimReport, direction?: DirectionSection) {
  const {movement, stops, click, phases, landing, spread, halves, misses, stance, sides} = report, n = report.shots || 1;
  const tiles: [string, string, string][] = [
    ['Hit rate', report.shots ? percent(report.hits / report.shots) : '–', `${report.hits}/${report.shots} shots${report.mode !== 'pop' && report.hits ? `, ${percent(report.heads / report.hits)} heads` : ''}`],
    ['Time to hit', report.timeToHit === undefined ? '–' : ms(report.timeToHit), `median over ${report.hitTimes} targets`],
    ['Reaction', report.reaction === undefined ? '–' : ms(report.reaction), `median of ${report.fresh} that appeared`],
    ['Shots while moving', report.shots ? percent((movement.moving.shots + movement.air.shots) / n) : '–', `${movement.moving.shots} moving, ${movement.air.shots} in the air`],
    ['Throughput', report.throughput === undefined ? '–' : `${report.throughput.toFixed(1)} bits/s`, 'aiming done per second (Fitts)'],
    ['Targets per minute', report.perMinute === undefined ? '–' : report.perMinute.toFixed(1), `${report.cleared} of ${report.targets} targets cleared`],
  ];
  const parts: string[] = [];
  parts.push(`<section class="tips">${report.tips.map(tip => `<article class="${tip.tone}"><strong>${escape(tip.title)}</strong><p>${escape(tip.detail)}</p></article>`).join('') ||
    '<article class="good"><strong>Not enough shots for advice yet</strong><p>Each tip needs enough shots or flicks to be sure of it.</p></article>'}</section>`);
  parts.push(`<section class="tiles">${tiles.map(([label, value, detail]) => `<div><small>${escape(label)}</small><strong>${escape(value)}</strong><p>${escape(detail)}</p></div>`).join('')}</section>`);
  parts.push(section('Flicks', (phases ? `<h3>Where your time to hit goes</h3>${bar([{name: 'Before moving', value: phases.before, text: ms(phases.before), color: colors.grey},
    {name: 'First movement', value: phases.flick, text: ms(phases.flick), color: colors.blue}, {name: 'Adjusting', value: phases.adjust, text: ms(phases.adjust), color: colors.amber},
    {name: 'On target before the shot', value: phases.confirm, text: ms(phases.confirm), color: colors.green}])}${note(`Means over ${phases.n} timed flicks, ${ms(phases.total)} in all.`)}` : '') +
    (landing ? `<h3>Where the first movement ended</h3>${bar([{name: 'On the target', value: landing.inside, text: percent(landing.inside), color: colors.green},
      {name: 'Past it', value: landing.past, text: percent(landing.past), color: colors.amber}, {name: 'Short of it', value: landing.short, text: percent(landing.short), color: colors.blue}])}
${note(`Typical miss ${percent(landing.error)} of the flick, ${Math.abs(landing.bias) < .005 ? 'no overall bias' : `${percent(Math.abs(landing.bias))} ${landing.bias < 0 ? 'short' : 'past'} overall`}${spread?.scatter === undefined ? '' : `, varying ±${percent(spread.scatter)} around that`}, ${landing.corrections.toFixed(1)} corrections per flick${report.peak === undefined ? '' : `, top speed ${Math.round(report.peak)}°/s`}.`)}
${report.sizes.length ? groups('Flick size', report.sizes) : ''}` : note('No flick could be measured in this session.'))));
  parts.push(section('Pace and consistency', [
    spread?.reaction ? `Reaction: the middle half of your reactions took ${ms(spread.reaction[0])} to ${ms(spread.reaction[1])}.` : '',
    spread?.time ? `Time to hit: the middle half took ${ms(spread.time[0])} to ${ms(spread.time[1])}.` : '',
    report.timeToKill === undefined ? '' : `Time to clear a target: ${ms(report.timeToKill)} (median).`,
    report.firstShot === undefined ? '' : `${percent(report.firstShot)} of targets were hit with the first shot.`,
  ].filter(Boolean).map(note).join('') + (halves ? table(['Half', 'Shots', 'Hit rate', 'Timed flicks', 'Time to hit'], [['First half', String(halves.first.shots), percent(halves.first.hit),
    String(halves.first.flicks), halves.first.time === undefined ? '–' : ms(halves.first.time)], ['Second half', String(halves.second.shots), percent(halves.second.hit),
    String(halves.second.flicks), halves.second.time === undefined ? '–' : ms(halves.second.time)]]) : '')));
  if (report.directions?.length) parts.push(section('Flicks by direction (this session)', groups('Direction', report.directions)));
  parts.push(section('Shooting while moving', table(['When you fired', 'Shots', 'Share', 'Hit rate'], [
    ['Standing', String(movement.standing.shots), percent(movement.standing.shots / n), rate(movement.standing)],
    ['Stopped', String(movement.stopped.shots), percent(movement.stopped.shots / n), rate(movement.stopped)],
    ['Moving', String(movement.moving.shots), percent(movement.moving.shots / n), rate(movement.moving)],
    ['In the air', String(movement.air.shots), percent(movement.air.shots / n), rate(movement.air)],
    ...(stance ? [['Crouched', String(stance.crouched.shots), percent(stance.crouched.shots / n), rate(stance.crouched)],
      ['Walking', String(stance.walking.shots), percent(stance.walking.shots / n), rate(stance.walking)]] : []),
  ]) + note(`Median speed at a shot ${Math.round(movement.speed)} u/s. CS2 adds movement inaccuracy above ${Math.round(ACCURATE_SPEED * 100)}% of your weapon's running speed.`) +
    (stops && stops.n ? `<h3>Stops before a shot</h3>${note(`${stops.counter} with the opposite key, ${stops.release} by letting go, ${stops.none} without stopping. ${stops.early} shots came before you were accurate, ${stops.onTime} within 100 ms of it and ${stops.late} later${stops.since === undefined ? '' : `; a median ${ms(stops.since)} from starting a stop to the shot`}${stops.toAccurate?.counter === undefined ? '' : `; accurate after ${ms(stops.toAccurate.counter)} with the opposite key`}${stops.toAccurate?.release === undefined ? '' : `, ${ms(stops.toAccurate.release)} letting go`}.`)}` : '') +
    (sides ? table(['Strafing', 'Stops', 'Before accurate', 'Accurate after'], (['left', 'right'] as const).flatMap(way => sides[way] ? [[way === 'left' ? 'Left' : 'Right',
      String(sides[way]!.n), percent(sides[way]!.early / sides[way]!.n), sides[way]!.toAccurate === undefined ? '–' : ms(sides[way]!.toAccurate!)]] : [])) : '')));
  parts.push(section('Clicks and misses', (click ? table(['At the first shot of a press', 'Clicks', 'Hit rate'], [['Settled (target under 30°/s)', String(click.settled.shots), rate(click.settled)],
    ['Still moving', String(click.moving.shots), rate(click.moving)]]) + note(`Median ${Math.round(click.speed)}°/s: the target's speed across your crosshair.`) : '') +
    (misses ? note(`${misses.n} misses with a target near: the crosshair was on the target for ${misses.on} (spread, recoil or moving) and off it for ${misses.off} (aim).`) : '') +
    (report.bullets && report.bullets.length > 1 ? `<h3>By shot in a press</h3>${table(['Shot', 'Shots', 'Hit rate'], report.bullets.map(entry => [entry.label, String(entry.shots), rate(entry)]))}` : '') +
    (report.placement === undefined ? '' : note(`Crosshair placement: targets appeared a median ${report.placement.toFixed(1)}° from your crosshair${report.placed === undefined ? '' : `, ${percent(report.placed)} already under it`}.`))));
  if (direction) parts.push(section('Direction profile', directionHtml(direction)));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SprayLab aim report: ${escape(report.label)}, ${escape(when(report.started))}</title>
<style>
:root{--text:#1d2329;--muted:#5b6670;--line:#dfe3e7;--panel:#f6f7f8;--accent:#3c9a3e;--warn:#d29b2f}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 24px 48px}header small{letter-spacing:.18em;font-weight:700;color:var(--accent);font-size:12px}
h1{font-size:34px;margin:4px 0}h2{font-size:18px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:14px;margin:16px 0 6px;color:var(--muted)}section{margin:26px 0;break-inside:avoid}.meta{color:var(--muted);margin:0}
.tips{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.tips article{border:1px solid var(--line);border-left:4px solid var(--warn);padding:10px 14px;background:var(--panel)}
.tips article.good{border-left-color:var(--accent)}.tips p{margin:4px 0 0;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tiles div{border:1px solid var(--line);padding:10px 14px}
.tiles small{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--muted);font-weight:700}.tiles strong{font-size:26px}.tiles p{margin:0;font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px;margin:6px 0}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.note{color:var(--muted);margin:6px 0}
.bar{display:flex;height:12px;background:var(--line);overflow:hidden;margin-top:4px}.bar i{display:block;height:100%}
.legend{margin:6px 0;font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px}.legend b{display:inline-block;width:9px;height:9px;margin-right:5px}.legend strong{color:var(--text)}
.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.chart{width:100%;max-width:300px;display:block;margin:0 auto}.chart text{font-size:11px;fill:var(--muted)}
footer{margin-top:32px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
@media (max-width:700px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:minmax(0,1fr)}}
</style></head><body><main>
<header><small>SPRAYLAB AIM REPORT</small><h1>${escape(report.label)}</h1>
<p class="meta">${escape(equipmentNames[report.weapon])} · ${escape(when(report.started))} · ${escape(clock(report.seconds))} played · ${report.cleared} of ${report.targets} targets cleared</p></header>
${parts.join('\n')}
<footer>Exported ${escape(when(new Date().toISOString()))} from SprayLab. Times are from the simulation's clock; a flick runs from a target appearing (or your previous shot or kill) to the first hit, and only flicks that started from a still crosshair count toward reaction. Thresholds such as 30°/s for a settled click and 100 ms for a late shot are SprayLab's judgement calls; the ${Math.round(ACCURATE_SPEED * 100)}% accurate speed is CS2's.</footer>
</main></body></html>
`;
}
