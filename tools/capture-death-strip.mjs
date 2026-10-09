// Headless screenshot strips of a bot dying or flinching in Deathmatch on aim_redline.
// Usage: node tools/capture-death-strip.mjs --out <dir> [--base http://127.0.0.1:5177] [--mode death|flinch]
//        [--weapon ak47] [--aim chest|head] [--distance 4] [--frames 24] [--step 100]
// Needs a Vite dev server of this checkout at --base (the Playwright config's server on :5176 also works).
// Frames are deterministic: after the shot the simulation is paused and the engine's animation frames are
// stepped by hand with synthetic timestamps `step` ms apart, so the presentation (ragdoll, flinch) advances
// exactly that much per screenshot however slow software WebGL is.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';

const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback;};
const out = path.resolve(arg('out', 'research/death-strip')), base = arg('base', 'http://127.0.0.1:5177');
const mode = arg('mode', 'death'), weapon = arg('weapon', 'ak47'), aim = arg('aim', 'chest');
const distance = Number(arg('distance', '4')), frames = Number(arg('frames', '24')), step = Number(arg('step', '100'));
// --face player|side|away: which way the bot faces relative to you (side shows the fall in profile).
const face = arg('face', 'player');
fs.mkdirSync(out, {recursive: true});

const browser = await chromium.launch({channel: 'chromium'});
const page = await browser.newPage({viewport: {width: 1200, height: 750}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(weapon => {
  localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon, quality: 'performance', volume: 0, protectShortcuts: false}));
  localStorage.setItem('spraylab.deathmatch.v1', JSON.stringify({botCount: 1, skill: 1, respawnSeconds: 10, infiniteAmmo: 'magazine'}));
}, weapon);
await page.goto(base);
const select = page.getByLabel('Training mode');
if (!await select.isVisible()) {
  const play = page.getByRole('button', {name: 'Play', exact: true});
  if (await play.isVisible()) await play.click();
}
await select.selectOption('deathmatch');
await page.getByRole('button', {name: 'Enter deathmatch'}).waitFor({timeout: 180000});
await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts')).name;
  const {DuelEngine} = await import(/* @vite-ignore */ url);
  const original = DuelEngine.prototype.tick;
  DuelEngine.prototype.tick = function(time) {window.dmEngine = this; return original.call(this, time);};
});
await page.waitForFunction(() => window.dmEngine?.sim?.deathmatch === true);
await page.getByRole('button', {name: 'Enter deathmatch'}).click();
await page.getByRole('button', {name: 'Pause deathmatch'}).waitFor();
await page.waitForFunction(() => window.dmEngine.models.size >= 1, undefined, {timeout: 120000});
// Stand the bot on a floor spot in view at the requested distance, facing the player, and take it over.
const placed = await page.evaluate(async ({distance, face}) => {
  const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/geometry.ts')).name;
  const {traceSolid} = await import(/* @vite-ignore */ url);
  const sim = window.dmEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
  const sees = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    return !Number.isFinite(traceSolid(from, {x: dx / length, y: dy / length, z: dz / length}, sim.arena, length - .05).distance);
  };
  const spots = sim.arena.workshop.spots.filter(([x, feet, z]) => feet < .05 && sees(eye, {x, y: feet + 1.6256, z}))
    .map(spot => ({spot, error: Math.abs(Math.hypot(spot[0] - eye.x, spot[2] - eye.z) - distance)})).sort((a, b) => a.error - b.error);
  if (!spots.length) return null;
  const [x, feet, z] = spots[0].spot;
  const turn = face === 'side' ? Math.PI / 2 : face === 'away' ? Math.PI : 0;
  Object.assign(bot, {position: {x, y: feet + 1.6256, z}, feet, grounded: true, velocity: {x: 0, z: 0}, yaw: Math.atan2(-(eye.x - x), -(eye.z - z)) + turn});
  sim.command(1, {forward: 0, side: 0, fireHeld: false, firePressed: false});
  sim.actors[0].weapon.options = {...sim.actors[0].weapon.options, spread: false};
  return {x, feet, z, range: Math.hypot(x - eye.x, z - eye.z)};
}, {distance, face});
if (!placed) throw new Error('No visible floor spot for the bot');
await page.waitForTimeout(1000);
const aimAt = async target => page.evaluate(({target}) => {
  const sim = window.dmEngine.sim, eye = sim.actors[0].position, bot = sim.actors[1];
  const dx = bot.position.x - eye.x, dy = bot.feet + (target === 'head' ? 1.62 : 1.15) - eye.y, dz = bot.position.z - eye.z;
  sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
}, {target});
const state = () => page.evaluate(() => {
  const sim = window.dmEngine.sim, bot = sim.actors[1];
  return {time: sim.time, alive: bot.alive, health: bot.health, generation: bot.generation};
});
// Pausing the engine opens the setup menu over the view, so only the simulation is paused and the HUD is hidden.
const hideHud = () => page.addStyleTag({content: '.probe-hide * {visibility: hidden !important} .probe-hide canvas[data-duel] {visibility: visible !important}'})
  .then(() => page.evaluate(() => document.body.classList.add('probe-hide')));
