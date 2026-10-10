// Supplied native stance snapshots at an accuracy boundary; not an input replay.
// Run only under the authorized 512 MiB hard cap. No game or browser is started.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), audit = path.resolve(root, '../native-audit');
const require = createRequire(path.join(root, 'package.json'));
const {createServer} = await import(pathToFileURL(require.resolve('vite')).href);
const output = process.argv[2] ?? path.join(audit, 'reports/reaudit-duck-accuracy/engines-after.json');
const fixturePath = path.join(root, 'docs/evidence/reaudit-duck-accuracy-fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const vite = await createServer({root, server:{middlewareMode:true}, appType:'custom', logLevel:'error'});
try {
  const {Simulation} = await vite.ssrLoadModule('/src/range/simulation.ts');
  const {DuelSimulation} = await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {DuelWeaponState} = await vite.ssrLoadModule('/src/range/duel/weapon-state.ts');
  const {defaults, gameData} = await vite.ssrLoadModule('/src/range/config.ts');
  const {WeaponRecovery} = await vite.ssrLoadModule('/src/range/ballistics.ts');
  const {idleCommand} = await vite.ssrLoadModule('/src/range/duel/types.ts');
  const {UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const sourceRows = [...fixture.baselineDisagreements,
    fixture.phases[0].rows.find(r => r.tick === 425),
    fixture.phases[1].rows.find(r => r.tick === 544)];
  const rows = [], missingNativeWeapons = [];
  function pose(target, row) {
    Object.assign(target, {duckAmount:row.amount, duckFlag:row.duckFlag, duckSpeed:row.speed,
      crouchHeld:row.desiresDuck, duckCooldown:0, duckRootOffset:0,
      duckViewOffset:-18*UNIT*row.amount, eyeHeight:(64-18*row.amount)*UNIT,
      feet:0, verticalVelocity:0, grounded:true, velocity:{x:0,z:0}});
    target.position.y = target.eyeHeight;
  }
  function seed(recovery, sample) {
    // Leave exactly one 64 Hz boundary pending. step(0) resolves its real
    // motor-to-weapon stance selection without changing the supplied amount.
    recovery.advance(1/64, false, false, true, 1/64);
    recovery.penalty = Math.fround(sample.penalty); recovery.index = sample.index;
    recovery.lastShot = 0;
  }
  for (const weapon of ['ak47','m4a4','m4a1s','deagle','awp','usp']) {
    const samples = fixture.nativeUpdates.filter(r => r.weapon === weapon && r.mode === 0 && r.index === 3 && r.gate === 'equal');
    if (!samples.length) {missingNativeWeapons.push(weapon); continue;}
    for (const source of sourceRows) {
      const sample = samples.find(r => r.stance === (source.duckFlag ? 'crouch' : 'stand'));
      if (!sample) throw Error(`Missing native stance for ${weapon}`);
      for (const engine of ['range-active','range-inventory','duel-active','duel-inventory']) {
        let state, chosen;
        if (engine.startsWith('range')) {
          const sim = new Simulation({...defaults, weapon, mode:'spray'});
          pose(sim, source); sim.time = 1/64; sim.active = true;
          sim.input.crouch = source.desiresDuck;
          if (engine === 'range-active') state = sim.recovery;
          else {
            sim.slot = 3; state = new WeaponRecovery(gameData.weapons[weapon]);
            sim.recoveryStates.set(weapon, state);
          }
          seed(state, sample); sim.step(0); chosen = state.accuracyCrouch;
        } else {
          const sim = new DuelSimulation(undefined, 1, undefined, weapon);
          const actor = sim.actors[0]; pose(actor, source);
          actor.command = {...idleCommand(), crouch:source.desiresDuck};
          const weaponState = new DuelWeaponState(weapon, () => .5);
          state = weaponState.recovery;
          actor.weapon = engine === 'duel-active' ? weaponState : new DuelWeaponState('knife', () => .5);
          actor.inventory = new Map([[weapon, weaponState]]);
          seed(state, sample); sim.time = 1/64; sim.start(); sim.step(0, true);
          chosen = state.accuracyCrouch;
        }
        rows.push({engine, weapon, nativeTick:source.tick, amount:source.amount,
          nativeDuckFlag:source.duckFlag, chosenCrouch:chosen,
          initialPenalty:Math.fround(sample.penalty), index:sample.index,
          nativeInvocationPenalty:sample.actual.penalty, actualPenalty:state.penalty,
          penaltyError:state.penalty-sample.actual.penalty});
      }
    }
  }
  const report = {method:'Actual range/duel active and inventory consumers with retained native stance snapshots. Each executes one pending accuracy boundary; native per-invocation reference is independently retained.',
    demoSha256:fixture.demoSha256, fixtureSha256:sha(fixturePath), nativeUpdateSource:fixture.nativeUpdateSource,
    sourceSha256:Object.fromEntries(['actor-physics.ts','simulation.ts','duel/simulation.ts','duel/weapon-state.ts','ballistics.ts']
      .map(name => [name,sha(path.join(root,'src/range',name))])),
    cases:rows.length, wrongStance:rows.filter(r=>r.chosenCrouch!==r.nativeDuckFlag).length,
    penaltyMismatches:rows.filter(r=>Math.abs(r.penaltyError)>1e-8).length,
    maxPenaltyError:Math.max(...rows.map(r=>Math.abs(r.penaltyError))), missingNativeWeapons,
    limits:['Supplied pose/flag and initial penalty; not replay of native button input or a measured shot.',
      'Native movement recording does not itself contain the common-weapon penalty outcomes.',
      'Reference penalty uses the retained current-server invocation at index3; no new native invocation is executed.',
      'No blocked-unduck, jump, ladder or fatigue boundary was measured by this consumer bench.'], rows};
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
  const summary = {...report,rows:undefined,byEngine:{},byWeapon:{},
    disagreementTicks:[...new Set(rows.filter(r=>r.penaltyError).map(r=>r.nativeTick))]};
  for (const [key,label] of [['engine','byEngine'],['weapon','byWeapon']]) {
    for (const name of new Set(rows.map(r=>r[key]))) {
      const selected = rows.filter(r=>r[key]===name);
      summary[label][name] = {cases:selected.length,
        wrongStance:selected.filter(r=>r.chosenCrouch!==r.nativeDuckFlag).length,
        penaltyMismatches:selected.filter(r=>Math.abs(r.penaltyError)>1e-8).length,
        maxPenaltyError:Math.max(...selected.map(r=>Math.abs(r.penaltyError)))};
    }
  }
  const summaryPath = process.argv[3] ?? path.join(root,'docs/evidence/reaudit-duck-accuracy-after.json');
  fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({output,cases:report.cases,wrongStance:report.wrongStance,
    penaltyMismatches:report.penaltyMismatches,maxPenaltyError:report.maxPenaltyError,missingNativeWeapons}));
} finally { await vite.close(); }
