import {memo, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ACCURATE_SPEED, type AimBucket, type AimGroup, type AimReport} from '../../aim-report';
import {aimReportData, aimReportFileName, aimReportHtml, type DirectionSection} from '../../aim-report-export';
import {aimReportStore} from '../../aim-report-store';
import {directionReport, MIN_FIT, type DirectionReport, type FlickRecord} from '../../aim-vector';
import type {Settings} from '../../config';
import {equipmentNames} from '../../equipment';
import {download, downloadText} from '../download';
import {Button, Panel, SwitchRow as Toggle, Tabs} from '../primitives';
import {DirectionCalibration, gapText, useDirectionRecords} from './DirectionCalibration';
import '../aim.css';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const rate = (bucket: AimBucket) => bucket.shots ? percent(bucket.hits / bucket.shots) : '–';
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const when = (iso: string) => new Date(iso).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
const bias = (value: number) => Math.abs(value) < .005 ? 'on target' : `${percent(Math.abs(value))} ${value < 0 ? 'short' : 'past'}`;
/** Pop has no heads to hit. */
const hasHeads = (report: AimReport) => report.mode !== 'pop';

/** The saved reports, refreshed when another tab saves one. */
export function useAimReports() {
  const snapshot = useSyncExternalStore(aimReportStore.subscribe, aimReportStore.getSnapshot, aimReportStore.getSnapshot);
  useEffect(() => aimReportStore.watchStorage(), []);
  return snapshot;
}

/** A difference from the previous session of the same mode, coloured by whether it is better. */
function Change({now, before, lower = false, unit}: {now?: number; before?: number; lower?: boolean; unit: 'percent' | 'ms' | 'bits'}) {
  if (now === undefined || before === undefined) return null;
  const delta = now - before, shown = unit === 'percent' ? Math.round(delta * 100) : unit === 'ms' ? Math.round(delta * 1000) : Math.round(delta * 10) / 10;
  if (!shown) return <em className="sl-aim-change">same as last time</em>;
  const better = lower ? delta < 0 : delta > 0;
  return <em className={`sl-aim-change ${better ? 'better' : 'worse'}`}>{shown > 0 ? '+' : '−'}{Math.abs(shown)}{unit === 'percent' ? ' pts' : unit === 'ms' ? ' ms' : ' bits/s'} vs last time</em>;
}

function Tile({label, value, detail, tone = ''}: {label: string; value: string; detail?: ReactNode; tone?: string}) {
  return <div className={`sl-result-tile ${tone}`}><small>{label}</small><strong>{value}</strong>{detail && <p>{detail}</p>}</div>;
}

/** Stacked shares with a legend under them, so every number can be read without the colours. */
function Bar({label, parts}: {label: string; parts: {key: string; name: string; value: number; text: string}[]}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return <div className="sl-aim-bar-block"><div className="sl-aim-bar" role="img" aria-label={`${label}: ${parts.map(part => `${part.name} ${part.text}`).join(', ')}`}>
    {parts.map(part => part.value > 0 && <span key={part.key} className={`part-${part.key}`} style={{width: `${part.value / total * 100}%`}}/>)}</div>
    <ul className="sl-aim-legend">{parts.map(part => <li key={part.key}><i className={`part-${part.key}`}/>{part.name} <b>{part.text}</b></li>)}</ul></div>;
}

function Groups({title, list}: {title: string; list: readonly AimGroup[]}) {
  return <table className="sl-aim-table"><thead><tr><th>{title}</th><th>Flicks</th><th>First movement</th><th>Typical miss</th><th>Time to hit</th></tr></thead><tbody>
    {list.map(entry => <tr key={entry.label}><th>{entry.label}</th><td>{entry.n}</td><td>{bias(entry.bias)}</td><td>{percent(entry.error)}</td><td>{entry.time ? ms(entry.time) : '–'}</td></tr>)}
  </tbody></table>;
}

