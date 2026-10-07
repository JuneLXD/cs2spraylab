import {memo} from 'react';
import {Download, Target} from 'lucide-react';
import {weaponIds, weaponNames} from '../config';
import {equipmentNames, type Equipment} from '../equipment';
import {BOTZ_MAX_BOTS, botzDistanceBands, botzSessionLengths, type BotzConfig, type BotzHistory, type BotzSummary} from './botz';

const sessionName = (seconds: number) => !seconds ? 'Endless' : seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
const band = (distance: BotzConfig['distance']) => `${botzDistanceBands[distance][0]}-${botzDistanceBands[distance][1]} m`;
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

type BotzSetupProps = {config: BotzConfig; update: (patch: Partial<BotzConfig>) => void};

// Status reports arrive at 10 Hz; setup only changes with its configuration.
export const BotzSetup = memo(function BotzSetup({config, update}: BotzSetupProps) {
  return <div className="duel-controls-body">
    <label className="duel-field"><span>Bots <output>{config.botCount}</output></span><input aria-label="Number of bots" type="range" min="1" max={BOTZ_MAX_BOTS} step="1" value={config.botCount} onChange={event => update({botCount: +event.target.value})}/></label>
    <label className="duel-field"><span>Distance <output>{band(config.distance)}</output></span><select aria-label="Bot distance" value={config.distance} onChange={event => update({distance: event.target.value as BotzConfig['distance']})}>
      <option value="near">Close</option><option value="mixed">Mixed</option><option value="far">Long</option></select></label>
    <label className="duel-field"><span>Movement</span><select aria-label="Bot movement" value={config.movement} onChange={event => update({movement: event.target.value as BotzConfig['movement']})}>
      <option value="static">Stand still</option><option value="strafe">Strafe (A-D)</option></select></label>
    <label className="duel-field"><span>Crouch</span><select aria-label="Bot crouch" value={config.crouch} onChange={event => update({crouch: event.target.value as BotzConfig['crouch']})}>
      <option value="never">Never</option><option value="some">Some bots</option><option value="always">All bots</option></select></label>
    <label className="duel-check"><span>Spawn on ledges</span><input aria-label="Spawn on ledges" type="checkbox" checked={config.elevated} disabled={config.distance === 'near'} onChange={event => update({elevated: event.target.checked})}/></label>
    <label className="duel-check"><span>Headshot only</span><input aria-label="Headshot only" type="checkbox" checked={config.headshotOnly} onChange={event => update({headshotOnly: event.target.checked})}/></label>
    <label className="duel-field"><span>Respawn delay <output>{config.respawnSeconds ? `${config.respawnSeconds.toFixed(2)} s` : 'Instant'}</output></span><input aria-label="Respawn delay" type="range" min="0" max="3" step=".25" value={config.respawnSeconds} onChange={event => update({respawnSeconds: +event.target.value})}/></label>
    <label className="duel-field"><span>Session</span><select aria-label="Session length" value={config.sessionSeconds} onChange={event => update({sessionSeconds: +event.target.value})}>
      {botzSessionLengths.map(seconds => <option key={seconds} value={seconds}>{sessionName(seconds)}</option>)}</select></label>
    <label className="duel-field"><span>Ammo</span><select aria-label="Infinite ammo" value={config.infiniteAmmo} onChange={event => update({infiniteAmmo: event.target.value as BotzConfig['infiniteAmmo']})}>
      <option value="off">Normal reserves</option><option value="reserve">Infinite reserve</option><option value="magazine">Never reload</option></select></label>
    <label className="duel-field"><span>Bot weapon</span><select aria-label="Bot weapon" value={config.weapon} onChange={event => update({weapon: event.target.value as Equipment})}>
      {[...weaponIds, 'knife' as const].map(id => <option key={id} value={id}>{equipmentNames[id]}</option>)}</select></label>
    <label className="duel-field"><span>Bot health <output>{config.health}</output></span><input aria-label="Bot health" type="number" min="1" max="500" value={config.health} onChange={event => update({health: +event.target.value})}/></label>
    <label className="duel-check"><span>Bot Kevlar</span><input aria-label="Bot armor" type="checkbox" checked={config.armor} onChange={event => update({armor: event.target.checked})}/></label>
    <label className="duel-check"><span>Bot helmet</span><input aria-label="Bot helmet" type="checkbox" checked={config.helmet} disabled={!config.armor} onChange={event => update({helmet: event.target.checked})}/></label>
    <label className="duel-check"><span>Protect Ctrl+W in fullscreen</span><input aria-label="Protect Ctrl+W" type="checkbox" checked={config.shortcutProtection} onChange={event => update({shortcutProtection: event.target.checked})}/></label>
    <p className="botz-note">Bots never shoot back. Each one respawns at a new spot after it dies. Infinite reserve matches sv_infinite_ammo 2; Never reload matches 1.</p>
  </div>;
});

