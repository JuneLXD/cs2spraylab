// Measure actual trainer ordering without prescribing native command association.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2);
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);};
const repo = arg('--repo'), output = arg('--output');
const zeroTimeDiagnostic = !args.includes('--without-zero-time');
assert(!fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(repo, 'package.json')), {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `
export {idleInput, UNIT} from './src/range/actor-physics';
export {defaults} from './src/range/config';
export {Simulation} from './src/range/simulation';
export {DuelSimulation} from './src/range/duel/simulation';
export {sanitizeDuelConfig} from './src/range/duel/config';
export {testArena} from './src/range/duel/geometry';`, resolveDir: repo},
  absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const mod = new Module(path.join(repo, '.awp-phase.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {idleInput, UNIT, defaults, Simulation, DuelSimulation, sanitizeDuelConfig, testArena} = mod.exports;
const step = 1 / 128, cases = [];
for (const zoom of [1, 2]) for (const walk of [false, true]) for (const empty of [false, true]) {
  for (const schedule of ['exact-deadline', 'next-half-tick']) for (const engine of ['range', 'duel']) {
    const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
    const range = engine === 'range' ? new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: false}) : undefined;
    const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp') : undefined;
    const sim = range ?? duel, actor = range ?? duel.actors[0], actions = range?.actions ?? actor.weapon.actions;
    if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
    sim.time = 1;
    Object.assign(actor, {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0,
      feet: 0, grounded: true, verticalVelocity: 0, movementTime: 1, friction: undefined});
    actions.zoom = zoom;
    const ammo = () => range?.loadedAmmo ?? actor.weapon.ammo;
    const beforeShotAmmo = ammo();
    if (range) {range.pressTrigger(); range.release('mouse');}
    else {duel.command(0, {fireHeld: true, firePressed: true}); duel.step(0); duel.command(0, {fireHeld: false, firePressed: false});}
    assert.equal(ammo(), beforeShotAmmo - 1); assert.equal(actions.zoom, 0); assert(actions.pendingZoom);
    const deadline = actions.nextEventAt;
    assert(deadline > sim.time && deadline < sim.time + 2);
    const arrival = schedule === 'exact-deadline' ? deadline : Math.ceil(deadline / step) * step;
    const command = {...idleInput(), side: 1, walk};
    if (range) range.input = command; else duel.command(0, command);
    let currentCalls;
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(actions), 'scopedSlowMovement')?.get;
    if (getter) Object.defineProperty(actions, 'scopedSlowMovement', {get() {
      const value = getter.call(this);
      currentCalls?.push({time: sim.time, zoom: this.zoom, speed: this.stats.speed, scopedSlow: value});
      return value;
    }});
    const snapshot = () => ({time: sim.time, zoom: actions.zoom, pendingZoom: actions.pendingZoom,
      nextEventAt: Number.isFinite(actions.nextEventAt) ? actions.nextEventAt : null, ammo: ammo(), speed: actions.stats.speed,
      position: {x: actor.position.x / UNIT, z: actor.position.z / UNIT},
      velocity: {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT},
      friction: JSON.parse(JSON.stringify(actor.friction ?? null))});
    const rows = [];
    const advance = (dt, stage) => {
      currentCalls = []; sim.step(dt);
      rows.push({stage, dt, movementCalls: currentCalls, ...snapshot()});
      currentCalls = undefined;
    };
    while (sim.time + step < deadline - 1e-10) advance(step, 'approach');
    if (empty) {if (range) range.reloadState.ammo = 0; else actor.weapon.ammo = 0;}
    rows.push({stage: 'before-arrival', dt: 0, movementCalls: [], ...snapshot()});
    assert(actions.pendingZoom && actions.zoom === 0);
    advance(arrival - sim.time, 'arrival');
    assert.equal(actions.zoom, empty ? 0 : zoom); assert.equal(actions.pendingZoom, false);
    if (zeroTimeDiagnostic) advance(0, 'zero-time');
    advance(step, 'next-half-tick');
    cases.push({zoom, walk, empty, schedule, engine, beforeShotAmmo, deadline, arrival,
      predicateInstrumentation: Boolean(getter), rows});
  }
}
const pairs = [];
for (const range of cases.filter(c => c.engine === 'range')) {
  const duel = cases.find(c => c.engine === 'duel' && c.zoom === range.zoom && c.walk === range.walk &&
    c.empty === range.empty && c.schedule === range.schedule);
  assert.equal(range.deadline, duel.deadline);
  const stages = ['before-arrival', 'arrival', ...(zeroTimeDiagnostic ? ['zero-time'] : []), 'next-half-tick'].map(stage => {
    const r = range.rows.find(row => row.stage === stage), d = duel.rows.find(row => row.stage === stage);
    assert.equal(r.time, d.time);
    return {stage, time: r.time,
      rangeZoomUsed: r.movementCalls.map(c => c.zoom), duelZoomUsed: d.movementCalls.map(c => c.zoom),
      rangeVelocity: r.velocity, duelVelocity: d.velocity,
      velocityDifference: Math.hypot(r.velocity.x - d.velocity.x, r.velocity.z - d.velocity.z),
      positionDifference: Math.hypot(r.position.x - d.position.x, r.position.z - d.position.z)};
  });
  pairs.push({zoom: range.zoom, walk: range.walk, empty: range.empty, schedule: range.schedule, stages});
}
const result = {schema: 'spraylab.awp-movement-phase-trainer.v1', zeroTimeDiagnostic,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  method: 'Actual Range/full Duel shot APIs and cumulative movement; getter wrapper records and returns the unchanged production predicate. Scope level and initial dry-ground state are supplied. Empty-magazine controls assign zero before eligibility.',
  limits: ['This measures trainer order; no native runtime commands or physical input are executed.',
    'The 128 Hz step and supplied arrival schedule do not establish native 64 Hz command association.',
    'A zero-time call is an explicit diagnostic, not a claim that the native engine performs the same call.',
    'Empty controls are a supplied-state gate check, not native ammo or refill lifecycle coverage.'],
  summary: {cases: cases.length, pairs: pairs.length, rows: cases.reduce((n, c) => n + c.rows.length, 0),
    maxArrivalVelocityDifference: Math.max(...pairs.map(p => p.stages.find(s => s.stage === 'arrival').velocityDifference)),
    maxArrivalPositionDifference: Math.max(...pairs.map(p => p.stages.find(s => s.stage === 'arrival').positionDifference)),
    maxNextStepVelocityDifference: Math.max(...pairs.map(p => p.stages.find(s => s.stage === 'next-half-tick').velocityDifference)),
    maxNextStepPositionDifference: Math.max(...pairs.map(p => p.stages.find(s => s.stage === 'next-half-tick').positionDifference))},
  pairs, cases};
assert.equal(cases.length, 32); assert.equal(pairs.length, 16);
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(result.summary));
