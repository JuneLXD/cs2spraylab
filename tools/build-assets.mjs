import { execFileSync } from 'node:child_process';
import { ensureBlender, stopBlender } from './blender-server.mjs';
const steps = [
  ['tools/import-game.mjs'],
  ['tools/import-equipment.mjs'],
  ['tools/import-audio.mjs'],
  ['tools/import-weapon-fx.mjs'],
  ['tools/blender-command.mjs', 'art/build_native.py', '--target-only'],
  ['tools/blender-command.mjs', 'art/build_arsenal.py'],
  ['tools/build-weapon-mounts.mjs'],
  ['tools/blender-command.mjs', 'art/build_range.py'],
  ['tools/build-reload.mjs'],
  ['tools/optimize-assets.mjs', '--world-only'],
  ['tools/import-cosmetics.mjs'],
  ['tools/import-knives.mjs'],
  ['tools/build-knives.mjs'],
  ['tools/import-knife-cosmetics.mjs'],
  ['tools/build-reload.mjs', 'sg553','aug','mp7','mp5sd','ump45','bizon','m249','negev','cz75a','hkp2000','elite','fiveseven','revolver','g3sg1','scar20','mag7','sawedoff', '--legacy','--reuse-source'],
  ['tools/build-duel-motion.mjs','--gestures-only'],
  ['tools/build-cosmetic-actors.mjs'],
  ['tools/verify-weapon-data.mjs', '--write-fixture'],
  ['tools/build-duel-motion.mjs', '--refresh'],
  ['tools/blender-command.mjs', 'art/verify_target_grips.py'],
  ['tools/blender-command.mjs', 'art/render_target_preview.py'],
  ['tools/check-assets.mjs']
];
// --from=<text> resumes at the first step whose command line contains <text>, e.g. --from=import-audio.
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7);
const start = from ? steps.findIndex(args => args.join(' ').includes(from)) : 0;
if (start < 0) throw new Error(`No asset step matches --from=${from}`);
// The Blender steps talk to port 9876; start Blender unless something already listens there.
const startedBlender = await ensureBlender();
try {
  for (const args of steps.slice(start)) {
    console.log(`\n== ${args.join(' ')}`);
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  }
}
finally { if (startedBlender) await stopBlender(); }
