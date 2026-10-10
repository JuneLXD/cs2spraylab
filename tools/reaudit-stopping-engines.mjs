// Actual actor, Range and Duel trajectories under declared synthetic input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);
};
const repo = arg('--repo'), output = arg('--output');
assert(!fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(repo, 'package.json')), {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `
export {advanceActor, idleInput, UNIT, STEP} from './src/range/actor-physics';
export {gameData, defaults} from './src/range/config';
export {Simulation} from './src/range/simulation';
export {DuelSimulation} from './src/range/duel/simulation';
export {sanitizeDuelConfig} from './src/range/duel/config';
export {testArena} from './src/range/duel/geometry';
export {movementInaccuracy} from './src/range/ballistics';`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.stopping-engines.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo);
mod._compile(built.outputFiles[0].text, mod.filename);
const {advanceActor, idleInput, UNIT, STEP, gameData, defaults, Simulation,
  DuelSimulation, sanitizeDuelConfig, testArena, movementInaccuracy} = mod.exports;
const cases = [];
for (const weapon of ['ak47', 'm4a4', 'm4a1s', 'deagle', 'glock', 'usp', 'awp']) {
  const speed = gameData.weapons[weapon].speed;
  for (const releaseFraction of [0, .25, .5, .75]) for (const side of [0, -1]) {
    const at = 1 + releaseFraction / 64;
    const initial = () => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: speed * UNIT, z: 0},
      yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0, duckFlag: false,
      jumpHeld: false, grounded: true, movementTime: at,
      // Explicit inactive cache/previous running wish, for the candidate adapter.
      // The baseline ignores this extra data; it is not a recorded native state.
      friction: {command: 64, state: {active: false, savedFraction: 0, storedSpeed: 0,
        commandMarked: false, previousWish: {x: speed, z: 0}}}});
    for (const engine of ['actor', 'range', 'duel']) {
      let actor = initial(), sim;
      if (engine === 'range') {
        sim = new Simulation({...defaults, weapon, mode: 'spray', spread: false});
        sim.time = at; Object.assign(sim, actor); sim.input = {...idleInput(), side}; actor = sim;
      } else if (engine === 'duel') {
        const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
        sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, weapon);
        sim.start(); sim.time = at; Object.assign(sim.actors[0], actor); actor = sim.actors[0];
        sim.actors[1].position = {x: 50, y: 64 * UNIT, z: 50};
        sim.command(1, {}); sim.command(0, {side});
      }
      const rows = []; let time = at, first = null;
      for (let i = 0; i < 64; i++) {
        const end = (Math.floor((time + 1e-10) / STEP) + 1) * STEP, dt = end - time;
        assert(dt > 0 && dt <= STEP + 1e-10);
        if (engine === 'actor') actor = advanceActor(actor, {...idleInput(), side}, speed * UNIT, dt);
        else {sim.step(dt); assert.equal(sim.time, end);}
        time = end;
        const speedUnits = Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT;
        const movementPenalty = movementInaccuracy(gameData.weapons[weapon], speedUnits / speed);
        if (first === null && movementPenalty === 0) first = time - at;
        rows.push({time, elapsed: time - at, velocity: {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT},
          position: {x: actor.position.x / UNIT, z: actor.position.z / UNIT}, movementPenalty,
          friction: actor.friction ?? null});
      }
      cases.push({weapon, speed, releaseFraction, side, engine, initial: initial(), firstEvaluatedZeroMovementPenalty: first, rows});
    }
  }
}
const pairs = [], mismatches = [];
for (let i = 0; i < cases.length; i += 3) {
  const [a, r, d] = cases.slice(i, i + 3);
  const clean = c => c.rows.map(({friction, ...row}) => row);
  const rangeMatches = JSON.stringify(clean(a)) === JSON.stringify(clean(r));
  const duelMatches = JSON.stringify(clean(a)) === JSON.stringify(clean(d));
  const pair = {weapon: a.weapon, releaseFraction: a.releaseFraction, side: a.side, rangeMatches, duelMatches};
  pairs.push(pair); if (!rangeMatches || !duelMatches) mismatches.push(pair);
}
const report = {method: 'Actual shared actor, Range and Duel engines under supplied initial velocity, inactive cache and previous running wish. This establishes shared-engine consistency; the separate native combined replay establishes supplied native acceleration parity.',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  summary: {cases: cases.length, triplets: pairs.length, mismatchedTriplets: mismatches}, pairs, cases};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report.summary));
if (mismatches.length) process.exitCode = 1;
