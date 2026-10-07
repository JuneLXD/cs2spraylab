import type {Viewmodel} from '../config';
import {commandsOf, parseKeyValues, quote, tokenize, type KeyValues} from './console';
import {isCrosshairCvar, videoHeight, type Cs2Crosshair} from './crosshair-cvars';
import {browserReservedKeys, canonicalKey, keyboardKeys, mouseKeys} from './keys';
import {cs2DefaultBinds, defaultKeyboard, expandCommand, keyboardPage, sanitizeKeyboard, trainerCommands, type KeyboardProfile} from './profile';

export type ImportFile = {name: string; text: string};
export type ImportedFileKind = 'keys' | 'convars' | 'video' | 'script' | 'ignored';
export type ImportReport = {
  files: {name: string; kind: ImportedFileKind}[];
  binds: number; unbinds: number; aliases: number;
  /** Mouse/keyboard convars that changed a setting. */
  settings: string[];
  /** `exec` targets that were not among the chosen files. */
  missingExec: string[];
  unknownKeys: string[];
  /** Trainer controls on keys a browser cannot deliver, with the reason. */
  reserved: {key: string; reason: string}[];
};
export type ImportResult = {profile: KeyboardProfile; mouse: {sensitivity?: number; invertY?: boolean}; viewmodel: Partial<Viewmodel>;
  /** Crosshair convars in the order CS2 set them; screenHeight comes from cs2_video.txt when chosen. */
  crosshair?: Omit<Cs2Crosshair, 'screenHeight'> & {screenHeight?: number}; report: ImportReport};

const known = new Set<string>([...keyboardKeys, ...mouseKeys]);
const bool = (value: string) => /^(1|true)$/i.test(value.trim());
const fileKey = (name: string) => name.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.cfg$/, '');
const block = (values: KeyValues, name: string) => {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === name)?.[1];
  return entry && typeof entry === 'object' ? entry : undefined;
};

/**
 * Rebuilds a bind table from CS2 files the way the game loads them: stock
 * defaults, then cs2_user_keys/convars .vcfg files, then cfg scripts with
 * autoexec.cfg last. `exec` follows other chosen files; aliases run at load.
 */
