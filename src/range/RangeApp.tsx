import {download} from './ui/download';
import {HomeScreen} from './ui/screens/HomeScreen';
import {SessionScreen} from './ui/screens/SessionScreen';
import {ResultsScreen} from './ui/screens/ResultsScreen';
import {readSessionHistories, recentSessions} from './ui/session-data';
import type {DuelStatus} from './duel/DuelEngine';
import {drillSetupSummary, rangeDrillDefaults} from './ui/drill-setup';
import {LoadoutScreen, type LoadoutSlot} from './ui/screens/LoadoutScreen';
import {TopNav, type MenuScreen} from './ui/TopNav';
import {PlayScreen} from './ui/screens/PlayScreen';
import {useBotzConfig, useDuelConfig} from './ui/useDrillConfig';
import type {DuelHandle, DuelMenuStatus} from './duel/DuelStage';
import {SettingsScreen} from './ui/screens/SettingsScreen';
import {CrosshairView} from './ui/CrosshairView';
import {AmmoBlock, EscHint, ScoreBar, ScoreCell, StatBlock, WeaponSlotList} from './hud/Hud';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Activity, ArrowLeft, ArrowRight, ArrowUp, Check, Eye, Pause, Play, RotateCcw, ScanLine, Shield, Target, X} from 'lucide-react';
import {Crosshair, defaults, gameData, isDuelEngineMode, loadSettings, loadoutWeapon, MeasuredProfile, migrateMode, Mode, modeNames, parseProfile, saveSettings, Settings, Weapon, weaponNames} from './config';
import {RangeEngine, RangeStatus} from './engine';
import {Result} from './simulation';
import {loadAttempts} from '../lib/storage';
import {markSetupHintSeen, needsSetupHint} from './onboarding';
import {equipmentIds, equipmentNames} from './equipment';
import {isDrillMode, readDrillMetrics} from './drills';
import {DrillPanel} from './DrillPanel';
import {makeRepFeedback, type RepFeedback} from './rep-feedback';
import {DuelStage} from './duel/DuelStage';
import {MovementTutorial} from './MovementTutorial';
import {modeInfo} from './mode-info';
import {createProgressionController} from './progression';
import {AchievementNotification, ProgressionPanel, useProgression} from './ProgressionPanel';
import {cosmeticCatalog, cosmeticLabel} from './cosmetics';
import {Changelog} from './Changelog';
import {HearingPractice} from './HearingPractice';
import {keyHint} from './keybinds/profile';
import {applyConsoleCommand} from './console-settings';

