import {TrainingSettings} from './TrainingSettings';
import {memo, useEffect, useRef, useState, type FocusEvent, type MouseEvent} from 'react';
import {Check, Download, RotateCcw, Upload, Volume2, X} from 'lucide-react';
import {classicViewmodel, gameData, loadoutWeapon, presets, resolutions, resolutionSize, weaponNames, type Crosshair, type MeasuredProfile, type Resolution, type Settings, type Weapon} from '../../config';
import {KeyboardSettings} from '../../keybinds/KeyboardSettings';
import {frameLimitOptions, useDisplayRate} from '../../display-rate';
import recoilProvenance from '../../recoil-provenance.json';
import {RangeAudio} from '../../audio';
import {CrosshairView} from '../CrosshairView';
import {SliderRow as Slider, SwitchRow as Toggle, NumberField, Tabs, Button, IconButton} from '../primitives';
import '../settings.css';

type Tab = 'game' | 'video' | 'crosshair' | 'keyboard' | 'data';
const tabs: {id: Tab; label: string}[] = [{id: 'game', label: 'Game'}, {id: 'video', label: 'Video'}, {id: 'crosshair', label: 'Crosshair'}, {id: 'keyboard', label: 'Keyboard / Mouse'}, {id: 'data', label: 'Audio & Data'}];
type Props = {settings: Settings; profiles: Partial<Record<Weapon, MeasuredProfile>>; update: (patch: Partial<Settings>) => void;
  cross: (patch: Partial<Crosshair>) => void; close: () => void; restore: () => void; notify: (message: string) => void;
  importProfile: (file?: File) => Promise<void>; removeCapture: () => void; exportSession: () => void; exportFrames: () => void};
const help: Record<string, string> = {
  'Low-latency rendering': 'Chrome and Edge can present the frame without waiting for the page compositor. It can tear, like V-Sync off. Takes effect when you switch drills or reload. Software renderers always get a normal canvas.',
  'Render quality': 'Choose scene detail and rendering density. Adaptive adjusts density as the frame rate changes. Performance also sets a 60 FPS limit.',
  'Resolution': "Like CS2's Stretched scaling: the world and crosshair are stretched to fill the view, and the scene renders at that many rows. Your hands and weapon keep their proportions.",
  'Show FPS counter': 'Show FPS and the 95th-percentile frame interval. When paused, click the monitor to download frame timings. This measures frame delivery, not physical input latency.',
  'Protect range Ctrl+W': 'Request fullscreen and keyboard lock while playing, where supported, so browser shortcuts do not interrupt practice. Escape still pauses.',
  'Sensitivity': 'Match your CS2 sensitivity. Together with mouse DPI, this determines eDPI and the distance required for a full turn.',
  'Mouse DPI': 'Enter the DPI set on your mouse. SprayLab uses this to show cm/360 and eDPI; it cannot change the mouse hardware setting.',
  'Invert mouse Y': 'Reverse vertical mouse movement.',
  'Follow recoil': 'Move the crosshair with recoil so you can see the correction needed between shots.',
  'Viewmodel FOV': "Same values as CS2's viewmodel_fov and viewmodel_offset_x/y/z (right, forward, up). Import CS2 config under Keyboard / Mouse reads them from autoexec.cfg or CS2's saved settings.",
  'Viewmodel offset X': 'Move the first-person weapon right or left. Matches viewmodel_offset_x in CS2.',
  'Viewmodel offset Y': 'Move the first-person weapon forward or back. Matches viewmodel_offset_y in CS2.',
  'Viewmodel offset Z': 'Move the first-person weapon up or down. Matches viewmodel_offset_z in CS2.',
  'Transfer trigger': 'Transfer targets have 100 health and no armor. Recoil continues across A and B. A short selected burst caps the transfer count before its last round.',
  'Transfer after bullet': 'Transfer targets have 100 health and no armor. Recoil continues across A and B. A short selected burst caps the transfer count before its last round.',

};
const aspectName = (width: number, height: number) => ({'1.33': '4:3', '1.25': '5:4', '1.6': '16:10', '1.78': '16:9'} as Record<string, string>)[String(Math.round(width / height * 100) / 100)] ?? `${width}:${height}`;
function resolutionLabel(resolution: Resolution) {
  const size = resolutionSize(resolution);
  if (!size) return 'Native (fill the window)';
  const aspect = aspectName(size.width, size.height);
  return `${size.width} x ${size.height} (${aspect}${aspect === '4:3' || aspect === '5:4' ? ' stretched' : ''})`;
}

