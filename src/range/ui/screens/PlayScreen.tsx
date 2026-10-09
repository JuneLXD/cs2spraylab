import {memo, useEffect, useState} from 'react';
import {Check, Crosshair, GraduationCap, Headphones, MoveHorizontal, RotateCcw, Target, Zap} from 'lucide-react';
import {modeNames, type Mode, type Settings} from '../../config';
import {modeInfo} from '../../mode-info';
import {cosmeticLabel, cosmeticPreview} from '../../cosmetics';
import type {ProgressionProfile} from '../../progression';
import {categoryFor, drillCategories} from '../drill-catalog';
import {Button, Tabs, Tile} from '../primitives';
import {TrainingSettings} from './TrainingSettings';

export const PlayScreen = memo(function PlayScreen({settings, profile, update, selectMode, controlsRef, ready, resume, input, startLabel, start, newSession, loadout, openSettings, tutorial, reset}: {
  settings: Settings; profile: ProgressionProfile; update: (patch: Partial<Settings>) => void; selectMode: (mode: Mode) => void;
  controlsRef: (element: HTMLDivElement | null) => void; ready: boolean; resume: boolean; input: string; startLabel: string;
  start: () => void; newSession: () => void; loadout: () => void; openSettings: () => void; tutorial: () => void; reset: () => void;
}) {
  const [category, setCategory] = useState(categoryFor(settings.mode));
  useEffect(() => setCategory(categoryFor(settings.mode)), [settings.mode]);
  const info = modeInfo[settings.mode];
  return <section className="sl-play sl-menu-page" aria-label="Play setup">
    <div className="sl-play-heading"><Tabs label="Drill categories" value={category} items={drillCategories} onChange={setCategory}/><select aria-label="Training mode" value={settings.mode} onChange={event => selectMode(event.target.value as Mode)}>{Object.entries(modeNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
    <div className="sl-play-body"><div className="sl-play-main"><div className="sl-drill-tiles">{drillCategories.find(item => item.id === category)!.modes.map(mode => {
      const Icon = mode === 'hearing' ? Headphones : mode === 'precision' || mode === 'peek' ? MoveHorizontal : mode === 'reflex' ? Zap : mode === 'guided' ? Crosshair : Target;
      return <Tile key={mode} selected={mode === settings.mode} onClick={() => selectMode(mode)} className={`sl-drill-tile sl-drill-${mode}`}>
        <div className="sl-drill-art" aria-hidden="true"><div className="sl-map-lines"/>{['botz','redline'].includes(mode) ? <img src="/models/target.png" alt=""/> : <Icon size={58} strokeWidth={1}/>}<span>{mode === 'redline' ? 'AIM_REDLINE' : mode === 'reflex' ? 'FAST AIM / REFLEX' : modeNames[mode]}</span></div>
        <div><h2>{modeNames[mode]}</h2><p>{modeInfo[mode].benefit}</p></div>{settings.mode === mode && <Check className="sl-selected-check" size={20}/>}
      </Tile>;
    })}</div>
    <section className="sl-drill-brief mode-brief"><small>{info.benefit}</small><h1>{modeNames[settings.mode]}</h1><p>{info.task}</p><div className="sl-fact-chips"><span>{settings.mode === 'redline' ? 'MAP BY BOT REED' : 'LOCAL PRACTICE'}</span><span>{settings.mode === 'guided' && !settings.spread ? 'SPREAD OFF' : 'CS2 WEAPON DATA'}</span></div></section>
    <button className="sl-learn" onClick={tutorial}><GraduationCap size={23}/><span><strong>Learn the fundamentals</strong><small>Movement, counter-strafing and shot timing</small></span></button>
    </div><aside className="sl-setup-panel" aria-label="Drill setup"><div ref={controlsRef}/>{!['duel','botz','reflex','redline'].includes(settings.mode) && <><header><div><small>DRILL SETUP</small><h2>{modeNames[settings.mode]}</h2></div><Button aria-label="Reset range" onClick={reset}><RotateCcw size={16}/></Button></header><div className="sl-range-setup">{settings.mode === 'hearing' ? <p>Start practice to choose sounds and locate their direction and distance.</p> : <TrainingSettings settings={settings} update={update}/>}</div></>}</aside></div>
    <footer className="sl-play-footer"><div className="sl-loadout-chips">{[...(settings.primaryEnabled ? [settings.weapon] : []), settings.sidearm].map((id, index) => <button key={`${id}-${index}`} onClick={loadout}><img src={cosmeticPreview(profile, id)} alt=""/><span><small>{index === 0 && settings.primaryEnabled ? 'PRIMARY' : 'SIDEARM'}</small>{cosmeticLabel(profile, id)}</span></button>)}</div><Button className="sl-mouse-settings" onClick={openSettings}>Mouse & crosshair</Button><div className="sl-ready"><strong>{ready ? resume ? 'PAUSED' : 'READY' : 'LOADING'}</strong><small>{input.includes('blocked') ? input : modeNames[settings.mode]}</small></div>{resume && <Button onClick={newSession}>New session</Button>}<Button primary className="sl-go" aria-label={startLabel} disabled={!ready} onClick={start}>{resume ? 'Resume' : 'Go'}</Button></footer>
  </section>;
});
