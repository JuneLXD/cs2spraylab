import {useEffect, useRef, useState} from 'react';
import {ClipboardPaste, Download, FileUp, Plus, RotateCcw, TriangleAlert, X} from 'lucide-react';
import {sanitizeViewmodel, type Settings} from '../config';
import {cs2DefaultBinds, defaultKeyboard, duelOnlyCommands, keyboardPage, keysFor, otherBinds, trainerCommands,
  type BindRow, type EnumRow, type KeyboardProfile, type SliderRow} from './profile';
import {browserReservedKeys, describeKey, displayKey, keyFromCode, keyFromMouseButton} from './keys';
import {exportCfg, importCs2Config, parseBindLine, type ImportReport, type ImportResult} from './cs2-import';
import {crosshairFromCvars, cvarsFromCrosshair} from './crosshair-cvars';
import {screenMetrics} from '../console-settings';
import './keybinds.css';

type Props = {settings: Settings; update: (patch: Partial<Settings>) => void; notify: (message: string) => void};
type Capture = {command: string; label: string; replace?: string};

const summaryRows: [string, string][] = [['Move Forward', '+forward'], ['Move Backward', '+back'], ['Move Left', '+left'], ['Move Right', '+right'],
  ['Walk', '+sprint'], ['Duck', '+duck'], ['Jump', '+jump'], ['Fire', '+attack'], ['Secondary Fire', '+attack2'], ['Reload', '+reload'],
  ['Inspect', '+lookatweapon'], ['Use', '+use'], ['Drop', 'drop'], ['Primary', 'slot1'], ['Secondary', 'slot2'], ['Knife / Zeus', 'slot3'],
  ['Zeus', 'slot11'], ['Last weapon', 'lastinv'], ['Next / prev weapon', 'invnext']];
const rowId = (section: string) => `kb-${section}`;