export const SettingsScreen = memo(function SettingsScreen({settings, profiles, update, cross, close, restore, notify, importProfile, removeCapture, exportSession, exportFrames}: Props) {
  const [tab, setTab] = useState<Tab>('game');
  const [about, setAbout] = useState({title: 'Sensitivity', text: help.Sensitivity});
  const displayHz = useDisplayRate(true);
  const audio = useRef<RangeAudio>();
  useEffect(() => () => {audio.current?.dispose(); audio.current = undefined;}, []);
  const testSound = async () => {
    const player = audio.current ??= new RangeAudio();
    await player.unlock(settings.weapon);
    if (player.disposed) return;
    if (player.status !== 'ready') notify('Weapon audio unavailable.');
    else player.play(settings.weapon, settings.volume);
  };
  const describe = (event: MouseEvent | FocusEvent) => {
    const row = (event.target as HTMLElement).closest('.sl-setting-row, .select-row, .two-fields label, .kb-row');
    if (!row) return;
    const control = row.querySelector('input, select');
    const title = control?.getAttribute('aria-label') ?? row.querySelector('label')?.textContent ?? '';
    if (!title) return;
    const paragraph = row.nextElementSibling;
    const explanation = paragraph?.matches('.setting-explanation') ? paragraph.textContent : '';
    const text = help[title] || explanation || row.getAttribute('title') || '';
    if (text) setAbout(previous => previous.title === title && previous.text === text ? previous : {title, text});
  };
  return <>
    <header className="sl-settings-header"><h1 id="panel-title">Settings</h1><Tabs label="Settings sections" items={tabs} value={tab} onChange={value => {
      setTab(value);
      if (value === 'video') setAbout({title: 'Low-latency rendering', text: help['Low-latency rendering']});
      else if (value === 'game') setAbout({title: 'Sensitivity', text: help.Sensitivity});
    }}/><IconButton label="Close panel" onClick={close}><X size={22}/></IconButton></header>
    <div className={`sl-settings-body sl-settings-${tab}`}>
      <div className="sl-settings-controls drawer-content" role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} onMouseOver={describe} onFocusCapture={describe}>
            {tab === 'keyboard' && <KeyboardSettings settings={settings} update={update} notify={notify}/>}
            {tab === 'game' && <>
              <h2>Mouse</h2><div className="two-fields"><label>Sensitivity<NumberField label="Sensitivity" min={.05} max={10} step={.05} value={settings.sensitivity} onCommit={sensitivity => update({ sensitivity })} /></label><label>Mouse DPI<NumberField label="Mouse DPI" min={100} max={32000} step={100} value={settings.dpi} onCommit={dpi => update({ dpi })} /></label></div>
              <div className="readout"><span>cm / 360</span><b>{(360 / (.022 * settings.sensitivity * settings.dpi) * 2.54).toFixed(2)}</b></div>
              <div className="readout"><span>eDPI</span><b>{Math.round(settings.sensitivity * settings.dpi)}</b></div>
              <Toggle label="Invert mouse Y" checked={settings.invertY} onChange={v => update({ invertY: v })} />
              <TrainingSettings settings={settings} update={update}/>
              <h2>Viewmodel</h2>
              <Slider label="Viewmodel FOV" value={settings.viewmodel.fov} min={54} max={68} onChange={fov => update({viewmodel: {...settings.viewmodel, fov}})}/>
              <Slider label="Viewmodel offset X" value={settings.viewmodel.x} min={-2.5} max={2.5} step={.1} onChange={x => update({viewmodel: {...settings.viewmodel, x}})}/>
              <Slider label="Viewmodel offset Y" value={settings.viewmodel.y} min={-2} max={2} step={.1} onChange={y => update({viewmodel: {...settings.viewmodel, y}})}/>
              <Slider label="Viewmodel offset Z" value={settings.viewmodel.z} min={-2} max={2} step={.1} onChange={z => update({viewmodel: {...settings.viewmodel, z}})}/>
              <button className="secondary" onClick={() => update({viewmodel: classicViewmodel})}><RotateCcw size={15}/>Classic position</button>
              <p className="setting-explanation">Same values as CS2&apos;s viewmodel_fov and viewmodel_offset_x/y/z (right, forward, up). Import CS2 config under Keyboard / Mouse reads them from autoexec.cfg or CS2&apos;s saved settings.</p>

            </>}
            {tab === 'video' && <><h2>Display</h2><label className="select-row">Resolution<select aria-label="Resolution" value={settings.resolution} onChange={e => update({ resolution: e.target.value as Resolution })}>{resolutions.map(r => <option key={r} value={r}>{resolutionLabel(r)}</option>)}</select></label>
              <p className="setting-explanation">Like CS2&apos;s Stretched scaling: the world and crosshair are stretched to fill the view, and the scene renders at that many rows. Your hands and weapon keep their proportions.</p>
              <h2>Rendering</h2><label className="select-row">Render quality<select aria-label="Render quality" value={settings.quality} onChange={e => update({ quality: e.target.value as Settings['quality'], ...(e.target.value === 'performance' ? {frameLimit:60} : {}) })}><option value="auto">Adaptive</option><option value="performance">Performance (older PCs)</option><option value="low">Low</option><option value="high">High</option></select></label>
              <label className="select-row">Frame limit<select aria-label="Frame limit" value={settings.frameLimit} onChange={e => update({frameLimit: +e.target.value})}>{frameLimitOptions(displayHz, settings.frameLimit).map(n => <option key={n} value={n}>{n ? `${n} FPS` : displayHz ? `Display refresh rate (${displayHz} FPS)` : 'Display refresh rate'}</option>)}</select></label>
              <p className="setting-explanation">Browsers draw at most once per display refresh, so Display refresh rate is the highest frame rate this PC allows: up to 500 FPS on a 500 Hz monitor, when the PC keeps up.{displayHz ? ` This display measures ${displayHz} Hz.` : ''}</p>
              <Toggle label="Low-latency rendering" checked={settings.lowLatency} onChange={lowLatency => update({lowLatency})}/>
              <p className="setting-explanation">Chrome and Edge show each frame without waiting for the page compositor, about a frame sooner after you move the mouse. It can tear, like V-Sync off. Takes effect when you switch drills or reload.</p>
              <Toggle label="Show FPS counter" checked={settings.showFps} onChange={showFps => update({showFps})}/>
              <Button disabled={!settings.showFps || settings.mode==='hearing'} onClick={exportFrames} title={settings.showFps ? 'Download measured frame intervals' : 'Enable the FPS counter to record frame intervals'}><Download size={16}/>Export frame timings</Button>
              <h2>Browser</h2><Toggle label="Protect range Ctrl+W" checked={settings.protectShortcuts} onChange={protectShortcuts => update({protectShortcuts})}/>
              </>}
            {tab === 'crosshair' && <>
              <div className="sl-crosshair-layout"><div className="sl-crosshair-left"><div className="crosshair-preview" aria-label="Crosshair preview"><span className="sl-preview-label">4× zoom</span><div className="preview-target"/><div className="sl-crosshair-zoom"><CrosshairView value={settings.crosshair}/></div><div className="sl-crosshair-actual"><span className="sl-preview-label">Actual size</span><div className="preview-target"/><CrosshairView value={settings.crosshair}/></div></div><h2>Presets</h2>
              <div className="presets">{Object.entries(presets).map(([name, value]) => <button key={name} aria-pressed={Object.entries(value).every(([key, v]) => settings.crosshair[key as keyof Crosshair] === v)} onClick={() => cross(value)}><div><CrosshairView value={value} /></div>{name}</button>)}</div>
              </div><div className="sl-crosshair-controls"><label className="color-row">Color<input type="color" aria-label="Crosshair color" value={settings.crosshair.color} onChange={e => cross({ color: e.target.value })} /></label>
              <div className="swatches">{['#50ff76', '#52edff', '#ffef68', '#ffffff', '#ef79b3', '#f66556'].map(color => <button key={color} style={{ background: color }} aria-label={`Crosshair ${color}`} aria-pressed={settings.crosshair.color === color} onClick={() => cross({ color })}>{settings.crosshair.color === color && <Check size={14} color="#111" />}</button>)}</div>
              {settings.cs2Crosshair && <p className="setting-explanation">Matches your CS2 crosshair convars at {settings.cs2Crosshair.screenHeight}p. Editing here replaces them; keys bound to crosshair convars, such as toggle aliases, still change it in game.</p>}
              <Slider label="Length" value={settings.crosshair.size} min={0} max={40} step={.5} onChange={v => cross({ size: v })} />
              <Slider label="Gap" value={settings.crosshair.gap} min={-10} max={30} step={.5} onChange={v => cross({ gap: v })} />
              <Slider label="Thickness" value={settings.crosshair.thickness} min={.5} max={10} step={.5} onChange={v => cross({ thickness: v })} />
              <Slider label="Outline" value={settings.crosshair.outline} min={0} max={3} step={.5} onChange={v => cross({ outline: v })} />
              <Slider label="Opacity" value={settings.crosshair.alpha} min={.1} max={1} step={.05} onChange={v => cross({ alpha: v })} />
              <Toggle label="Center dot" checked={settings.crosshair.dot} onChange={v => cross({ dot: v })} />
              <Toggle label="T-style" checked={settings.crosshair.t} onChange={v => cross({ t: v })} />
              <Toggle label="Dynamic gap" checked={settings.crosshair.dynamic} onChange={v => cross({ dynamic: v })} /></div></div>
            </>}
            {tab === 'data' && <>
              <h2>Audio</h2><Slider label="Master volume" value={Math.round(settings.volume * 100)} min={0} max={100} suffix="%" onChange={v => update({ volume: v / 100 })} />
              <button className="secondary" onClick={testSound}><Volume2 size={16} />Test {weaponNames[settings.weapon]}</button>
              <h2>Data provenance</h2><dl className="data-list"><dt>Weapon data build</dt><dd>{gameData.build}</dd><dt>Recoil math inspected</dt><dd>{recoilProvenance.build}</dd><dt>Cadence, speed, magazine</dt><dd>Game weapon data</dd><dt>Models & shot samples</dt><dd>Local Valve assets</dd><dt>Spray trajectory</dt><dd>{profiles[settings.weapon] ? 'Capture-fitted impulses' : 'Native seeds + recovered recoil math'}</dd><dt>Recoil recovery</dt><dd>Persistent punch + recoil index</dd></dl>
              <p className="settings-note">Weapon parameters match the latest local export. Recoil math was inspected on an earlier build; full trajectories, camera motion and subtick timing are not an exact CS2 reproduction.</p>
              <p className="data-note">Recoil and firing inaccuracy persist between trigger presses. Recovery math is derived from the installed client; subtick movement, spread RNG and animation blending are not an exact CS2 reproduction.</p>
              <label className="secondary file-button"><Upload size={16} />Import angular capture<input aria-label="Import angular capture" type="file" accept="application/json,.json" onChange={e => { void importProfile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {profiles[settings.weapon] && <><p className="data-note">{profiles[settings.weapon]?.source} / build {profiles[settings.weapon]?.build}</p><button className="secondary" onClick={removeCapture}>Remove capture</button></>}
              <button className="secondary" onClick={exportSession}><Download size={16} />Export session</button>
            </>}
      </div>
      {tab !== 'crosshair' && tab !== 'data' && tab !== 'keyboard' && <aside className="sl-setting-help" aria-label="About this setting">
        <small>About this setting</small><h2>{about.title}</h2><p>{about.text}</p>
        {about.title === 'Low-latency rendering' && <div className="sl-latency-diagram" aria-hidden="true"><small>Off</small><div><span>Frame</span> → <span>Page compositor</span> → <span>Screen</span></div><small>On</small><div><span>Frame</span> → <span>Screen</span></div></div>}
      </aside>}
    </div>
    <footer className="sl-settings-footer"><Button onClick={restore}><RotateCcw size={16}/>Restore defaults</Button><Button primary onClick={close}>Done</Button></footer>
  </>;
});
