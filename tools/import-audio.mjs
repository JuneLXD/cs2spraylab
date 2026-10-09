import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {parseKv3} from './kv3.mjs';

function writeSoundMetadata(manifest) {
  const keys = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json','utf8')).weapons).concat('knife');
  const weapons = Object.fromEntries(keys.map(key => {
    const event = manifest.events[key];
    if (!event?.distanceCurve?.length) throw new Error(`Missing native audio distance curve: ${key}`);
    return [key,{source:event.source,volume:event.volume,distanceCurve:event.distanceCurve}];
  }));
  const cues = Object.fromEntries(Object.entries(manifest.events).filter(([key]) => !keys.includes(key)).map(([key, event]) =>
    [key, {source: event.source, volume: event.volume, distanceCurve: event.distanceCurve ?? []}]));
  const timelines = Object.fromEntries(Object.entries(manifest.timelines ?? {}).map(([id, actions]) => [id,
    Object.fromEntries(Object.entries(actions).map(([action, timeline]) => [action, {duration: timeline.duration,
      cues: timeline.cues.map(({time, key, audience}) => ({time, key, audience}))}]))]));
  fs.writeFileSync('src/range/sound-events-data.json',JSON.stringify({build:manifest.build,weapons,cues,timelines},null,2)+'\n');
}
export function extractSoundTimeline(raw, duration, fps = 30) {
  const clip = parseKv3(raw);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) return null;
  const cues = (clip.m_eventTracks ?? []).flatMap(track => (track.m_events ?? []))
    .filter(event => event._class === 'CNmClipDocEvent_Sound' && event.m_name && Number.isFinite(event.m_flStartTime))
    .map(event => ({time: event.m_flStartTime / fps, key: `native:${event.m_name}`,
      audience: event.m_relevance === 'Client' || event.m_relevance === 'ClientOnly' ? 'local' : 'all',
      nativeRelevance: event.m_relevance, nativeFrame: event.m_flStartTime}))
    .filter(cue => cue.time >= 0 && cue.time <= duration + 1 / fps).sort((a, b) => a.time - b.time);
  const windows = Object.fromEntries((clip.m_eventTracks ?? []).flatMap(track => track.m_events ?? [])
    .filter(event => event._class === 'CNmClipDocEvent_ID' && /^WPN_RELOAD_(INTRO|LOOP|OUTRO)$/.test(event.m_ID))
    .map(event => [event.m_ID.slice(11).toLowerCase(), {start: event.m_flStartTime / fps, duration: event.m_flDuration / fps}]));
  // Newer clips record their DMX source with Windows separators.
  return {duration, fps, windows, source: clip.m_sourceFilename.replace(/\\/g, '/').replace(/\.dmx$/, '.vnmclip_c'),
    sha256: crypto.createHash('sha256').update(raw).digest('hex'), cues};
}

async function main() {
if (process.argv.includes('--metadata-only')) {
  writeSoundMetadata(JSON.parse(fs.readFileSync('public/revamp/audio/events.json','utf8')));
  return;
}

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = process.env.SOURCE2VIEWER || path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const run = (...args) => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args], {stdio: 'pipe', windowsHide: true, maxBuffer: 20e6});
const actionsOnly = process.argv.includes('--actions-only');
fs.mkdirSync('research/audio-events', {recursive: true});
fs.mkdirSync('research/audio-events/samples', {recursive: true});
fs.mkdirSync('public/revamp/audio/native', {recursive: true});
const sources = {};
for (const name of ['footsteps', 'player', 'weapons']) {
  const file = `research/audio-events/${name}.vsndevts`;
  if (!actionsOnly || !fs.existsSync(file)) run('-f', `soundevents/game_sounds_${name}.vsndevts_c`, '-d', '-o', file);
  Object.assign(sources, parseKv3(fs.readFileSync(file, 'utf8')));
}
const old = actionsOnly ? JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8')) : {};
const events = old.events ?? {};
const canonicalName = name => Object.keys(sources).find(key => key.toLowerCase() === name.toLowerCase());
/** Playback parameters CS2 keeps on the event: level, mix group, pitch with its random range, distance curve. */
const eventMetadata = (canonical, source) => ({source: canonical, volume: source.volume ?? 1, pitch: source.pitch ?? 1,
  mixgroup: source.mixgroup ?? 'All',
  ...(source.pitch_random_min || source.pitch_random_max ? {pitchRandom: [source.pitch_random_min ?? 0, source.pitch_random_max ?? 0]} : {}),
  distanceCurve: source.distance_volume_mapping_curve?.map(row => row.slice(0, 2))});