/** CS2's Settings > Keyboard / Mouse page, plus import and export of CS2 config files. */
export function KeyboardSettings({settings, update, notify}: Props) {
  const keyboard = settings.keyboard;
  const setKeyboard = (patch: Partial<KeyboardProfile>) => update({keyboard: {...keyboard, ...patch}});
  const [capture, setCapture] = useState<Capture | null>(null);
  const [change, setChange] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fromDefaults, setFromDefaults] = useState(true);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [newBind, setNewBind] = useState('');
  const [resetting, setResetting] = useState(false);
  const latest = useRef(keyboard); latest.current = keyboard;

  const assign = (key: string, target: Capture) => {
    const binds = {...latest.current.binds};
    const previous = binds[key];
    if (target.replace && target.replace !== key) delete binds[target.replace];
    binds[key] = target.command;
    update({keyboard: {...latest.current, binds}});
    const was = previous && previous !== target.command ? ` (was ${previous})` : '';
    setChange(`${displayKey(key)} now runs ${target.label}${was}.${browserReservedKeys[key] ? ` ${browserReservedKeys[key]}` : ''}`);
  };
  useEffect(() => {
    if (!capture) return;
    const swallow = (event: Event) => {event.preventDefault(); event.stopPropagation();};
    // The release after a captured press must not reach the page either: a click on another
    // row, the context menu, or Alt opening the browser menu.
    const trailing = (types: readonly string[]) => {
      const late = (event: Event) => swallow(event);
      types.forEach(type => window.addEventListener(type, late, true));
      setTimeout(() => types.forEach(type => window.removeEventListener(type, late, true)), 800);
    };
    const finish = (key: string | undefined, release: readonly string[]) => {setCapture(null); trailing(release); if (key) assign(key, capture);};
    const keydown = (event: KeyboardEvent) => {
      swallow(event);
      const key = keyFromCode(event.code);
      if (event.code === 'Escape' || key) finish(key && event.code !== 'Escape' ? key : undefined, ['keyup']);
    };
    const mousedown = (event: MouseEvent) => {swallow(event); const key = keyFromMouseButton(event.button); if (key) finish(key, ['click', 'auxclick', 'contextmenu', 'mouseup']);};
    const wheel = (event: WheelEvent) => {if (!event.deltaY) return; swallow(event); finish(event.deltaY < 0 ? 'MWHEELUP' : 'MWHEELDOWN', []);};
    const listeners: [string, EventListener][] = [['keydown', keydown as EventListener], ['mousedown', mousedown as EventListener],
      ['wheel', wheel as EventListener], ['contextmenu', swallow], ['auxclick', swallow], ['click', swallow]];
    // Wait for the click that opened capture to finish, so it does not bind Mouse 1.
    const timer = setTimeout(() => listeners.forEach(([type, listener]) => window.addEventListener(type, listener, {capture: true, passive: false})));
    return () => {clearTimeout(timer); listeners.forEach(([type, listener]) => window.removeEventListener(type, listener, {capture: true}));};
  }, [capture]);

  const unbind = (key: string) => {
    const binds = {...keyboard.binds}; delete binds[key];
    setKeyboard({binds}); setChange(`${displayKey(key)} is unbound.`);
  };
  const apply = (result: ImportResult) => {
    const metrics = screenMetrics(settings.resolution);
    const cs2Crosshair = result.crosshair && {cvars: result.crosshair.cvars, screenHeight: result.crosshair.screenHeight ?? metrics.screenHeight};
    const view = cs2Crosshair && crosshairFromCvars(cs2Crosshair, metrics.cssHeight);
    update({keyboard: result.profile, ...(result.mouse.sensitivity !== undefined ? {sensitivity: result.mouse.sensitivity} : {}),
      ...(result.mouse.invertY !== undefined ? {invertY: result.mouse.invertY} : {}),
      ...(Object.keys(result.viewmodel).length ? {viewmodel: sanitizeViewmodel({...settings.viewmodel, ...result.viewmodel})} : {}),
      ...(cs2Crosshair && view ? {crosshair: view.crosshair, cs2Crosshair, ...(view.follow !== undefined ? {follow: view.follow} : {})} : {})});
    setReport(view?.notes.length ? {...result.report, settings: [...result.report.settings, ...view.notes.map(note => `crosshair: ${note}`)]} : result.report);
    setChange('');
  };
  const importFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    try {
      const files = await Promise.all([...list].slice(0, 16).map(async file => {
        if (file.size > 1_000_000) throw new Error(`${file.name} is larger than 1 MB.`);
        return {name: file.name, text: await file.text()};
      }));
      apply(importCs2Config(files, keyboard, {fromDefaults}));
    } catch (error) {notify((error as Error).message);}
  };
  const download = () => {
    const metrics = screenMetrics(settings.resolution);
    // Current CS2 builds read the pixel-based crosshair names.
    const crosshair = cvarsFromCrosshair(settings.crosshair, settings.cs2Crosshair?.screenHeight ?? metrics.screenHeight, metrics.cssHeight);
    const url = URL.createObjectURL(new Blob([exportCfg(keyboard, {...settings, crosshair: {...crosshair, cvars: {...crosshair.cvars, cl_crosshair_recoil: settings.follow ? '1' : '0'}}})], {type: 'text/plain'}));
    const link = document.createElement('a'); link.href = url; link.download = 'spraylab.cfg'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addBind = () => {
    const parsed = parseBindLine(newBind);
    if (!parsed) {notify('Write a bind as: bind "key" "command"'); return;}
    setKeyboard({binds: {...keyboard.binds, [parsed.key]: parsed.command}});
    setChange(`${displayKey(parsed.key)} now runs ${parsed.command}.`); setNewBind('');
  };

  const enumValue = (row: EnumRow): [string, (value: string) => void] | undefined =>
    row.bindkey === 'mouse_y' ? [settings.invertY ? '!pitch' : 'pitch', value => update({invertY: value === '!pitch'})]
      : row.convar === 'option_duck_method' ? [keyboard.duckToggle ? '1' : '0', value => setKeyboard({duckToggle: value === '1'})]
      : row.convar === 'option_speed_method' ? [keyboard.walkToggle ? '1' : '0', value => setKeyboard({walkToggle: value === '1'})]
      : row.convar === 'cl_debounce_zoom' ? [keyboard.zoomRepeat ? '0' : '1', value => setKeyboard({zoomRepeat: value === '0'})]
      : undefined;
  const sliderValue = (row: SliderRow): [number, (value: number) => void] | undefined =>
    row.convar === 'sensitivity' ? [settings.sensitivity, sensitivity => update({sensitivity})]
      : row.convar === 'zoom_sensitivity_ratio' ? [keyboard.zoomSensitivity, zoomSensitivity => setKeyboard({zoomSensitivity})]
      : undefined;

  const bindRow = (row: BindRow) => {
    const keys = keysFor(keyboard, row.bind);
    const used = trainerCommands.has(row.bind);
    const listening = capture?.command === row.bind;
    const target = {command: row.bind, label: row.label};
    return <div key={row.id} className={`kb-row${used ? '' : ' cs2-only'}`} role="group" aria-label={row.label} title={row.tooltip}>
      <span className="kb-label">{row.label}{!used ? <small>CS2 only</small> : duelOnlyCommands.has(row.bind) && <small>AI Duel</small>}</span>
      <span className="kb-keys">
        {keys.map(({key, direct}) => <span key={key} className={`kb-key${used && browserReservedKeys[key] ? ' reserved' : ''}`}>
          {direct
            ? <button type="button" className={listening && capture?.replace === key ? 'listening' : ''}
                title={used && browserReservedKeys[key] ? `${describeKey(key)}. ${browserReservedKeys[key]}` : describeKey(key)}
                aria-label={`${row.label}: ${displayKey(key)}. Press to change`} onClick={() => setCapture({...target, replace: key})}>
                {listening && capture?.replace === key ? 'Press a key' : displayKey(key)}</button>
            : <span className="kb-alias" title={`${describeKey(key)} runs "${keyboard.binds[key]}"`}>{displayKey(key)}<em>script</em></span>}
          <button type="button" className="kb-clear" aria-label={`Unbind ${displayKey(key)}`} title="Unbind" onClick={() => unbind(key)}><X size={12}/></button>
        </span>)}
        <button type="button" className={`kb-add${listening && !capture?.replace ? ' listening' : ''}`} aria-label={`Add a key for ${row.label}`}
          title="Add a key" onClick={() => setCapture(target)}>
          {listening && !capture?.replace ? 'Press a key' : keys.length ? <Plus size={13}/> : 'Unbound'}</button>
      </span>
    </div>;
  };

  return <div className="keyboard-settings">
    <nav className="kb-nav" aria-label="Keyboard / Mouse sections">
      {[{id: 'import', title: 'Import'}, ...keyboardPage.sections].map(section => <button key={section.id} type="button"
        onClick={() => document.getElementById(rowId(section.id))?.scrollIntoView({block: 'start', behavior: 'smooth'})}>
        {section.title.replace(/ (Keys|Settings|Options)$/, '')}</button>)}
    </nav>
    {capture && <p className="kb-capture" role="status">Press a key, mouse button or wheel for <b>{capture.label}</b>. Esc cancels.</p>}
    {change && !capture && <p className="kb-change" role="status">{change}</p>}

    <section id={rowId('import')} className="kb-import" aria-labelledby="kb-import-title">
      <h2 id="kb-import-title">Use your CS2 binds</h2>
      <p className="setting-explanation">Choose <code>autoexec.cfg</code>, and optionally the <code>cs2_user_keys_0_slot0.vcfg</code> and <code>cs2_user_convars_0_slot0.vcfg</code> files CS2 saves your settings in. Add <code>cs2_video.txt</code> from the same folder so the crosshair is sized for your CS2 resolution. They are read in this browser and never uploaded.</p>
      <div className="kb-actions">
        <label className="secondary file-button"><FileUp size={15}/>Import CS2 config<input type="file" multiple accept=".cfg,.vcfg,.txt"
          aria-label="Import CS2 config files" onChange={event => {void importFiles(event.target.files); event.target.value = '';}}/></label>
        <button type="button" className="secondary" aria-expanded={pasting} onClick={() => setPasting(value => !value)}><ClipboardPaste size={15}/>Paste</button>
        <button type="button" className="secondary" onClick={download}><Download size={15}/>Export .cfg</button>
      </div>
      <label className="toggle-row"><span>Start from CS2 defaults</span><input type="checkbox" role="switch" checked={fromDefaults} onChange={event => setFromDefaults(event.target.checked)}/><span className="switch"/></label>
      {pasting && <div className="kb-paste">
        <textarea aria-label="CS2 config text" value={pasted} spellCheck={false} rows={6} placeholder={'bind "t" "+forward"\nbind "c" "+duck"'} onChange={event => setPasted(event.target.value)}/>
        <button type="button" className="primary" disabled={!pasted.trim()} onClick={() => apply(importCs2Config([{name: 'Pasted config', text: pasted}], keyboard, {fromDefaults}))}>Apply</button>
      </div>}
      <details className="kb-paths"><summary>Where are these files?</summary>
        <dl>
          <dt>autoexec.cfg</dt><dd><code>Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg</code></dd>
          <dt>Saved binds and settings</dt><dd><code>Steam\userdata\&lt;your account ID&gt;\730\local\cfg</code></dd>
        </dl>
        <p>Paste the folder path into the file picker&apos;s address bar. Steam is usually in <code>C:\Program Files (x86)\Steam</code>.</p>
      </details>
      {keyboard.source && <p className="kb-source">Binds from {keyboard.source.label}, {new Date(keyboard.source.at).toLocaleString()}</p>}
      {report && <ImportSummary report={report} keyboard={keyboard} close={() => setReport(null)}/>}
    </section>

    {keyboardPage.sections.map(section => <section key={section.id} id={rowId(section.id)} className="kb-section" aria-labelledby={`${rowId(section.id)}-title`}>
      <h2 id={`${rowId(section.id)}-title`}>{section.title}</h2>
      {section.rows.filter(row => !(row.kind === 'slider' && row.convar === 'sensitivity') && !(row.kind === 'enum' && row.bindkey === 'mouse_y')).map(row => {
        if (row.kind === 'bind') return bindRow(row);
        if (row.kind === 'enum') {
          const [value, set] = enumValue(row) ?? ['', () => {}];
          return <label key={row.label} className="kb-row kb-option" title={row.tooltip}><span className="kb-label">{row.label}</span>
            <select aria-label={row.label} value={value} onChange={event => set(event.target.value)}>
              {row.values.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
        }
        const [value, set] = sliderValue(row) ?? [0, () => {}];
        return <label key={row.label} className="slider-row kb-slider"><span>{row.label}<output>{value.toFixed(row.precision)}</output></span>
          <input aria-label={row.label} type="range" min={row.min} max={row.max} step={10 ** -row.precision} value={Math.min(row.max, Math.max(row.min, value))}
            onChange={event => set(Number(event.target.value))}/></label>;
      })}
    </section>)}

    <section className="kb-section" aria-labelledby="kb-other-title">
      <h2 id="kb-other-title">Other binds</h2>
      <p className="setting-explanation">Keys that run commands outside CS2&apos;s list, usually from an autoexec. Aliases and toggles work in SprayLab; other commands are kept for export.</p>
      {otherBinds(keyboard).map(([key, command]) => <div key={key} className="kb-row kb-other">
        <span className="kb-key"><span className="kb-alias" title={describeKey(key)}>{displayKey(key)}</span>
          <button type="button" className="kb-clear" aria-label={`Unbind ${displayKey(key)}`} title="Unbind" onClick={() => unbind(key)}><X size={12}/></button></span>
        <code>{command}</code>
      </div>)}
      <div className="kb-add-bind"><input aria-label="New bind" value={newBind} placeholder='bind "KP_ENTER" "noclip"' spellCheck={false}
        onChange={event => setNewBind(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') addBind();}}/>
        <button type="button" className="secondary" onClick={addBind}><Plus size={14}/>Add</button></div>
      {Object.keys(keyboard.aliases).length > 0 && <details className="kb-aliases"><summary>{Object.keys(keyboard.aliases).length} aliases</summary>
        <dl>{Object.entries(keyboard.aliases).map(([name, body]) => <div key={name}><dt>{name}</dt><dd><code>{body}</code></dd></div>)}</dl></details>}
    </section>

    <div className="kb-reset">
      {resetting ? <>
        <span>Are you sure you want to reset your Keyboard / Mouse settings?</span>
        <button type="button" className="secondary" onClick={() => {update({keyboard: defaultKeyboard}); setResetting(false); setReport(null); setChange('Restored SprayLab defaults.');}}>SprayLab defaults</button>
        <button type="button" className="secondary" onClick={() => {update({keyboard: {...defaultKeyboard, binds: cs2DefaultBinds}}); setResetting(false); setReport(null); setChange('Restored CS2 defaults.');}}>CS2 defaults</button>
        <button type="button" className="secondary" onClick={() => setResetting(false)}>Cancel</button>
      </> : <button type="button" className="secondary" onClick={() => setResetting(true)}><RotateCcw size={15}/>Reset</button>}
    </div>
  </div>;
}

function ImportSummary({report, keyboard, close}: {report: ImportReport; keyboard: KeyboardProfile; close: () => void}) {
  const keys = (command: string) => {
    const bound = keysFor(keyboard, command), direct = bound.filter(entry => entry.direct), scripts = bound.filter(entry => !entry.direct);
    return <>{direct.map(entry => displayKey(entry.key)).join(' / ') || (scripts.length ? '' : 'unbound')}
      {scripts.length > 0 && <small title="Runs as part of a script or alias">{direct.length ? ' + ' : ''}{scripts.map(entry => displayKey(entry.key)).join(', ')} script</small>}</>;
  };
  const files = report.files.filter(file => file.kind !== 'ignored').map(file => file.name).join(', ');
  return <div className="kb-report" role="status">
    <header><b>Imported {files || 'config'}</b><button type="button" className="icon-button" aria-label="Dismiss import summary" onClick={close}><X size={14}/></button></header>
    <p>{report.binds} binds, {report.unbinds} unbinds, {report.aliases} aliases{report.settings.length ? `; ${report.settings.join(', ')}` : ''}.</p>
    <dl className="kb-summary">{summaryRows.map(([label, command]) => <div key={command}><dt>{label}</dt><dd>{command === 'invnext' ? <>{keys('invnext')} · {keys('invprev')}</> : keys(command)}</dd></div>)}</dl>
    {report.missingExec.map(name => <p key={name} className="kb-warning"><TriangleAlert size={13}/><span><code>exec {name}</code> was skipped. Choose that file too to include its binds.</span></p>)}
    {report.reserved.map(({key, reason}) => <p key={key} className="kb-warning"><TriangleAlert size={13}/><span>{displayKey(key)}: {reason}</span></p>)}
    {report.unknownKeys.length > 0 && <p className="kb-warning"><TriangleAlert size={13}/><span>Unknown key names: {report.unknownKeys.join(', ')}</span></p>}
  </div>;
}
