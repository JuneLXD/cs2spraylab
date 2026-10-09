import {TopNav, type MenuScreen} from './ui/TopNav';
import {PlayScreen} from './ui/screens/PlayScreen';
import {useBotzConfig, useDuelConfig} from './ui/useDrillConfig';
import type {DuelHandle, DuelMenuStatus} from './duel/DuelStage';
import {SettingsScreen} from './ui/screens/SettingsScreen';
import {CrosshairView} from './ui/CrosshairView';
import {AmmoBlock, EscHint, ScoreBar, ScoreCell, StatBlock, WeaponSlotList} from './hud/Hud';
import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Code2 as Github, Crosshair as AimIcon, Download, Eye, Gauge, History, ListPlus, Maximize, Paintbrush, Pause, Play, RotateCcw, ScanLine, Settings2, Shield, Target, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { classicViewmodel, Crosshair, defaults, gameData, historyModeNames, isDuelEngineMode, loadSettings, loadoutWeapon, MeasuredProfile, migrateMode, Mode, modeNames, parseProfile, presets, resolutions, resolutionSize, saveSettings, Settings, Weapon, weaponIds, weaponNames, pistolIds, type Pistol, type Resolution } from './config';
import { RangeEngine, RangeStatus } from './engine';
import { Result } from './simulation';
import { loadAttempts } from '../lib/storage';
import { markSetupHintSeen, needsSetupHint } from './onboarding';
import {equipmentIds,equipmentNames,equipmentStats,type Slot} from './equipment';
import {isDrillMode,readDrillMetrics} from './drills';
import {DrillPanel,DrillReview} from './DrillPanel';
import {makeRepFeedback,type RepFeedback} from './rep-feedback';
import {DuelStage} from './duel/DuelStage';
import {GraduationCap} from 'lucide-react';
import {MovementTutorial} from './MovementTutorial';
import {modeInfo} from './mode-info';
import recoilProvenance from './recoil-provenance.json';
import {createProgressionController, cosmeticsForEquipment, equippedCosmetic, type ProgressionController, type ProgressionProfile} from './progression';
import {AchievementNotification, ProgressionPanel, useProgression} from './ProgressionPanel';
import {cosmeticCatalog, cosmeticLabel, cosmeticPreview} from './cosmetics';
import {Changelog} from './Changelog';
import {HearingPractice} from './HearingPractice';
import {KeyboardSettings} from './keybinds/KeyboardSettings';
import {keyHint, shortcutHint, slotKey} from './keybinds/profile';
import {applyConsoleCommand} from './console-settings';
import {SliderRow as Slider, SwitchRow as Toggle, NumberField} from './ui/primitives';
import {frameLimitOptions, useDisplayRate} from './display-rate';

function LoadoutFinishes({equipment, profile, controller, onArmory, focusRequest}: {equipment: Weapon; profile: ProgressionProfile; controller: ProgressionController; onArmory: (equipment: string) => void; focusRequest: number}) {
  const finishes = useRef<HTMLElement>(null);
  const handledFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequest;
    finishes.current?.scrollIntoView({block: 'start'});
    const equipped = finishes.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (equipped ?? finishes.current?.querySelector<HTMLButtonElement>('button[aria-pressed]'))?.focus({preventScroll: true});
  }, [equipment, focusRequest]);
  return <section ref={finishes} className="loadout-finishes" aria-label={`${weaponNames[equipment]} skins`}><header><h3>{weaponNames[equipment]} finishes</h3>
    <button type="button" className="finish-armory" onClick={() => onArmory(equipment)} aria-label="Open the armory: weapon finishes, knives, gloves and agents" title="Weapon finishes, knives, gloves and agents"><Paintbrush size={13}/>Armory</button></header>
    <div>{cosmeticsForEquipment(controller.catalog, equipment).map(item => {
      const equipped = equippedCosmetic(profile, controller.catalog, equipment)?.id === item.id;
      return <button key={item.id} type="button" className={equipped ? 'selected' : ''} aria-pressed={equipped}
        title={item.label} aria-label={`Equip ${weaponNames[equipment]} skin ${item.label}`}
        onClick={() => controller.equip(equipment, item.id)}>
        <img src={item.imageUrl} alt="" loading="lazy"/><span>{item.label}</span>{equipped && <Check size={13}/>}
      </button>;
    })}</div></section>;
}

