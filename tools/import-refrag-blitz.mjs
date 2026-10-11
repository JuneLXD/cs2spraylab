// Import the documented Creator Studio `.arenas <arena> [group]` console dump.
// Coordinates are Source units at the feet; retain the original dump as evidence.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const numbers = value => value.trim().split(/\s+/).map(Number);
export const sourcePoint = ([x, y, z]) => ({x: y * .0254, y: z * .0254, z: x * .0254});
export const sourceAngles = ([pitch, yaw]) => ({yaw: (yaw + 180) * Math.PI / 180, pitch: -pitch * Math.PI / 180});

export function parseRefragArenas(text) {
  const arenas = new Map();
  let arena, group, bot, spawn;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\d\d\/\d\d \d\d:\d\d:\d\d /, '').trim();
    let match;
    if ((match = /^Arena Index: (\d+)$/.exec(line))) {
      arena = {index: +match[1], name: '', groups: [], spawns: []};
      arenas.set(arena.index, arena); group = bot = spawn = undefined;
    } else if (arena && (match = /^Arena Name: (.+)$/.exec(line))) arena.name = match[1];
    else if (arena && (match = /^Bot Group Count: (\d+)$/.exec(line))) arena.groupCount = +match[1];
    else if (arena && (match = /^Spawnpoint Count: (\d+)$/.exec(line))) arena.spawnCount = +match[1];
    else if (arena && (match = /^(\d+) \[BOT GROUP\] (.+) \(Bot Count: (\d+)\)$/.exec(line))) {
      const index = +match[1];
      group = arena.groups[index] ??= {index, name: match[2], count: +match[3], bots: []}; bot = spawn = undefined;
    } else if (arena && (match = /^(\d+) \[SPAWN\]$/.exec(line))) {
      spawn = arena.spawns[+match[1]] = {index: +match[1]}; bot = undefined;
    } else if (group && (match = /^---> (\d+) \[BOT\]$/.exec(line))) {
      bot = group.bots[+match[1]] = {index: +match[1]}; spawn = undefined;
    } else if ((bot || spawn) && (match = /setpos_exact ([-.\d ]+); setang_exact ([-.\d ]+)$/.exec(line))) {
      Object.assign(bot ?? spawn, {position: numbers(match[1]), angles: numbers(match[2])});
    } else if (bot && (match = /Widest Swing Pos\s+setpos_exact ([-.\d ]+)$/.exec(line))) bot.widest = numbers(match[1]);
    else if (bot && (match = /Swing Direction\s+(.+) \[(\d+)\]$/.exec(line))) bot.direction = match[1];
    else if (bot && (match = /Displacement\s+([-.\d]+)$/.exec(line))) bot.displacement = +match[1];
    else if (bot && (match = /Peek Group\s+(\d+)$/.exec(line))) bot.peekGroup = +match[1];
    else if (bot && (match = /(Can Jump|Can Jiggle|Can Duck|Always Ducked|Always Wide Duck|Always Peek Before Util|Rush After Swing)\s+(Yes|No)$/.exec(line))) (bot.flags ??= {})[match[1]] = match[2] === 'Yes';
    else if (bot && (match = /(Min|Max) Swing Delay\s+([-.\d]+)$/.exec(line))) (bot.delays ??= {})[match[1]] = +match[2];
  }
  return [...arenas.values()].sort((a, b) => a.index - b.index);
}

export function compileRefragArenas(text) {
  const value = name => text.match(new RegExp(`${name}: (.+)`))?.[1]?.trim();
  const count = +value('Arena Count'), id = +value('Set ID'), version = +(value('Active live')?.match(/version (\d+)/)?.[1]);
  if (!Number.isInteger(count) || count < 1 || !id || !version || !/^\d{4}-\d{2}-\d{2}$/.test(value('Capture Date') ?? '')) throw new Error('Missing set identity/version/count');
  const source = parseRefragArenas(text);
  if (source.length !== count || source.some((arena, index) => arena.index !== index)) throw new Error('Incomplete arena roster');
  for (const arena of source) {
    if (arena.groupCount !== 1 || arena.spawnCount !== 1) throw new Error(`Arena ${arena.index}: additional groups/spawns need explicit support`);
    if (arena.spawns.length !== arena.spawnCount || arena.groups.length !== arena.groupCount) throw new Error(`Arena ${arena.index}: incomplete groups/spawns`);
    const valid = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    for (const spawn of arena.spawns) if (!spawn || !valid(spawn.position) || !valid(spawn.angles)) throw new Error(`Arena ${arena.index}: missing player pose`);
    for (const group of arena.groups) {
      if (!group || group.bots.length !== group.count || !group.count) throw new Error(`Arena ${arena.index}: incomplete bots`);
      for (const bot of group.bots) if (!bot || !valid(bot.position) || !valid(bot.angles) || !valid(bot.widest) || !['Left', 'Right', 'Forward'].includes(bot.direction) || bot.displacement !== 0 || bot.peekGroup !== 0 ||
        ['Can Jump','Can Jiggle','Can Duck'].some(key => typeof bot.flags?.[key] !== 'boolean') ||
        ['Always Ducked','Always Wide Duck','Always Peek Before Util','Rush After Swing'].some(key => bot.flags?.[key] !== false) ||
        bot.delays?.Min !== 0 || bot.delays?.Max !== 0)
        throw new Error(`Arena ${arena.index}: missing/unsupported bot settings`);
    }
  }
  return {map: 'de_ancient', source: {provider: 'Refrag', title: value('Set Title'), setId: id, version,
    captureDate: value('Capture Date'), command: '.arenas <index>; .arenas <index> 0', url: 'https://wiki.refrag.gg/en/creator-studio'},
  arenas: source.map(arena => {
    const player = {...sourcePoint(arena.spawns[0].position), ...sourceAngles(arena.spawns[0].angles)};
    return {id: `refrag-${id}-${arena.index}`, name: arena.name, side: 'ct', player,
      swingers: arena.groups[0].bots.map(bot => {
        const hold = sourcePoint(bot.position), angles = sourceAngles(bot.angles);
        const yaw = bot.angles[1] * Math.PI / 180, sign = bot.direction === 'Left' ? 1 : -1;
        // Source left is (-sin(yaw), cos(yaw)); convert horizontal axes to Three.
        const swing = bot.direction === 'Forward' ? {x: Math.sin(yaw), z: Math.cos(yaw)} : {x: sign * Math.cos(yaw), z: -sign * Math.sin(yaw)};
        return {index: bot.index, hold, ...angles, swing, widest: sourcePoint(bot.widest),
          permissions: {jump: bot.flags['Can Jump'], jiggle: bot.flags['Can Jiggle'], duck: bot.flags['Can Duck']},
          distance: Math.hypot(hold.x - player.x, hold.z - player.z),
          bearing: (Math.atan2(hold.z - player.z, hold.x - player.x) * 180 / Math.PI + 360) % 360};
      })};
  })};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output = 'src/range/duel/maps/de_ancient.blitz.json'] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node tools/import-refrag-blitz.mjs <console-dump.txt> [output.json]');
  const data = compileRefragArenas(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
  console.log(`Imported ${data.arenas.length} arenas / ${data.arenas.reduce((n, a) => n + a.swingers.length, 0)} bots from set ${data.source.setId} v${data.source.version}`);
}
