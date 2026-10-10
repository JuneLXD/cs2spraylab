// Read-only current VPK identity + fresh decoded weapon data. No export/game execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseKv3} from './kv3.mjs';
const args = process.argv.slice(2);
const option = name => {assert(args.includes(name), 'Missing ' + name); return path.resolve(args[args.indexOf(name) + 1]);};
const vpk = option('--vpk'), decoded = option('--vdata'), exporter = option('--exporter'), out = option('--output');
const hash = b => createHash('sha256').update(b).digest('hex');
const directory = fs.readFileSync(vpk), raw = fs.readFileSync(decoded), doc = parseKv3(raw.toString());
assert.equal(directory.readUInt32LE(0), 0x55aa1234);
const version = directory.readUInt32LE(4); assert([1, 2].includes(version));
const header = version === 2 ? 28 : 12, treeSize = directory.readUInt32LE(8);
let cursor = header, entry;
function token() {
  const end = directory.indexOf(0, cursor); assert(end >= cursor && end < header + treeSize);
  const value = directory.toString('utf8', cursor, end); cursor = end + 1; return value;
}
for (let ext = token(); ext; ext = token()) for (let folder = token(); folder; folder = token()) for (let name = token(); name; name = token()) {
  assert(cursor + 18 <= header + treeSize);
  const crc = directory.readUInt32LE(cursor), preloadSize = directory.readUInt16LE(cursor + 4),
    archive = directory.readUInt16LE(cursor + 6), offset = directory.readUInt32LE(cursor + 8), length = directory.readUInt32LE(cursor + 12);
  assert.equal(directory.readUInt16LE(cursor + 16), 0xffff); cursor += 18;
  const resource = (folder === ' ' ? '' : folder + '/') + name + '.' + ext;
  if (resource === 'scripts/weapons.vdata_c') entry = {crc, archive, offset, length, preload: directory.subarray(cursor, cursor + preloadSize)};
  cursor += preloadSize; assert(cursor <= header + treeSize);
}
assert(entry, 'Current compiled weapons data missing');
assert(entry.length < 16 * 1024 * 1024);
const archive = entry.archive === 0x7fff ? vpk : vpk.replace(/_dir\.vpk$/, '_' + String(entry.archive).padStart(3, '0') + '.vpk');
const payload = Buffer.alloc(entry.length), fd = fs.openSync(archive, 'r');
try {assert.equal(fs.readSync(fd, payload, 0, payload.length, entry.offset + (entry.archive === 0x7fff ? header + treeSize : 0)), payload.length);}
finally {fs.closeSync(fd);}
const compiled = Buffer.concat([entry.preload, payload]);
let crc = 0xffffffff;
for (const byte of compiled) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
assert.equal((crc ^ 0xffffffff) >>> 0, entry.crc);
const overrides = [];
function walk(value, parts = []) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'm_bLinkedCooldowns' || key === 'm_nBurstShotCount') overrides.push({path: [...parts, key].join('.'), value: child});
    walk(child, [...parts, key]);
  }
}
walk(doc); assert.deepEqual(overrides, []);
const chain = [];
function visit(name) {
  assert(!chain.includes(name), 'Cyclic base data');
  const object = doc[name]; assert(object, 'Base not retained in decoded resource: ' + name); chain.push(name);
  if (object._base) for (const base of Array.isArray(object._base) ? object._base : [object._base]) visit(base);
}
visit('weapon_glock');
const glock = doc.weapon_glock;
assert.deepEqual(glock.m_flCycleTime, [.15, .3]);
assert.equal(glock.m_flCycleTimeWhenInBurstMode, .5); assert.equal(glock.m_flTimeBetweenBurstShots, .05);
assert.equal(glock.m_bHasBurstMode, true); assert.equal(glock.m_bIsRevolver, false);
const report = {method: 'Fresh decoded Source2Viewer weapons resource paired with the current compiled entry identity, plus parsed inheritance and override checks.',
  scriptSha256: hash(fs.readFileSync(new URL(import.meta.url))), parserSha256: hash(fs.readFileSync(new URL('./kv3.mjs', import.meta.url))),
  packageDirectorySha256: hash(directory), compiled: {resource: 'scripts/weapons.vdata_c', crc32: entry.crc.toString(16).padStart(8, '0'), bytes: compiled.length, sha256: hash(compiled)},
  decoded: {resource: 'scripts/weapons.vdata', bytes: raw.length, sha256: hash(raw)}, exporterSha256: hash(fs.readFileSync(exporter)),
  export: {exit: 0, command: 'Source2Viewer-CLI -i <csgo>/pak01_dir.vpk -f scripts/weapons.vdata_c -d -o <local-output>',
    provenance: 'This audit ran the selected export before this identity/parser check. This checker does not rerun the exporter.'},
  inheritanceChain: chain, relevantOverridesInEntireDecodedResource: overrides,
  glock: {cycle: glock.m_flCycleTime, burstCycle: glock.m_flCycleTimeWhenInBurstMode,
    burstInterval: glock.m_flTimeBetweenBurstShots, hasBurst: glock.m_bHasBurstMode, isRevolver: glock.m_bIsRevolver},
  boundary: 'Absence of an override alone does not establish the value. Pair with reaudit-glock-native.json constructor/schema proof for LinkedCooldowns=false and BurstShotCount=2.'};
fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({output: out, inheritance: chain, overrides: overrides.length, compiled: report.compiled}));
