// Actual fresh shot at rescope arrival; a trainer integration observation only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2);
const arg = name => {const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return path.resolve(args[i + 1]);};
const repo = arg('--repo'), output = arg('--output');
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
const mod = new Module(path.join(repo, '.awp-rescope-shot.cjs'));
mod.filename = mod.id; mod.paths = Module._nodeModulePaths(repo); mod._compile(built.outputFiles[0].text, mod.filename);
const {idleInput, UNIT, defaults, Simulation, DuelSimulation, sanitizeDuelConfig, testArena} = mod.exports;
const step = 1 / 128, cases = [];
for (const zoom of [1, 2]) for (const walk of [false, true]) {
  for (const schedule of ['exact-deadline', 'next-half-tick']) for (const engine of ['range', 'duel']) {
    const arena = {...testArena(), minX: -100, maxX: 100, minZ: -100, maxZ: 100, solids: []};
    const range = engine === 'range' ? new Simulation({...defaults, weapon: 'awp', mode: 'spray', spread: true}) : undefined;
    const duel = engine === 'duel' ? new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 42, arena, 'awp') : undefined;
    const sim = range ?? duel, actor = range ?? duel.actors[0], actions = range?.actions ?? actor.weapon.actions;
    if (duel) {duel.start(); duel.actors[1].position = {x: 50, y: 64 * UNIT, z: 50}; duel.command(1, {});}
    sim.time = 1;
    Object.assign(actor, {position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0,
      feet: 0, grounded: true, verticalVelocity: 0, movementTime: 1, friction: undefined});
    actions.zoom = zoom;
    const ammo = () => range?.loadedAmmo ?? actor.weapon.ammo;
    const shoot = () => {
      if (range) {range.pressTrigger(); range.release('mouse');}
      else {duel.command(0, {fireHeld: true, firePressed: true}); duel.step(0); duel.command(0, {fireHeld: false, firePressed: false});}
    };
    const initialAmmo = ammo(); shoot();
    assert.equal(ammo(), initialAmmo - 1); assert.equal(actions.zoom, 0); assert(actions.pendingZoom);
    const deadline = actions.nextEventAt;
    const arrival = schedule === 'exact-deadline' ? deadline : Math.ceil(deadline / step) * step;
    const command = {...idleInput(), side: 1, walk};
    if (range) range.input = command; else duel.command(0, command);
    while (sim.time + step < deadline - 1e-10) sim.step(step);
    sim.step(arrival - sim.time);
    assert.equal(actions.zoom, zoom); assert.equal(actions.pendingZoom, false);
    const snapshot = () => ({time: sim.time, zoom: actions.zoom, ammo: ammo(), speed: actions.stats.speed,
      velocity: {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT},
      position: {x: actor.position.x / UNIT, z: actor.position.z / UNIT}});
    const beforeShot = snapshot(), recovery = range?.recovery ?? actor.weapon.recovery;
    const original = recovery.inaccuracy.bind(recovery), observed = [];
    recovery.inaccuracy = (...values) => {
      const cone = original(...values);
      observed.push({args: values, movementRatio: values[0], penalty: recovery.penalty, cone,
        consumedVelocity: {x: actor.velocity.x / UNIT, z: actor.velocity.z / UNIT}});
      return cone;
    };
    shoot();
    assert.equal(observed.length, 1); assert.equal(ammo(), initialAmmo - 2); assert.equal(sim.time, arrival);
    cases.push({zoom, walk, schedule, engine, deadline, arrival, beforeShot, observed, afterShot: snapshot()});
  }
}
assert.equal(cases.length, 16);
const result = {schema: 'spraylab.awp-rescope-shot.v1',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  probeSha256: hash(fs.readFileSync(import.meta.filename)),
  sourceHashes: Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
    .map(p => [p, hash(fs.readFileSync(path.resolve(repo, p)))])),
  method: 'Actual fresh shot APIs after cumulative rescope arrival. Range pressTrigger is immediate; Duel processes firePressed with step(0). The wrapper records and returns the unchanged recovery.inaccuracy result.',
  limits: ['No native shot or input scheduling is executed.', 'Initial scope and dry-ground state are supplied.',
    'The real Duel API performs zero-time movement before firing; this behavior is retained, not equated with native command association.',
    'Cone includes base/current penalty; a zero movement contribution does not mean a perfectly accurate shot.'],
  cases};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({cases: cases.length, zeroMovementRatioShots: cases.filter(c => c.observed[0].movementRatio === 0).length,
  scopes: [...new Set(cases.map(c => c.zoom))]}));
