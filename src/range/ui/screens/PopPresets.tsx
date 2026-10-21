import {useEffect, useId, useMemo, useState, useSyncExternalStore} from 'react';
import {loadoutWeapon, weaponNames, type Settings} from '../../config';
import {MAX_POP_PRESET_NAME, capturePopPreset, matchesPopPreset, popBuiltInPresets, popPresetPatch, popPresetStore, type PopPreset, type PopPresetResult} from '../../pop-presets';
import {Button, SettingRow, SwitchRow as Toggle} from '../primitives';

/** The saved presets, shared by every place the Pop settings are shown, and refreshed when another tab saves one. */
export function usePopPresets() {
  const snapshot = useSyncExternalStore(popPresetStore.subscribe, popPresetStore.getSnapshot, popPresetStore.getSnapshot);
  useEffect(() => popPresetStore.watchStorage(), []);
  return snapshot;
}

const optionLabel = (preset: PopPreset) => preset.weapon ? `${preset.name} · ${weaponNames[preset.weapon]}` : preset.name;

/** Load a ready-made or saved Pop setup, save the current one under a name (optionally tied to your weapon), update it, delete it. */
export function PopPresets({settings, update}: {settings: Settings; update: (patch: Partial<Settings>) => void}) {
  const {presets, persisted, selectedId: chosen} = usePopPresets();
  const nameId = useId();
  const all = useMemo(() => [...popBuiltInPresets, ...presets], [presets]);
  // The Play screen and Settings both show this block at once, so the chosen preset is shared; until one is chosen, it is
  // whichever preset the settings already are.
  const selected = chosen === undefined ? all.find(preset => matchesPopPreset(preset, settings)) : all.find(preset => preset.id === chosen);
  const saved = selected?.builtIn ? undefined : selected;
  const [name, setName] = useState(saved?.name ?? '');
  const [tie, setTie] = useState(!!saved?.weapon);
  const [message, setMessage] = useState('');
  // Choosing a preset on the other screen fills the name and tie here too.
  useEffect(() => {if (chosen !== undefined) {setName(saved?.name ?? ''); setTie(!!saved?.weapon);}}, [chosen]);
  const modified = !!selected && !matchesPopPreset(selected, settings);
  const load = (id: string) => {
    setMessage(''); popPresetStore.select(id);
    const preset = all.find(item => item.id === id);
    if (!preset) return;
    update(popPresetPatch(preset));
    const own = preset.builtIn ? undefined : preset;
    setName(own?.name ?? ''); setTie(!!own?.weapon);
  };
  const report = (result: PopPresetResult, verb: string) => {
    if ('error' in result) {setMessage(result.error); return;}
    popPresetStore.select(result.preset.id); setName(result.preset.name); setTie(!!result.preset.weapon);
    setMessage(`${verb} “${result.preset.name}”.`);
  };
  const save = () => {
    const result = popPresetStore.save(name, capturePopPreset(settings, tie));
    report(result, 'replaced' in result && result.replaced ? 'Replaced' : 'Saved');
  };
  const updateSaved = () => {if (saved) report(popPresetStore.update(saved.id, name, capturePopPreset(settings, tie)), 'Updated');};
  const remove = () => {
    if (!saved) return;
    popPresetStore.remove(saved.id); popPresetStore.select(''); setName(''); setTie(false); setMessage(`Deleted “${saved.name}”.`);
  };
  return <>
    <h2>Presets</h2>
    <label className="select-row">Preset<select aria-label="Pop preset" value={selected?.id ?? ''} onChange={event => load(event.target.value)}>
      <option value="">Custom (current settings)</option>
      <optgroup label="Built-in">{popBuiltInPresets.map(preset => <option key={preset.id} value={preset.id}>{optionLabel(preset)}</option>)}</optgroup>
      {presets.length > 0 && <optgroup label="Saved">{presets.map(preset => <option key={preset.id} value={preset.id}>{optionLabel(preset)}</option>)}</optgroup>}
    </select></label>
    <p className="setting-explanation">Presets set the balls (size, count, spacing, distance, hits, movement, respawn) and the environment (peek wall, wallbang, pad). Pick one to load it. Built-in presets leave your colours alone; the ones you save keep them. A preset tied to a weapon equips that weapon when you load it. No preset changes your ammo, sound or HUD options. Saved presets stay in this browser.</p>
    <p className="sl-preset-status" role="status">{[selected?.note, modified ? 'Changed since you loaded it.' : '', message].filter(Boolean).join(' ')}</p>
    <SettingRow label="Preset name" htmlFor={nameId}><input id={nameId} className="sl-text" aria-label="Preset name" type="text" maxLength={MAX_POP_PRESET_NAME}
      value={name} placeholder="Name your setup" autoComplete="off" spellCheck={false} onChange={event => setName(event.target.value)}
      onKeyDown={event => {if (event.key === 'Enter') save();}}/></SettingRow>
    <Toggle label={`Tie to my current weapon (${weaponNames[loadoutWeapon(settings)]})`} checked={tie} onChange={setTie}/>
    <div className="sl-preset-actions"><Button onClick={save} disabled={!name.trim()}>Save preset</Button>
      {saved && <><Button onClick={updateSaved}>Update preset</Button><Button onClick={remove}>Delete preset</Button></>}</div>
    {!persisted && <p className="sl-preset-status">Browser storage is unavailable, so saved presets last until you close this tab.</p>}
  </>;
}
