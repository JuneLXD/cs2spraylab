import {memo} from 'react';
import {blitzDifficultyLevels, blitzMaps, blitzPresets, type BlitzConfig, type BlitzHistory} from './blitz';
import type {SkillLevel} from './config';
import type {DuelStatus} from './DuelEngine';

/** Blitz setup: Refrag's chat commands as controls. Any change starts the arena again. */
export const BlitzSetup = memo(function BlitzSetup({config, update, arenas, status}: {config: BlitzConfig; update: (patch: Partial<BlitzConfig>) => void;
  arenas: number; status?: DuelStatus['blitz']}) {
  const levels: SkillLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, '10+'];
  return <div className="duel-controls-body">
    <label className="duel-field"><span>Map</span><select aria-label="Blitz map" value={config.map} onChange={event => update({map: event.target.value as BlitzConfig['map']})}>
      {Object.entries(blitzMaps).map(([id, map]) => <option key={id} value={id}>{map.title}</option>)}</select></label>
    <label className="duel-field"><span>Swingers <output>{config.swingers}</output></span><input aria-label="Swingers" title=".swingers: bots per arena" type="range" min="1" max="5" step="1" value={config.swingers} onChange={event => update({swingers: +event.target.value})}/></label>
    <label className="duel-field"><span>Difficulty</span><select aria-label="Blitz difficulty" title=".easy / .normal / .hard, or your own FACEIT level" value={config.difficulty} onChange={event => update({difficulty: event.target.value as BlitzConfig['difficulty']})}>
      <option value="easy">Easy (level {blitzDifficultyLevels.easy})</option><option value="normal">Normal (level {blitzDifficultyLevels.normal})</option><option value="hard">Hard (level {blitzDifficultyLevels.hard})</option><option value="custom">Custom level</option></select></label>
    {config.difficulty === 'custom' && <label className="duel-field"><span>FACEIT level <output>{config.skill}</output></span><select aria-label="Blitz bot level" value={config.skill} onChange={event => update({skill: event.target.value === '10+' ? '10+' : +event.target.value as SkillLevel})}>
      {levels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
    <label className="duel-check"><span>Smart mode{status && config.smart ? <output>now level {status.level}</output> : null}</span><input aria-label="Smart mode" title=".smart: a level up after a clean clear, a level down after a death" type="checkbox" checked={config.smart} onChange={event => update({smart: event.target.checked})}/></label>
    <label className="duel-field"><span>Bot loadout</span><select aria-label="Bot loadout preset" title=".presets: pistol, save, eco, force, default, AWP" value={config.preset} disabled={config.noPrimary} onChange={event => update({preset: event.target.value as BlitzConfig['preset']})}>
      {Object.entries(blitzPresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select></label>
    <label className="duel-check"><span>No primary (pistols only)</span><input aria-label="No primary" title=".noprimary: you use your sidearm and the bots use pistols" type="checkbox" checked={config.noPrimary} onChange={event => update({noPrimary: event.target.checked})}/></label>
    <label className="duel-check"><span>Headshots only</span><input aria-label="Headshots only" title=".hs: only headshots damage the bots" type="checkbox" checked={config.headshotOnly} onChange={event => update({headshotOnly: event.target.checked})}/></label>
    <label className="duel-field"><span>Bot reaction <output>{config.reactionMs ? `${config.reactionMs} ms` : 'by level'}</output></span><input aria-label="Bot reaction time" title=".reaction: time before a bot that sees you can fire (0 = the level's own)" type="range" min="0" max="1000" step="10" value={config.reactionMs} onChange={event => update({reactionMs: +event.target.value})}/></label>
    <label className="duel-field"><span>Repeek reaction <output>{config.repeekReactionMs ? `${config.repeekReactionMs} ms` : 'same'}</output></span><input aria-label="Bot repeek reaction time" title=".repeekreaction: the reaction time once a bot sees you again (0 = the same as the first)" type="range" min="0" max="1000" step="10" value={config.repeekReactionMs} onChange={event => update({repeekReactionMs: +event.target.value})}/></label>
    <label className="duel-field"><span>Bot accuracy <output>{config.aimOffset.toFixed(2)}x</output></span><input aria-label="Bot accuracy" title=".aimoffset: multiplies the level's accuracy" type="range" min=".5" max="1.5" step=".05" value={config.aimOffset} onChange={event => update({aimOffset: +event.target.value})}/></label>
    <label className="duel-field"><span>First swing after <output>{config.firstSwingSeconds.toFixed(1)}s</output></span><input aria-label="First swing delay" type="range" min="0" max="5" step=".1" value={config.firstSwingSeconds} onChange={event => update({firstSwingSeconds: +event.target.value})}/></label>
    <label className="duel-field"><span>Gap between swings <output>{config.swingGapMin.toFixed(2)}–{config.swingGapMax.toFixed(2)}s</output></span>
      <input aria-label="Shortest gap between swings" type="range" min="0" max="3" step=".05" value={config.swingGapMin} onChange={event => update({swingGapMin: +event.target.value, swingGapMax: Math.max(config.swingGapMax, +event.target.value)})}/>
      <input aria-label="Longest gap between swings" type="range" min="0" max="3" step=".05" value={config.swingGapMax} onChange={event => update({swingGapMax: +event.target.value, swingGapMin: Math.min(config.swingGapMin, +event.target.value)})}/></label>
    <label className="duel-field"><span>Arena time limit <output>{config.roundSeconds}s</output></span><input aria-label="Arena time limit" type="range" min="15" max="180" step="5" value={config.roundSeconds} onChange={event => update({roundSeconds: +event.target.value})}/></label>
    <label className="duel-field"><span>Arena order</span><select aria-label="Arena order" title=".n / .p: arenas in order, or any next" value={config.order} onChange={event => update({order: event.target.value as BlitzConfig['order']})}>
      <option value="random">Random</option><option value="sequence">In order</option></select></label>
    <label className="duel-field"><span>Start at arena</span><select aria-label="Start arena" value={config.arena} onChange={event => update({arena: +event.target.value})}>
      <option value={0}>Any</option>{Array.from({length: arenas}, (_, i) => <option key={i + 1} value={i + 1}>Arena {i + 1}</option>)}</select></label>
    <label className="duel-field"><span>Repeat a cleared arena <output>{config.repeat < 0 ? 'forever' : config.repeat ? `×${config.repeat}` : 'no'}</output></span><input aria-label="Repeat arena" title=".repeat: times to repeat an arena after clearing it; all the way left repeats forever" type="range" min="-1" max="10" step="1" value={config.repeat} onChange={event => update({repeat: +event.target.value})}/></label>
    <label className="duel-check"><span>Skip after three deaths (Smart)</span><input aria-label="Autoskip" title=".autoskip: in Smart mode, move on after three deaths in one arena" type="checkbox" checked={config.autoskip} onChange={event => update({autoskip: event.target.checked})}/></label>
    {status && <p className="setting-explanation">Arena {status.arena} of {status.arenas}{status.name ? ` (${status.name})` : ''}: {status.clears} {status.clears === 1 ? 'clear' : 'clears'}, {status.deaths} {status.deaths === 1 ? 'death' : 'deaths'} here. Bots at level {status.level}.</p>}
  </div>;
});

/** Past arenas, newest first. */
export const BlitzScorecard = memo(function BlitzScorecard({history}: {history: BlitzHistory[]}) {
  if (!history.length) return <p className="setting-explanation">No arenas finished yet. Clear one and it shows here.</p>;
  return <ol className="blitz-history">{history.slice(0, 20).map((entry, index) => <li key={`${entry.date}-${index}`}>
    <b className={entry.outcome}>{entry.outcome === 'won' ? 'Cleared' : entry.outcome === 'lost' ? 'Died' : 'Time up'}</b> {entry.arena} · {entry.kills} kills · {entry.seconds.toFixed(1)} s · level {entry.level}
  </li>)}</ol>;
});
