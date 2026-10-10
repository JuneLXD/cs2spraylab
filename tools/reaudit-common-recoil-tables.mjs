// Compare the actual trainer table/RNG implementation with a separately
// executed current-native oracle. This does not derive per-command seeds.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';

const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing ${name}`);
  return path.resolve(args[i + 1]);
};
const repo = arg('--repo'), nativePath = arg('--native'), output = arg('--output');
assert(!fs.existsSync(output), 'Refusing to overwrite an existing report');
const hash = data => createHash('sha256').update(data).digest('hex');
const nativeBytes = fs.readFileSync(nativePath), native = JSON.parse(nativeBytes);
assert.equal(native.wholeArtifactHashesVerified, true);
assert.equal(native.serverSha256, 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a');
assert.equal(native.tier0Sha256, 'a3d4f81bb46eeca0d1d0a60a0c3bb3661a6398888359d0121ac795c6bd40d5af');
const require = createRequire(path.join(repo, 'package.json'));
const {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `export {gameData} from './src/range/config';
export {recoilTable,UniformRandomStream} from './src/range/recoil';`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false,
  metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.common-recoil-table-probe.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo);
mod._compile(built.outputFiles[0].text, mod.filename);
const {gameData, recoilTable, UniformRandomStream} = mod.exports;
const weapons = ['ak47', 'm4a4', 'm4a1s', 'awp', 'glock', 'usp', 'deagle'];
const buf = new ArrayBuffer(4), view = new DataView(buf);
const bits = value => {view.setFloat32(0, value); return view.getUint32(0);};
const ordered = value => {const n = bits(value); return n & 0x80000000 ? (~n + 1) >>> 0 : (n | 0x80000000) >>> 0;};
const difference = (actual, expected) => {
  assert(Number.isFinite(actual) && Number.isFinite(expected));
  assert.equal(actual, Math.fround(actual)); assert.equal(expected, Math.fround(expected));
  return {actual, expected, absolute: Math.abs(actual - expected),
    ulps: Math.abs(ordered(actual) - ordered(expected)), bitsEqual: bits(actual) === bits(expected)};
};
const rows = [], rawModeRows = [], parameterChecks = [];
const nativeTable = (weapon, mode) => (mode === 0 ? native.tables : native.alternateTables)[weapon];
const nativeParameters = (weapon, mode) => {
  const input = native.inputs.weapons[weapon];
  return {fullAuto: input.fullAuto, recoilSeed: input.seed, recoilAngle: input.angle[mode],
    recoilVariance: input.variance[mode], recoilMagnitude: input.magnitude[mode],
    recoilMagnitudeVariance: input.magnitudeVariance[mode]};
};
for (const weapon of weapons) for (const nativeMode of [0, 1]) {
  const actual = recoilTable(nativeParameters(weapon, nativeMode));
  const expected = nativeTable(weapon, nativeMode);
  assert.equal(actual.length, 64); assert.equal(expected.length, 64);
  for (let index = 0; index < 64; index++) rawModeRows.push({weapon, nativeMode, index,
    angle: difference(actual[index].angle, expected[index].angle),
    magnitude: difference(actual[index].magnitude, expected[index].magnitude)});
}
for (const mode of ['primary', 'alternate']) for (const weapon of weapons) {
  const source = gameData.weapons[weapon];
  const parameters = mode === 'primary' ? source : {...source, ...source.alternate};
  // Import-game intentionally defaults both silenced weapons to native mode 1;
  // their current alternate data is also mode 1. Raw mode 0 is checked above.
  const nativeMode = mode === 'alternate' || ['m4a1s', 'usp'].includes(weapon) ? 1 : 0;
  const expectedParameters = nativeParameters(weapon, nativeMode);
  for (const [field, expected] of Object.entries(expectedParameters)) {
    const actual = parameters[field];
    parameterChecks.push({weapon, mode, nativeMode, field, actual, expected, equal: actual === expected});
  }
  const actual = recoilTable(parameters);
  const expected = nativeTable(weapon, nativeMode);
  assert.equal(actual.length, 64); assert.equal(expected.length, 64);
  for (let index = 0; index < 64; index++) rows.push({weapon, mode, nativeMode, index,
    angle: difference(actual[index].angle, expected[index].angle),
    magnitude: difference(actual[index].magnitude, expected[index].magnitude)});
}
const rng = [];
assert(native.rngValues && native.rngRange);
const {low, high} = native.rngRange;
assert(Number.isFinite(low) && Number.isFinite(high) && low < high);
for (const [seed, expected] of Object.entries(native.rngValues)) {
  assert(Array.isArray(expected) && expected.length > 0);
  const stream = new UniformRandomStream(Number(seed));
  rng.push({seed: Number(seed), samples: expected.map(value => difference(stream.float(low, high), value))});
}
assert(rng.length > 0);
const differences = rows.flatMap(r => [r.angle, r.magnitude]);
const rawDifferences = rawModeRows.flatMap(r => [r.angle, r.magnitude]);
const rngDifferences = rng.flatMap(r => r.samples);
const summary = samples => ({values: samples.length,
  bitMismatches: samples.filter(r => !r.bitsEqual).length,
  maxAbsoluteError: Math.max(0, ...samples.map(r => r.absolute)),
  maxUlps: Math.max(0, ...samples.map(r => r.ulps))});
const report = {
  method: 'Actual trainer functions compared with supplied current-native emulation outputs. No command seed generation or gameplay invocation is inferred.',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  probeSha256: hash(fs.readFileSync(import.meta.filename)), nativeReportSha256: hash(nativeBytes),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  weapons, rawModeEntries: rawModeRows.length, rawModeSummary: summary(rawDifferences),
  tableEntries: rows.length, tableSummary: summary(differences),
  parameterMismatches: parameterChecks.filter(r => !r.equal).length,
  rngRange: {low, high}, rngSummary: summary(rngDifferences), parameterChecks, rawModeRows, rows, rng,
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({rawModeEntries: report.rawModeEntries, rawModes: report.rawModeSummary,
  tableEntries: report.tableEntries, tables: report.tableSummary,
  parameterMismatches: report.parameterMismatches, rng: report.rngSummary}));
if (report.rawModeSummary.bitMismatches || report.tableSummary.bitMismatches ||
  report.rngSummary.bitMismatches || report.parameterMismatches) process.exitCode = 1;
