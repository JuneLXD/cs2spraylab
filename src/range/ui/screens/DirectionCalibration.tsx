import {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import type {Settings} from '../../config';
import {directionLimits, directionProfileFile, directionReport, isNeutralProfile, MIN_FIT, modelExtent, neutralDirectionProfile, RECOMMENDED_FLICKS, TEST_FLICKS,
  type DirectionProfile, type DirectionReport, type ModelComparison} from '../../aim-vector';
import {directionStore} from '../../direction-store';
import {vectorReach} from '../../pop-vector';
import {download} from '../download';
import {Button, SliderRow as Slider, SwitchRow as Toggle} from '../primitives';
import '../direction.css';

const names = ['Right', 'Right, up-right', 'Up-right', 'Up, up-right', 'Up', 'Up, up-left', 'Up-left', 'Left, up-left', 'Left', 'Left, down-left', 'Down-left',
  'Down, down-left', 'Down', 'Down, down-right', 'Down-right', 'Right, down-right'];
const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const signedPercent = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(digits)}%`;
const milliseconds = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const degrees = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}°`;

/** What the cross-validated comparison says a direction profile can fix, and how much of it the four-direction profile Raw
 * Accel applies captures. When the sixteen-direction model does no better out of sample, the four directions get all of it. */
export function gapText(c: ModelComparison) {
  const remaining = ` The remaining ${percent(Math.min(c.iso, c.axis, c.full), 1)} is flick-to-flick variation that no fixed profile can remove; only practice shrinks it.`;
  if (c.share === undefined) return `No reliable direction pattern: on your flicks, direction-dependent sensitivity does not beat a plain sensitivity change (cross-validated, ${percent(c.full, 1)} vs ${percent(c.iso, 1)} typical miss). Your aim is even across directions, or there are not enough flicks yet.${remaining}`;
  if (c.axis <= c.full) return `Direction-dependent sensitivity could cut your typical first-movement miss from ${percent(c.iso, 1)} to ${percent(c.axis, 1)} of the flick distance (cross-validated), and the four-direction profile Raw Accel can apply gets all of it: with this many flicks, finer directional control adds nothing measurable.${remaining}`;
  return `Direction-dependent sensitivity could cut your typical first-movement miss from ${percent(c.iso, 1)} to ${percent(c.full, 1)} of the flick distance (cross-validated). With the four-direction profile Raw Accel can apply it would be ${percent(c.axis, 1)}, ${percent(c.share)} of that improvement; finer directional control could add the rest.${remaining}`;
}

/** The stored flicks, refreshed when another tab records some. */
export function useDirectionRecords() {
  const snapshot = useSyncExternalStore(directionStore.subscribe, directionStore.getSnapshot, directionStore.getSnapshot);
  useEffect(() => directionStore.watchStorage(), []);
  return snapshot;
}

/** Where first movements landed in each of the 16 screen directions: the ring is exactly on target, outside it past the target,
 * inside it short. Bars are 95% intervals; the lines are the four-direction fit (what Raw Accel applies) and the 16-direction one. */