// Take over the animation loop: every stepFrame(ms) runs exactly one engine tick `ms` later on its clock.
const takeOverFrames = () => page.evaluate(() => {
  const engine = window.dmEngine;
  cancelAnimationFrame(engine.frame);
  let pending = null, clock = performance.now();
  window.requestAnimationFrame = callback => {pending = callback; return 1;};
  window.stepFrame = ms => {clock += ms; const callback = pending; pending = null; if (callback) callback(clock); else engine.tick(clock); return clock;};
  engine.tick(clock);
});
const stepFrame = ms => page.evaluate(ms => window.stepFrame(ms), ms);
const clip = {x: 330, y: 90, width: 540, height: 560};
const log = [];
const shoot = async () => page.evaluate(() => {
  const sim = window.dmEngine.sim;
  sim.command(0, {firePressed: true, fireHeld: true}); sim.stepEarly(); sim.command(0, {fireHeld: false, firePressed: false});
});
const capture = async (file, extra) => {
  const s = await state();
  await page.screenshot({path: path.join(out, file), clip});
  log.push({file, ...extra, ...s});
};
await aimAt(aim);
if (mode === 'death') {
  // One lethal shot, and the simulation pauses in the same call, so frame 0 is the moment of death.
  await hideHud(); await takeOverFrames();
  const killed = await page.evaluate(() => {
    const sim = window.dmEngine.sim, bot = sim.actors[1]; bot.health = 1; bot.armor = 0;
    sim.command(0, {firePressed: true, fireHeld: true}); sim.stepEarly(); sim.command(0, {fireHeld: false, firePressed: false});
    sim.pause(); return !bot.alive;
  });
  if (!killed) throw new Error('The shot did not kill the bot');
  for (let i = 0; i < frames; i++) {
    await capture(`death-${String(i).padStart(2, '0')}.png`, {age: i * step / 1000});
    await stepFrame(step);
    if (process.argv.includes('--debug')) console.log(await page.evaluate(age => {
      const rag = window.dmEngine.animators.get(1)?.dynamicDeath; if (!rag) return 'no ragdoll';
      const h = name => rag.point(name)?.y.toFixed(2);
      const s = rag.stats, f = v => Number(v.toFixed(3));
      // Displacement along the shot (positive = away from you), from the bot's spawn point.
      const eye = window.dmEngine.sim.actors[0].position, bot = window.dmEngine.sim.actors[1].position;
      const dx = bot.x - eye.x, dz = bot.z - eye.z, len = Math.hypot(dx, dz);
      const away = name => {const q = rag.point(name); return q ? (((q.x - bot.x) * dx + (q.z - bot.z) * dz) / len).toFixed(2) : '?';};
      return `${age.toFixed(1)}s speed ${f(s.speed)} links ${f(s.links)} struts ${f(s.struts)} pairs ${f(s.pairs)} contacts ${f(s.contacts)} | y pelvis ${h('pelvis')} chest ${h('spine_2')} head ${h('head_0')} kneeL ${h('leg_lower_L')} ankL ${h('ankle_L')} | away pelvis ${away('pelvis')} head ${away('head_0')} ankL ${away('ankle_L')} sleeping ${rag.sleeping}`;
    }, (i + 1) * step / 1000));
  }
} else {
  await page.evaluate(() => {const bot = window.dmEngine.sim.actors[1]; bot.health = 100000; bot.armor = 0;});
  await hideHud(); await takeOverFrames();
  const perShot = Math.max(1, Math.round(frames / 3));
  console.log('flinch pack:', await page.evaluate(() => {
    const engine = window.dmEngine, animator = engine.animators.get(1);
    return {clips: engine.flinchClips?.length, actions: animator ? [...animator.actions.keys()].filter(k => k.startsWith('flinch_')).length : null};
  }));
  for (let shot = 0; shot < 3; shot++) {
    await page.evaluate(() => window.dmEngine.sim.resume());
    await aimAt(aim); await shoot();
    await page.evaluate(() => window.dmEngine.sim.pause());
    await stepFrame(1);
    console.log('after shot', shot, await page.evaluate(() => {
      const engine = window.dmEngine, animator = engine.animators.get(1), bot = engine.sim.actors[1];
      return {health: bot.health, flinching: animator?.flinching, flinches: animator?.flinches?.map(f => f.key), events: engine.sim.events?.length};
    }));
    for (let i = 0; i < perShot; i++) {
      await stepFrame(step);
      if (process.argv.includes('--debug')) console.log(await page.evaluate(() => {
        const engine = window.dmEngine, animator = engine.animators.get(1), root = engine.models.get(1);
        const q = name => root.getObjectByName(name)?.quaternion.toArray().map(v => v.toFixed(3)).join(',');
        const entry = animator?.flinches?.[0], action = entry && animator.actions.get(entry.key);
        return {elapsed: entry?.elapsed?.toFixed(3), weight: action?.getEffectiveWeight(), time: action?.time?.toFixed(3), running: action?.isRunning(),
          enabled: action?.enabled, tracks: action?.getClip().tracks.length, blend: action?.blendMode, spine_2: q('spine_2'), head: q('head_0'), arm: q('arm_upper_L')};
      }));
      await capture(`flinch-${shot}-${String(i).padStart(2, '0')}.png`, {shot, age: (i + 1) * step / 1000});
    }
  }
}
fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify({mode, weapon, aim, placed, errors, frames: log}, null, 2));
console.log(`${log.length} frames in ${out}; bot at ${placed.range.toFixed(2)} m; errors: ${errors.length}`);
await browser.close();