export function importCs2Config(files: readonly ImportFile[], base: KeyboardProfile, {fromDefaults = true} = {}): ImportResult {
  const binds = new Map(Object.entries(fromDefaults ? cs2DefaultBinds : base.binds));
  const aliases = new Map(Object.entries(fromDefaults ? {} : base.aliases));
  // Insertion order records which convar was set last: CS2's two crosshair schemes resolve by recency.
  const convars = new Map<string, string>();
  const setConvar = (name: string, value: string) => {convars.delete(name); convars.set(name, value);};
  let screenHeight: number | undefined;
  const report: ImportReport = {files: [], binds: 0, unbinds: 0, aliases: 0, settings: [], missingExec: [], unknownKeys: [], reserved: []};
  const mouse: ImportResult['mouse'] = {};
  const bind = (rawKey: string, command: string) => {
    if (/^mouse_[xy]$/i.test(rawKey)) {if (/^mouse_y$/i.test(rawKey)) mouse.invertY = command.trim().startsWith('!'); return;}
    const key = canonicalKey(rawKey);
    if (!key || !known.has(key)) {if (!report.unknownKeys.includes(rawKey)) report.unknownKeys.push(rawKey); if (!key) return;}
    if (command === '<unbound>' || !command.trim()) {binds.delete(key); report.unbinds++;}
    else {binds.set(key, command); report.binds++;}
  };

  const scripts: ImportFile[] = [];
  for (const file of files) {
    const text = file.text.replace(/^﻿/, '');
    if (/^\s*"config"\s*\{/i.test(text)) {
      const config = block(parseKeyValues(text), 'config') ?? {};
      const keys = block(config, 'bindings'), analog = block(config, 'analogbindings'), values = block(config, 'convars');
      for (const [key, command] of Object.entries(keys ?? {})) if (typeof command === 'string') bind(key, command);
      for (const [key, command] of Object.entries(analog ?? {})) if (typeof command === 'string') bind(key, command);
      for (const [name, value] of Object.entries(values ?? {})) if (typeof value === 'string') setConvar(name.toLowerCase(), value);
      report.files.push({name: file.name, kind: keys ? 'keys' : values ? 'convars' : 'ignored'});
    } else if (/^\s*"video\.cfg"\s*\{/i.test(text)) {
      screenHeight = videoHeight(text) ?? screenHeight;
      report.files.push({name: file.name, kind: screenHeight ? 'video' : 'ignored'});
    } else scripts.push({name: file.name, text});
  }

  // A chosen file that another chosen file execs runs at that point, not on its own.
  const byName = new Map(scripts.map(file => [fileKey(file.name), file]));
  const referenced = new Set(scripts.flatMap(file => commandsOf(file.text).filter(args => args[0].toLowerCase() === 'exec' && args[1]).map(args => fileKey(args[1]))));
  const running = new Set<ImportFile>();
  let budget = 20000;
  const execute = (args: string[], depth: number) => {
    if (--budget < 0 || depth > 24) return;
    const name = args[0].toLowerCase(), alias = aliases.get(name);
    if (alias !== undefined) {for (const command of commandsOf(alias)) execute(command, depth + 1); return;}
    if (name === 'bind' && args.length >= 3) bind(args[1], args.slice(2).join(' '));
    else if (name === 'unbind' && args[1]) bind(args[1], '');
    else if (name === 'unbindall') {binds.clear(); report.unbinds++;}
    else if (name === 'alias' && args.length >= 3) {aliases.set(args[1].toLowerCase(), args.slice(2).join(' ')); report.aliases++;}
    else if (name === 'exec' && args[1]) {
      const file = byName.get(fileKey(args[1]));
      if (file) run(file, depth + 1);
      else if (!report.missingExec.includes(args[1])) report.missingExec.push(args[1]);
    } else if (args.length >= 2 && !name.startsWith('+') && !name.startsWith('-')) setConvar(name, args[1]);
  };
  const run = (file: ImportFile, depth: number) => {
    if (running.has(file) || depth > 8) return;
    running.add(file);
    for (const args of commandsOf(file.text)) execute(args, depth);
    running.delete(file);
  };
  const autoexec = (file: ImportFile) => fileKey(file.name) === 'autoexec';
  for (const file of [...scripts].sort((a, b) => +autoexec(a) - +autoexec(b))) {
    report.files.push({name: file.name, kind: 'script'});
    if (autoexec(file) || !referenced.has(fileKey(file.name))) run(file, 0);
  }

  const profile: KeyboardProfile = {...(fromDefaults ? defaultKeyboard : base), binds: Object.fromEntries(binds), aliases: Object.fromEntries(aliases)};
  const setting = (name: string, apply: (value: string) => void) => {
    const value = convars.get(name);
    if (value === undefined) return;
    apply(value); report.settings.push(name);
  };
  setting('option_duck_method', value => profile.duckToggle = bool(value));
  setting('option_speed_method', value => profile.walkToggle = bool(value));
  setting('cl_debounce_zoom', value => profile.zoomRepeat = !bool(value));
  setting('zoom_sensitivity_ratio', value => {if (Number.isFinite(Number(value))) profile.zoomSensitivity = Number(value);});
  setting('sensitivity', value => {if (Number(value) > 0) mouse.sensitivity = Math.min(10, Math.max(.05, Number(value)));});
  setting('m_pitch', value => {if (Number(value)) mouse.invertY = Number(value) < 0;});
  if (mouse.invertY !== undefined && !report.settings.includes('m_pitch')) report.settings.push('reverse mouse');
  const viewmodel: Partial<Viewmodel> = {};
  for (const [name, key] of [['viewmodel_fov', 'fov'], ['viewmodel_offset_x', 'x'], ['viewmodel_offset_y', 'y'], ['viewmodel_offset_z', 'z']] as const)
    setting(name, value => {if (value.trim() && Number.isFinite(Number(value))) viewmodel[key] = Number(value);});
  const crosshairCvars = Object.fromEntries([...convars].filter(([name]) => isCrosshairCvar(name)));
  const crosshair = Object.keys(crosshairCvars).length ? {cvars: crosshairCvars, ...(screenHeight ? {screenHeight} : {})} : undefined;
  if (crosshair) report.settings.push(screenHeight ? `crosshair (${screenHeight}p)` : 'crosshair');

  for (const [key, command] of binds) {
    const reason = browserReservedKeys[key];
    if (reason && key !== 'ESCAPE' && expandCommand({aliases: Object.fromEntries(aliases)}, command).some(name => trainerCommands.has(name))) report.reserved.push({key, reason});
  }
  const label = files.map(file => file.name.replace(/\\/g, '/').split('/').pop()).join(', ') || 'Pasted config';
  return {profile: sanitizeKeyboard({...profile, source: {label, at: new Date().toISOString()}}), mouse, viewmodel, ...(crosshair ? {crosshair} : {}), report};
}

/** A cfg that recreates the profile on top of CS2's defaults: `exec spraylab`. */
export function exportCfg(profile: KeyboardProfile, mouse: {sensitivity: number; invertY: boolean; viewmodel?: Viewmodel; crosshair?: Cs2Crosshair}, date = new Date()) {
  const lines = [
    '// SprayLab keyboard & mouse profile',
    `// Exported ${date.toISOString().slice(0, 10)} against CS2 build ${keyboardPage.build} default binds.`,
    '// Copy into ...\\game\\csgo\\cfg\\ and run it in the console with: exec spraylab',
    '',
  ];
  for (const [name, body] of Object.entries(profile.aliases)) lines.push(`alias ${quote(name)} ${quote(body)}`);
  for (const key of Object.keys(cs2DefaultBinds)) if (!(key in profile.binds)) lines.push(`unbind ${quote(key)}`);
  for (const [key, command] of Object.entries(profile.binds)) if (cs2DefaultBinds[key] !== command) lines.push(`bind ${quote(key)} ${quote(command)}`);
  lines.push('',
    `sensitivity "${mouse.sensitivity}"`, `zoom_sensitivity_ratio "${profile.zoomSensitivity}"`,
    `option_duck_method "${+profile.duckToggle}"`, `option_speed_method "${+profile.walkToggle}"`,
    `cl_debounce_zoom "${+!profile.zoomRepeat}"`, `bind "mouse_y" "${mouse.invertY ? '!pitch' : 'pitch'}"`);
  if (mouse.viewmodel) lines.push(`viewmodel_fov "${mouse.viewmodel.fov}"`, `viewmodel_offset_x "${mouse.viewmodel.x}"`,
    `viewmodel_offset_y "${mouse.viewmodel.y}"`, `viewmodel_offset_z "${mouse.viewmodel.z}"`);
  if (mouse.crosshair) lines.push('', '// Crosshair', ...Object.entries(mouse.crosshair.cvars).map(([name, value]) => `${name} ${quote(value)}`));
  lines.push('');
  return lines.join('\r\n');
}

/** Reads a single bind line typed by the user, such as `bind "x" "drop"`. */
export function parseBindLine(text: string) {
  const args = tokenize(text.trim().replace(/;+\s*$/, ''));
  if (args[0]?.toLowerCase() === 'bind') args.shift();
  const key = canonicalKey(args[0]);
  return key && args.length >= 2 ? {key, command: args.slice(1).join(' ')} : undefined;
}
