// Actual Range/Duel entry points; run once against the frozen base and once against the patch.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire, Module} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--repo') || !args.includes('--output')) throw Error('Usage: --repo PATH --output NEW.json');
const repo = path.resolve(option('--repo')), output = path.resolve(option('--output'));
if (fs.existsSync(output)) throw Error('Refusing to overwrite evidence');
const require = createRequire(path.join(repo, 'package.json'));
const {buildSync} = require('esbuild');
const built = buildSync({stdin: {contents: `export {Simulation} from './src/range/simulation'; export {defaults} from './src/range/config'; export {DuelSimulation} from './src/range/duel/simulation'; export {sanitizeDuelConfig} from './src/range/duel/config'; export {testArena} from './src/range/duel/geometry';`, resolveDir: repo}, absWorkingDir: repo, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, logLevel: 'silent'});
const module = new Module(path.join(repo, '.glock-audit.cjs'));
module.filename = path.join(repo, '.glock-audit.cjs'); module.paths = Module._nodeModulePaths(repo);
module._compile(built.outputFiles[0].text, module.filename);
const {Simulation, defaults, DuelSimulation, sanitizeDuelConfig, testArena} = module.exports;
const fixtures = [
  {name: 'toggle-immediate-burst', events: [[1, 'secondary-down'], [1, 'secondary-up'], [1, 'fire-down'], [1, 'fire-up']]},
  {name: 'toggle-immediate-semi', burst: true, events: [[1, 'secondary-down'], [1, 'secondary-up'], [1, 'fire-down'], [1, 'fire-up']]},
  {name: 'toggle-early-held', events: [[1, 'secondary-down'], [1, 'secondary-up'], [1.03125, 'fire-down'], [2, 'fire-up']]},
  {name: 'burst-mid-secondary-tap', burst: true, events: [[1, 'fire-down'], [1.0078125, 'fire-up'], [1.03125, 'secondary-down'], [1.0390625, 'secondary-up']]},
  {name: 'burst-mid-secondary-held', burst: true, events: [[1, 'fire-down'], [1.0078125, 'fire-up'], [1.03125, 'secondary-down'], [1.6, 'secondary-up']]},
  {name: 'primary-then-secondary-held', events: [[1, 'fire-down'], [1, 'secondary-down'], [1.5, 'fire-up'], [1.6, 'secondary-up']]},
  {name: 'secondary-repeat', events: [[1, 'secondary-down'], [1.7, 'secondary-up']]},
  {name: 'semi-cooldown-secondary-tap', events: [[1, 'fire-down'], [1, 'fire-up'], [1.03125, 'secondary-down'], [1.0390625, 'secondary-up']]},
  {name: 'semi-cooldown-secondary-held', events: [[1, 'fire-down'], [1, 'fire-up'], [1.03125, 'secondary-down'], [1.3, 'secondary-up']]},
  {name: 'normal-semi', events: [[1, 'fire-down'], [1, 'fire-up'], [1.15, 'fire-down'], [1.15, 'fire-up'], [1.3, 'fire-down'], [1.3, 'fire-up']]},
  {name: 'normal-burst-released', burst: true, events: [[1, 'fire-down'], [1.0078125, 'fire-up']]},
  {name: 'normal-burst-held', burst: true, events: [[1, 'fire-down'], [2, 'fire-up']]},
];
const cases = [];
for (const fixture of fixtures) for (const engine of ['range', 'duel']) {
  const range = engine === 'range';
  const sim = range ? new Simulation({...defaults, weapon: 'glock', mode: 'guided', spread: false, burst: 0}, () => .5)
    : new DuelSimulation(sanitizeDuelConfig({botCount: 1, roundSeconds: 60}), 1, testArena(), 'glock');
  const state = range ? sim : sim.actors[0].weapon, actions = state.actions;
  if (range) sim.active = true;
  else {sim.start(); sim.actors[0].yaw = Math.PI; sim.command(1, {fireHeld: false});}
  if (fixture.burst) actions.burst = true;
  const shots = [], events = []; let last = '';
  if (range) sim.onShot = s => shots.push({at: sim.time, scheduledAt: s.at});
  function sample(edge) {
    if (!range) for (const event of sim.drainEvents()) if (event.kind === 'fire' && event.actorId === 0)
      shots.push({at: sim.time});
    const value = {burst: actions.burst, readyAt: actions.readyAt, secondaryReadyAt: actions.secondaryReadyAt,
      ammo: range ? sim.reloadState.ammo : state.ammo, next: range ? sim.shotReady.get('glock') ?? 0 : state.nextShotAt};
    const key = JSON.stringify(value);
    if (edge || key !== last) events.push({at: sim.time, ...(edge ? {edge} : {}), ...value});
    last = key;
  }
  function advance(at) {
    while (sim.time < at - 1e-10) {
      const dt = Math.min(1 / 128, at - sim.time);
      if (range) sim.step(dt); else sim.step(dt, true);
      sample();
    }
  }
  sample('initial');
  for (const [at, kind] of fixture.events) {
    advance(at);
    const down = kind.endsWith('down'), secondary = kind.startsWith('secondary');
    if (range) {
      if (secondary) {
        sim.secondaryHeld = down;
        if (down) {
          if (typeof sim.secondary === 'function') sim.secondary();
          // Frozen bfebff8 RangeEngine.secondary's actual guard.
          else if (!sim.firing && !sim.reloadState.active) actions.secondary(sim.time);
        }
      } else if (down) sim.pressTrigger(); else sim.release('mouse');
    } else {
      sim.command(0, secondary ? {secondaryPressed: down, secondaryHeld: down} : {firePressed: down, fireHeld: down});
      sim.processInput();
    }
    sample(kind);
  }
  advance(2.2);
  cases.push({engine, scenario: fixture.name, shots, events});
}
const hash = value => createHash('sha256').update(value).digest('hex');
const portableInput = p => p.includes('node_modules/') ? p.slice(p.indexOf('node_modules/')) : p;
const sourceHashes = Object.fromEntries(Object.keys(built.metafile.inputs).filter(p => p !== '<stdin>').sort()
  .map(p => [portableInput(p), hash(fs.readFileSync(path.resolve(repo, p)))]));
// RangeEngine is not bundled in Node, but its input adapter is part of the baseline identity.
sourceHashes['src/range/engine.ts'] = hash(fs.readFileSync(path.join(repo, 'src/range/engine.ts')));
const report = {commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  trackedChanges: execFileSync('git', ['diff', '--name-only'], {cwd: repo, encoding: 'utf8'}).trim().split('\n').filter(Boolean),
  scriptSha256: hash(fs.readFileSync(new URL(import.meta.url))), bundleSha256: hash(built.outputFiles[0].contents), sourceHashes,
  method: 'Actual Range and Duel simulations, 128 Hz maximum steps, exact input edges. Original RangeEngine edge guard for bfebff8; corrected Simulation entry thereafter. Held input is processed by each actual simulation. Default inventory; mode-only seed for burst controls. Browser checks cover the public Range mouse handlers separately.',
  fixtures, cases};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({output, cases: cases.length, commit: report.commit, scriptSha256: report.scriptSha256}));
