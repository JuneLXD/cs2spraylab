import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [input, output] = process.argv.slice(2);
assert(input && output && !fs.existsSync(output));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input);
assert.equal(hash(bytes), '2c7b684995f2f6f7e725fe13cb21296b78b49c2b1c7a20c91716a5e79adb586e');
const native = JSON.parse(bytes);
assert.equal(native.sourceExecutionSha256, 'b8dbfe8e2b6997488e8f3b6da5ebf3fb01dbf68200f94ea9d03af07d6f8f46e9');
assert.equal(native.unexpectedAccesses, 0);
const state = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
const releases = [];
for (const fixture of native.fixtures.filter(f => f.kind === 'release')) {
  const first = fixture.commands[0], seed = fixture.initialState;
  if (!first.extraBoundaries.includes(.5)) continue;
  if (!(first.startFraction === 0 && seed.velocity[0] > 0) &&
      !(fixture.suppliedSpeed === 225 && [.25, .75].includes(first.startFraction))) continue;
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  let position = {x: 0, z: 0}; const samples = [];
  for (const r of sequence.rows) {
    position.x += r.derivedUncollidedDisplacement.x; position.z += r.derivedUncollidedDisplacement.y;
    const command = fixture.commands[r.command - 1];
    if (r.endFraction !== command.endFraction && !command.extraBoundaries.includes(r.endFraction)) continue;
    samples.push({at: (r.command - 1 + r.endFraction) / 64,
      velocity: {x: r.afterPostHelper.speedX, z: r.afterPostHelper.speedY}, derivedPosition: {...position},
      state: state(r.afterCommandHandoff ?? r.afterWishCopy)});
  }
  releases.push({id: fixture.id, speed: fixture.suppliedSpeed, startTime: first.startFraction / 64,
    velocity: {x: seed.velocity[0], z: seed.velocity[1]},
    state: {active: seed.active, savedFraction: seed.savedFraction, storedSpeed: seed.storedSpeed,
      commandMarked: seed.commandMarked, previousWish: {x: seed.previousWish[0], z: seed.previousWish[1]}}, samples});
}
assert.equal(releases.length, 10);
const report = {sourceExecutionSha256: native.sourceExecutionSha256, inputSha256: hash(bytes),
  extractorSha256: hash(fs.readFileSync(import.meta.filename)),
  method: 'Native stop predicate controls and cumulative native release endpoints through complete stopping; omit automatically inserted cache boundaries from caller schedule.',
  controls: native.stopGateControls.map(c => ({id: c.id, dt: c.duration,
    velocity: {x: c.before.velocity[0], z: c.before.velocity[1], y: c.before.velocity[2]},
    acceleration: {x: c.before.accelerationWork[0], z: c.before.accelerationWork[1], y: c.before.accelerationWork[2]},
    stopped: c.gate.taken})),
  smallControls: native.smallControlSpeedCases.map(c => ({id: c.id, dt: c.duration,
    velocity: {x: c.before.speedX, z: c.before.speedY}, control: c.nativeControlSpeed,
    afterFriction: {x: c.afterFriction.speedX, z: c.afterFriction.speedY},
    afterPost: {x: c.afterPostHelper.speedX, z: c.afterPostHelper.speedY}})), releases};
fs.writeFileSync(output, JSON.stringify(report) + '\n', {flag: 'wx'});
console.log(JSON.stringify({sha256: hash(fs.readFileSync(output)), controls: report.controls.length,
  smallControls: report.smallControls.length, releases: releases.length,
  samples: releases.reduce((n, r) => n + r.samples.length, 0)}));
