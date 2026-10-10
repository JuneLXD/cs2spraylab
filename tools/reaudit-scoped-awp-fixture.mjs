import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [input, output] = process.argv.slice(2);
assert(input && output && !fs.existsSync(output));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input);
assert.equal(sha(bytes), '5e908e813f902d790c643eb33e90ac9066f34913fa3821827527f333a955a03a');
const native = JSON.parse(bytes);
const cases = native.fixtures.map(fixture => {
  const sequence = native.sequences.find(s => s.fixtureId === fixture.id && s.mxcsrProfile === 'nearest-gradual');
  assert(sequence);
  let x = 0, z = 0;
  return {id: fixture.id, zoomLevel: fixture.zoomLevel, stance: fixture.stance, weaponSpeed: fixture.weaponSpeed,
    suppliedSpeed: fixture.suppliedSpeed, initial: fixture.initialState, origin: fixture.commands[0].startFraction / 64,
    rows: sequence.rows.map(row => {
      x += row.derivedUncollidedDisplacement.x; z += row.derivedUncollidedDisplacement.y;
      const state = row.afterCommandHandoff ?? row.afterWishCopy;
      return {time: (row.command - 1 + row.endFraction) / 64,
        side: row.currentWish.x / fixture.suppliedSpeed, forward: -row.currentWish.y / fixture.suppliedSpeed,
        velocity: {x: row.afterPostHelper.speedX, z: row.afterPostHelper.speedY}, position: {x, z},
        friction: {active: state.stashActive, savedFraction: state.savedFraction, storedSpeed: state.storedSpeed,
          commandMarked: state.commandMarker, previousWish: {x: state.previousWish.x, z: state.previousWish.y}}};
    })};
});
const result = {schema: 'spraylab.scoped-awp-fixture.v1', nativeInputSha256: sha(bytes),
  generatorSha256: sha(fs.readFileSync(import.meta.filename)), cases};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({cases: cases.length, rows: cases.reduce((n, c) => n + c.rows.length, 0), sha256: sha(fs.readFileSync(output))}));
