// Deterministic integration probe. Run under the machine's Node memory cap.
// Writes evidence because Vitest console output is suppressed on this host.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, '../native-audit/reports/movement-feel.json'));
const vite = await createServer({root, server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {advanceActor, idleInput, STEP, UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const standing = (speed = 0) => ({position: {x: 0, y: 64 * UNIT, z: 0},
    velocity: {x: speed * UNIT, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0,
    eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false});
  const horizontal = a => ({positionUnits: a.position.x / UNIT, speedUnits: a.velocity.x / UNIT});
  const result = {stepSeconds: STEP, ground: {}, air: [], bhop: []};
  for (const [name, initial, command] of [
    ['accelerate', 0, {side: 1}], ['release', 215, {}], ['counterstrafe', 215, {side: -1}],
    ['walkTransition', 215, {side: 1, walk: true}],
  ]) {
    let actor = standing(initial);
    const samples = [];
    for (let i = 1; i <= 128; i++) {
      actor = advanceActor(actor, {...idleInput(), ...command}, 215 * UNIT, STEP);
      samples.push({time: i * STEP, ...horizontal(actor)});
    }
    result.ground[name] = {firstStep: samples[0],
      accuracyThresholdAt: initial ? samples.find(s => s.speedUnits <= 215 * .34)?.time : undefined,
      stopAt: initial ? samples.find(s => s.speedUnits <= 0)?.time : undefined,
      fullSpeedAt: initial ? undefined : samples.find(s => s.speedUnits >= 215 - 1e-8)?.time,
      samples};
  }
  for (const initial of [0, 20, 29, 30, -40]) {
    const before = {...standing(initial), feet: 10, position: {x: 0, y: 10 + 64 * UNIT, z: 0}};
    const after = advanceActor(before, {...idleInput(), side: 1}, 215 * UNIT, STEP);
    result.air.push({initialUnits: initial, ...horizontal(after)});
  }
  for (const previousSpeed of [100, 215, 250]) {
    const before = {...standing(50), movementTime: .001, landedAt: 0, landingVelocity: -300 * UNIT,
      landingVelocityXY: {x: previousSpeed * UNIT, z: 0}};
    const after = advanceActor(before, {...idleInput(), jump: true}, 215 * UNIT, STEP);
    result.bhop.push({previousLandingSpeedUnits: previousSpeed, currentSpeedUnits: 50, ...horizontal(after)});
  }
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(output);
} finally {
  await vite.close();
}