function Flicks({report}: {report: AimReport}) {
  const {phases, landing, spread} = report;
  if (!landing) return <Panel title="Flicks" className="sl-aim-panel"><div className="sl-aim-body"><p className="sl-aim-note">{report.targets
    ? 'No flick could be measured yet: a flick counts from the crosshair standing still to the first hit on a target that needed a clear movement.'
    : 'This mode has no targets that come and go, so there are no flicks to measure. The shot and movement numbers still apply.'}</p></div></Panel>;
  return <Panel title="Flicks" className="sl-aim-panel"><div className="sl-aim-body">
    {phases ? <><h3>Where your time to hit goes</h3>
      <Bar label="Time to hit" parts={[{key: 'before', name: 'Before moving', value: phases.before, text: ms(phases.before)},
        {key: 'flick', name: 'First movement', value: phases.flick, text: ms(phases.flick)},
        {key: 'adjust', name: 'Adjusting', value: phases.adjust, text: ms(phases.adjust)},
        {key: 'confirm', name: 'On target before the shot', value: phases.confirm, text: ms(phases.confirm)}]}/>
      <p className="sl-aim-note">Means over {phases.n} timed {phases.n === 1 ? 'flick' : 'flicks'}, {ms(phases.total)} in all. A flick starts when the target appears or when you finish the previous one.</p></>
      : <p className="sl-aim-note">None of your flicks is timed yet: the ones so far began when the session did, so their wait is not a reaction.</p>}
    <h3>Where the first movement ended</h3>
    <Bar label="First movements" parts={[{key: 'inside', name: 'On the target', value: landing.inside, text: percent(landing.inside)},
      {key: 'past', name: 'Past it', value: landing.past, text: percent(landing.past)}, {key: 'short', name: 'Short of it', value: landing.short, text: percent(landing.short)}]}/>
    <p className="sl-aim-note">Typical miss {percent(landing.error)} of the flick, {Math.abs(landing.bias) < .005 ? 'no overall bias' : `${percent(Math.abs(landing.bias))} ${landing.bias < 0 ? 'short' : 'past'} overall`}{spread?.scatter === undefined ? '' : `, varying ±${percent(spread.scatter)} around that`}, {landing.corrections.toFixed(1)} corrections per flick.
      {spread?.scatter !== undefined && Math.abs(landing.bias) > spread.scatter ? ' Your bias is bigger than your scatter: a habit to fix, not just noise.' : spread?.scatter !== undefined ? ' Your scatter is bigger than your bias: consistency is the thing to train.' : ''}</p>
    {report.sizes.length > 0 && <Groups title="Flick size" list={report.sizes}/>}
  </div></Panel>;
}

/** Throughput, speed, consistency and how the session changed from its first half to its second. */
function Pace({report}: {report: AimReport}) {
  const {spread, halves} = report;
  return <Panel title="Pace and consistency" className="sl-aim-panel"><div className="sl-aim-body">
    <dl className="sl-aim-facts">
      <div><dt>Throughput</dt><dd>{report.throughput === undefined ? '–' : `${report.throughput.toFixed(1)} bits/s`}</dd></div>
      <div><dt>First-movement top speed</dt><dd>{report.peak === undefined ? '–' : `${Math.round(report.peak)}°/s`}</dd></div>
      <div><dt>Time to clear a target</dt><dd>{report.timeToKill === undefined ? '–' : ms(report.timeToKill)}</dd></div>
      <div><dt>Hit with the first shot</dt><dd>{report.firstShot === undefined ? '–' : percent(report.firstShot)}</dd></div>
    </dl>
    <p className="sl-aim-note">Throughput is how much aiming you do per second (Fitts): the flick's distance against the target's size, over the time from starting to move to the hit. Higher is better, and it only compares fairly within one drill and target size.</p>
    {(spread?.reaction || spread?.time) && <><h3>The middle half of your times</h3>
      <p className="sl-aim-note">{spread.reaction && `Reaction ${ms(spread.reaction[0])}–${ms(spread.reaction[1])}. `}{spread.time && `Time to hit ${ms(spread.time[0])}–${ms(spread.time[1])}. `}A narrow range means you aim the same way every time.</p></>}
    {halves ? <><h3>First half and second half</h3>
      <table className="sl-aim-table"><thead><tr><th>Half</th><th>Shots</th><th>Hit</th><th>Time to hit</th></tr></thead><tbody>
        {([['First', halves.first], ['Second', halves.second]] as const).map(([name, half]) => <tr key={name}><th>{name}</th><td>{half.shots}</td><td>{percent(half.hit)}</td><td>{half.time === undefined ? '–' : ms(half.time)}</td></tr>)}
      </tbody></table>
      <p className="sl-aim-note">Faster or better in the second half: you were still warming up. Worse: a shorter session or a break may help.</p></>
      : <p className="sl-aim-note">The two halves compare from 10 shots on.</p>}
  </div></Panel>;
}

