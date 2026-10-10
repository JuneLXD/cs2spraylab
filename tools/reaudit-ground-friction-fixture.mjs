// Extract fixed regression cases from separately guarded native execution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [v1Path, v2Path, output] = process.argv.slice(2);
assert(v1Path && v2Path && output, 'Usage: node TOOL V1.json V2.json NEW.json');
assert(!fs.existsSync(output), 'Refusing to overwrite an existing fixture');
const hash = b => createHash('sha256').update(b).digest('hex');
const v1Bytes = fs.readFileSync(v1Path), v2Bytes = fs.readFileSync(v2Path);
assert.equal(hash(v1Bytes), '14cff2b71b2ed06b54434622b39575a6f1d08c6f81d4ed59d513489076d67502');
assert.equal(hash(v2Bytes), '91ac101a4e06a7278923c5a5de2a1eace6b6d3dce5ab099920ee4785aca8b9b3');
const v1 = JSON.parse(v1Bytes), v2 = JSON.parse(v2Bytes);
assert.equal(v1.memoryGuard.unexpectedAccesses, 0); assert.equal(v2.memoryGuard.unexpectedAccesses, 0);
const state = s => ({active: s.stashActive, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
  commandMarked: s.commandMarker, previousWish: {x: s.previousWish.x, z: s.previousWish.y}});
const primitive = [], releases = [];
for (const fixture of v2.fixtures) {
  const sequence = v2.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  assert(sequence);
  if (fixture.kind !== 'release') {
    for (const [i, r] of sequence.rows.entries()) primitive.push({id: `${fixture.id}/${i}`,
      state: state(r.before), velocity: {x: r.before.speedX, z: r.before.speedY},
      wish: {x: r.currentWish.x, z: r.currentWish.y}, fraction: r.startFraction, dt: r.duration,
      selected: state(r.afterCache), control: r.nativeControlSpeed,
      velocityAfterFriction: {x: r.afterFriction.speedX, z: r.afterFriction.speedY},
      completed: state(r.afterWishCopy)});
    continue;
  }
  const first = fixture.commands[0];
  // Every supplied speed/sign at tick start with half-tick boundaries, plus
  // both signs/schedules at all three interior phases for M4/pistol speeds.
  if (!(first.startFraction === 0 && first.extraBoundaries.includes(.5)) &&
      !([225, 240].includes(fixture.suppliedSpeed) && first.startFraction > 0)) continue;
  let position = {x: 0, z: 0}; const samples = [];
  for (const r of sequence.rows) {
    position.x += r.derivedUncollidedDisplacement.x; position.z += r.derivedUncollidedDisplacement.y;
    const c = fixture.commands[r.command - 1];
    if (r.endFraction !== c.endFraction && !c.extraBoundaries.includes(r.endFraction)) continue;
    samples.push({at: (r.command - 1 + r.endFraction) / 64,
      velocity: {x: r.afterPostHelper.speedX, z: r.afterPostHelper.speedY}, derivedPosition: {...position},
      state: state(r.afterCommandHandoff ?? r.afterWishCopy)});
  }
  const s = fixture.initialState;
  releases.push({id: fixture.id, speed: fixture.suppliedSpeed, startTime: first.startFraction / 64,
    velocity: {x: s.velocity[0], z: s.velocity[1]},
    state: {active: s.active, savedFraction: s.savedFraction, storedSpeed: s.storedSpeed,
      commandMarked: s.commandMarked, previousWish: {x: s.previousWish[0], z: s.previousWish[1]}}, samples});
}
assert.equal(releases.length, 36);
const result = {nativeV1Sha256: hash(v1Bytes), nativeV2Sha256: hash(v2Bytes),
  extractorSha256: hash(fs.readFileSync(import.meta.filename)),
  method: 'Frozen native quantizer/state cases and cumulative release endpoints. Release samples omit native-inserted interior boundaries so actual actor scheduling must supply them. Position is a derived uncollided midpoint diagnostic.',
  quantizer: v1.quantizer, primitive, releases};
fs.writeFileSync(output, JSON.stringify(result) + '\n', {flag: 'wx'});
console.log(JSON.stringify({quantizer: result.quantizer.length, primitive: primitive.length, releases: releases.length,
  releaseSamples: releases.reduce((sum, c) => sum + c.samples.length, 0), sha256: hash(fs.readFileSync(output))}));
