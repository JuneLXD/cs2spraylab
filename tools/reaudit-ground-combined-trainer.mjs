import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
const args = process.argv.slice(2), baseline = args.includes('--baseline'), stanceReplay = args.includes('--stance');
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);};
const repo = arg('--repo'), input = arg('--native'), output = arg('--output');
assert(!fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input);
assert.equal(hash(bytes), stanceReplay ? '41ee21338fa9d76670290875adec5ef0551367eea2e2627f1e884233f12e84dd' : '4f4146fa0215d0dc740806ad5dd6f223e75fdae73a69e531ed63c4bf491c2224');
const native = JSON.parse(bytes);
if (!stanceReplay) {
  assert.equal(native.fixtureDefinitionSha256, 'dfca8e8935df9b8a717b64eb67d55fcdb75369f5456750eb9c0571df69beae11');
  assert.equal(native.sourceExecutionSha256, 'b1e454f893f7c85e6ea1e2f43afd71d9b6895749348f26ae17ac350616cd4548');
}
else assert.equal(native.sourceExecutionSha256, '07a134fd393ed319968f2c51b644c3152ea46cae8d4d3cba868a3ab0439e0ce1');
assert.equal(native.guardedNativeExecution, true);
assert.equal(native.memoryGuard?.unexpectedAccesses ?? native.unexpectedAccesses, 0);
const require = createRequire(path.join(repo, 'package.json')), {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `export {advanceActor, idleInput, UNIT} from './src/range/actor-physics';
${baseline ? '' : "export * from './src/range/ground-friction';"}`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.ground-combined.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {advanceActor, idleInput, UNIT} = mod.exports;
let maxVelocityError = 0, maxPositionError = 0, mismatches = 0, stateMismatches = 0, thresholdMismatches = 0;
let primitiveRows = 0, primitiveMismatches = 0;
const cases = [], errors = [];
const fail = error => {mismatches++; if (errors.length < 300) errors.push(error);};
const expectedState = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
if (!baseline) for (const sequence of native.sequences) {
  const fixture = native.fixtures.find(f => f.id === sequence.fixtureId);
  for (const [i, row] of sequence.rows.entries()) {
    const effect = mod.exports.groundFrictionStep({x: row.before.speedX, z: row.before.speedY}, row.nativeControlSpeed, row.duration);
    const accelerated = mod.exports.accelerateGroundMotion(effect.velocity, effect.acceleration,
      {x: row.currentWish.x, z: row.currentWish.y}, fixture.suppliedSpeed, row.duration, effect.overshoot,
      {weaponSpeed: fixture.weaponSpeed ?? fixture.suppliedSpeed, ducking: fixture.stance === 'crouch', walking: fixture.stance === 'walk'});
    const capped = mod.exports.capGroundMotion(accelerated.velocity, accelerated.acceleration, fixture.suppliedSpeed, row.duration);
    for (const [phase, actual, expected] of [['acceleration', accelerated, row.afterAccelerate], ['cap', capped, row.afterNativeCap]]) {
      for (const [axis, nativeAxis] of [['x', 'x'], ['z', 'y']]) {
        for (const [field, value, target] of [['velocity', actual.velocity[axis], expected[nativeAxis === 'x' ? 'speedX' : 'speedY']],
          ['work', actual.acceleration[axis], expected.accelerationWork[nativeAxis]]]) {
          if (value !== target) {primitiveMismatches++; fail({at: `${fixture.id}/${sequence.mxcsrProfile}/${i}`, phase, field, axis, actual: value, expected: target});}
        }
      }
    }
    primitiveRows++;
  }
}
for (const fixture of native.fixtures) {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  assert(sequence);
  for (const schedule of ['native-segments', 'supplied-events']) {
    const seed = fixture.initialState, origin = fixture.commands[0].startFraction / 64;
    let actor = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: seed.velocity[0] * UNIT, z: seed.velocity[1] * UNIT},
      yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true,
      movementTime: origin, velocityModifier: fixture.tagLabel ?? 1,
      duckAmount: fixture.stance === 'crouch' ? 1 : 0, duckFlag: fixture.stance === 'crouch', crouchHeld: fixture.stance === 'crouch',
      friction: {command: 0, state: {active: seed.active, savedFraction: seed.savedFraction, storedSpeed: seed.storedSpeed,
        commandMarked: seed.commandMarked, previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}}};
    let position = {x: 0, z: 0}, firstNative = null, firstTrainer = null, caseMaxVelocity = 0, caseMaxPosition = 0;
    const threshold = Math.fround(Math.fround(.34) * (fixture.weaponSpeed ?? fixture.suppliedSpeed)), rows = [];
    for (const [i, row] of sequence.rows.entries()) {
      position.x += row.derivedUncollidedDisplacement.x; position.z += row.derivedUncollidedDisplacement.y;
      const command = fixture.commands[row.command - 1];
      if (schedule !== 'native-segments' && row.endFraction !== command.endFraction &&
          !command.extraBoundaries.includes(row.endFraction) && !command.events.some(e => e.fraction === row.endFraction)) continue;
      const time = (row.command - 1 + row.endFraction) / 64, dt = time - actor.movementTime;
      assert(dt > 0);
      const frozen = JSON.stringify(actor);
      const next = advanceActor(actor, {...idleInput(), side: row.currentWish.x / fixture.suppliedSpeed,
        forward: -row.currentWish.y / fixture.suppliedSpeed, crouch: fixture.stance === 'crouch',
        walk: fixture.stance === 'walk'}, (fixture.weaponSpeed ?? fixture.suppliedSpeed) * UNIT, dt);
      assert.equal(JSON.stringify(actor), frozen);
      actor = next;
      const actual = {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT};
      const expected = {x: row.afterPostHelper.speedX, z: row.afterPostHelper.speedY};
      const velocityError = Math.hypot(actual.x - expected.x, actual.z - expected.z);
      const positionError = Math.hypot(actor.position.x / UNIT - position.x, actor.position.z / UNIT - position.z);
      const at = `${fixture.id}/${schedule}/${i}`;
      maxVelocityError = Math.max(maxVelocityError, velocityError); maxPositionError = Math.max(maxPositionError, positionError);
      caseMaxVelocity = Math.max(caseMaxVelocity, velocityError); caseMaxPosition = Math.max(caseMaxPosition, positionError);
      if (velocityError > .00025 || positionError > .00004) fail({at, velocityError, positionError, actual, expected});
      const nativeZero = Math.hypot(expected.x, expected.z) <= threshold;
      const trainerZero = Math.hypot(actual.x, actual.z) <= threshold;
      if (nativeZero !== trainerZero) {thresholdMismatches++; fail({at, field: 'movementZero', nativeZero, trainerZero});}
      if (firstNative === null && nativeZero) firstNative = time - origin;
      if (firstTrainer === null && trainerZero) firstTrainer = time - origin;
      if (!baseline && JSON.stringify(actor.friction?.state) !== JSON.stringify(expectedState(row.afterCommandHandoff ?? row.afterWishCopy))) {
        stateMismatches++; fail({at, field: 'frictionState', actual: actor.friction?.state,
          expected: expectedState(row.afterCommandHandoff ?? row.afterWishCopy)});
      }
      rows.push({time, elapsed: time - origin, actual, expected, velocityError, derivedUncollidedPositionError: positionError,
        nativeZero, trainerZero});
    }
    cases.push({fixtureId: fixture.id, kind: fixture.kind, weapon: fixture.weaponLabel, schedule,
      stance: fixture.stance, suppliedCap: fixture.suppliedSpeed,
      firstNative, firstTrainer, maxVelocityError: caseMaxVelocity, maxPositionError: caseMaxPosition, rows});
  }
}
const report = {schema: 'cs2.trainer-ground-combined-comparison.v1', baseline, stanceReplay,
  nativeReportSha256: hash(bytes), probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  method: 'Cumulative actual advanceActor replay of every unique supplied native combined fixture, with all native segment boundaries or only externally supplied boundaries. Input/velocity/history are independently carried after the declared seed.',
  limits: ['Grounded supplied standing/walking/fully crouched states, unit owner/surface factors and unscoped/dry settings.',
    'Processed caps and stance/tag labels are supplied; upstream native modifier/input production is not executed.',
    'Derived position diagnostic excludes native collision and full command dispatcher.',
    'Threshold labels apply float32(.34)*supplied weapon-mode speed, independently of the stance/tag processed cap; first boundary is evaluated sample, not physical latency.',
    'Predeclared bounds: .00025 u/s velocity, .00004 native units derived displacement; no numerical fitting.'],
  summary: {cases: cases.length, rows: cases.reduce((n,c) => n+c.rows.length,0), maxVelocityError, maxPositionError,
    primitiveRows, primitiveMismatches, mismatches, stateMismatches, thresholdMismatches}, errors, cases};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report.summary)); if (!baseline && mismatches) process.exitCode = 1;
