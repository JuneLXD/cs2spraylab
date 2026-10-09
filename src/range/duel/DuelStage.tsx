import {AmmoBlock, EscHint, ScoreBar, ScoreCell, StatBlock, WeaponSlotList} from '../hud/Hud';
import {useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight, Plus, Eye, Hand, Pause, Play, RotateCcw, ScanLine, Settings2, Shield, Target, X} from 'lucide-react';
import {gameData, loadoutWeapon, type Settings} from '../config';
import {botConfig, sanitizeDuelConfig, type BotOverride, type DuelConfig} from './config';
import {DuelEngine, type DuelStatus} from './DuelEngine';
import './duel.css';
import {equipmentNames, equipmentStats, type Slot, type Equipment} from '../equipment';
import {DuelScorecard} from './DuelScorecard';
import type {ProgressionController} from '../progression';
import {cosmeticPreview, cosmeticLabel} from '../cosmetics';
import {DuelSetup} from './DuelSetup';
import {keyHint, shortcutHint, slotKey} from '../keybinds/profile';
import {sanitizeBotzConfig, type BotzConfig} from './botz';
import type {Arena} from './geometry';
import {loadWorkshopArena} from './workshop';
import {BotzScorecard, BotzSetup, clock} from './BotzPanel';
import {cvarAssignment} from '../keybinds/console';

const initialStatus: DuelStatus = {phase: 'ready', paused: false, health: 100, armor: 100,
  ammo: 30, reloading: false, enemies: 1, seconds: 0, kills: 0, damage: 0, input: 'Ready', caption: '',
  shortcutProtected: false, nextRoundIn: 0};

export type DuelHandle = {enter: () => Promise<void>; newSession: () => Promise<void>; restart: () => void; pause: () => void; snapshot: () => DuelStatus};
export type DuelMenuStatus = {ready: boolean; playing: boolean; paused: boolean; result: boolean; input: string; error: string};

function loadHint() {
  try {return localStorage.getItem('spraylab.duel.hint.v1') !== 'seen';}
  catch {return true;}
}

/** AI Duel, Aim Botz (variant 'botz': passive respawning bots), Fast Aim / Reflex (variant 'reflex': bots rush your
 * island) or Aim Botz on the imported aim_redline map (variant 'redline'), all on the same engine. */