export function BotzScorecard({summary, history}: {summary?: BotzSummary; history: BotzHistory[]}) {
  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'spraylab-aim-botz.json'; link.click(); URL.revokeObjectURL(url);
  };
  const values: [string, string, string][] = summary ? [
    ['Kills', String(summary.kills), 'Bots you killed this session.'],
    ['Headshot kills', `${summary.headshots} (${summary.headshotRate.toFixed(0)}%)`, 'Kills where the lethal hit struck the head.'],
    ['Hits / shots', `${summary.hits} / ${summary.shots}`, 'Shots that hit a bot. A shotgun blast counts once. Knife swings are excluded.'],
    ['Accuracy', `${summary.accuracy.toFixed(0)}%`, 'Hits divided by shots.'],
    ['Head hits', String(summary.headHits), 'Shots that struck a head, lethal or not.'],
    ['Kills per minute', summary.killsPerMinute.toFixed(1), 'Kills divided by active session time.'],
    ['Time per kill', summary.secondsPerKill === null ? '--' : `${summary.secondsPerKill.toFixed(2)} s`, 'Active time divided by kills. Includes respawn waits.'],
    ['Best headshot streak', String(summary.bestHeadshotStreak), 'Most kills in a row by headshot.'],
    ['Session time', clock(summary.seconds), 'Active time. Pausing stops the clock.'],
  ] : [];
  return <section className="duel-analysis" aria-label="Aim Botz stats">
    <div className="duel-coach"><Target size={18}/><strong>{!summary?.shots ? 'Shoot a bot to start your stats' : summary.headshotRate >= 60 ? 'Clean headshots' : summary.accuracy < 40 ? 'Slow down your first shot' : 'Keep your crosshair at head height'}</strong>
      <p>{!summary?.shots ? 'Flick to the head, stop, and tap. Stats count from your first shot.' : summary.accuracy < 40 ? 'Stop moving and let the crosshair settle before you click. Speed comes after accuracy.' : 'Pre-aim where the next head will be, then make one small correction.'}</p></div>
    {summary && <dl>{values.map(([label, value, help]) => <div key={label}><dt title={help}>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <div className="duel-history-title"><strong>Recent sessions</strong><button className="icon-button" title="Export Aim Botz history" aria-label="Export Aim Botz history" disabled={!history.length} onClick={exportHistory}><Download size={16}/></button></div>
    {!history.length && <p className="duel-analysis-empty">Sessions are saved when time runs out or you start a new one.</p>}
    <ol>{history.slice(0, 10).map((entry, index) => <li key={`${entry.date}-${index}`}><span>{entry.kills} kills / {entry.headshotRate.toFixed(0)}% HS
      <small>{weaponNames[entry.weapon as keyof typeof weaponNames] ?? equipmentNames[entry.weapon]} / {clock(entry.seconds)} / {new Date(entry.date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</small></span>
      <b>{entry.killsPerMinute.toFixed(1)}<small>/min</small></b></li>)}</ol>
  </section>;
}