function DirectionChart({report}: {report: DirectionReport}) {
  const size = 300, c = size / 2, radius = (extent: number) => 32 + (Math.min(1.4, Math.max(.6, extent)) - .6) / .8 * 104;
  // Screen directions: counterclockwise from right, with up toward the top of the chart.
  const point = (angle: number, extent: number) => ({x: c + radius(extent) * Math.cos(angle), y: c - radius(extent) * Math.sin(angle)});
  const flip = report.calibration[report.calibration.length - 1]?.flip ?? 0, angles = Array.from({length: 73}, (_, i) => i * Math.PI / 36);
  const curve = (model: Parameters<typeof modelExtent>[0]) =>
    `M${angles.map(angle => {const p = point(angle, modelExtent(model, angle, flip)); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join('L')}`;
  const measured = report.directions.filter(stat => stat.n > 0), profiled = report.profiled.filter(stat => stat.n > 0);
  const labels: [string, number][] = [['Right', 0], ['Up', Math.PI / 2], ['Left', Math.PI], ['Down', Math.PI * 1.5]];
  return <svg className="sl-direction-chart" viewBox={`0 0 ${size} ${size}`} role="img"
    aria-label={`Flick landing by direction: ${measured.map(stat => `${names[stat.dir]} ${stat.extent.toFixed(2)}`).join(', ') || 'no flicks yet'}`}>
    {[.8, 1, 1.2].map(extent => <circle key={extent} cx={c} cy={c} r={radius(extent)} className={extent === 1 ? 'ring-target' : 'ring'}/>)}
    {Array.from({length: 16}, (_, dir) => {const end = point(dir * Math.PI / 8, 1.4); return <line key={dir} x1={c} y1={c} x2={end.x} y2={end.y} className="spoke"/>;})}
    {labels.map(([label, angle]) => {const p = point(angle, 1.5); return <text key={label} x={p.x} y={p.y} className="label" textAnchor="middle" dominantBaseline="middle">{label}</text>;})}
    {[.8, 1, 1.2].map(extent => {const p = point(Math.PI * 11 / 16, extent); return <text key={extent} x={p.x} y={p.y - 2} className="scale" textAnchor="middle">{extent.toFixed(1)}</text>;})}
    {report.full && <path d={curve({full: report.full})} className="fit-full"/>}
    {report.fit && <path d={curve({fit: report.fit})} className="fit-axis"/>}
    {measured.map(stat => {
      const angle = stat.dir * Math.PI / 8, low = point(angle, stat.low), high = point(angle, stat.high), p = point(angle, stat.extent);
      return <g key={stat.dir}><line x1={low.x} y1={low.y} x2={high.x} y2={high.y} className="interval"/><circle cx={p.x} cy={p.y} r={3.5} className="measured"/></g>;
    })}
    {profiled.map(stat => {const p = point(stat.dir * Math.PI / 8, stat.extent); return <circle key={stat.dir} cx={p.x} cy={p.y} r={4.5} className="profiled"/>;})}
  </svg>;
}

function ProfileTable({fit, applied}: {fit: NonNullable<DirectionReport['fit']>; applied: DirectionProfile}) {
  // 95% intervals from the bootstrap standard errors; right and left share the left/right balance.
  const rows: [string, number, number, number, string][] = [
    ['Right', fit.fitted.right, fit.profile.right, fit.se.asymmetry, '×'], ['Left', fit.fitted.left, fit.profile.left, fit.se.asymmetry, '×'],
    ['Up', fit.fitted.up, fit.profile.up, fit.se.up, '×'], ['Down', fit.fitted.down, fit.profile.down, fit.se.down, '×'],
    ['Rotation', fit.fitted.rotation, fit.profile.rotation, fit.se.rotation, '°']];
  const show = (value: number, unit: string) => unit === '°' ? degrees(value) : `×${value.toFixed(3)}`;
  const appliedValue = (label: string) => applied[label.toLowerCase() as keyof DirectionProfile];
  return <table className="sl-direction-table"><thead><tr><th>Direction</th><th>Fitted ± 95%</th><th>To apply</th><th>In use</th></tr></thead><tbody>
    {rows.map(([label, fitted, shrunk, se, unit]) => <tr key={label}><th>{label}</th>
      <td>{show(fitted, unit)} <small>± {unit === '°' ? `${(1.96 * se).toFixed(1)}°` : percent(1.96 * se, 1)}</small></td>
      <td>{show(shrunk, unit)}</td><td>{show(appliedValue(label), unit)}</td></tr>)}
  </tbody></table>;
}

/** Direction Calibration's results: where your flicks land by direction, the fitted profile and how much it can fix, the blind
 * A/B test, and the profile as Raw Accel settings and as a file. */