/** The converter writes <dir>/<vpk path>.wav next to the vsnd's own KV3, so decode into a folder and pick the audio. */
const decodeSample = (file, output) => {
  const staging = `research/audio-events/samples/${path.basename(output, '.wav')}`;
  fs.rmSync(staging, {recursive: true, force: true}); fs.mkdirSync(staging, {recursive: true});
  run('-f', `${file}_c`, '-d', '-o', staging);
  const decoded = fs.readdirSync(staging, {recursive: true}).map(String).find(name => /\.(wav|mp3)$/i.test(name));
  if (!decoded) throw new Error(`Nothing decoded for ${file}`);
  const bytes = fs.readFileSync(`${staging}/${decoded}`);
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') fs.copyFileSync(`${staging}/${decoded}`, output);
  else execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${staging}/${decoded}`,
    '-c:a', 'pcm_s16le', output], {stdio: 'pipe', windowsHide: true});
};
const add = (key, name, limit = 4) => {
  const canonical = canonicalName(name);
  const source = sources[canonical];
  if (!source) throw new Error(`Missing sound event ${name}`);
  const cached = events[key];
  // Cached samples keep their files; the playback parameters are always refreshed from the game's definitions.
  if (actionsOnly && cached?.samples.length && cached.samples.every(sample => fs.existsSync(`public/revamp${sample}`))) {
    events[key] = {...eventMetadata(canonical, source), samples: cached.samples}; return;
  }
  const tracks = source.vsnd_files_track_01;
  const files = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean).slice(0, limit);
  if (!files.length) throw new Error(`No samples for ${name}`);
  events[key] = {...eventMetadata(canonical, source), samples: files.map((file, i) => {
    const output = `native/${key}-${i}.wav`;
    decodeSample(file, `public/revamp/audio/${output}`);
    return `/audio/${output}`;
  })};
};
for (const [key, name] of Object.entries({concrete: 'Concrete', wood: 'Wood', metal: 'SolidMetal'})) {
  add(`step-${key}`, `CT_${name}.StepLeft`);
  add(`land-${key}`, `Land_${name}.StepLeft`, 2);
}
for (const [key, name] of Object.entries({
  'hit-body': 'Player.DamageBody.AttackerFeedback', 'hit-head': 'Player.DamageHeadShot.AttackerFeedback',
  'hit-armor': 'Player.DamageBodyArmor.AttackerFeedback', 'hit-helmet': 'Player.DamageHeadShotArmor.AttackerFeedback',
  'hurt-body': 'Player.DamageBody.Victim', 'hurt-armor': 'Player.DamageBodyArmor.Victim',
  'hurt-head': 'Player.DamageHeadShot.Victim', 'hurt-helmet': 'Player.DamageHeadShotArmor.Victim', death: 'Player.Death',
})) add(key, name, 3);
const weapons = {ak47: 'AK47', m4a4: 'M4A4', m4a1s: 'M4A1', galil: 'GalilAR', famas: 'FAMAS',
  sg553: 'sg556', aug: 'AUG', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5', mac10: 'MAC10', ump45: 'UMP45',
  p90: 'P90', bizon: 'bizon', m249: 'M249', negev: 'Negev', cz75a: 'CZ75A', usp: 'USP',
  glock: 'Glock', hkp2000: 'hkp2000', p250: 'P250', deagle: 'DEagle', elite: 'ELITE', fiveseven: 'FiveSeven',
  tec9: 'tec9', revolver: 'Revolver', awp: 'AWP', ssg08: 'SSG08', g3sg1: 'G3SG1', scar20: 'SCAR20',
  nova: 'Nova', xm1014: 'XM1014', mag7: 'Mag7', sawedoff: 'Sawedoff', zeus: 'Taser'};
for (const [id, name] of Object.entries(weapons)) {
  const fireEvent = `Weapon_${name}.${id === 'm4a1s' ? 'Silenced' : id === 'usp' ? 'SilencedShot' : 'Single'}`;
  add(id, fireEvent);
  // CS2 layers a separate distant event on every shot (its soundevent_01 children): own samples, level and curve.
  const distant = [].concat(sources[canonicalName(fireEvent)].soundevent_01 ?? []).find(child => /distant$/i.test(child));
  if (distant) add(`${id}-distant`, distant, 2);
  // Clip event names differ from the firing-event names for these native models.
  const actionName = id === 'm4a4' ? 'M4A1' : id === 'cz75a' ? 'CZ' : name;
  for (const [kind, suffix] of [['reload', ['m249', 'negev'].includes(id) ? 'Coverup' : 'Clipout'], ['draw', 'Draw']]) {
    const key = Object.keys(sources).find(key => key.toLowerCase() === `Weapon_${actionName}.${suffix}`.toLowerCase());
    if (key) add(`${id}-${kind}`, key, 1);
  }
  if (['nova', 'xm1014', 'sawedoff'].includes(id)) add(`${id}-reload-shell`, `Weapon_${name}.Insertshell`, 2);
}
add('knife', 'Weapon_Knife.Slash', 2);
for (const [kind, suffix] of Object.entries({stab: 'Stab', hit: 'Hit', wall: 'HitWall', draw: 'Deploy'}))
  add(`knife-${kind}`, `Weapon_Knife.${suffix}`, 2);
for (const id of ['aug', 'sg553', 'awp', 'ssg08', 'scar20', 'g3sg1']) {
  const name = weapons[id];
  for (const [kind, suffix] of [['in', ['aug', 'sg553'].includes(id) ? 'ZoomIn' : 'Zoom'], ['out', 'ZoomOut']]) {
    const source = Object.keys(sources).find(key => key.toLowerCase() === `Weapon_${name}.${suffix}`.toLowerCase());
    if (source) add(`${id}-scope-${kind}`, source, 2);
  }
}
const impactFile = 'research/audio-events/physics.vsndevts';
if (!fs.existsSync(impactFile)) run('-f', 'soundevents/game_sounds_physics.vsndevts_c', '-d', '-o', impactFile);
Object.assign(sources, parseKv3(fs.readFileSync(impactFile, 'utf8')));
for (const [surface, native] of Object.entries({concrete: 'Concrete', metal: 'SolidMetal', wood: 'Wood', glass: 'Glass'}))
  add(`impact-${surface}`, `${native}.BulletImpact`, 3);
const inventory = JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json', 'utf8'));
const timelines = {};
const reloadWindows = {};
const missing = [];
for (const [id, weapon] of Object.entries(inventory.weapons)) {
  if (id.endsWith('-legacy')) continue;
  const actions = {};
  for (const [action, clip] of Object.entries(weapon.clips)) {
    if (!['reload', 'reload-empty', 'draw', 'inspect', 'fire', 'fire-alt', 'charge'].includes(action) || clip.seconds <= 0) continue;
    const file = `research/${path.posix.basename(clip.path).replace(/_c$/, '')}`;
    if (!fs.existsSync(file)) run('-f', clip.path, '-d', '-o', file);
    const raw = fs.readFileSync(file, 'utf8');
    const timeline = extractSoundTimeline(raw, clip.seconds);
    if (timeline.source !== clip.path) throw new Error(`Wrong native namespace for ${id}/${action}`);
    // Physical shot events already play gunfire/slash; retain only bolt/foley cues here.
    timeline.cues = timeline.cues.filter(cue => !/\.(?:Single|SingleDistant|Silenced|SilencedShot|Slash|Stab)$/i.test(cue.key));
    timeline.cues = timeline.cues.filter(cue => {
      const requested = cue.key.slice(7);
      const name = Object.keys(sources).find(key => key.toLowerCase() === requested.toLowerCase());
      if (!name) {missing.push({id, action, source: requested}); return false;}
      const key = `cue-${crypto.createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
      add(key, name, 2); cue.key = key; return true;
    });
    actions[action] = timeline;
    if (action === 'reload' && timeline.windows.loop) {
      reloadWindows[id] = timeline.windows;
      for (const [phase, name] of [['intro', 'reload-start'], ['loop', 'reload-loop'], ['outro', 'reload-end']]) {
        const window = timeline.windows[phase]; if (!window?.duration) continue;
        actions[name] = {...timeline, duration: window.duration, cues: timeline.cues
          .filter(cue => cue.time >= window.start && cue.time < window.start + window.duration + (phase === 'outro' ? 1e-6 : 0))
          .map(cue => ({...cue, time: cue.time - window.start}))};
      }
    }
  }
  timelines[id] = actions;
}
// Mix-group levels from the game's mixer (scripts/soundmixers.txt, Default_Mix), multiplied up each parent chain.
const mixerFile = 'research/audio-events/soundmixers.txt';
if (!fs.existsSync(mixerFile)) {
  const dir = 'research/audio-events/soundmixers'; fs.mkdirSync(dir, {recursive: true});
  run('-f', 'scripts/soundmixers.txt', '-o', dir);
  fs.copyFileSync(`${dir}/scripts/soundmixers.txt`, mixerFile);
}
const mixer = parseKv3(fs.readFileSync(mixerFile, 'utf8'));
const parents = Object.fromEntries((mixer.MixGroups ?? []).map(group => [group.name, group.parent]));
const levels = Object.fromEntries((mixer.SoundMixers?.Default_Mix ?? []).map(entry => [entry.mixgroup, entry.vol ?? 1]));
const mixgroups = Object.fromEntries(Object.keys(levels).map(name => {
  let gain = 1; for (let group = name; group; group = parents[group]) gain *= levels[group] ?? 1;
  return [name, +gain.toFixed(4)];
}));
for (const event of Object.values(events)) if (!(event.mixgroup in mixgroups)) missing.push({mixgroup: event.mixgroup, source: event.source});
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const definitionBuild = actionsOnly ? inventory.weapons.ak47?.build ?? old.build ?? build : build;
fs.writeFileSync('src/range/native-reload-presentation.json', JSON.stringify({definitionBuild, installedBuild: build, weapons: reloadWindows}, null, 2));
fs.writeFileSync('public/revamp/audio/events.json', JSON.stringify({build: definitionBuild, installedBuild: build, mixgroups, events, timelines,
  audit: {missing, cachedDefinitions: actionsOnly, timing: 'Native frame markers / 30 Hz; duration from audited DMX; runtime retimes to presentation duration.',
    provenance: 'Cached event/clip definitions may predate installedBuild; newly decoded samples come from installed static VPK. No parity claim.'}}, null, 2));
if (!actionsOnly) writeSoundMetadata({build: definitionBuild,events});
console.log(`Exported ${Object.keys(events).length} native sound events from CS2 ${build}.`);
console.log(`${Object.keys(timelines).length} action sets; ${missing.length} unresolved native sound references.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  main().catch(error => {console.error(error); process.exitCode = 1;});
