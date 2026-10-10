// Guarded native endpoints against actual trainer primitives and cumulative actors.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
const args = process.argv.slice(2);
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);};
const repo = arg('--repo'), input = arg('--native'), output = arg('--output');
assert(!fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input), native = JSON.parse(bytes);
assert.equal(hash(bytes), '2c7b684995f2f6f7e725fe13cb21296b78b49c2b1c7a20c91716a5e79adb586e');
assert.equal(native.sourceExecutionSha256, 'b8dbfe8e2b6997488e8f3b6da5ebf3fb01dbf68200f94ea9d03af07d6f8f46e9');
assert.equal(native.schema, 'cs2.native-friction-segment-oracle.v3');
assert.equal(native.fixtureDefinitionSha256, '4600d5b952bef24f8fa6b21d6553b04f01a297f536acaf304da910459bf63a71');
assert.equal(native.guardedNativeExecution, true); assert.equal(native.unexpectedAccesses, 0);
const require = createRequire(path.join(repo, 'package.json')), {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `export * from './src/range/ground-friction';
export {advanceActor, idleInput, UNIT} from './src/range/actor-physics';`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.friction-v2.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {selectGroundFriction, groundFrictionVelocity, finishGroundFrictionSegment,
  groundFrictionStep, groundStopGate, prepareGroundMotion, advanceActor, idleInput, UNIT} = mod.exports;
const stateFromNative = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
const errors = []; let primitiveRows = 0, maxVelocityError = 0, maxPositionError = 0, maxPrimitiveError = 0;
const check = (at, field, actual, expected, tolerance = 0) => {
  if (typeof expected === 'number') {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) errors.push({at, field, actual, expected, tolerance});
  } else if (actual !== expected) errors.push({at, field, actual, expected});
};
const checkState = (at, actual, expected) => {
  check(at, 'active', actual.active, expected.stashActive);
  check(at, 'savedFraction', actual.savedFraction, expected.savedFraction);
  check(at, 'storedSpeed', actual.storedSpeed, expected.storedSpeed);
  check(at, 'commandMarked', actual.commandMarked, expected.commandMarker);
  check(at, 'previousWishX', actual.previousWish.x, expected.previousWish.x);
  check(at, 'previousWishZ', actual.previousWish.z, expected.previousWish.y);
};
for (const sequence of native.sequences) for (const [i, row] of sequence.rows.entries()) {
  const at = `${sequence.fixtureId}/${sequence.mxcsrProfile}/${i}`;
  const state = stateFromNative(row.before), velocity = {x: row.before.speedX, z: row.before.speedY};
  const wish = {x: row.currentWish.x, z: row.currentWish.y};
  const frozen = JSON.stringify(state), selected = selectGroundFriction(state, velocity, wish, row.startFraction);
  assert.equal(JSON.stringify(state), frozen);
  checkState(at, selected.state, row.afterCache);
  check(at, 'controlSpeed', selected.controlSpeed, row.nativeControlSpeed);
  const after = groundFrictionVelocity(velocity, selected.controlSpeed, row.duration);
  check(at, 'frictionX', after.x, row.afterFriction.speedX);
  check(at, 'frictionZ', after.z, row.afterFriction.speedY);
  maxPrimitiveError = Math.max(maxPrimitiveError, Math.abs(after.x - row.afterFriction.speedX), Math.abs(after.z - row.afterFriction.speedY));
  const effect = groundFrictionStep(velocity, selected.controlSpeed, row.duration);
  check(at, 'frictionWorkX', effect.acceleration.x, row.afterFriction.accelerationWork.x);
  check(at, 'frictionWorkZ', effect.acceleration.z, row.afterFriction.accelerationWork.y);
  const prepared = prepareGroundMotion(effect.velocity, effect.acceleration, row.duration);
  check(at, 'stopGate', prepared.stopped, row.nativeStopGate.taken);
  check(at, 'movementX', prepared.movement.x, row.nativeStopGate.vectors.velocity[0]);
  check(at, 'movementZ', prepared.movement.z, row.nativeStopGate.vectors.velocity[1]);
  check(at, 'deferredX', prepared.deferred.x, row.nativeStopGate.vectors.carriedDelta[0]);
  check(at, 'deferredZ', prepared.deferred.z, row.nativeStopGate.vectors.carriedDelta[1]);
  check(at, 'postHelperX', Math.fround(prepared.movement.x + prepared.deferred.x), row.afterPostHelper.speedX);
  check(at, 'postHelperZ', Math.fround(prepared.movement.z + prepared.deferred.z), row.afterPostHelper.speedY);
  checkState(at, finishGroundFrictionSegment(selected.state, wish), row.afterWishCopy);
  primitiveRows++;
}
const actorCases = [];
for (const control of native.stopGateControls) {
  const vector = a => ({x: a[0], z: a[1], y: a[2]});
  check(control.id, 'directStopGate', groundStopGate(vector(control.before.velocity),
    vector(control.before.accelerationWork), control.duration), control.gate.taken);
}
for (const fixture of native.fixtures.filter(f => f.kind === 'release' && !args.includes('--primitives-only'))) {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  assert(sequence);
  for (const schedule of ['native-segments', 'supplied-events']) {
    const seed = fixture.initialState;
    let actor = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: seed.velocity[0] * UNIT, z: seed.velocity[1] * UNIT},
      yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true,
      movementTime: fixture.commands[0].startFraction / 64,
      friction: {command: 0, state: {active: seed.active, savedFraction: seed.savedFraction, storedSpeed: seed.storedSpeed,
        commandMarked: seed.commandMarked, previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}}};
    const rows = []; let expectedPosition = {x: 0, z: 0}, firstNative = null, firstTrainer = null;
    let nativeStop = null, trainerStop = null;
    const threshold = Math.fround(Math.fround(.34) * fixture.suppliedSpeed);
    const origin = actor.movementTime;
    for (const [i, row] of sequence.rows.entries()) {
      expectedPosition.x += row.derivedUncollidedDisplacement.x;
      expectedPosition.z += row.derivedUncollidedDisplacement.y;
      const command = fixture.commands[row.command - 1];
      const observed = schedule === 'native-segments' || row.endFraction === command.endFraction ||
        command.extraBoundaries.includes(row.endFraction) || command.events.some(e => e.fraction === row.endFraction);
      if (!observed) continue;
      const time = (row.command - 1 + row.endFraction) / 64, dt = time - actor.movementTime;
      assert(dt > 0);
      const frozen = JSON.stringify(actor);
      const next = advanceActor(actor, idleInput(), fixture.suppliedSpeed * UNIT, dt);
      assert.equal(JSON.stringify(actor), frozen, 'Actual actor prediction mutated its input');
      actor = next;
      const actual = {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT};
      const expected = {x: row.afterPostHelper.speedX, z: row.afterPostHelper.speedY};
      const velocityError = Math.hypot(actual.x - expected.x, actual.z - expected.z);
      const positionError = Math.hypot(actor.position.x / UNIT - expectedPosition.x, actor.position.z / UNIT - expectedPosition.z);
      maxVelocityError = Math.max(maxVelocityError, velocityError); maxPositionError = Math.max(maxPositionError, positionError);
      const at = `${fixture.id}/${schedule}/${i}`;
      check(at, 'velocityError', velocityError, 0, .0002);
      check(at, 'derivedUncollidedPositionError', positionError, 0, .00003);
      checkState(at, actor.friction.state, row.afterCommandHandoff ?? row.afterWishCopy);
      if (firstNative === null && Math.hypot(expected.x, expected.z) <= threshold) firstNative = time - origin;
      if (firstTrainer === null && Math.hypot(actual.x, actual.z) <= threshold) firstTrainer = time - origin;
      if (nativeStop === null && expected.x === 0 && expected.z === 0) nativeStop = time - origin;
      if (trainerStop === null && actual.x === 0 && actual.z === 0) trainerStop = time - origin;
      rows.push({time, elapsed: time - origin, actual, expected, velocityError, derivedUncollidedPositionError: positionError,
        friction: actor.friction});
    }
    check(`${fixture.id}/${schedule}`, 'firstEvaluatedThresholdBoundary', firstTrainer, firstNative);
    check(`${fixture.id}/${schedule}`, 'firstExactStopBoundary', trainerStop, nativeStop);
    actorCases.push({fixtureId: fixture.id, schedule, firstNative, firstTrainer, nativeStop, trainerStop, rows});
  }
}
const report = {schema: 'cs2.trainer-friction-v3-comparison', sourceExecutionSha256: native.sourceExecutionSha256,
  comparisonInputSha256: hash(bytes),
  probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  method: 'One-step actual primitive checks over every native row, plus cumulative actual advanceActor release replay with either all native intervals or only supplied event boundaries. The latter requires the actor to insert the saved cache fraction itself.',
  limits: ['Primitive checks seed each invocation from native inputs; the actor replays carry their own state throughout.',
    'Native work/pre/post arithmetic is float32; the actor accumulates positions in SI doubles. Bounds are velocity .0002 u/s and derived uncollided displacement .00003 units.',
    'No nonzero-wish acceleration, actual native collision, full command scheduler or physical latency claim.'],
  summary: {primitiveRows, actorCases: actorCases.length, actorRows: actorCases.reduce((s,c) => s + c.rows.length, 0),
    maxPrimitiveError, maxVelocityError, maxPositionError, mismatches: errors.length}, errors, actorCases};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report.summary)); if (errors.length) process.exitCode = 1;