export function DirectionCalibration({settings, update}: {settings: Settings; update: (patch: Partial<Settings>) => void}) {
  const {records, persisted} = useDirectionRecords();
  const report = useMemo(() => directionReport(records), [records]);
  const [message, setMessage] = useState(''), [confirmClear, setConfirmClear] = useState(false);
  const {fit, comparison, summary, test} = report, applied = settings.directionProfile, hasProfile = !isNeutralProfile(applied);
  const file = useMemo(() => directionProfileFile(report, applied, settings.directionStrength), [report, applied, settings.directionStrength]);
  const counts = report.directions.map(stat => stat.n), fewest = Math.min(...counts);
  const reach = vectorReach({vectorReach: settings.popVectorReach, distance: settings.popDistance, size: settings.popSize / 100});
  const copy = async () => {
    try {await navigator.clipboard.writeText(JSON.stringify(file, null, 2)); setMessage('Copied the profile.');}
    catch {setMessage('Copying is blocked here: use Download instead.');}
  };
  const time = test.time, verdict = !time ? '' : time.high < 1 ? 'The profile makes you faster. Keep it.'
    : time.low > 1 ? 'The profile makes you slower. Turn it off.' : 'No clear difference. Keep testing, or the profile is not worth using.';
  return <section className="sl-direction" aria-label="Direction profile">
    <h2>Direction profile</h2>
    <p className="setting-explanation">{summary.valid} calibration {summary.valid === 1 ? 'flick' : 'flicks'} recorded, at least {fewest} in every direction. Aim for {RECOMMENDED_FLICKS} (three rounds of 48); the profile needs {MIN_FIT}. Calibration flicks are the ones with the profile switched off. Flicks stay in this browser{persisted ? '' : ' until you close this tab (storage is unavailable)'}.
      {reach < settings.popVectorReach - .05 && ` At this distance the largest flick is limited to ${reach.toFixed(1)}° so targets stay above the floor; bring the targets closer for bigger flicks.`}</p>
    <DirectionChart report={report}/>
    <p className="sl-direction-legend"><span className="key measured"/>Where first movements landed: the bright ring is exactly on target, outside it past the target, inside it short. Bars are 95% intervals.
      <span className="key fit-axis"/>Four-direction fit (what Raw Accel can apply). <span className="key fit-full"/>Sixteen-direction fit.{report.profiled.some(stat => stat.n) && <><span className="key profiled"/>With your profile on.</>}</p>
    {summary.valid > 0 && <p className="setting-explanation">First movements: {percent(summary.perfect)} ended inside the target, {percent(summary.over)} past it, {percent(summary.under)} short.
      Typical miss {percent(summary.error, 1)} of the flick distance. Reaction {milliseconds(summary.reaction)}, time to hit {milliseconds(summary.total)}, {summary.corrections.toFixed(1)} corrections per flick, {percent(summary.firstShot)} hit with the first shot.
      Overall your first movements {summary.bias < 0 ? `fall ${percent(-summary.bias, 1)} short` : `overshoot by ${percent(summary.bias, 1)}`} (that is your sensitivity, which a direction profile leaves alone)
      {Math.abs(summary.angle) < .1 ? ' and keep their direction' : ` and turn ${Math.abs(summary.angle).toFixed(1)}° ${summary.angle > 0 ? 'counterclockwise' : 'clockwise'}`}.</p>}
    {comparison && <p className="setting-explanation" data-testid="direction-gap">{gapText(comparison)}</p>}
    {fit ? <>
      <ProfileTable fit={fit} applied={applied}/>
      <p className="setting-explanation">Multipliers act on mouse counts before your sensitivity, in Raw Accel's order: rotate, then scale each direction. To apply shrinks each one toward no change by its own uncertainty, so noise never becomes a correction; limits are {percent(directionLimits.gain[0] - 1)}/+{percent(directionLimits.gain[1] - 1)} and ±{directionLimits.rotation}°. Your flicks imply a horizontal sensitivity ×{fit.scale.toFixed(3)}; that is reported, not applied. Changing up and down also changes how far you pull down to control a spray.</p>
      <div className="sl-preset-actions"><Button onClick={() => {update({directionProfile: fit.profile, directionProfileOn: true}); setMessage('Applied the fitted profile.');}}>Use fitted profile</Button>
        {hasProfile && <Button onClick={() => {update({directionProfile: neutralDirectionProfile, directionProfileOn: false, directionTest: false}); setMessage('Cleared the profile.');}}>Clear profile</Button>}</div>
    </> : <p className="setting-explanation">Record {Math.max(0, MIN_FIT - summary.valid)} more calibration {MIN_FIT - summary.valid === 1 ? 'flick' : 'flicks'} for a profile.</p>}
    <Toggle label="Apply profile in SprayLab" checked={settings.directionProfileOn} disabled={!hasProfile} onChange={directionProfileOn => update({directionProfileOn})}/>
    <Slider label="Profile strength" value={Math.round(settings.directionStrength * 100)} min={0} max={100} step={5} suffix=" %" onChange={value => update({directionStrength: value / 100})}/>
    <Toggle label="Blind A/B test" checked={settings.directionTest} disabled={!hasProfile} onChange={directionTest => update({directionTest})}/>
    <p className="setting-explanation" data-testid="direction-test">{settings.directionTest || test.on + test.off > 0 ? <>
      {settings.directionTest && 'The blind test switches your profile on and off in hidden blocks of 16 flicks, so you cannot tell which is which. '}
      {test.ready && time && test.error && test.firstShot ? <>With the profile your time to hit was {signedPercent(time.estimate - 1)} (95% interval {signedPercent(time.low - 1)} to {signedPercent(time.high - 1)}),
        first movements ended {signedPercent(test.error.estimate)} of the distance {test.error.estimate <= 0 ? 'closer' : 'further'}, and {percent(test.firstShot.on)} vs {percent(test.firstShot.off)} were hit with the first shot. <strong>{verdict}</strong></>
        : `${test.on} flicks with the profile and ${test.off} without so far; the comparison needs ${TEST_FLICKS} of each.`}
    </> : 'Once a profile is in use, the blind A/B test measures whether it actually makes you faster.'}</p>
    {hasProfile && <>
      <h2>Use it in CS2</h2>
      <p className="setting-explanation">Raw Accel, a signed Windows mouse driver, can apply these fields to all mouse input, CS2 included. They include the strength above and assume Raw Accel's defaults (Output DPI 1000, ratios 1, no rotation): with other settings, multiply your Output DPI by {(applied.right ** settings.directionStrength).toFixed(4)}, multiply each ratio by its value here and add the rotation. Raw Accel's window has no left/right or up/down fields, so edit them in its settings.json and run writer.exe settings.json, or let the SprayLab companion (spraylab-direction.exe) do all of it from the downloaded profile. While Raw Accel applies the profile, switch Apply profile in SprayLab off, and switch the Raw Accel profile off before calibrating again: SprayLab sees what Raw Accel outputs, so it would measure on top of it.</p>
      <pre className="sl-direction-export" data-testid="raw-accel-fields">{Object.entries(file.rawAccel).map(([key, value]) => `"${key}": ${value}`).join('\n')}</pre>
      <div className="sl-preset-actions"><Button onClick={() => void copy()}>Copy profile</Button><Button onClick={() => download('spraylab-direction-profile.json', file)}>Download profile</Button></div>
    </>}
    <p className="sl-preset-status" role="status">{message}</p>
    {summary.valid > 0 && <details className="sl-direction-details"><summary>Per-direction numbers</summary>
      <table className="sl-direction-table"><thead><tr><th>Direction</th><th>Flicks</th><th>Distance ± 95%</th><th>Turn</th><th>Inside / past / short</th><th>Time to hit</th></tr></thead><tbody>
        {report.directions.map(stat => <tr key={stat.dir}><th>{names[stat.dir]}</th><td>{stat.n}</td>
          <td>{stat.n ? `${stat.extent.toFixed(3)}` : '–'}{stat.n > 1 && <small> {stat.low.toFixed(2)}–{stat.high.toFixed(2)}</small>}</td>
          <td>{stat.n ? degrees(stat.angle) : '–'}</td><td>{stat.n ? `${percent(stat.perfect)} / ${percent(stat.over)} / ${percent(stat.under)}` : '–'}</td><td>{stat.n ? milliseconds(stat.total) : '–'}</td></tr>)}
      </tbody></table></details>}
    {records.length > 0 && <div className="sl-preset-actions">{confirmClear
      ? <><Button onClick={() => {directionStore.clear(); setConfirmClear(false); setMessage('Cleared all recorded flicks.');}}>Delete {records.length} flicks</Button><Button onClick={() => setConfirmClear(false)}>Keep them</Button></>
      : <Button onClick={() => setConfirmClear(true)}>Clear recorded flicks</Button>}</div>}
  </section>;
}