export function DuelStage({settings, openSettings, onEnter, suspended, progression, cosmeticRevision, variant = 'duel', onConsole, config, update, botz, updateBotz, engineRef, controlsTarget, onMenuStatus}: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean; progression?: ProgressionController; cosmeticRevision?: Readonly<Record<string,string>>; variant?: 'duel' | 'botz' | 'reflex' | 'redline';
  config: DuelConfig; update: (patch: Partial<DuelConfig>) => void; botz: BotzConfig; updateBotz: (patch: Partial<BotzConfig>) => void;
  engineRef: Ref<DuelHandle>; controlsTarget: HTMLElement | null; onMenuStatus: (value: DuelMenuStatus) => void;
  /** Console commands from binds that change app settings, such as crosshair convars. */
  onConsole?: (args: string[]) => void}) {
  const botzMode = variant !== 'duel', reflexMode = variant === 'reflex', redlineMode = variant === 'redline';
  const kind = reflexMode ? 'reflex' : redlineMode ? 'redline' : 'botz';
  const drill = reflexMode ? 'reflex training' : redlineMode ? 'aim_redline' : 'Aim Botz';
  const title = reflexMode ? 'Fast Aim / Reflex' : redlineMode ? 'aim_redline' : 'Aim Botz';
  // aim_redline's collision and spawns load as a separate chunk before the engine can start.
  const [workshop, setWorkshop] = useState<Arena>();
  const [status, setStatus] = useState<DuelStatus>(initialStatus);
  const statusRef = useRef(status);
  const reportStatus = useCallback((value: DuelStatus) => {statusRef.current = value; setStatus(value);}, []);
  const latest = useRef({config, onConsole}); latest.current = {config, onConsole};
  const [hint, setHint] = useState(loadHint);
  const [panel, setPanel] = useState<'setup' | 'review'>('setup');
  const [error, setError] = useState('');
  const [weaponToAdd, setWeaponToAdd] = useState<Equipment>('m4a4');
  const canvasHost = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);
  const engine = useRef<DuelEngine>();

  useEffect(() => {
    if (!redlineMode) return;
    let live = true;
    loadWorkshopArena('aim_redline').then(arena => {if (live) setWorkshop(arena);},
      () => {if (live) setError('The aim_redline map data could not be loaded. Reload to try again.');});
    return () => {live = false;};
  }, []);
  useEffect(() => {
    if (!canvasHost.current || redlineMode && !workshop) return;
    try {
      engine.current = new DuelEngine(canvasHost.current, crosshair.current!, reportStatus, setError, settings, config, progression, botzMode ? botz : undefined, workshop);
      engine.current.onConsole = args => {
        // cl_radar_scale (e.g. `toggle cl_radar_scale 0.3 1`) zooms the Duel radar; the rest goes to the app.
        const radar = cvarAssignment(args, name => name === 'cl_radar_scale' ? String(latest.current.config.radarScale) : undefined);
        if (radar?.name === 'cl_radar_scale') {if (radar.value.trim() && Number.isFinite(Number(radar.value))) update({radarScale: Number(radar.value)}); return;}
        latest.current.onConsole?.(args);
      };
    } catch {setError('WebGL could not start. Enable hardware acceleration and reload.');}
    return () => {engine.current?.dispose(); engine.current = undefined;};
  }, [workshop]);
  useEffect(() => {engine.current?.setSettings(settings);}, [settings]);
  useEffect(() => {void engine.current?.refreshCosmetics();}, [cosmeticRevision]);
  useEffect(() => {if (suspended) engine.current?.pause();}, [suspended]);
  useEffect(() => {if (!botzMode) engine.current?.setConfig(config);}, [config]);
  useEffect(() => {if (botzMode) engine.current?.setBotz(botz);}, [botz]);
  const updateBot = useCallback((index: number, patch: BotOverride) => {
    const overrides = [...config.overrides]; overrides[index] = {...overrides[index], ...patch}; update({overrides});
  }, [config, update]);
  const customizeBot = useCallback((index: number, enabled: boolean) => {
    const overrides = [...config.overrides]; overrides[index] = enabled ? {...botConfig(config, index)} : {}; update({overrides});
  }, [config, update]);
  useImperativeHandle(engineRef, () => ({
    enter: async () => {dismissHint(); onEnter(); if (botzMode && engine.current?.sim.phase === 'result') engine.current.restart(); await engine.current?.enter();},
    newSession: async () => {engine.current?.restart(); await engine.current?.enter();},
    restart: () => engine.current?.restart(), pause: () => engine.current?.pause(), snapshot: () => statusRef.current,
  }), [status, onEnter]);
  const ready = !!engine.current && !error && (!redlineMode || !!workshop && !status.mapLoading);
  useEffect(() => onMenuStatus({ready, playing: status.phase !== 'ready' && !status.paused, paused: status.paused,
    result: botzMode && status.phase === 'result', input: status.input, error}), [ready, status.phase, status.paused, status.input, error, onMenuStatus]);
  const dismissHint = () => {
    setHint(false);
    try {localStorage.setItem('spraylab.duel.hint.v1', 'seen');} catch { /* Hint may repeat without storage. */ }
  };
  const alive = status.phase === 'fighting' && !status.paused;
  const playing = status.phase !== 'ready' && !status.paused;
  const equipped = status.equipped ?? loadoutWeapon(settings);
  const profile = progression?.getSnapshot().profile;
  const label = (id: typeof equipped) => profile ? cosmeticLabel(profile, id) : equipmentNames[id];
  const useKey = keyHint(settings.keyboard, '+use', 'Use');
  const crosshairStyle = {'--cross-color': settings.crosshair.color, '--cross-size': `${settings.crosshair.size}px`,
    '--cross-gap': `${settings.crosshair.gap}px`, '--cross-thickness': `${settings.crosshair.thickness}px`,
    '--cross-outline': `${settings.crosshair.outline}px`, opacity: settings.crosshair.alpha} as CSSProperties;

  return <div className="duel-layout">
    <div className={`duel-view sl-game-view ${botzMode ? 'sl-botz-view' : 'sl-duel-view'}`}>
      <div className="duel-canvas" ref={canvasHost} />
      <div className="duel-topline"><span className="range-badge"><i />{botzMode ? title.toUpperCase() : 'AI DUEL'}</span><span>{botzMode ? `${status.enemies} ${status.enemies === 1 ? 'BOT' : 'BOTS'} UP` : `${status.enemies} ${status.enemies === 1 ? 'ENEMY' : 'ENEMIES'} LEFT`}</span></div>
      <div className="duel-tools">
      <WeaponSlotList settings={settings} equipped={equipped} profile={profile} loadout={status.loadout} label="Duel equipment" equip={slot => engine.current?.equip(slot)}/>
      <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title={`Inspect weapon (${keyHint(settings.keyboard, '+lookatweapon')})`} onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {equipped !== 'knife' && (gameData.weapons[equipped].zoomLevels > 0 || gameData.weapons[equipped].hasBurst || gameData.weapons[equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={`${equipped === 'revolver' ? 'Quick alternate shot' : 'Scope / burst mode'} (${keyHint(settings.keyboard, '+attack2')})`} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>
      {playing && <EscHint className="duel-exit" label={botzMode ? `Pause ${drill}` : 'Pause duel'} pause={() => engine.current?.pause()}/>}
      {alive && !status.shortcutProtected && shortcutHint(settings.keyboard) && <div className="duel-shortcut-warning" role="status">{shortcutHint(settings.keyboard)}</div>}
      </div>
      <div className="follow-origin" ref={crosshair} aria-hidden="true"><div className={`crosshair ${settings.crosshair.t ? 't-style' : ''} ${settings.crosshair.size === 0 ? 'dot-only' : ''}`} style={crosshairStyle}>
        <i className="arm top"/><i className="arm right"/><i className="arm bottom"/><i className="arm left"/>{settings.crosshair.dot&&<i className="dot"/>}
      </div></div>
      {status.phase !== 'ready' && status.caption && <div className="duel-caption" role="status">{status.caption}</div>}
      {alive && status.pickup && <button className="pickup-prompt" title={`Pick up weapon (${useKey})`} onClick={()=>engine.current?.pickup()}><Hand size={15}/>{useKey} <span>Pick up {equipmentNames[status.pickup]}</span></button>}
      {alive && status.interaction && !status.pickup && <button className="pickup-prompt" title={`${status.interaction} (${useKey})`} onClick={()=>engine.current?.sim.command(0,{usePressed:true})}><Hand size={15}/>{useKey} <span>{status.interaction}</span></button>}
      {status.phase === 'result' && !botzMode && <div className={`duel-result ${status.outcome}`} role="status"><strong>{status.outcome === 'won' ? 'Round won' : status.outcome === 'lost' ? 'Round lost' : 'Draw'}</strong>
        <span>{status.paused ? 'Paused' : `Next round in ${status.nextRoundIn.toFixed(1)}s`}</span>
        {status.review && <><b>{status.review.message}</b><p>{status.review.tip}</p></>}</div>}
      {status.phase === 'result' && botzMode && status.botz && <div className="duel-result won" role="status"><strong>Session complete</strong>
        <span>{status.botz.kills} kills / {reflexMode ? `${status.botz.leaks} reached you` : `${status.botz.headshotRate.toFixed(0)}% headshots`} / {status.botz.accuracy.toFixed(0)}% accuracy</span>
        <b>{status.botz.killsPerMinute.toFixed(1)} kills per minute</b></div>}
      {error && <div className="range-error" role="alert"><Shield size={24}/><p>{error}</p><button onClick={() => location.reload()}><RotateCcw size={16}/>Reload</button></div>}
      <div className="duel-hud sl-hud">
        {botzMode ? status.botz && <>
          <div className="duel-health sl-bottom-stats">
            <StatBlock value={status.botz.accuracy.toFixed(0)} unit="%" icon={Target} bar={status.botz.accuracy} label="ACCURACY"/>
            <StatBlock value={status.botz.hits} unit={` / ${status.botz.shots}`} icon={ScanLine} label="HITS / SHOTS" bar={status.botz.accuracy}>
              <span className="sr-only">{status.botz.hits} / {status.botz.shots} hits</span>
            </StatBlock>
          </div>
          <ScoreBar className="duel-round" bots={{alive: status.enemies, total: botz.botCount, label: `${status.enemies} ${status.enemies === 1 ? 'BOT' : 'BOTS'} UP`}}>
            <ScoreCell value={status.botz.kills} label="KILLS" tone="blue"/>
            <ScoreCell value={clock(status.botz.sessionSeconds ? Math.max(0, Math.ceil(status.botz.sessionSeconds - status.botz.seconds)) : status.botz.seconds)} label={status.botz.sessionSeconds ? 'REMAINING' : 'ENDLESS'}/>
            <ScoreCell value={reflexMode ? status.botz.leaks : `${status.botz.headshotRate.toFixed(0)}%`} label={reflexMode ? 'REACHED YOU' : 'HEADSHOTS'} tone="gold"/>
          </ScoreBar>
        </> : <>
          <div className="duel-health sl-bottom-stats">
            <StatBlock value={Math.ceil(status.health)} icon={Plus} bar={status.health / config.playerHealth * 100} label="HEALTH"/>
            <StatBlock value={Math.ceil(status.armor)} icon={Shield} bar={status.armor} label={config.playerHelmet ? 'ARMOR · HELMET' : 'ARMOR'}/>
          </div>
          <ScoreBar className="duel-round" bots={{alive: status.enemies, total: config.botCount, label: `${status.enemies} ${status.enemies === 1 ? 'ENEMY' : 'ENEMIES'} LEFT`}}>
            <ScoreCell value={status.kills} label="KILLS" tone="blue"/>
            <ScoreCell value={clock(Math.max(0, Math.ceil(config.roundSeconds - status.seconds)))} label="ROUND"/>
            <ScoreCell value={Math.round(status.damage)} label="DAMAGE" tone="gold"/>
          </ScoreBar>
        </>}
        <AmmoBlock className="duel-ammo" label={label(equipped)} ammo={equipped === 'knife' ? '--' : status.ammo}
          reserve={equipped !== 'knife' && equipped !== 'zeus' ? status.reserve ?? equipmentStats(equipped).reserve : undefined}
          state={status.reloading ? status.reloadSilent ? 'Silent reload' : 'Reloading' : equipped === 'zeus' && status.recharge ? `Recharge ${Math.ceil(status.recharge)}s` : botzMode && botz.infiniteAmmo === 'magazine' && equipped !== 'knife' ? 'Never reload' : `${keyHint(settings.keyboard, '+reload')} reload`}
          input={!alive ? status.input : undefined}
          reload={alive && equipped !== 'knife' && equipped !== 'zeus' ? () => engine.current?.sim.command(0, {reloadPressed: true}) : undefined}
          reloadDisabled={status.reloading || !status.reserve || status.ammo === equipmentStats(equipped).magazine} reloadHint={`Reload (${keyHint(settings.keyboard, '+reload')})`}/>
      </div>
    </div>
    {controlsTarget && createPortal(botzMode ? <aside className="duel-controls" aria-label={reflexMode ? 'Reflex settings' : `${title} settings`}>
      <div className="duel-controls-head"><div><small>{redlineMode ? 'AIM BOTZ / MAP BY BOT REED' : 'DRILL SETUP'}</small><h2>{title}</h2></div><button className="icon-button" title="New session" aria-label={reflexMode ? 'New reflex session' : `New ${title} session`} onClick={() => engine.current?.restart()}><RotateCcw size={17}/></button></div>
      <div className="tabs" role="tablist" aria-label={reflexMode ? 'Reflex panel' : `${title} panel`}><button role="tab" aria-selected={panel === 'setup'} onClick={() => setPanel('setup')}>Setup</button><button role="tab" aria-selected={panel === 'review'} onClick={() => setPanel('review')}>Stats</button></div>
      {panel === 'review' ? <div className="duel-controls-body"><BotzScorecard island={reflexMode} name={reflexMode ? 'Reflex' : title} summary={status.botz} history={status.botzHistory ?? []}/></div> : <BotzSetup config={botz} update={updateBotz}/>}
      <div className="duel-controls-foot"><button onClick={openSettings}><Settings2 size={15}/>Mouse & crosshair</button><span><Target size={13}/>Changes start a new session</span></div>
    </aside> : <aside className="duel-controls" aria-label="Duel settings">
      <div className="duel-controls-head"><div><small>DRILL SETUP</small><h2>AI Duel</h2></div><button className="icon-button" title="New round" aria-label="New duel round" onClick={() => engine.current?.restart()}><RotateCcw size={17}/></button></div>
      <div className="tabs" role="tablist" aria-label="Duel panel"><button role="tab" aria-selected={panel === 'setup'} onClick={() => setPanel('setup')}>Setup</button><button role="tab" aria-selected={panel === 'review'} onClick={() => setPanel('review')}>Scorecard</button></div>
      {hint && <div className="duel-hint" role="status"><ArrowRight size={18}/><span>Set up your opponent here</span><button aria-label="Dismiss duel hint" title="Dismiss hint" onClick={dismissHint}><X size={14}/></button></div>}
      {panel === 'review' ? <div className="duel-controls-body"><DuelScorecard review={status.review} history={status.history ?? []}/></div> : <DuelSetup config={config} arenaDesign={status.arenaDesign} weaponToAdd={weaponToAdd} setWeaponToAdd={setWeaponToAdd} update={update} updateBot={updateBot} customizeBot={customizeBot}/>}
      <div className="duel-controls-foot"><button onClick={openSettings}><Settings2 size={15}/>Mouse & crosshair</button><span><Target size={13}/>Changes start a new round</span></div>
    </aside>, controlsTarget)}
  </div>;
}