function readResults(): Result[] {
  try {
    const a = JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]');
    return Array.isArray(a) ? a.filter(r => r && equipmentIds.includes(r.weapon) && typeof r.id === 'string'
      && ['shots', 'hits', 'heads', 'seconds', 'tracking'].every(k => Number.isFinite(r[k])) && Number.isFinite(Date.parse(r.date))
      && Array.isArray(r.samples) && r.samples.length <= 150 && r.samples.every((p: Record<string, unknown>) => p && ['x', 'y', 'bullet'].every(k => Number.isFinite(p[k])))).slice(0, 100).map(r => ({ ...r, drill:readDrillMetrics(r.drill), mode: r.mode === 'tracking' ? 'tracking' : migrateMode(r.mode) })) : [];
  } catch { return []; }
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const emptyStatus: RangeStatus = { weapon: 'ak47', equipped:'ak47',slot:1,equipReady:true,magazine:30, active: false, firing: false, shots: 0, hits: 0, heads: 0, remaining: 30, reload: 0, speed: 0, distance: 12, input: 'Ready', audio: 'locked', assets: 'Loading models', fps: 0 };
type Panel = 'settings' | 'weapons' | 'history' | 'changelog' | null;

export default function RangeApp() {
  const [progression] = useState(() => createProgressionController({catalog: cosmeticCatalog}));
  const progressionState = useProgression(progression);
  const [armoryOpen, setArmoryOpen] = useState(false);
  const [armoryRequest, setArmoryRequest] = useState<string | null>(null);
  const [achievementRequest, setAchievementRequest] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [setupHint, setSetupHint] = useState(needsSetupHint);
  const [tutorial, setTutorial] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [status, setStatus] = useState(emptyStatus);
  const [panel, setPanel] = useState<Panel>(null);
  const [screen, setScreen] = useState<MenuScreen | 'game'>('play');
  const screenRef = useRef(screen); screenRef.current = screen;
  const duel = useRef<DuelHandle>(null);
  const [duelMenu, setDuelMenu] = useState<DuelMenuStatus>({ready: false, playing: false, paused: false, result: false, input: 'Ready', error: ''});
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const duelConfig = useDuelConfig(), botzConfig = useBotzConfig('botz'), reflexConfig = useBotzConfig('reflex'), redlineConfig = useBotzConfig('redline');
  const selectedBotz = settings.mode === 'reflex' ? reflexConfig : settings.mode === 'redline' ? redlineConfig : botzConfig;
  const [hasSession, setHasSession] = useState(false);
  const onDuelMenu = useCallback((value: DuelMenuStatus) => {
    setDuelMenu(previous => Object.keys(value).every(key => previous[key as keyof DuelMenuStatus] === value[key as keyof DuelMenuStatus]) ? previous : value);
    if (screenRef.current === 'game' && (value.paused || !value.playing || value.result)) setScreen(value.result ? 'results' : 'play');
  }, []);
  const [finishSlot, setFinishSlot] = useState<1 | 2>(1);
  const [finishFocusRequest, setFinishFocusRequest] = useState(0);
  const [results, setResults] = useState(readResults);
  const resultsRef=useRef(results);resultsRef.current=results;
  const [repFeedback,setRepFeedback]=useState<(RepFeedback&{id:string;mode:Mode})|null>(null);
  const [legacy] = useState(loadAttempts);
  const [selected, setSelected] = useState<Result>();
  const [profiles, setProfiles] = useState<Partial<Record<Weapon, MeasuredProfile>>>(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('spraylab.profiles.v1') || '{}')).map(([k, v]) => [k, parseProfile(JSON.stringify(v))])); } catch { return {}; }
  });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [replay, setReplay] = useState(35);
  const host = useRef<HTMLDivElement>(null), follow = useRef<HTMLDivElement>(null), hitmarker = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const engine = useRef<RangeEngine>();
  const drawer = useRef<HTMLElement>(null);
  const selectedWeapon = loadoutWeapon(settings);
  const assetReady = status.assets === 'Models ready' && status.weapon === selectedWeapon;
  const weapon = gameData.weapons[selectedWeapon];
  const score = settings.mode==='precision' ? status.drill?.last?.movementScore ?? 0 : status.shots ? status.hits / status.shots * 100 : 0;
  const showRepFeedback=repFeedback?.mode===settings.mode && status.active && !status.firing && !status.hitFlash;
  const update = useCallback((patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch })), []);
  // A manual edit replaces the CS2 convars; the next bound crosshair command starts from this crosshair.
  const cross = useCallback((patch: Partial<Crosshair>) => setSettings(s => { const next = { ...s, crosshair: { ...s.crosshair, ...patch } }; delete next.cs2Crosshair; return next; }), []);
  const [consoleCommand] = useState(() => (args: string[]) => setSettings(s => applyConsoleCommand(s, args) ?? s));
  const open = useCallback((next: Panel) => { engine.current?.pause(); duel.current?.pause(); setSetupHint(false); setPanel(next); }, []);
  const navigate = useCallback((next: MenuScreen) => {engine.current?.pause(); duel.current?.pause(); setPanel(null); setScreen(next);}, []);
  const openLoadout = useCallback(() => open('weapons'), [open]);
  const openSettings = useCallback(() => open('settings'), [open]);
  const openHistory = useCallback(() => open('history'), [open]);
  const openChangelog = useCallback(() => open('changelog'), [open]);
  const openArmory = useCallback(() => setArmoryRequest('knife'), []);
  const toggleFps = useCallback(() => update({showFps: !settingsRef.current.showFps}), [update]);
  const mute = useCallback(() => update({volume: settingsRef.current.volume ? 0 : .2}), [update]);
  const fullscreen = useCallback(() => {if (document.fullscreenElement) void document.exitFullscreen(); else void stage.current?.requestFullscreen?.().catch(() => setNotice('Fullscreen unavailable in this browser.'));}, []);
  const learn = useCallback(() => {engine.current?.pause(); duel.current?.pause(); setTutorial(true);}, []);
  const reset = useCallback(() => engine.current?.reset(), []);
  const selectMode = useCallback((mode: Mode) => {engine.current?.pause(); duel.current?.pause(); setHasSession(false); setDuelMenu({ready: false, playing: false, paused: false, result: false, input: 'Ready', error: ''}); update({mode, spread: modeInfo[mode].spread});}, [update]);
  const entered = useCallback(() => setSetupHint(false), []);
  useEffect(() => {if (!status.active && screenRef.current === 'game' && !isDuelEngineMode(settingsRef.current.mode) && settingsRef.current.mode !== 'hearing') setScreen('play');}, [status.active]);
  useEffect(() => {if (screen !== 'game' || panel || tutorial || armoryOpen) engine.current?.pause();}, [screen, panel, tutorial, armoryOpen]);
  useEffect(() => { if (setupHint) markSetupHintSeen(); }, [setupHint]);
  useEffect(() => { if (status.active) setSetupHint(false); }, [status.active]);
  useEffect(()=>{if(!repFeedback)return;const timer=setTimeout(()=>setRepFeedback(null),4000);return()=>clearTimeout(timer);},[repFeedback]);
  useEffect(()=>setRepFeedback(null),[settings.mode]);
  useEffect(() => {
    if (isDuelEngineMode(settings.mode) || settings.mode === 'hearing') {engine.current = undefined; return;}
    let range: RangeEngine;
    try {
      range = new RangeEngine(host.current!, setStatus, settingsRef.current, follow.current!, hitmarker.current!, setError, progression);
      range.onConsole = consoleCommand;
      engine.current = range;
      range.sim.attempts = results.length;
      range.sim.onResult = result => {
        range.settleProgression(result);
        if(result.drill&&isDrillMode(result.mode)) {
          const previous=resultsRef.current.filter(r=>r.mode===result.mode&&r.drill).map(r=>r.drill!);
          setRepFeedback({id:result.id,mode:result.mode,...makeRepFeedback(result.mode,result.drill,previous)});
        } else if (result.shots && result.mode !== 'tracking') {
          setRepFeedback({id: result.id, mode: result.mode, passed: result.hits / result.shots >= .7,
            message: `${result.hits}/${result.shots} hits / ${result.heads} head hits`,
            tip: result.hits / result.shots < .5 ? 'Start on the head, stop moving, then correct recoil as it climbs. Use shorter bursts until the first shots connect.'
              : 'Keep the same starting aim. Check the wall marks for shots that drifted away as the spray continued.'});
        }
        resultsRef.current=[result,...resultsRef.current].slice(0,100);
        setSelected(result); setReplay(result.samples.length);
        setResults(previous => {
          const next = [result, ...previous].slice(0, 100);
          try { localStorage.setItem('spraylab.results.v2', JSON.stringify(next)); } catch { setNotice('Browser storage unavailable. This session is not saved.'); }
          return next;
        });
      };
      return () => { engine.current = undefined; range.dispose(); };
    } catch { setError('WebGL could not start. Enable browser hardware acceleration, then restart the range.'); }
  }, [generation, isDuelEngineMode(settings.mode), settings.mode === 'hearing']);
  useEffect(() => {
    engine.current?.configure(settings, profiles[settings.weapon]);
    if (!saveSettings(settings)) setNotice('Browser storage unavailable. Settings apply to this session.');
  }, [settings, profiles, generation]);
  useEffect(() => {void engine.current?.refreshCosmetics();}, [progressionState.profile.equipped]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    drawer.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPanel(null); }
      if (e.key === 'Tab') {
        const elements = drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [panel]);
  const start = useCallback(() => {
    setSetupHint(false); setHasSession(true);
    // Pointer lock must be requested in this click, before any effect or await.
    const entering = isDuelEngineMode(settingsRef.current.mode) ? duel.current?.enter() : settingsRef.current.mode !== 'hearing' ? engine.current?.enter() : undefined;
    setScreen('game');
    void entering?.then(() => {
      if (!isDuelEngineMode(settingsRef.current.mode) && settingsRef.current.mode !== 'hearing' && !engine.current?.sim.active) setScreen('play');
    });
  }, []);
  const newSession = useCallback(() => {if (isDuelEngineMode(settingsRef.current.mode)) duel.current?.restart(); else engine.current?.reset(); start();}, [start]);
  const importProfile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Profile exceeds 100 KB.');
      const p = parseProfile(await file.text());
      const next = { ...profiles, [p.weapon]: p }; setProfiles(next);
      try { localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next)); } catch { setNotice('Capture loaded for this session only.'); }
      update({ weapon: p.weapon }); setNotice(`${weaponNames[p.weapon]} capture loaded.`);
    } catch (e) { setNotice((e as Error).message); }
  }, [profiles]);
  const closePanel = useCallback(() => setPanel(null), []);
  const restoreSettings = useCallback(() => setSettings(current => ({...defaults, mode: current.mode, weapon: current.weapon, sidearm: current.sidearm, primaryEnabled: current.primaryEnabled, crosshair: {...defaults.crosshair}, keyboard: current.keyboard})), []);
  const removeCapture = useCallback(() => {
    const next = {...profiles}; delete next[settings.weapon]; setProfiles(next);
    try {localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next));} catch {setNotice('Storage unavailable.');}
  }, [profiles, settings.weapon]);
  const exportSession = useCallback(() => download('spraylab-session.json', {settings, results, legacy, profiles}), [settings, results, legacy, profiles]);
  return <main className="range-app">
    <section ref={stage} data-screen={screen} className={`range-stage sl-stage${screen !== 'game' || panel ? ' sl-menu-open' : ''}${isDuelEngineMode(settings.mode) ? ' duel-stage' : isDrillMode(settings.mode) ? ' with-drill' : ''}`} aria-label="Practice range">
      <AchievementNotification controller={progression} onOpenAchievements={()=>{setPanel(null);setAchievementRequest(true);}}/>
      {settings.mode === 'hearing' ? <HearingPractice volume={settings.volume} openSettings={() => open('settings')} suspended={screen !== 'game' || !!panel || tutorial || armoryOpen}/> : isDuelEngineMode(settings.mode) ? <DuelStage key={settings.mode} variant={settings.mode === 'botz' || settings.mode === 'reflex' || settings.mode === 'redline' ? settings.mode : 'duel'} onConsole={consoleCommand} settings={settings} progression={progression} cosmeticRevision={progressionState.profile.equipped} openSettings={() => open('settings')} onEnter={entered} engineRef={duel} onMenuStatus={onDuelMenu} controlsTarget={controlsTarget} config={duelConfig.config} update={duelConfig.update} botz={selectedBotz.config} updateBotz={selectedBotz.update} suspended={screen !== 'game' || !!panel || tutorial || armoryOpen}/> : <>
      <div className={`range-view sl-game-view${showRepFeedback?' has-rep-feedback':''}`}>
      <div className="canvas-host" ref={host} />
      <div className="range-topline"><span className="range-badge"><i />{status.active ? 'LIVE RANGE' : 'RANGE 01'}</span><span>{profiles[settings.weapon] ? 'IMPORTED RECOIL CAPTURE' : 'GAME-DERIVED RECOIL'}</span></div>
      {!isDrillMode(settings.mode)&&<div className="target-label">{modeNames[settings.mode]} <span>{status.distance.toFixed(1)} m</span></div>}
      {settings.mode === 'transfer' && settings.transferRule === 'kill' && <div className="transfer-health" aria-label="Transfer target health">
        {(status.targetHealth ?? [100,100]).map((health, i) => <span key={i} className={health === 0 ? 'down' : ''}>{i ? 'B' : 'A'} <b>{health === 0 ? 'DOWN' : `${Math.ceil(health)} HP`}</b></span>)}
      </div>}
      <WeaponSlotList settings={settings} equipped={status.equipped} slot={status.slot} profile={progressionState.profile} label="Equipped weapon" equip={slot => {void engine.current?.equip(slot);}}/>
      <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title={`Inspect weapon (${keyHint(settings.keyboard, '+lookatweapon')})`} onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {status.equipped !== 'knife' && (gameData.weapons[status.equipped].zoomLevels > 0 || gameData.weapons[status.equipped].hasBurst || gameData.weapons[status.equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={`${status.equipped === 'revolver' ? 'Quick alternate shot' : 'Scope / burst mode'} (${keyHint(settings.keyboard, '+attack2')})`} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>
      <div className="follow-origin" ref={follow}><CrosshairView value={settings.crosshair} /></div>
      {settings.mode==='peek'&&status.active&&!!status.drill?.peekDirection&&<div className="peek-direction" role="status" aria-label={`Peek ${status.drill.peekDirection<0?'left':'right'}`}>
        {status.drill.peekDirection<0?<ArrowLeft size={32}/>:<ArrowRight size={32}/>}<span>Peek {status.drill.peekDirection<0?'left':'right'}</span>
      </div>}
      {!settings.spread&&<button className="spread-warning" onClick={()=>{update({spread:true});}} title="Enable movement and firing inaccuracy">Spread off<Shield size={12}/></button>}
      <div className="hit-marker" ref={hitmarker}><X size={42} strokeWidth={3} /></div>
      {showRepFeedback&&repFeedback&&<div className={`rep-feedback${repFeedback.passed?' passed':''}`} role="status" aria-label="Rep feedback"><Check className="sl-rep-icon" size={24}/><div><b>{repFeedback.message}</b>{repFeedback.tip&&<p>{repFeedback.tip}</p>}</div></div>}
      {error && <div className="range-error" role="alert"><Shield size={24} /><p>{error}</p><button onClick={() => { setError(''); setGeneration(g => g + 1); }}><RotateCcw size={16} />Restart range</button></div>}
      {status.active && <EscHint className="exit-hint" label="Pause range" pause={() => engine.current?.pause()}/>}
      {status.active && status.input !== 'Touch' && !status.shortcutProtected && shortcutHint(settings.keyboard) && <div className="range-shortcut-warning" role="status">{shortcutHint(settings.keyboard)}</div>}
      <div className="range-hud sl-hud">
        <div className="hud-performance sl-bottom-stats">
          <StatBlock className="hud-stat" icon={Activity} value={Math.round(status.speed)} unit="u/s" label="SPEED"/>
          <StatBlock className="hud-stat" icon={Target} value={status.distance.toFixed(1)} unit="m" label="DISTANCE"/>
        </div>
        <ScoreBar className="hud-result">
          <ScoreCell value={status.heads} label="HEAD" tone="gold"/>
          <ScoreCell value={status.hits - status.heads} label="BODY" tone="blue"/>
          <ScoreCell value={<>{Math.round(score)}<em>{settings.mode === 'precision' ? '/100' : '%'}</em></>} label={settings.mode === 'precision' ? 'MOVEMENT SCORE' : 'HIT RATE'} testId="accuracy"/>
          <ScoreCell value={status.shots - status.hits} label="MISS" tone="miss"/>
        </ScoreBar>
        <AmmoBlock className="hud-ammo" label={cosmeticLabel(progressionState.profile, status.equipped)} testId="ammo" compactSeparator
          ammo={status.slot === 3 ? '--' : status.remaining} reserve={status.slot !== 3 && status.equipped !== 'zeus' ? status.reserve ?? status.magazine : undefined}
          state={status.reload ? `${status.reloadSilent ? 'Silent reload' : 'Reloading'} ${status.reload.toFixed(1)} s` : status.recharge ? `Recharge ${Math.ceil(status.recharge)}s` : !status.equipReady ? 'Drawing' : status.firing ? 'Firing' : 'Ready'}
          reload={status.active && status.slot !== 3 && status.equipped !== 'zeus' ? () => engine.current?.sim.reload() : undefined}
          reloadDisabled={status.remaining === status.magazine || !!status.reload || !status.reserve} reloadHint={`Reload ${equipmentNames[status.equipped]} (${keyHint(settings.keyboard, '+reload')})`}/>
      </div>
      </div>
      {isDrillMode(settings.mode)&&<DrillPanel status={status} mode={settings.mode} challenge={settings.drillPace==='challenge'} peekDuration={settings.peekDuration}/>}
      </>}
      {screen !== 'game' && <div className="sl-menu-layer">
        <TopNav screen={screen} navigate={navigate} loadout={openLoadout} armory={openArmory} session={openHistory} settings={openSettings} changelog={openChangelog} count={results.length} fps={settings.showFps} volume={settings.volume} toggleFps={toggleFps} mute={mute} fullscreen={fullscreen}/>
        <PlayScreen settings={settings} profile={progressionState.profile} update={update} selectMode={selectMode} controlsRef={setControlsTarget}
          ready={settings.mode === 'hearing' || (isDuelEngineMode(settings.mode) ? duelMenu.ready : assetReady)} resume={hasSession && !duelMenu.result}
          input={isDuelEngineMode(settings.mode) ? duelMenu.input : status.input}
          startLabel={settings.mode === 'hearing' ? 'Start hearing practice' : isDuelEngineMode(settings.mode) ? `${hasSession ? 'Resume' : settings.mode === 'duel' ? 'Enter' : 'Start'} ${settings.mode === 'duel' ? 'duel' : settings.mode === 'reflex' ? 'reflex training' : settings.mode === 'redline' ? 'aim_redline' : 'Aim Botz'}` : 'Enter range'}
          start={start} newSession={newSession} loadout={openLoadout} openSettings={openSettings} tutorial={learn} reset={reset}/>
        {setupHint && !panel && <div className="settings-hint" role="status"><button className="hint-action" aria-label="Customize your CS2 settings" onClick={openSettings}><b>Match your CS2 setup</b><span id="settings-hint-text">Sensitivity, crosshair & audio</span></button><ArrowUp className="hint-arrow" size={22}/><button className="icon-button" aria-label="Dismiss settings hint" onClick={() => {setSetupHint(false); stage.current?.querySelector<HTMLButtonElement>('.settings-button')?.focus();}}><X size={16}/></button></div>}
      </div>}
      {settings.mode === 'hearing' && screen === 'game' && <button className="sl-hearing-back" onClick={() => navigate('play')}>Back to Play</button>}
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {panel && <div className="drawer-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className={`drawer ${panel === 'settings' ? 'sl-settings-page' : ''} ${panel === 'history' || panel === 'changelog' || panel === 'settings' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={drawer}>
        {panel !== 'settings' && <div className="drawer-header"><div><small>SPRAYLAB</small><h1 id="panel-title">{panel === 'weapons' ? 'Loadout' : panel === 'changelog' ? 'Changelog' : 'Session history'}</h1></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={21} /></button></div>}
        {panel === 'changelog' && <Changelog/>}
        {panel === 'settings' && <SettingsScreen settings={settings} profiles={profiles} update={update} cross={cross} close={closePanel} notify={setNotice} importProfile={importProfile}
          restore={restoreSettings} removeCapture={removeCapture} exportSession={exportSession}/>}
        {panel === 'weapons' && <div className="drawer-content arsenal">
          <Toggle label="Carry a primary weapon" checked={settings.primaryEnabled} onChange={primaryEnabled=>update({primaryEnabled})}/>
          <label className="select-row">Sidearm<select aria-label="Sidearm" value={settings.sidearm} onChange={e=>update({sidearm:e.target.value as Pistol})}>{pistolIds.map(id=><option key={id} value={id}>{weaponNames[id]}</option>)}</select></label>
          {settings.primaryEnabled && settings.weapon !== settings.sidearm && <label className="select-row">Finishes for<select aria-label="Skin weapon" value={finishSlot} onChange={e=>setFinishSlot(+e.target.value as 1 | 2)}><option value="1">{weaponNames[settings.weapon]}</option><option value="2">{weaponNames[settings.sidearm]}</option></select></label>}
          <LoadoutFinishes equipment={settings.primaryEnabled && finishSlot === 1 ? settings.weapon : settings.sidearm} profile={progressionState.profile} controller={progression} focusRequest={finishFocusRequest} onArmory={id=>{setPanel(null);setArmoryRequest(id);}}/>
          <h2>Weapons</h2>{weaponIds.map(id => <button className={`weapon-item ${selectedWeapon === id ? 'chosen' : ''}`} key={id} onClick={() => {
            const sidearm = pistolIds.includes(id as Pistol);
            update(sidearm ? {sidearm: id as Pistol, primaryEnabled:false} : {weapon:id,primaryEnabled:true});
            if (cosmeticsForEquipment(progression.catalog, id).some(item => !item.isDefault)) {
              setFinishSlot(sidearm ? 2 : 1); setFinishFocusRequest(request => request + 1);
            } else setPanel(null);
          }}><img src={cosmeticPreview(progressionState.profile,id)} alt={weaponNames[id]} /><span><b>{weaponNames[id]}</b><small>{gameData.weapons[id].magazine} rounds <i /> {Math.round(60 / gameData.weapons[id].cycle)} RPM</small></span>{id === selectedWeapon && <Check size={18} />}</button>)}</div>}
        {panel === 'history' && <div className="drawer-content history">
          <div className="session-summary"><div><small>ATTEMPTS</small><b>{results.length}</b></div><div><small>AVG. HIT RATE</small><b>{results.filter(r => r.shots).length ? Math.round(results.filter(r => r.shots).reduce((n, r) => n + r.hits / r.shots * 100, 0) / results.filter(r => r.shots).length) : 0}%</b></div><button className="icon-button" aria-label="Export history" title="Export history" onClick={() => download('spraylab-history.json', { results, legacy })}><Download size={18} /></button></div>
          {selected && <section className="replay"><div className="section-title"><h2>{equipmentNames[selected.weapon]} / {historyModeNames[selected.mode]}</h2><span>{selected.mode === 'tracking' ? `${selected.tracking.toFixed(1)}%` : `${selected.hits}/${selected.shots}`}</span></div>{selected.drill&&<DrillReview value={selected.drill}/>} {selected.samples.length > 0 && <><svg viewBox="0 0 400 240" role="img" aria-label="Shot replay, metres relative to target head"><path d="M200 0V240M0 120H400" stroke="#47524d" strokeDasharray="3 5" /><circle cx="200" cy="120" r="10" fill="none" stroke="#8daba0" /><path d="M182 139h36v42h-36z" fill="#394943" />{selected.samples.slice(0, replay).map((s, i) => <g key={i}><circle cx={200 + Math.max(-190, Math.min(190, s.x * 70))} cy={120 - Math.max(-110, Math.min(110, s.y * 70))} r="3" fill={s.head ? '#e6cf6b' : s.hit ? '#6ddbb1' : '#ed9186'} /><title>Round {s.bullet}: {s.x.toFixed(2)}m, {s.y.toFixed(2)}m</title></g>)}</svg><Slider label="Replay round" value={replay} min={0} max={selected.samples.length} onChange={setReplay} /></>}</section>}
          <h2>Recent attempts</h2>{!results.length && <p className="empty-state">No attempts yet.</p>}{results.map(r => <button key={r.id} className={`history-row ${selected?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r); setReplay(r.samples.length); }}><span><b>{equipmentNames[r.weapon]}</b><small>{historyModeNames[r.mode]} / {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{r.mode==='precision' ? r.drill?.movementScore===undefined?'Unscored':`${r.drill.movementScore}/100` : `${Math.round(r.mode === 'tracking' ? r.tracking : r.shots ? r.hits / r.shots * 100 : 0)}%`}</strong><ChevronDown size={14} /></button>)}
          {legacy.length > 0 && <><h2>Previous-version history</h2>{legacy.map(r => <div className="history-row" key={r.id}><span>{r.weaponName}<small>{new Date(r.createdAt).toLocaleDateString()}</small></span><b>{r.scores.overall} score</b></div>)}</>}
        </div>}
      </aside>
    </div>}
    {tutorial && <MovementTutorial keyboard={settings.keyboard} close={() => setTutorial(false)} practice={() => {setTutorial(false); update({mode: 'precision', spread: true, drillPace: 'practice'});}}/>}
    <ProgressionPanel controller={progression} activeEquipment={selectedWeapon} equipmentLabels={equipmentNames} requestedEquipment={armoryRequest} requestedAchievements={achievementRequest} onRequestHandled={()=>{setArmoryRequest(null);setAchievementRequest(false);}} onOpenChange={value=>{setArmoryOpen(value); if(value)engine.current?.pause();}}/>
    </section>
  </main>;
}
