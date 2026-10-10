// Preserve native counter/restart/cap regressions without executing the game in tests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [input, output] = process.argv.slice(2);
assert(input && output && !fs.existsSync(output));
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = fs.readFileSync(input); assert.equal(hash(bytes), '4f4146fa0215d0dc740806ad5dd6f223e75fdae73a69e531ed63c4bf491c2224');
const native = JSON.parse(bytes);
assert.equal(native.sourceExecutionSha256, 'b1e454f893f7c85e6ea1e2f43afd71d9b6895749348f26ae17ac350616cd4548');
const vector = s => ({x: s.speedX, z: s.speedY});
const work = s => ({x: s.accelerationWork.x, z: s.accelerationWork.y});
const state = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
const primitives = [], trajectories = [];
let zeroCacheRestart = 0;
for (const fixture of native.fixtures) {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  for (const [i, row] of sequence.rows.entries()) {
    if (!(row.afterFriction.frictionOvershoot > 0 || row.nativeStopGate.taken ||
      i === 0 && ['start-from-rest', 'supplied-cap-correction'].includes(fixture.kind))) continue;
    if (row.before.speedX === 0 && row.before.speedY === 0 && row.before.stashActive && row.afterFriction.frictionOvershoot > 0)
      zeroCacheRestart++;
    primitives.push({id: `${fixture.id}/${i}`, speed: fixture.suppliedSpeed, dt: row.duration,
      velocity: vector(row.before), control: row.nativeControlSpeed, wish: {x: row.currentWish.x, z: row.currentWish.y},
      overshoot: row.afterFriction.frictionOvershoot,
      accelerated: {velocity: vector(row.afterAccelerate), work: work(row.afterAccelerate)},
      capped: {velocity: vector(row.afterNativeCap), work: work(row.afterNativeCap)},
      endpoint: vector(row.afterPostHelper), stopped: row.nativeStopGate.taken});
  }
  if (!(fixture.id.includes('release-counter-+1-0.25-diagonal') || fixture.id.includes('start-+1-diagonal') ||
    fixture.kind === 'supplied-cap-correction' || fixture.weaponLabel === 'deagle' && fixture.kind === 'near-zero-reversal')) continue;
  const initial = fixture.initialState; let position = {x: 0, z: 0}; const samples = [];
  for (const row of sequence.rows) {
    position.x += row.derivedUncollidedDisplacement.x; position.z += row.derivedUncollidedDisplacement.y;
    const command = fixture.commands[row.command - 1];
    if (row.endFraction !== command.endFraction && !command.extraBoundaries.includes(row.endFraction) &&
      !command.events.some(e => e.fraction === row.endFraction)) continue;
    samples.push({at: (row.command - 1 + row.endFraction) / 64,
      input: {side: row.currentWish.x / fixture.suppliedSpeed, forward: -row.currentWish.y / fixture.suppliedSpeed},
      velocity: vector(row.afterPostHelper), derivedPosition: {...position}, state: state(row.afterCommandHandoff ?? row.afterWishCopy)});
  }
  trajectories.push({id: fixture.id, speed: fixture.suppliedSpeed, startTime: fixture.commands[0].startFraction / 64,
    velocity: {x: initial.velocity[0], z: initial.velocity[1]},
    state: {active: initial.active, savedFraction: initial.savedFraction, storedSpeed: initial.storedSpeed,
      commandMarked: initial.commandMarked, previousWish: {x: initial.previousWish[0], z: initial.previousWish[1]}}, samples});
}
assert(zeroCacheRestart > 0, 'The native zero-speed live-cache restart regression must be present');
const result = {sourceExecutionSha256: native.sourceExecutionSha256, inputSha256: hash(bytes),
  extractorSha256: hash(fs.readFileSync(import.meta.filename)), zeroCacheRestart,
  method: 'Native positive friction overshoot, stop-gate and first start/cap rows; cumulative counter, diagonal start, supplied cap and near-zero reversal controls. Caller omits automatically inserted saved-fraction boundaries.',
  primitives, trajectories};
fs.writeFileSync(output, JSON.stringify(result) + '\n', {flag: 'wx'});
console.log(JSON.stringify({sha256: hash(fs.readFileSync(output)), primitives: primitives.length,
  trajectories: trajectories.length, samples: trajectories.reduce((n, c) => n + c.samples.length, 0), zeroCacheRestart}));
