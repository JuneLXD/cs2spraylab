// Run with the documented systemd 8 GiB memory cap. No browser or game launch.
// Records state each simulation step, including cases that lack native parity evidence.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, '../native-audit/reports/reaudit-movement-before.json'));
const vite = await createServer({root, server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {advanceActor, idleInput, UNIT, STEP, airAcceleration, stanceCurve} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const {acceptedJumpPress, isBhopPress, groundLandingFactor, jumpLandingFactor} = await vite.ssrLoadModule('/src/range/actor-jump.ts');
  const standing = (vx = 0) => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: vx * UNIT, z: 0},
    yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, duckAmount: 0,
    grounded: true, jumpHeld: false});
  const sample = (a, time) => ({time, x: a.position.x / UNIT, z: a.position.z / UNIT,
    feet: a.feet / UNIT, eye: a.position.y / UNIT, eyeOffset: a.eyeHeight / UNIT,
    vx: a.velocity.x / UNIT, vz: a.velocity.z / UNIT, verticalVelocity: a.verticalVelocity / UNIT,
    grounded: a.grounded, duckAmount: a.duckAmount, duckSpeed: a.duckSpeed, duckCooldown: a.duckCooldown,
    duckViewOffset: a.duckViewOffset === undefined ? undefined : a.duckViewOffset / UNIT,
    duckRootOffset: a.duckRootOffset === undefined ? undefined : a.duckRootOffset / UNIT});
  function run(start, input, count = 128, dt = STEP, speed = 215, environment) {
    let actor = start;
    return Array.from({length: count}, (_, i) => {
      actor = advanceActor(actor, {...idleInput(), ...(typeof input === 'function' ? input(i, actor) : input)},
        speed * UNIT, dt, undefined, undefined, undefined, environment);
      return sample(actor, (i + 1) * dt);
    });
  }
  const result = {baseline: 'c488943', units: 'Source units and seconds', step: STEP, ground: {}, air: [],
    jump: {}, duck: {}, perWeapon: [], landing: [], jumpGates: {}, limits: [
      'Trainer measurements are observations of repository code, not native agreement claims.',
      'Inputs are exact simulation boundary inputs. Physical browser scheduling is not measured.',
      'Native comparison must use recorded input fractions and matching start state.']};
  for (const [name, initial, input] of [['accelerate', 0, {side: 1}], ['release', 215, {}],
    ['counterstrafe', 215, {side: -1}], ['walk', 215, {side: 1, walk: true}]]) {
    const samples = run(standing(initial), input);
    result.ground[name] = {threshold34: initial ? samples.find(s => s.vx <= 215 * .34)?.time : null,
      stopOrReverse: initial ? samples.find(s => s.vx <= 0)?.time : null,
      fullSpeed: initial ? null : samples.find(s => s.vx >= 215 - 1e-8)?.time, samples};
  }
  for (const dt of [1 / 64, STEP]) for (const speed of [100, 215, 250]) for (const initial of [-40, 0, 20, 29, 30]) {
    const v = airAcceleration(initial * UNIT, 0, 1, 0, speed * UNIT, dt);
    result.air.push({dt, speed, initial, beforeMove: v.movement.x / UNIT,
      deferred: v.deferred.x / UNIT, final: (v.movement.x + v.deferred.x) / UNIT});
  }
  for (const [name, command] of [['standing', () => ({jump: true})],
    ['crouchAtTakeoff', () => ({jump: true, crouch: true})],
    ['crouchMidair', i => ({jump: i === 0, crouch: i >= 16})]]) {
    const samples = run(standing(), command, 160);
    result.jump[name] = {maxFeet: Math.max(...samples.map(s => s.feet)),
      maxEye: Math.max(...samples.map(s => s.eye)),
      firstGroundedAfterLaunch: samples.find((s, i) => i > 1 && s.grounded)?.time, samples};
  }
  for (const dt of [1 / 64, STEP]) {
    const down = run(standing(), {crouch: true}, Math.ceil(.4 / dt), dt);
    const initial = {...standing(), duckAmount: 1, duckSpeed: 8, crouchHeld: true,
      eyeHeight: 46 * UNIT, position: {x: 0, y: 46 * UNIT, z: 0}};
    const up = run(initial, {}, Math.ceil(.4 / dt), dt);
    result.duck[String(dt)] = {fullDuckAt: down.find(s => s.duckAmount === 1)?.time,
      fullStandAt: up.find(s => s.duckAmount === 0)?.time, down, up};
  }
  result.duck.hullCurve = [0, .25, .5, .75, 1].map(amount => ({amount, hullHeight: 72 - 18 * stanceCurve(amount)}));
  result.jumpGates.spam = [.015624, .015625, .015626].map(time => ({time, accepted: acceptedJumpPress(time, 0)}));
  result.jumpGates.bhop = [-.00390725, -.00390625, 0, .00390625, .00390725].map(offset => ({offset, accepted: isBhopPress(1 + offset, 1)}));
  for (const velocity of [-100, -300, -600]) for (const elapsed of [0, .05, .1, .25, .5]) {
    result.landing.push({velocity, elapsed, ground: groundLandingFactor(velocity * UNIT, elapsed),
      jump: jumpLandingFactor(velocity * UNIT, elapsed)});
  }
  const weaponData = JSON.parse(fs.readFileSync(path.join(root, 'src/range/game-data.json'), 'utf8')).weapons;
  weaponData.knife = JSON.parse(fs.readFileSync(path.join(root, 'src/range/equipment-data.json'), 'utf8')).weapons.knife;
  for (const [name, stats] of Object.entries(weaponData)) for (const [mode, data] of [['primary', stats], ...(stats.alternate ? [['alternate', {...stats, ...stats.alternate}]] : [])]) {
    result.perWeapon.push({name, mode, run: data.speed, walk: data.speed * .52, crouch: data.speed * .34});
  }
  const native = JSON.parse(fs.readFileSync(path.join(root, 'src/range/native-movement-reaudit-fixture.json'), 'utf8'));
  result.nativeCameraComparison = native.phases.map(phase => {
    const first = phase.samples[0], feet = phase.air ? 1000 * UNIT : 0;
    let actor = {...standing(), feet, grounded: !phase.air,
      position: {x: 0, y: feet + (64 + first.viewOffset + first.rootOffset) * UNIT, z: 0},
      eyeHeight: (64 + first.viewOffset + first.rootOffset) * UNIT,
      duckAmount: first.amount, duckSpeed: first.speed, crouchHeld: phase.held,
      duckViewOffset: first.viewOffset * UNIT, duckRootOffset: first.rootOffset * UNIT};
    const samples = phase.samples.slice(1).map(source => {
      actor = advanceActor(actor, {...idleInput(), crouch: phase.held}, 215 * UNIT, native.sampleInterval);
      return {tick: source.tick, nativeEyeOffset: 64 + source.viewOffset + source.rootOffset,
        trainerEyeOffset: actor.eyeHeight / UNIT, nativeAmount: source.amount, trainerAmount: actor.duckAmount};
    });
    return {phase: phase.name, maxEyeError: Math.max(...samples.map(s => Math.abs(s.trainerEyeOffset - s.nativeEyeOffset))), samples};
  });
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(output);
} finally { await vite.close(); }