function Directions({report, openDirection}: {report: AimReport; openDirection: () => void}) {
  return <Panel title="Flicks by direction" className="sl-aim-panel"><div className="sl-aim-body">
    {report.directions?.length ? <><Groups title="Direction" list={report.directions}/>
      <p className="sl-aim-note">This session's measured flicks by the way they went on screen.</p></>
      : <p className="sl-aim-note">No measured flicks in this session yet.</p>}
    <p className="sl-aim-note">{report.calibration !== undefined && `${plural(report.calibration, 'flick')} from this session went into Direction calibration. `}The Direction calibration view maps your aim by direction over every session and fits a profile.</p>
    <div className="sl-preset-actions"><Button onClick={openDirection}>Open Direction calibration</Button></div>
  </div></Panel>;
}

function Movement({report}: {report: AimReport}) {
  const {movement, stops, stance, sides} = report, n = report.shots || 1;
  const rows: [string, string, AimBucket][] = [['Standing', 'no running in the last 0.6 s', movement.standing],
    ['Stopped', 'ran, then slowed to an accurate speed', movement.stopped],
    ['Moving', `above ${Math.round(ACCURATE_SPEED * 100)}% of running speed`, movement.moving], ['In the air', 'jumping or falling', movement.air],
    ...(stance ? [['Crouched', 'any of the above, ducked', stance.crouched], ['Walking', 'holding the walk key', stance.walking]] as [string, string, AimBucket][] : [])];
  const made = stops ? stops.counter + stops.release : 0;
  return <Panel title="Shooting while moving" className="sl-aim-panel"><div className="sl-aim-body">
    <table className="sl-aim-table"><thead><tr><th>When you fired</th><th>Shots</th><th>Hit</th></tr></thead><tbody>
      {rows.map(([name, note, bucket]) => <tr key={name} className={bucket.shots && (name === 'Moving' || name === 'In the air') ? 'warn' : ''}>
        <th>{name}<small>{note}</small></th><td>{bucket.shots} <small>{percent(bucket.shots / n)}</small></td><td>{rate(bucket)}</td></tr>)}
    </tbody></table>
    <p className="sl-aim-note">Median speed at a shot {Math.round(movement.speed)} u/s. CS2 adds movement inaccuracy above {Math.round(ACCURATE_SPEED * 100)}% of your weapon's running speed.</p>
    {stops && stops.n > 0 ? <>
      <h3>Stops before a shot</h3>
      <Bar label="How you stopped" parts={[{key: 'counter', name: 'Opposite key', value: stops.counter, text: String(stops.counter)},
        {key: 'release', name: 'Let go', value: stops.release, text: String(stops.release)}, {key: 'none', name: 'Did not stop', value: stops.none, text: String(stops.none)}]}/>
      {made > 0 && <Bar label="Shot timing after a stop" parts={[{key: 'early', name: 'Shot before accurate', value: stops.early, text: percent(stops.early / made)},
        {key: 'ontime', name: 'Shot within 100 ms of accurate', value: stops.onTime, text: percent(stops.onTime / made)}, {key: 'late', name: 'Shot later', value: stops.late, text: percent(stops.late / made)}]}/>}
      <p className="sl-aim-note">{stops.since !== undefined && `A median ${ms(stops.since)} from starting a stop to the shot`}{stops.wait !== undefined && `; once accurate you fired after ${ms(stops.wait)}`}{stops.since !== undefined && '. '}
        {stops.toAccurate?.counter !== undefined && `With the opposite key you were accurate after ${ms(stops.toAccurate.counter)}`}{stops.toAccurate?.counter !== undefined && stops.toAccurate?.release !== undefined && ', '}
        {stops.toAccurate?.release !== undefined && `${stops.toAccurate?.counter === undefined ? 'Letting go, you were accurate after' : 'letting go after'} ${ms(stops.toAccurate.release)}`}{(stops.toAccurate?.counter ?? stops.toAccurate?.release) !== undefined && '.'}</p>
      {sides && <table className="sl-aim-table"><thead><tr><th>Stopping from</th><th>Stops</th><th>Too early</th><th>Accurate after</th></tr></thead><tbody>
        {(['left', 'right'] as const).map(way => sides[way] && <tr key={way}><th>Strafing {way}</th><td>{sides[way]!.n}</td><td>{percent(sides[way]!.early / sides[way]!.n)}</td>
          <td>{sides[way]!.toAccurate === undefined ? '–' : ms(sides[way]!.toAccurate!)}</td></tr>)}
      </tbody></table>}
    </> : <p className="sl-aim-note">You did not shoot right after running this session, so there are no stops to time.</p>}
  </div></Panel>;
}

