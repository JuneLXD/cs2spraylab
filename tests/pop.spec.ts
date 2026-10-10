import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

/** Exposes the running RangeEngine as window.popEngine once Pop is the active drill. */
async function popEngine(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).popEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).popEngine?.sim?.pop);
}

test('pop: the balls follow the setup, a shot pops the ball it crosses and a new one takes its place', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop range smoke test');
  test.setTimeout(180000);
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'pop', weapon: 'ak47', quality: 'auto', spread: false,
      popCount: 4, popSize: 40, popSpacing: 1, popDistance: 10}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'pop');
  await expect(page.getByLabel('Ball size')).toHaveValue('40');
  await expect(page.getByLabel('Balls at once')).toHaveValue('4');
  await expect(page.getByLabel('Distance to the balls')).toHaveValue('10');
  await expect(page.getByLabel('Ammo mode')).toHaveValue('magazine');
  await expect(page.getByLabel('Hit sound')).toHaveValue('hitmarker');
  await page.getByRole('button', {name: 'Cyan balls'}).click();
  await expect(page.getByLabel('Ball color', {exact: true})).toHaveValue('#4df3ff');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await popEngine(page);
  const before = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, balls = sim.pop.balls as {id: number; x: number; y: number; z: number}[];
    return {ids: balls.map(ball => ball.id), count: balls.length, distance: sim.position.z - balls[0].z, color: engine.popMaterial.color.getHexString(),
      spaced: balls.every((a, i) => balls.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.4 - 1e-6)),
      meshes: engine.pop.children.filter((child: {name: string}) => child.name.startsWith('pop-ball-')).length};
  });
  expect(before.count).toBe(4); expect(before.distance).toBeCloseTo(10, 5); expect(before.spaced).toBe(true);
  expect(before.color).toBe('4df3ff'); expect(before.meshes).toBe(4);
  // Aim at the first ball's centre and tap once with spread off.
  await page.evaluate(() => {
    const sim = (window as any).popEngine.sim, ball = sim.pop.balls[0];
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
  });
  await expect(page.getByTestId('accuracy')).toHaveText('100%', {timeout: 10000});
  const after = await page.evaluate(() => {
    const sim = (window as any).popEngine.sim;
    return {pops: sim.pop.pops, shots: sim.pop.shots, count: sim.pop.balls.length, ids: sim.pop.balls.map((ball: {id: number}) => ball.id), ammo: sim.loadedAmmo};
  });
  expect(after).toMatchObject({pops: 1, shots: 1, count: 4, ammo: 30});
  expect(after.ids).not.toContain(before.ids[0]);
  await expect(page.locator('.hit-caption')).toHaveText('POP');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeVisible();
  // Pop-only options: no gunshot, no miss marks, no HUD.
  for (const label of ['Mute gun sound', 'Hide bullet impacts', 'Hide HUD']) await page.getByLabel(label, {exact: true}).check();
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await expect(page.locator('.range-hud')).toBeHidden();
  await expect(page.locator('.sl-hud-hidden')).toHaveCount(1);
  const quiet = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim;
    let played = 0; engine.audio.play = () => {played++;};
    sim.yaw = Math.PI / 2; sim.pitch = -.3;   // off the wall: a miss
    sim.start(); sim.release('mouse');
    return {played, shots: sim.pop.shots, pops: sim.pop.pops, clouds: engine.impactClouds?.size ?? 0, caption: engine.hitCaption.textContent};
  });
  expect(quiet).toEqual({played: 0, shots: 2, pops: 1, clouds: 0, caption: 'MISS'});
  // Hits to pop, the peek wall and the background colour.
  await page.keyboard.press('Escape');
  await page.getByLabel('Hits to pop').fill('3');
  await page.getByLabel('Ball respawn delay').fill('1.5');
  await page.getByLabel('Left-right speed').fill('2');
  await page.getByLabel('Left-right direction changes').fill('1');
  await page.getByLabel('Peek wall').selectOption('left');
  await page.getByRole('button', {name: 'White background'}).click();
  await expect(page.getByLabel('Background color', {exact: true})).toHaveValue('#f0f0ec');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!(window as any).popEngine?.sim?.pop?.wall);
  const walled = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, backdrop = engine.pop.getObjectByName('pop-backdrop');
    sim.yaw = 0; sim.pitch = 0;   // straight ahead from the spawn: into the wall
    sim.start(); sim.release('mouse');
    return {blocked: {shots: sim.pop.shots, hits: sim.pop.hits, caption: engine.hitCaption.textContent}, hits: sim.pop.config.hits, respawn: sim.pop.config.respawn, moveX: sim.pop.config.x, moving: sim.pop.balls.every((b: {vx: number}) => Math.abs(b.vx) === 2),
      wall: !!engine.pop.getObjectByName('pop-wall'), spawn: {...sim.position}, background: backdrop.material.color.getHexString(),
      benches: engine.scene.getObjectByName('range-benches').visible};
  });
  await page.waitForTimeout(400);   // the AK's cycle, so the next tap fires at once
  const struck = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, ball = sim.pop.balls[0];
    sim.position.x = -1;          // stepped out to the left: the balls are ahead
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
    return {shots: sim.pop.shots, hits: sim.pop.hits, pops: sim.pop.pops, ballHits: sim.pop.balls.find((b: {id: number}) => b.id === ball.id)?.hits, caption: engine.hitCaption.textContent};
  });
  expect(walled.hits).toBe(3); expect(walled.respawn).toBe(1.5); expect(walled.moveX).toEqual({speed: 2, range: 1.5, flips: 1}); expect(walled.moving).toBe(true); expect(walled.wall).toBe(true); expect(walled.background).toBe('f0f0ec'); expect(walled.benches).toBe(false);
  expect(walled.spawn.x).toBe(0); expect(walled.spawn.z).toBe(2);
  expect(walled.blocked).toEqual({shots: 1, hits: 0, caption: 'MISS'});
  expect(struck).toEqual({shots: 2, hits: 1, pops: 0, ballHits: 1, caption: 'HIT'});
  // The master volume in the top bar is the same level as the Audio setting.
  await page.keyboard.press('Escape');
  const slider = page.getByLabel('Master volume');
  await expect(slider).toHaveValue('20');
  await slider.focus(); await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('19');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).volume)).toBeCloseTo(.19, 6);
  expect(errors).toEqual([]);
});
