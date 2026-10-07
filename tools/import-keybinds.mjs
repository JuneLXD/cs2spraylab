// Extracts CS2's Settings > Keyboard / Mouse page from the installed game:
// the Panorama layout (section order, rows and bound commands), the English
// labels for those rows and the stock key bindings. Read-only; no game process.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const out = 'research/keybinds';
const layoutSource = 'panorama/layout/settings/settings_kbmouse.vxml_c';
const localizationSource = 'resource/csgo_english.txt';
const defaultsSource = 'game/csgo/cfg/user_keys_default.vcfg';
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

fs.mkdirSync(out, {recursive: true});
execFileSync(cli, ['-i', vpk, '-f', layoutSource, '-d', '-o', out], {stdio: 'pipe'});
execFileSync(cli, ['-i', vpk, '-f', localizationSource, '-o', out], {stdio: 'pipe'});
const layout = fs.readFileSync(`${out}/panorama/layout/settings/settings_kbmouse.xml`, 'utf8');
const decode = buffer => buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le').slice(1)
  : buffer.toString('utf8').replace(/^\uFEFF/, '');
const english = decode(fs.readFileSync(`${out}/${localizationSource}`));
const defaultsText = fs.readFileSync(`${game}/${defaultsSource}`, 'utf8');

// Localization tokens are one `"token" "text"` pair per line in KeyValues.
const tokens = new Map();
for (const match of english.matchAll(/^\s*"([^"]+)"\s+"((?:\\.|[^"\\])*)"/gm)) {
  if (!tokens.has(match[1].toLowerCase())) tokens.set(match[1].toLowerCase(), match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
}
// Unresolved tokens stay as `#token`; the checks below reject them on used rows.
const text = token => token?.startsWith('#') ? tokens.get(token.slice(1).toLowerCase()) ?? token : token ?? '';

// The decompiled layout is regular XML; a tag scanner keeps document order.
const attributes = source => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replace(/&apos;/g, "'").replace(/&amp;/g, '&')]));
const sections = [];
let section, pendingLabel, dropdown, tooltip;
for (const [, closing, tag, rawAttributes] of layout.matchAll(/<(\/?)([A-Za-z]+)([^>]*?)\/?>/g)) {
  const attr = attributes(rawAttributes);
  if (closing) {
    if (dropdown && /DropDown/.test(tag)) {section.rows.push(dropdown); dropdown = undefined;}
    if (tag === 'TooltipPanel') tooltip = undefined;
    continue;
  }
  if (tag === 'Panel' && /SettingsBackground/.test(attr.class ?? '') && attr.id) {
    section = {id: attr.id, title: '', rows: []}; sections.push(section); continue;
  }
  if (!section) continue;
  if (tag === 'TooltipPanel') {tooltip = text(attr.tooltip); continue;}
  if (tag === 'Label') {
    if (/SettingsSectionTitleLabel/.test(attr.class ?? '')) {if (!section.title) section.title = text(attr.text);}
    else if (dropdown) dropdown.values.push({label: text(attr.text), value: attr.value});
    else pendingLabel = text(attr.text);
    continue;
  }
  if (tag === 'CSGOSettingsKeyBinder') {
    section.rows.push({kind: 'bind', id: attr.id, label: text(attr.text), bind: attr.bind, ...(tooltip ? {tooltip} : {})});
    continue;
  }
  if (/DropDown/.test(tag)) {
    dropdown = {kind: 'enum', label: pendingLabel ?? '', ...(attr.convar ? {convar: attr.convar} : {bindkey: attr.bindkey}), values: [], ...(tooltip ? {tooltip} : {})};
    pendingLabel = undefined; continue;
  }
  if (tag === 'CSGOSettingsSlider') {
    section.rows.push({kind: 'slider', label: text(attr.text), convar: attr.convar, min: Number(attr.min), max: Number(attr.max), precision: Number(attr.displayprecision ?? 2)});
  }
}

// Stock bindings: `"key" "command"` pairs inside the "bindings" block.
const block = defaultsText.match(/"bindings"\s*\{([^}]*)\}/);
if (!block) throw new Error('No bindings block in user_keys_default.vcfg');
const defaults = Object.fromEntries([...block[1].matchAll(/"([^"]+)"\s+"([^"]*)"/g)].map(([, key, command]) => [key, command]));
const analog = Object.fromEntries([...(defaultsText.match(/"analogbindings"\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/"([^"]+)"\s+"([^"]*)"/g)].map(([, key, command]) => [key, command]));

const output = {
  build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1],
  source: {layout: layoutSource, layoutSha256: sha256(layout), localization: localizationSource, defaults: defaultsSource, defaultsSha256: sha256(defaultsText)},
  sections: sections.filter(entry => entry.rows.length).map(({id, title, rows}) => ({id, title, rows})),
  defaults, analog,
};
const rows = output.sections.flatMap(entry => entry.rows), binds = rows.filter(row => row.kind === 'bind');
if (binds.length < 40 || !binds.some(row => row.bind === '+forward')) throw new Error(`Unexpected keyboard layout: ${binds.length} binds`);
const unresolved = [...output.sections.map(entry => entry.title), ...rows.flatMap(row => [row.label, ...(row.values ?? []).map(value => value.label)])].filter(label => !label || label.startsWith('#'));
if (unresolved.length) throw new Error(`Unresolved labels: ${unresolved.join(', ')}`);
fs.mkdirSync('src/range/keybinds', {recursive: true});
fs.writeFileSync('src/range/keybinds/cs2-keyboard-page.json', JSON.stringify(output, null, 2) + '\n');
console.log(`Build ${output.build}: ${output.sections.length} sections, ${binds.length} key binders, ${Object.keys(defaults).length} default binds`);