function readResults(): Result[] {
  try {
    const a = JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]');
    return Array.isArray(a) ? a.filter(r => r && equipmentIds.includes(r.weapon) && typeof r.id === 'string'
      && ['shots', 'hits', 'heads', 'seconds', 'tracking'].every(k => Number.isFinite(r[k])) && Number.isFinite(Date.parse(r.date))
      && Array.isArray(r.samples) && r.samples.length <= 150 && r.samples.every((p: Record<string, unknown>) => p && ['x', 'y', 'bullet'].every(k => Number.isFinite(p[k])))).slice(0, 100).map(r => ({ ...r, drill:readDrillMetrics(r.drill), mode: r.mode === 'tracking' ? 'tracking' : migrateMode(r.mode) })) : [];
  } catch { return []; }
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
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [status, setStatus] = useState(emptyStatus);
  const [panel, setPanel] = useState<Panel>(null);
  const panelRef = useRef(panel); panelRef.current = panel;
  const [loadoutSlot, setLoadoutSlot] = useState<LoadoutSlot>();
  const [screen, setScreen] = useState<MenuScreen | 'game'>('play');
  const screenRef = useRef(screen); screenRef.current = screen;
  const duel = useRef<DuelHandle>(null);
  const [duelMenu, setDuelMenu] = useState<DuelMenuStatus>({ready: false, playing: false, paused: false, result: false, input: 'Ready', error: ''});
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const duelConfig = useDuelConfig(), botzConfig = useBotzConfig('botz'), reflexConfig = useBotzConfig('reflex'), redlineConfig = useBotzConfig('redline');
  const selectedBotz = settings.mode === 'reflex' ? reflexConfig : settings.mode === 'redline' ? redlineConfig : botzConfig;
  const setupSummary = drillSetupSummary(settings, selectedBotz.config, duelConfig.config);
  const setupRef = useRef(setupSummary); setupRef.current = setupSummary;
  const [hasSession, setHasSession] = useState(false);
  const starting = useRef(false);
  const [completed, setCompleted] = useState<{status: DuelStatus; mode: Mode; setup: string}>();
  const [histories, setHistories] = useState(readSessionHistories);
  const onDuelMenu = useCallback((value: DuelMenuStatus) => {
    setDuelMenu(previous => Object.keys(value).every(key => previous[key as keyof DuelMenuStatus] === value[key as keyof DuelMenuStatus]) ? previous : value);
    if (!starting.current && screenRef.current === 'game' && (value.paused || !value.playing || value.result)) {
      if (value.result && duel.current) setCompleted({status: duel.current.snapshot(), mode: settingsRef.current.mode, setup: setupRef.current});
      setScreen(value.result ? 'results' : 'play');
    }
  }, []);
  const [results, setResults] = useState(readResults);
  const resultsRef=useRef(results);resultsRef.current=results;
  const [repFeedback,setRepFeedback]=useState<(RepFeedback&{id:string;mode:Mode})|null>(null);
  const [legacy] = useState(loadAttempts);
  const [profiles, setProfiles] = useState<Partial<Record<Weapon, MeasuredProfile>>>(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('spraylab.profiles.v1') || '{}')).map(([k, v]) => [k, parseProfile(JSON.stringify(v))])); } catch { return {}; }
  });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const host = useRef<HTMLDivElement>(null), follow = useRef<HTMLDivElement>(null), hitmarker = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const engine = useRef<RangeEngine>();
  const drawer = useRef<HTMLElement>(null);
  const selectedWeapon = loadoutWeapon(settings);
  const assetReady = status.assets === 'Models ready' && status.weapon === selectedWeapon;
  const score = settings.mode==='precision' ? status.drill?.last?.movementScore ?? 0 : status.shots ? status.hits / status.shots * 100 : 0;
  const showRepFeedback=repFeedback?.mode===settings.mode && status.active && !status.firing && !status.hitFlash;
  const update = useCallback((patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch })), []);
  // A manual edit replaces the CS2 convars; the next bound crosshair command starts from this crosshair.
  const cross = useCallback((patch: Partial<Crosshair>) => setSettings(s => { const next = { ...s, crosshair: { ...s.crosshair, ...patch } }; delete next.cs2Crosshair; return next; }), []);
  const [consoleCommand] = useState(() => (args: string[]) => setSettings(s => applyConsoleCommand(s, args) ?? s));
  useEffect(() => {if (screen !== 'game' || panel === 'history') setHistories(readSessionHistories());}, [screen, panel, settings.mode, results]);
  const recent = useMemo(() => recentSessions(results, histories), [results, histories]);
  const open = useCallback((next: Panel) => { engine.current?.pause(); duel.current?.pause(); setSetupHint(false); setPanel(next); }, []);
  const navigate = useCallback((next: MenuScreen) => {engine.current?.pause(); duel.current?.pause(); setPanel(null); setScreen(next);}, []);
  const home = useCallback(() => navigate('home'), [navigate]);
  const play = useCallback(() => navigate('play'), [navigate]);
  const openLoadout = useCallback(() => {setLoadoutSlot(undefined); open('weapons');}, [open]);
  const openLoadoutSlot = useCallback((slot: LoadoutSlot) => {setLoadoutSlot(slot); open('weapons');}, [open]);
  const openSettings = useCallback(() => open('settings'), [open]);
  const openHistory = useCallback(() => open('history'), [open]);
  const openChangelog = useCallback(() => open('changelog'), [open]);
  const openAgent = useCallback(() => setArmoryRequest('agent'), []);
  const openArmory = useCallback(() => setArmoryRequest('knife'), []);
  const toggleFps = useCallback(() => update({showFps: !settingsRef.current.showFps}), [update]);
  const mute = useCallback(() => update({volume: settingsRef.current.volume ? 0 : .2}), [update]);
  const fullscreen = useCallback(() => {if (document.fullscreenElement) void document.exitFullscreen(); else void stage.current?.requestFullscreen?.().catch(() => setNotice('Fullscreen unavailable in this browser.'));}, []);
  const learn = useCallback(() => {engine.current?.pause(); duel.current?.pause(); setTutorial(true);}, []);
  const reset = useCallback(() => {engine.current?.reset(); update(rangeDrillDefaults(settingsRef.current.mode)); setHasSession(false);}, [update]);
  const selectMode = useCallback((mode: Mode) => {if (settingsRef.current.mode === mode) return; engine.current?.pause(); duel.current?.pause(); setHasSession(false); setCompleted(undefined); setDuelMenu({ready: false, playing: false, paused: false, result: false, input: 'Ready', error: ''}); update({mode, spread: modeInfo[mode].spread});}, [update]);
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
      if (document.querySelector('dialog[open]')) return;
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
    return () => {
      document.removeEventListener('keydown', key);
      if (!panelRef.current) {
        if (previous?.isConnected) previous.focus();
        else stage.current?.querySelector<HTMLButtonElement>('.settings-button')?.focus();
      }
    };
  }, [panel]);
  const start = useCallback(() => {
    setSetupHint(false); setHasSession(true); starting.current = true;
    // Pointer lock must be requested in this click, before any effect or await.
    const entering = isDuelEngineMode(settingsRef.current.mode) ? duel.current?.enter() : settingsRef.current.mode !== 'hearing' ? engine.current?.enter() : undefined;
    setScreen('game');
    void Promise.resolve(entering).finally(() => {
      starting.current = false;
      if (isDuelEngineMode(settingsRef.current.mode) && (duel.current?.snapshot().paused || duel.current?.snapshot().phase === 'ready')) setScreen('play');
      if (!isDuelEngineMode(settingsRef.current.mode) && settingsRef.current.mode !== 'hearing' && !engine.current?.sim.active) setScreen('play');
    });
  }, []);
  const newSession = useCallback(() => {if (isDuelEngineMode(settingsRef.current.mode)) duel.current?.restart(); else engine.current?.reset(); start();}, [start]);
  useEffect(() => {
    if (screen === 'game' || panel || tutorial || armoryOpen) return;
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape' && screen !== 'play') {event.preventDefault(); setScreen('play');}};
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [screen, panel, tutorial, armoryOpen]);
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
  const exportFrames = useCallback(() => stage.current?.querySelector<HTMLButtonElement>('.performance-meter')?.click(), []);
  const exportSession = useCallback(() => download('spraylab-session.json', {settings, results, legacy, profiles}), [settings, results, legacy, profiles]);
  const navigation = <TopNav screen={panel === 'weapons' ? 'loadout' : panel === 'history' ? 'session' : screen} navigate={navigate} loadout={openLoadout} armory={openArmory} session={openHistory} settings={openSettings} changelog={openChangelog} changelogOpen={panel === 'changelog'} count={recent.length} fps={settings.showFps} volume={settings.volume} toggleFps={toggleFps} mute={mute} fullscreen={fullscreen}/>;
  return <main className="range-app">
    <section ref={stage} data-screen={screen} className={`range-stage sl-stage${screen !== 'game' || panel ? ' sl-menu-open' : ''}${isDuelEngineMode(settings.mode) ? ' duel-stage' : isDrillMode(settings.mode) ? ' with-drill' : ''}`} aria-label="Practice range">
      <AchievementNotification controller={progression} onOpenAchievements={()=>{setPanel(null);setAchievementRequest(true);}}/>
      {settings.mode === 'hearing' ? <HearingPractice backToPlay={play} volume={settings.volume} openSettings={() => open('settings')} suspended={screen !== 'game' || !!panel || tutorial || armoryOpen}/> : isDuelEngineMode(settings.mode) ? <DuelStage key={settings.mode} variant={settings.mode === 'botz' || settings.mode === 'reflex' || settings.mode === 'redline' ? settings.mode : 'duel'} onConsole={consoleCommand} settings={settings} progression={progression} cosmeticRevision={progressionState.profile.equipped} openSettings={() => open('settings')} onEnter={entered} engineRef={duel} onMenuStatus={onDuelMenu} controlsTarget={controlsTarget} config={duelConfig.config} update={duelConfig.update} resetSetup={settings.mode==='duel'?duelConfig.reset:selectedBotz.reset} botz={selectedBotz.config} updateBotz={selectedBotz.update} suspended={screen !== 'game' || !!panel || tutorial || armoryOpen}/> : <>
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
        <AmmoBlock reloadProgress={status.reloadProgress} className="hud-ammo" label={cosmeticLabel(progressionState.profile, status.equipped)} testId="ammo" compactSeparator
          ammo={status.slot === 3 ? '--' : status.remaining} reserve={status.slot !== 3 && status.equipped !== 'zeus' ? status.reserve ?? status.magazine : undefined}
          state={status.reload ? `${status.reloadSilent ? 'Silent reload' : 'Reloading'} ${status.reload.toFixed(1)} s` : status.recharge ? `Recharge ${Math.ceil(status.recharge)}s` : !status.equipReady ? 'Drawing' : status.firing ? 'Firing' : 'Ready'}
          reload={status.active && status.slot !== 3 && status.equipped !== 'zeus' ? () => engine.current?.sim.reload() : undefined}
          reloadDisabled={status.remaining === status.magazine || !!status.reload || !status.reserve} reloadHint={`Reload ${equipmentNames[status.equipped]} (${keyHint(settings.keyboard, '+reload')})`}/>
      </div>
      </div>
      {isDrillMode(settings.mode)&&<DrillPanel status={status} mode={settings.mode} challenge={settings.drillPace==='challenge'} peekDuration={settings.peekDuration}/>}
      </>}
      {screen !== 'game' && <div className="sl-menu-layer" style={{visibility: panel ? 'hidden' : undefined}} aria-hidden={!!panel}>
        {navigation}
        {screen === 'play' && <PlayScreen settings={settings} profile={progressionState.profile} update={update} selectMode={selectMode} controlsRef={setControlsTarget}
          ready={settings.mode === 'hearing' || (isDuelEngineMode(settings.mode) ? duelMenu.ready : assetReady)} resume={isDuelEngineMode(settings.mode) ? duelMenu.paused && !duelMenu.result : hasSession}
          input={isDuelEngineMode(settings.mode) ? duelMenu.input : status.input}
          startLabel={settings.mode === 'hearing' ? 'Start hearing practice' : isDuelEngineMode(settings.mode) ? `${hasSession ? 'Resume' : settings.mode === 'duel' ? 'Enter' : 'Start'} ${settings.mode === 'duel' ? 'duel' : settings.mode === 'reflex' ? 'reflex training' : settings.mode === 'redline' ? 'aim_redline' : 'Aim Botz'}` : 'Enter range'}
          start={start} newSession={newSession} loadout={openLoadoutSlot} setupSummary={setupSummary} openSettings={openSettings} tutorial={learn} reset={reset} recent={recent} history={openHistory}/>}
        {screen === 'home' && <HomeScreen settings={settings} profile={progressionState.profile} rows={recent} ready={settings.mode === 'hearing' || (isDuelEngineMode(settings.mode) ? duelMenu.ready : assetReady)} start={start} setup={play} setupSummary={setupSummary} loadout={openLoadoutSlot} armory={openAgent} history={openHistory} changelog={openChangelog} tutorial={learn}/>}
        {screen === 'results' && completed && <ResultsScreen setupSummary={completed.setup} status={completed.status} mode={completed.mode} settings={settings} profile={progressionState.profile} home={home} setup={play} newSession={newSession}/>}
        {setupHint && !panel && <div className="settings-hint" role="status"><button className="hint-action" aria-label="Customize your CS2 settings" onClick={openSettings}><b>Match your CS2 setup</b><span id="settings-hint-text">Sensitivity, crosshair & audio</span></button><ArrowUp className="hint-arrow" size={22}/><button className="icon-button" aria-label="Dismiss settings hint" onClick={() => {setSetupHint(false); stage.current?.querySelector<HTMLButtonElement>('.settings-button')?.focus();}}><X size={16}/></button></div>}
      </div>}
      {screen !== 'game' && (error || duelMenu.error) && <div className="sl-engine-error" role="alert"><Shield size={24}/><p>{error || duelMenu.error}</p><button onClick={() => {if (isDuelEngineMode(settings.mode)) location.reload(); else {setError(''); setGeneration(value=>value+1);}}}>Reload range</button></div>}
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {panel && <div className="drawer-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className={`drawer ${panel === 'settings' ? 'sl-settings-page' : panel === 'weapons' ? 'sl-loadout-page' : panel === 'history' ? 'sl-session-page' : ''} ${panel === 'history' || panel === 'changelog' || panel === 'settings' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={drawer}>
        {(panel === 'weapons' || panel === 'history') && navigation}
        {panel === 'changelog' && <div className="drawer-header"><div><small>SPRAYLAB</small><h1 id="panel-title">Changelog</h1></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={21} /></button></div>}
        {panel === 'changelog' && <Changelog/>}
        {panel === 'settings' && <SettingsScreen settings={settings} profiles={profiles} update={update} cross={cross} close={closePanel} notify={setNotice} importProfile={importProfile}
          restore={restoreSettings} removeCapture={removeCapture} exportSession={exportSession} exportFrames={exportFrames}/>}
        {panel === 'weapons' && <LoadoutScreen initialSlot={loadoutSlot} settings={settings} update={update} profile={progressionState.profile} controller={progression} armory={setArmoryRequest} close={closePanel}/>}
        {panel === 'history' && <SessionScreen results={results} legacy={legacy} histories={histories} mode={settings.mode} snapshot={duel.current?.snapshot()} close={closePanel}/>}

      </aside>
    </div>}
    {tutorial && <MovementTutorial keyboard={settings.keyboard} close={() => setTutorial(false)} practice={() => {setTutorial(false); selectMode('precision'); update({drillPace:'practice'}); setScreen('play');}}/>}
    <ProgressionPanel controller={progression} activeEquipment={selectedWeapon} equipmentLabels={equipmentNames} requestedEquipment={armoryRequest} requestedAchievements={achievementRequest} onRequestHandled={()=>{setArmoryRequest(null);setAchievementRequest(false);}} onOpenChange={value=>{setArmoryOpen(value); if(value)engine.current?.pause();}}/>
    </section>
  </main>;
}
