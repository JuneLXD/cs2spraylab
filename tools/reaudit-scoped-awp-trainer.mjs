// Cumulative native scoped-AWP comparison through real Range and Duel callers.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2), baseline = args.includes('--baseline');
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);};
const repo = arg('--repo'), input = arg('--native'), output = arg('--output');
assert(!fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input);
const native = JSON.parse(bytes);
assert.equal(hash(bytes), '5e908e813f902d790c643eb33e90ac9066f34913fa3821827527f333a955a03a');
assert.equal(native.guardedNativeExecution, true);
assert.equal(native.memoryGuard?.unexpectedAccesses ?? native.unexpectedAccesses, 0);
const require = createRequire(path.join(repo, 'package.json')), {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `
export {advanceActor, idleInput, UNIT} from './src/range/actor-physics';
export {gameData, defaults} from './src/range/config';
export {Simulation} from './src/range/simulation';
export {DuelSimulation} from './src/range/duel/simulation';
export {sanitizeDuelConfig} from './src/range/duel/config';
export {testArena} from './src/range/duel/geometry';
export * from './src/range/ground-friction';`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.scoped-awp-native.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {advanceActor, idleInput, UNIT, gameData, defaults, Simulation, DuelSimulation,
  sanitizeDuelConfig, testArena} = mod.exports;
assert.equal(gameData.weapons.awp.zoomLevels, 2);
const cases = [], errors = [];
let primitiveRows = 0, primitiveMismatches = 0, mismatches = 0, stateMismatches = 0;
let maxVelocityError = 0, maxPositionError = 0;
let maxPredictionPositionError = 0, predictionMismatches = 0, predictionRows = 0;
const fail = value => {mismatches++; if (errors.length < 100) errors.push(value);};
const state = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
for (const sequence of native.sequences) {
  const fixture = native.fixtures.find(f => f.id === sequence.fixtureId);
  assert([1, 2].includes(fixture.zoomLevel)); assert.equal(fixture.zoomLevels, 2);
  assert(Math.fround(Math.fround(fixture.weaponSpeed) * Math.fround(.52)) < 110);
  for (const [i, row] of sequence.rows.entries()) {
    const friction = mod.exports.groundFrictionStep({x: row.before.speedX, z: row.before.speedY}, row.nativeControlSpeed, row.duration);
    const accelerated = mod.exports.accelerateGroundMotion(friction.velocity, friction.acceleration,
      {x: row.currentWish.x, z: row.currentWish.y}, fixture.suppliedSpeed, row.duration, friction.overshoot,
      {weaponSpeed: fixture.weaponSpeed, ducking: fixture.stance === 'crouch', walking: fixture.stance === 'walk', scopedSlow: true});
    const capped = mod.exports.capGroundMotion(accelerated.velocity, accelerated.acceleration, fixture.suppliedSpeed, row.duration);
    for (const [phase, actual, expected] of [['acceleration', accelerated, row.afterAccelerate], ['cap', capped, row.afterNativeCap]]) {
      for (const [axis, nativeAxis] of [['x', 'x'], ['z', 'y']]) {
        for (const [field, value, target] of [['velocity', actual.velocity[axis], expected[nativeAxis === 'x' ? 'speedX' : 'speedY']],
          ['work', actual.acceleration[axis], expected.accelerationWork[nativeAxis]]]) {
          if (value !== target) {primitiveMismatches++; fail({at: `${fixture.id}/${sequence.mxcsrProfile}/${i}`, phase, field, axis, value, target});}
        }
      }
    }
    primitiveRows++;
  }
}
for (const fixture of native.fixtures) {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  assert(sequence);
  for (const schedule of ['native-segments', 'supplied-events']) for (const engine of ['actor', 'range', 'duel']) {
    const seed = fixture.initialState, origin = fixture.commands[0].startFraction / 64;
    let actor = {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: seed.velocity[0] * UNIT, z: seed.velocity[1] * UNIT},
      yaw: 0, pitch: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true,
      movementTime: origin, velocityModifier: 1,
      duckAmount: fixture.stance === 'crouch' ? 1 : 0, duckFlag: fixture.stance === 'crouch', crouchHeld: fixture.stance === 'crouch',
      friction: {command: 0, state: {active: seed.active, savedFraction: seed.savedFraction, storedSpeed: seed.storedSpeed,
        commandMarked: seed.commandMarked, previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}}};
    let sim;
    if (engine === 'range') {
      sim = new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: false});
      sim.time = origin; sim.active = true; Object.assign(sim, actor); sim.actions.zoom = fixture.zoomLevel; actor = sim;
      assert.equal(sim.stats.speed, fixture.weaponSpeed);
    } else if (engine === 'duel') {
      const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
      sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp');
      sim.start(); sim.time = origin; Object.assign(sim.actors[0], actor); actor = sim.actors[0];
      actor.weapon.actions.zoom = fixture.zoomLevel;
      assert.equal(actor.weapon.actions.stats.speed, fixture.weaponSpeed);
      sim.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; sim.command(1, {});
    }
    let position = {x: 0, z: 0}, caseMaxVelocity = 0, caseMaxPosition = 0;
    const rows = [];
    for (const [i, row] of sequence.rows.entries()) {
      position.x += row.derivedUncollidedDisplacement.x; position.z += row.derivedUncollidedDisplacement.y;
      const command = fixture.commands[row.command - 1];
      if (schedule !== 'native-segments' && row.endFraction !== command.endFraction &&
        !command.extraBoundaries.includes(row.endFraction) && !command.events.some(e => e.fraction === row.endFraction)) continue;
      const time = (row.command - 1 + row.endFraction) / 64, dt = time - actor.movementTime;
      assert(dt > 0);
      const input = {...idleInput(), side: row.currentWish.x / fixture.suppliedSpeed,
        forward: -row.currentWish.y / fixture.suppliedSpeed, crouch: fixture.stance === 'crouch', walk: fixture.stance === 'walk'};
      let prediction;
      if (engine === 'actor') {
        const frozen = JSON.stringify(actor);
        // Native branch supplied explicitly only to the isolated arithmetic control.
        const next = advanceActor(actor, {...input, scopedSlow: true}, fixture.weaponSpeed * UNIT, dt);
        assert.equal(JSON.stringify(actor), frozen); actor = next;
      } else {
        if (engine === 'range') sim.input = input; else sim.command(0, input);
        sim.accumulator = dt;
        const frozen = JSON.stringify({time: sim.time, position: actor.position, velocity: actor.velocity,
          friction: actor.friction, input: engine === 'range' ? sim.input : actor.command});
        const predicted = engine === 'range' ? sim.renderPosition() : sim.renderSnapshot()[0].position;
        assert.equal(JSON.stringify({time: sim.time, position: actor.position, velocity: actor.velocity,
          friction: actor.friction, input: engine === 'range' ? sim.input : actor.command}), frozen);
        const predictionError = Math.hypot(predicted.x / UNIT - position.x, predicted.z / UNIT - position.z);
        prediction = {x: predicted.x / UNIT, z: predicted.z / UNIT, error: predictionError};
        maxPredictionPositionError = Math.max(maxPredictionPositionError, predictionError); predictionRows++;
        if (predictionError > .00004) {
          predictionMismatches++; fail({at: `${fixture.id}/${schedule}/${engine}/${i}`, field: 'predictedPosition', predictionError});
        }
        sim.accumulator = 0;
        sim.step(dt); assert.equal(sim.time, time);
      }
      const actual = {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT};
      const expected = {x: row.afterPostHelper.speedX, z: row.afterPostHelper.speedY};
      const velocityError = Math.hypot(actual.x - expected.x, actual.z - expected.z);
      const positionError = Math.hypot(actor.position.x / UNIT - position.x, actor.position.z / UNIT - position.z);
      const at = `${fixture.id}/${schedule}/${engine}/${i}`;
      caseMaxVelocity = Math.max(caseMaxVelocity, velocityError); caseMaxPosition = Math.max(caseMaxPosition, positionError);
      maxVelocityError = Math.max(maxVelocityError, velocityError); maxPositionError = Math.max(maxPositionError, positionError);
      if (velocityError > .00025 || positionError > .00004) fail({at, velocityError, positionError, actual, expected});
      if (JSON.stringify(actor.friction?.state) !== JSON.stringify(state(row.afterCommandHandoff ?? row.afterWishCopy))) {
        stateMismatches++; fail({at, field: 'frictionState', actual: actor.friction?.state,
          expected: state(row.afterCommandHandoff ?? row.afterWishCopy)});
      }
      rows.push({time, actual, expected, velocityError, derivedPositionError: positionError,
        expectedDerivedPosition: {...position}, prediction});
    }
    cases.push({fixtureId: fixture.id, kind: fixture.kind, zoomLevel: fixture.zoomLevel, stance: fixture.stance,
      schedule, engine, maxVelocityError: caseMaxVelocity, maxPositionError: caseMaxPosition, rows});
  }
}
const report = {schema: 'spraylab.scoped-awp-trainer.v1', baseline,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  nativeReportSha256: hash(bytes), probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  method: 'Cumulative actor arithmetic control and actual Range/full Duel callers. Current zoom is supplied to weapon actions; engine scopedSlow predicates are not overridden. Every trajectory independently carries velocity/history from its declared seed.',
  limits: ['Scope state, speed/cap and stance are supplied; native scope transitions and upstream cap construction are outside.',
    'Position is derived uncollided displacement, not native collision execution.',
    'Predeclared comparison bounds: .00025 u/s velocity, .00004 native units position; no fitted tolerance.'],
  summary: {cases: cases.length, rows: cases.reduce((n, c) => n + c.rows.length, 0), primitiveRows, primitiveMismatches,
    maxVelocityError, maxPositionError, maxPredictionPositionError, predictionRows, predictionMismatches, mismatches, stateMismatches}, errors, cases};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report.summary)); if (!baseline && mismatches) process.exitCode = 1;
