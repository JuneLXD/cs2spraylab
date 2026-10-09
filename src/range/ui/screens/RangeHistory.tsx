import {memo,useState} from 'react';
import {ChevronDown,Download} from 'lucide-react';
import {historyModeNames} from '../../config';
import {equipmentNames} from '../../equipment';
import {DrillReview} from '../../DrillPanel';
import {SliderRow as Slider} from '../primitives';
import type {Result} from '../../simulation';
import {loadAttempts} from '../../../lib/storage';
import {download} from '../download';
export const RangeHistory = memo(function RangeHistory({results,legacy}: {results:Result[];legacy:ReturnType<typeof loadAttempts>}) {
  const [selected,setSelected]=useState<Result|undefined>(results[0]);
  const [replay,setReplay]=useState(results[0]?.samples.length??0);
  return <div className="drawer-content history">
          <div className="session-summary"><div><small>ATTEMPTS</small><b>{results.length}</b></div><div><small>AVG. HIT RATE</small><b>{results.filter(r => r.shots).length ? Math.round(results.filter(r => r.shots).reduce((n, r) => n + r.hits / r.shots * 100, 0) / results.filter(r => r.shots).length) : 0}%</b></div><button className="icon-button" aria-label="Export history" title="Export history" onClick={() => download('spraylab-history.json', { results, legacy })}><Download size={18} /></button></div>
          {selected && <section className="replay"><div className="section-title"><h2>{equipmentNames[selected.weapon]} / {historyModeNames[selected.mode]}</h2><span>{selected.mode === 'tracking' ? `${selected.tracking.toFixed(1)}%` : `${selected.hits}/${selected.shots}`}</span></div>{selected.drill&&<DrillReview value={selected.drill}/>} {selected.samples.length > 0 && <><svg viewBox="0 0 400 240" role="img" aria-label="Shot replay, metres relative to target head"><path d="M200 0V240M0 120H400" stroke="#47524d" strokeDasharray="3 5" /><circle cx="200" cy="120" r="10" fill="none" stroke="#8daba0" /><path d="M182 139h36v42h-36z" fill="#394943" />{selected.samples.slice(0, replay).map((s, i) => <g key={i}><circle cx={200 + Math.max(-190, Math.min(190, s.x * 70))} cy={120 - Math.max(-110, Math.min(110, s.y * 70))} r="3" fill={s.head ? '#e6cf6b' : s.hit ? '#6ddbb1' : '#ed9186'} /><title>Round {s.bullet}: {s.x.toFixed(2)}m, {s.y.toFixed(2)}m</title></g>)}</svg><Slider label="Replay round" value={replay} min={0} max={selected.samples.length} onChange={setReplay} /></>}</section>}
          <h2>Recent attempts</h2>{!results.length && <p className="empty-state">No attempts yet.</p>}{results.map(r => <button key={r.id} className={`history-row ${selected?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r); setReplay(r.samples.length); }}><span><b>{equipmentNames[r.weapon]}</b><small>{historyModeNames[r.mode]} / {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{r.mode==='precision' ? r.drill?.movementScore===undefined?'Unscored':`${r.drill.movementScore}/100` : `${Math.round(r.mode === 'tracking' ? r.tracking : r.shots ? r.hits / r.shots * 100 : 0)}%`}</strong><ChevronDown size={14} /></button>)}
          {legacy.length > 0 && <><h2>Previous-version history</h2>{legacy.map(r => <div className="history-row" key={r.id}><span>{r.weaponName}<small>{new Date(r.createdAt).toLocaleDateString()}</small></span><b>{r.scores.overall} score</b></div>)}</>}
        </div>;
});
