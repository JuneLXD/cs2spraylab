// Run under systemd-run's MemoryMax=8G/MemorySwapMax=0 cap.
// Optional output path retains a before/after measurement without console logging.
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {Simulation} = await vite.ssrLoadModule('/src/range/simulation.ts');
  const {defaults} = await vite.ssrLoadModule('/src/range/config.ts');
  const {tickAligned} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const advanceTo = (sim, time) => {while (sim.time + sim.accumulator < time - 1e-9)
    sim.advance(Math.min(.125, time - sim.time - sim.accumulator));};
  const press = sim => typeof sim.pressTrigger === 'function' ? sim.pressTrigger() : sim.start();
  const measurements = [];
  for (const scenario of ['press-during-reload', 'hold-through-reload', 'hold-through-deploy', 'press-during-deploy', 'release-before-ready', 'empty-auto-reload']) {
    const sim = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', burst: 0, spread: false});
    const shots = []; sim.active = true;
    sim.onShot = shot => shots.push({at: shot.at, weapon: shot.equipment});
    let due, before;
    if (scenario.includes('deploy')) {
      if (scenario === 'hold-through-deploy') press(sim);
      sim.equip(2); sim.equip(1); due = sim.equipReadyAt;
      if (scenario === 'press-during-deploy') press(sim);
      before = shots.length;
    } else if (scenario === 'empty-auto-reload') {
      sim.reloadState.ammo = 1; press(sim); advanceTo(sim, .125);
      due = sim.reloadState.until; before = shots.length;
    } else {
      sim.reloadState.ammo = 5;
      if (scenario === 'hold-through-reload') press(sim);
      sim.reload(); due = sim.reloadState.until;
      if (scenario !== 'hold-through-reload') {advanceTo(sim, .25); press(sim);}
      if (scenario === 'release-before-ready') sim.release('mouse');
      before = shots.length;
    }
    advanceTo(sim, tickAligned(due) + .0625);
    const first = shots[before];
    measurements.push({scenario, readiness: due, expectedHeldShotAt: tickAligned(due),
      resumedShots: shots.length - before, firstResumedShotAt: first?.at ?? null,
      delayAfterReadyMs: first ? (first.at - due) * 1000 : null,
      nextScheduledShot: first ? sim.nextShot : null, ammo: sim.loadedAmmo});
  }
  const out = resolve(process.argv[2] ?? '../native-audit/reports/feel-trigger-current.json');
  await mkdir(dirname(out), {recursive: true});
  await writeFile(out, JSON.stringify({description: 'Range physical-trigger transitions; no browser or native execution', measurements}, null, 2) + '\n');
} finally {await vite.close();}
