// Cumulative actual actor/Range/Duel replay; never reseed from native endpoints.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
const args = process.argv.slice(2);
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return args[i + 1];};
const repo = path.resolve(arg('--repo')), input = path.resolve(arg('--native')), output = path.resolve(arg('--output'));
assert(!fs.existsSync(output));
const hash = b => createHash('sha256').update(b).digest('hex'), bytes = fs.readFileSync(input);
assert.equal(hash(bytes), arg('--native-sha'));
const native = JSON.parse(bytes);
const halfSteps = args.includes('--trainer-half-steps');
assert.equal(native.schema, 'cs2.ground-start-stop-native.v1');
assert.equal(native.guardedNativeExecution, true); assert.equal(native.memoryGuard.unexpectedAccesses, 0);
const require = createRequire(path.join(repo, 'package.json'));
const built = require('esbuild').buildSync({stdin: {contents: `
export {advanceActor, idleInput, UNIT} from './src/range/actor-physics';
export {defaults} from './src/range/config';
export {Simulation} from './src/range/simulation';
export {DuelSimulation} from './src/range/duel/simulation';
export {sanitizeDuelConfig} from './src/range/duel/config';
export {testArena} from './src/range/duel/geometry';`, resolveDir: repo},
absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.start-stop.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {advanceActor, idleInput, UNIT, defaults, Simulation, DuelSimulation, sanitizeDuelConfig, testArena} = mod.exports;
const cases = [];
for (const fixture of native.fixtures) for (const engine of ['actor', 'range', 'duel']) {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id), origin = fixture.commands[0].startFraction / 64;
  const weapon = {'awp-unscoped': 'awp', 'm4a1-s': 'm4a1s', 'usp-s': 'usp'}[fixture.weaponLabel] ?? fixture.weaponLabel;
  const range = engine === 'range' ? new Simulation({...defaults, weapon, mode: 'spray'}) : undefined;
  const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
  const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, weapon) : undefined;
  if (range) range.active = true;
  if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
  const sim = range ?? duel;
  if (sim) sim.time = origin;
  let actor = range ?? duel?.actors[0] ?? {};
  const crouch = fixture.stance === 'crouch';
  Object.assign(actor, {position: {x: 0, y: (crouch ? 46 : 64) * UNIT, z: 0}, velocity: {x: 0, z: 0},
    yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: (crouch ? 46 : 64) * UNIT,
    jumpHeld: false, grounded: true, movementTime: origin, velocityModifier: 1,
    duckAmount: crouch ? 1 : 0, duckFlag: crouch, crouchHeld: crouch,
    friction: {command: 0, state: {active: false, savedFraction: 0, storedSpeed: 0, commandMarked: false, previousWish: {x: 0, z: 0}}}});
  let position = {x: 0, z: 0}, previousTime = origin;
  const rows = [];
  for (const row of sequence.rows) {
    position.x += row.derivedUncollidedDisplacement.x; position.z += row.derivedUncollidedDisplacement.y;
    const command = fixture.commands[row.command - 1];
    // Saved native cache fractions are internal; the actual actor must insert them.
    if (row.endFraction !== command.endFraction && !command.extraBoundaries.includes(row.endFraction)) continue;
    const time = (row.command - 1 + row.endFraction) / 64, dt = time - previousTime;
    const input = {...idleInput(), side: row.currentWish.x / fixture.suppliedSpeed,
      forward: -row.currentWish.y / fixture.suppliedSpeed, crouch, walk: fixture.stance === 'walk'};
    let remaining = dt;
    while (remaining > 1e-12) {
      const delta = halfSteps ? Math.min(1 / 128, remaining) : remaining;
      if (!sim) {
        const frozen = JSON.stringify(actor);
        const next = advanceActor(actor, input, fixture.weaponSpeed * UNIT, delta);
        assert.equal(JSON.stringify(actor), frozen); actor = next;
      } else {
        if (range) range.input = input; else duel.command(0, input);
        sim.step(delta);
      }
      remaining -= delta;
    }
    previousTime = time;
    const actual = {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT};
    const expected = {x: row.afterPostHelper.speedX, z: row.afterPostHelper.speedY};
    const actualPosition = {x: actor.position.x / UNIT, z: actor.position.z / UNIT};
    const stage = fixture.stages.findLast(s => s.command <= row.command);
    rows.push({time, stage: stage.stage, stageTime: time - (stage.command === 1 ? origin : (stage.command - 1) / 64),
      actual, expected, actualPosition, expectedPosition: {...position},
      velocityError: Math.hypot(actual.x - expected.x, actual.z - expected.z),
      positionError: Math.hypot(actualPosition.x - position.x, actualPosition.z - position.z)});
  }
  const metrics = field => {
    const first = (stage, predicate) => rows.find(r => r.stage === stage && predicate(r[field]))?.stageTime ?? null;
    const speed = v => Math.hypot(v.x, v.z), cap = fixture.suppliedSpeed;
    const threshold = Math.fround(Math.fround(.34) * fixture.weaponSpeed);
    return {firstSpeed: speed(rows[0][field]), firstSampleMs: rows[0].stageTime * 1000,
      start50: first('start', v => speed(v) >= cap * .5), start90: first('start', v => speed(v) >= cap * .9),
      start99: first('start', v => speed(v) >= cap * .99), startFull: first('start', v => speed(v) >= cap - .0001),
      releaseMovementZero: first('release', v => speed(v) <= threshold), releaseStopped: first('release', v => speed(v) === 0),
      counterMovementZero: first('counter', v => speed(v) <= threshold),
      counterReversed: first('counter', v => v.x < 0), counter99: first('counter', v => v.x < 0 && speed(v) >= cap * .99)};
  };
  cases.push({fixtureId: fixture.id, weapon: fixture.weaponLabel, stance: fixture.stance, origin, engine,
    suppliedCap: fixture.suppliedSpeed, native: metrics('expected'), trainer: metrics('actual'),
    maxVelocityError: Math.max(...rows.map(r => r.velocityError)), maxPositionError: Math.max(...rows.map(r => r.positionError)), rows});
}
const summary = {cases: cases.length, rows: cases.reduce((n,c) => n + c.rows.length, 0),
  maxVelocityError: Math.max(...cases.map(c => c.maxVelocityError)), maxPositionError: Math.max(...cases.map(c => c.maxPositionError)),
  mismatchingCases: cases.filter(c => c.maxVelocityError > .00025 || c.maxPositionError > .00004).length};
const result = {schema: 'spraylab.ground-start-stop-trainer.v1', probeSha256: hash(fs.readFileSync(import.meta.filename)),
  nativeSha256: hash(bytes), halfSteps, repo, sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo,p)))])), summary,
  limits: native.limits.concat(['Accuracy boundaries use the previously verified float32(.34)*weapon speed threshold, not full shot simulation.',
    'The first sample follows a supplied input boundary; no DOM, OS or physical key-to-screen latency is measured.']), cases};
fs.writeFileSync(output, JSON.stringify(result) + '\n', {flag: 'wx'});
console.log(JSON.stringify(summary));
if (args.includes('--expect-match')) assert.equal(summary.mismatchingCases, 0);