function Clicks({report}: {report: AimReport}) {
  const {click, misses} = report;
  return <Panel title="Clicks and misses" className="sl-aim-panel"><div className="sl-aim-body">{click ? <>
    <table className="sl-aim-table"><thead><tr><th>At the first shot of a press</th><th>Clicks</th><th>Hit</th></tr></thead><tbody>
      <tr><th>Settled<small>target crossing the crosshair under 30°/s</small></th><td>{click.settled.shots}</td><td>{rate(click.settled)}</td></tr>
      <tr className={click.moving.shots ? 'warn' : ''}><th>Still moving<small>30°/s or faster</small></th><td>{click.moving.shots}</td><td>{rate(click.moving)}</td></tr>
    </tbody></table>
    <p className="sl-aim-note">Median {click.speed.toFixed(0)}°/s at a click. The speed is the target's across your crosshair, so following a moving target counts as settled.</p>
  </> : <p className="sl-aim-note">No shots yet.</p>}
    {misses && misses.n > 0 && <><h3>Why shots missed</h3>
      <Bar label="Missed shots" parts={[{key: 'off', name: 'Crosshair off the target (aim)', value: misses.off, text: String(misses.off)},
        {key: 'on', name: 'Crosshair on it (spread, recoil, moving)', value: misses.on, text: String(misses.on)}]}/>
      <p className="sl-aim-note">{plural(misses.n, 'miss', 'misses')} with a target near your crosshair.</p></>}
    {report.placement !== undefined && <><h3>Crosshair placement</h3>
      <p className="sl-aim-note">When targets appeared your crosshair was a median {report.placement.toFixed(1)}° away{report.placed !== undefined && `, and already on ${percent(report.placed)} of them`}.</p></>}
  </div></Panel>;
}

function Bursts({report}: {report: AimReport}) {
  const bullets = report.bullets ?? [];
  return <Panel title="Bursts and sprays" className="sl-aim-panel"><div className="sl-aim-body">
    {bullets.length > 1 ? <><table className="sl-aim-table"><thead><tr><th>Shot in a press</th><th>Shots</th><th>Hit</th></tr></thead><tbody>
      {bullets.map(entry => <tr key={entry.label}><th>{entry.label}</th><td>{entry.shots}</td><td>{rate(entry)}</td></tr>)}
    </tbody></table>
      <p className="sl-aim-note">How your hits hold up as you keep the trigger down: recoil grows with each bullet, so falling numbers show where your spray control gives out.</p></>
      : <p className="sl-aim-note">Every shot this session was a single tap: hold fire for bursts or sprays to compare later bullets with the first.</p>}
  </div></Panel>;
}

export type AimView = 'session' | 'direction';
const views: readonly {id: AimView; label: string}[] = [{id: 'session', label: 'Session report'}, {id: 'direction', label: 'Direction calibration'}];
/** The view shown last, so coming back to the Aim tab opens it again (until the page reloads). */
let lastView: AimView = 'session';

/** Direction Calibration's view: its switch, how many calibration flicks every mode has given it, and its results. */
function DirectionView({settings, update, records, persisted, analysis}: {settings: Settings; update: (patch: Partial<Settings>) => void;
  records: readonly FlickRecord[]; persisted: boolean; analysis: DirectionReport}) {
  const count = analysis.summary.valid;
  return <>
    <header className="sl-aim-head">
      <div><small>DIRECTION CALIBRATION</small><h1>Your aim by direction</h1>
        <p>{plural(count, 'calibration flick')} from every mode · {analysis.fit ? 'profile fitted' : `${Math.max(0, MIN_FIT - count)} more for a profile`}</p></div>
      <div className="sl-aim-record">
        <Toggle label="Record calibration flicks" checked={settings.directionCalibrate} onChange={directionCalibrate => update({directionCalibrate})}/>
        <p>{settings.directionCalibrate ? 'On: every mode adds the flicks that measure your aim cleanly.' : 'Off: nothing new is recorded. Your flicks and profile stay.'}</p>
      </div>
    </header>
    <div className="sl-aim-scroll"><Panel title="Direction profile" className="sl-aim-panel"><div className="sl-aim-body">
      <DirectionCalibration settings={settings} update={update} records={records} persisted={persisted} report={analysis}/></div></Panel></div>
  </>;
}

