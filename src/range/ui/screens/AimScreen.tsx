import {memo, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {ACCURATE_SPEED, type AimBucket, type AimReport} from '../../aim-report';
import {aimReportStore} from '../../aim-report-store';
import {equipmentNames} from '../../equipment';
import {Button, Panel} from '../primitives';
import '../aim.css';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const rate = (bucket: AimBucket) => bucket.shots ? percent(bucket.hits / bucket.shots) : '–';
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const when = (iso: string) => new Date(iso).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
/** Pop has no heads to hit. */
const hasHeads = (report: AimReport) => report.mode !== 'pop';

/** The saved reports, refreshed when another tab saves one. */
export function useAimReports() {
  const snapshot = useSyncExternalStore(aimReportStore.subscribe, aimReportStore.getSnapshot, aimReportStore.getSnapshot);
  useEffect(() => aimReportStore.watchStorage(), []);
  return snapshot;
}

/** A difference from the previous session of the same mode, coloured by whether it is better. */
function Change({now, before, lower = false, unit}: {now?: number; before?: number; lower?: boolean; unit: 'percent' | 'ms'}) {
  if (now === undefined || before === undefined) return null;
  const delta = now - before, shown = unit === 'percent' ? Math.round(delta * 100) : Math.round(delta * 1000);
  if (!shown) return <em className="sl-aim-change">same as last time</em>;
  const better = lower ? delta < 0 : delta > 0;
  return <em className={`sl-aim-change ${better ? 'better' : 'worse'}`}>{shown > 0 ? '+' : '−'}{Math.abs(shown)}{unit === 'percent' ? ' pts' : ' ms'} vs last time</em>;
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

function Flicks({report}: {report: AimReport}) {
  const {phases, landing} = report;
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
    <p className="sl-aim-note">Typical miss {percent(landing.error)} of the flick, {Math.abs(landing.bias) < .005 ? 'no overall bias' : `${percent(Math.abs(landing.bias))} ${landing.bias < 0 ? 'short' : 'past'} overall`}, {landing.corrections.toFixed(1)} corrections per flick.</p>
    {report.sizes.length > 0 && <table className="sl-aim-table"><thead><tr><th>Flick size</th><th>Flicks</th><th>First movement</th><th>Typical miss</th><th>Time to hit</th></tr></thead><tbody>
      {report.sizes.map(size => <tr key={size.label}><th>{size.label}</th><td>{size.n}</td>
        <td>{Math.abs(size.bias) < .005 ? 'on target' : `${percent(Math.abs(size.bias))} ${size.bias < 0 ? 'short' : 'past'}`}</td><td>{percent(size.error)}</td><td>{ms(size.time)}</td></tr>)}
    </tbody></table>}
  </div></Panel>;
}

function Movement({report}: {report: AimReport}) {
  const {movement, stops} = report, n = report.shots || 1;
  const rows: [string, string, AimBucket][] = [['Standing', 'no running in the last 0.6 s', movement.standing],
    ['Stopped', 'ran, then slowed to an accurate speed', movement.stopped],
    ['Moving', `above ${Math.round(ACCURATE_SPEED * 100)}% of running speed`, movement.moving], ['In the air', 'jumping or falling', movement.air]];
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
    </> : <p className="sl-aim-note">You did not shoot right after running this session, so there are no stops to time.</p>}
  </div></Panel>;
}

function Clicks({report}: {report: AimReport}) {
  const click = report.click;
  return <Panel title="Clicks" className="sl-aim-panel"><div className="sl-aim-body">{click ? <>
    <table className="sl-aim-table"><thead><tr><th>At the first shot of a press</th><th>Clicks</th><th>Hit</th></tr></thead><tbody>
      <tr><th>Settled<small>target crossing the crosshair under 30°/s</small></th><td>{click.settled.shots}</td><td>{rate(click.settled)}</td></tr>
      <tr className={click.moving.shots ? 'warn' : ''}><th>Still moving<small>30°/s or faster</small></th><td>{click.moving.shots}</td><td>{rate(click.moving)}</td></tr>
    </tbody></table>
    <p className="sl-aim-note">Median {click.speed.toFixed(0)}°/s at a click. The speed is the target's across your crosshair, so following a moving target counts as settled.</p>
  </> : <p className="sl-aim-note">No shots yet.</p>}
    {report.placement !== undefined && <><h3>Crosshair placement</h3>
      <p className="sl-aim-note">When targets appeared your crosshair was a median {report.placement.toFixed(1)}° away{report.placed !== undefined && `, and already on ${percent(report.placed)} of them`}.</p></>}
  </div></Panel>;
}

/** The Aim tab: the report of a session you played in any mode, chosen from the ones this browser keeps. */
export const AimScreen = memo(function AimScreen({mode}: {mode: string}) {
  const {reports, persisted} = useAimReports();
  const modes = useMemo(() => [...new Map(reports.map(report => [report.mode, report.label.split(' · ')[0]])).entries()], [reports]);
  const [filter, setFilter] = useState<string>('all'), [chosen, setChosen] = useState<string>(), [confirm, setConfirm] = useState(false);
  const shown = filter === 'all' ? reports : reports.filter(report => report.mode === filter);
  const report = shown.find(entry => entry.id === chosen) ?? shown[0];
  const previous = report && reports.slice(reports.indexOf(report) + 1).find(entry => entry.mode === report.mode && entry.label === report.label);
  useEffect(() => {if (filter !== 'all' && !reports.some(entry => entry.mode === filter)) setFilter('all');}, [reports, filter]);
  useEffect(() => setConfirm(false), [report?.id]);
  if (!report) return <section className="sl-aim sl-menu-page" aria-label="Aim report"><div className="sl-aim-empty">
    <small>AIM REPORT</small><h1>No report yet</h1>
    <p>Play any mode: when you pause or finish, your report appears here. It covers your flicks (reaction, first movement, adjusting), how you shot while moving and how you stopped, and your clicks.{!persisted && ' Browser storage is unavailable, so reports last until you close this tab.'}</p>
  </div></section>;
  const tiles = [
    <Tile key="hit" label="Hit rate" value={report.shots ? percent(report.hits / report.shots) : '–'} tone="blue"
      detail={<>{report.hits}/{report.shots} shots{hasHeads(report) && report.hits ? ` · ${percent(report.heads / report.hits)} heads` : ''}<br/><Change now={report.shots ? report.hits / report.shots : undefined} before={previous?.shots ? previous.hits / previous.shots : undefined} unit="percent"/></>}/>,
    <Tile key="time" label="Time to hit" value={report.timeToHit === undefined ? '–' : ms(report.timeToHit)}
      detail={report.timeToHit === undefined ? 'no timed flick yet' : <>median over {report.hitTimes} {report.hitTimes === 1 ? 'target' : 'targets'}<br/><Change now={report.timeToHit} before={previous?.timeToHit} lower unit="ms"/></>}/>,
    <Tile key="reaction" label="Reaction" value={report.reaction === undefined ? '–' : ms(report.reaction)}
      detail={report.reaction === undefined ? 'needs targets that appear while you are still' : <>median of {report.fresh} that appeared<br/><Change now={report.reaction} before={previous?.reaction} lower unit="ms"/></>}/>,
    <Tile key="moving" label="Shots while moving" value={report.shots ? percent((report.movement.moving.shots + report.movement.air.shots) / report.shots) : '–'} tone="gold"
      detail={<>{report.movement.moving.shots} moving, {report.movement.air.shots} in the air<br/><Change now={report.shots ? (report.movement.moving.shots + report.movement.air.shots) / report.shots : undefined}
        before={previous?.shots ? (previous.movement.moving.shots + previous.movement.air.shots) / previous.shots : undefined} lower unit="percent"/></>}/>,
  ];
  return <section className="sl-aim sl-menu-page" aria-label="Aim report">
    <header className="sl-aim-head">
      <div><small>AIM REPORT{report.mode === mode ? ' · THIS MODE' : ''}</small><h1>{report.label}</h1>
        <p>{equipmentNames[report.weapon]} · {when(report.started)} · {clock(report.seconds)} played · {report.cleared} of {report.targets} targets cleared</p></div>
      <div className="sl-aim-pick">
        <label>Mode<select aria-label="Mode" value={filter} onChange={event => {setFilter(event.target.value); setChosen(undefined);}}>
          <option value="all">All modes</option>{modes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Session<select aria-label="Session" value={report.id} onChange={event => setChosen(event.target.value)}>
          {shown.map(entry => <option key={entry.id} value={entry.id}>{when(entry.started)} · {entry.label} · {entry.shots} shots</option>)}</select></label>
      </div>
    </header>
    <div className="sl-aim-scroll">
      <section className="sl-aim-tips" aria-label="What to work on">{report.tips.map(tip => <article key={tip.title} className={tip.tone}>
        <strong>{tip.title}</strong><p>{tip.detail}</p></article>)}{!report.tips.length && <article className="good"><strong>Not enough shots for advice yet</strong><p>Play a little longer: each tip needs enough shots or flicks to be sure of it.</p></article>}</section>
      <div className="sl-result-tiles">{tiles}</div>
      <div className="sl-aim-grid"><Flicks report={report}/><Movement report={report}/><Clicks report={report}/></div>
      <footer className="sl-aim-footer"><p>Reports stay in this browser{persisted ? '' : ' until you close this tab (storage is unavailable)'}: the latest {reports.length} of at most 60. A session's report updates whenever you pause.</p>
        {confirm ? <><Button onClick={() => {aimReportStore.remove(report.id); setChosen(undefined);}}>Delete this report</Button><Button onClick={() => {aimReportStore.clear(); setChosen(undefined);}}>Delete all {reports.length}</Button><Button onClick={() => setConfirm(false)}>Keep them</Button></>
          : <Button onClick={() => setConfirm(true)}>Delete reports…</Button>}</footer>
    </div>
  </section>;
});