/** The Aim tab: one report for every mode, in two views. The session report shows one session's aim, chosen from the ones this
 * browser keeps; Direction calibration maps your aim by direction from the calibration flicks every mode records, with its
 * profile. `initialView` opens a view directly. */
export const AimScreen = memo(function AimScreen({mode, settings, update, initialView}: {mode: string; settings: Settings; update: (patch: Partial<Settings>) => void;
  initialView?: AimView}) {
  const {reports, persisted} = useAimReports();
  const [view, setView] = useState<AimView>(() => initialView ?? lastView);
  const choose = (next: AimView) => {lastView = next; setView(next);};
  const calibration = useDirectionRecords(), analysis = useMemo(() => directionReport(calibration.records), [calibration.records]);
  const modes = useMemo(() => [...new Map(reports.map(report => [report.mode, report.label.split(' · ')[0]])).entries()], [reports]);
  const [filter, setFilter] = useState<string>('all'), [chosen, setChosen] = useState<string>(), [confirm, setConfirm] = useState(false);
  const shown = filter === 'all' ? reports : reports.filter(report => report.mode === filter);
  const report = shown.find(entry => entry.id === chosen) ?? shown[0];
  const previous = report && reports.slice(reports.indexOf(report) + 1).find(entry => entry.mode === report.mode && entry.label === report.label);
  useEffect(() => {if (filter !== 'all' && !reports.some(entry => entry.mode === filter)) setFilter('all');}, [reports, filter]);
  useEffect(() => setConfirm(false), [report?.id]);
  const direction: DirectionSection | undefined = analysis.summary.valid || analysis.test.on + analysis.test.off ? {report: analysis,
    ...(analysis.comparison ? {gap: gapText(analysis.comparison)} : {}), applied: settings.directionProfile, on: settings.directionProfileOn, strength: settings.directionStrength} : undefined;
  const tabs = <Tabs label="Aim report views" value={view} items={views} onChange={choose}/>;
  if (view === 'direction') return <section className="sl-aim sl-menu-page" aria-label="Aim report">{tabs}
    <DirectionView settings={settings} update={update} records={calibration.records} persisted={calibration.persisted} analysis={analysis}/></section>;
  if (!report) return <section className="sl-aim sl-menu-page" aria-label="Aim report">{tabs}<div className="sl-aim-scroll">
    <div className="sl-aim-empty"><small>AIM REPORT</small><h1>No report yet</h1>
      <p>Play any mode: when you pause or finish, your report appears here. It covers your flicks (reaction, first movement, adjusting), pace and consistency, how you shot while moving and how you stopped, and your clicks and misses. Your aim by direction, from the flicks of every mode, is in the Direction calibration view.{!persisted && ' Browser storage is unavailable, so reports last until you close this tab.'}</p></div>
  </div></section>;
  const moving = (entry: AimReport) => entry.shots ? (entry.movement.moving.shots + entry.movement.air.shots) / entry.shots : undefined;
  const tiles = [
    <Tile key="hit" label="Hit rate" value={report.shots ? percent(report.hits / report.shots) : '–'} tone="blue"
      detail={<>{report.hits}/{plural(report.shots, 'shot')}{hasHeads(report) && report.hits ? ` · ${percent(report.heads / report.hits)} heads` : ''}<br/><Change now={report.shots ? report.hits / report.shots : undefined} before={previous?.shots ? previous.hits / previous.shots : undefined} unit="percent"/></>}/>,
    <Tile key="time" label="Time to hit" value={report.timeToHit === undefined ? '–' : ms(report.timeToHit)}
      detail={report.timeToHit === undefined ? 'no timed flick yet' : <>median over {plural(report.hitTimes, 'target')}<br/><Change now={report.timeToHit} before={previous?.timeToHit} lower unit="ms"/></>}/>,
    <Tile key="reaction" label="Reaction" value={report.reaction === undefined ? '–' : ms(report.reaction)}
      detail={report.reaction === undefined ? 'needs targets that appear while you are still' : <>median of {report.fresh} that appeared<br/><Change now={report.reaction} before={previous?.reaction} lower unit="ms"/></>}/>,
    <Tile key="moving" label="Shots while moving" value={report.shots ? percent(moving(report)!) : '–'} tone="gold"
      detail={<>{report.movement.moving.shots} moving, {report.movement.air.shots} in the air<br/><Change now={moving(report)} before={previous && moving(previous)} lower unit="percent"/></>}/>,
    <Tile key="throughput" label="Throughput" value={report.throughput === undefined ? '–' : `${report.throughput.toFixed(1)}`}
      detail={report.throughput === undefined ? 'needs five timed flicks' : <>bits per second<br/><Change now={report.throughput} before={previous?.throughput} unit="bits"/></>}/>,
    <Tile key="pace" label="Targets per minute" value={report.perMinute === undefined ? '–' : report.perMinute.toFixed(1)}
      detail={<>{report.cleared} of {plural(report.targets, 'target')} cleared</>}/>,
  ];
  const save = (kind: 'html' | 'json') => kind === 'html'
    ? downloadText(aimReportFileName(report, 'html'), aimReportHtml(report, direction), 'text/html')
    : download(aimReportFileName(report, 'json'), aimReportData(report, direction));
  return <section className="sl-aim sl-menu-page" aria-label="Aim report">{tabs}
    <header className="sl-aim-head">
      <div><small>AIM REPORT{report.mode === mode ? ' · THIS MODE' : ''}</small><h1>{report.label}</h1>
        <p>{equipmentNames[report.weapon]} · {when(report.started)} · {clock(report.seconds)} played · {report.cleared} of {plural(report.targets, 'target')} cleared</p></div>
      <div className="sl-aim-pick">
        <label>Mode<select aria-label="Mode" value={filter} onChange={event => {setFilter(event.target.value); setChosen(undefined);}}>
          <option value="all">All modes</option>{modes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Session<select aria-label="Session" value={report.id} onChange={event => setChosen(event.target.value)}>
          {shown.map(entry => <option key={entry.id} value={entry.id}>{when(entry.started)} · {entry.label} · {plural(entry.shots, 'shot')}</option>)}</select></label>
        <div className="sl-aim-downloads"><Button onClick={() => save('html')}>Download report</Button><Button onClick={() => save('json')}>Download data</Button></div>
      </div>
    </header>
    <div className="sl-aim-scroll">
      <section className="sl-aim-tips" aria-label="What to work on">{report.tips.map(tip => <article key={tip.title} className={tip.tone}>
        <strong>{tip.title}</strong><p>{tip.detail}</p></article>)}{!report.tips.length && <article className="good"><strong>Not enough shots for advice yet</strong><p>Play a little longer: each tip needs enough shots or flicks to be sure of it.</p></article>}</section>
      <div className="sl-result-tiles sl-aim-tiles">{tiles}</div>
      <div className="sl-aim-grid"><Flicks report={report}/><Pace report={report}/><Directions report={report} openDirection={() => choose('direction')}/><Movement report={report}/><Clicks report={report}/><Bursts report={report}/></div>
      <footer className="sl-aim-footer"><p>Reports stay in this browser{persisted ? '' : ' until you close this tab (storage is unavailable)'}: the latest {reports.length} of at most 60. A session's report updates whenever you pause. Download report saves a page you can open, print or share; Download data saves the numbers as JSON.</p>
        <Button onClick={() => download('spraylab-aim-reports.json', {format: 'spraylab-aim-reports', version: 1, exported: new Date().toISOString(), reports})}>Download all reports</Button>
        {confirm ? <><Button onClick={() => {aimReportStore.remove(report.id); setChosen(undefined);}}>Delete this report</Button><Button onClick={() => {aimReportStore.clear(); setChosen(undefined);}}>Delete all {reports.length}</Button><Button onClick={() => setConfirm(false)}>Keep them</Button></>
          : <Button onClick={() => setConfirm(true)}>Delete reports…</Button>}</footer>
    </div>
  </section>;
});
