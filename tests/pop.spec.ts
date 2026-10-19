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
  await page.getByLabel('Chance a ball moves').fill('100');
  await page.getByLabel('Peek wall').selectOption('left');
  await page.getByRole('button', {name: 'White background'}).click();
  await expect(page.getByLabel('Background color', {exact: true})).toHaveValue('#f0f0ec');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!(window as any).popEngine?.sim?.pop?.wall);
  const walled = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, backdrop = engine.pop.getObjectByName('pop-backdrop');
    sim.yaw = 0; sim.pitch = 0;   // straight ahead from the spawn: into the wall
    sim.start(); sim.release('mouse');
    return {blocked: {shots: sim.pop.shots, hits: sim.pop.hits, caption: engine.hitCaption.textContent}, hits: sim.pop.config.hits, respawn: sim.pop.config.respawn, moveX: sim.pop.config.x, chance: sim.pop.config.moveChance, moving: sim.pop.balls.every((b: {vx: number}) => Math.abs(b.vx) === 2),
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
  expect(walled.hits).toBe(3); expect(walled.respawn).toBe(1.5); expect(walled.moveX).toEqual({speed: 2, range: 1.5, flips: 1}); expect(walled.moving).toBe(true); expect(walled.chance).toBe(1); expect(walled.wall).toBe(true); expect(walled.background).toBe('f0f0ec'); expect(walled.benches).toBe(false);
  expect(walled.spawn.x).toBeCloseTo(1.15, 5); expect(walled.spawn.z).toBe(2);   // centred behind the 3 m wall
  expect(walled.blocked).toEqual({shots: 1, hits: 0, caption: 'MISS'});
  expect(struck).toEqual({shots: 2, hits: 1, pops: 0, ballHits: 1, caption: 'HIT'});
  // The respawn pad: a sized, coloured rectangle on the floor behind the wall that plays its trigger sound as the balls come back.
  await page.keyboard.press('Escape');
  await page.getByLabel('Hits to pop').fill('1');
  await page.getByLabel('Left-right speed').fill('0');
  await expect(page.getByLabel('Pad width')).toBeHidden();
  await page.getByLabel('Ball respawn', {exact: true}).selectOption('pad');
  await expect(page.getByLabel('Ball respawn delay')).toBeHidden();
  await page.getByLabel('Pad width').fill('2');
  await page.getByLabel('Pad depth').fill('0.6');
  await page.getByRole('button', {name: 'Yellow pad'}).click();
  await expect(page.getByLabel('Pad color', {exact: true})).toHaveValue('#ffd23f');
  await expect(page.getByLabel('Pad trigger sound')).toHaveValue('chime');
  await page.getByLabel('Pad trigger sound').selectOption('pop');
  await expect(page.locator('.sl-ready small')).toContainText('respawn on the 2 x 0.6 m pad');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => (window as any).popEngine?.sim?.pop?.config.respawnMode === 'pad' && !!(window as any).popEngine.pop.getObjectByName('pop-pad'));
  const padBefore = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, pad = engine.pop.getObjectByName('pop-pad');
    const calls: [string, number][] = []; (window as any).padCalls = calls;
    engine.audio.playPadSound = (kind: string, volume: number) => {calls.push([kind, volume]); return true;};
    const ball = sim.pop.balls[0];
    sim.position.x = -1;          // stepped out past the wall's edge, off the pad
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse');
    return {geometry: pad.geometry.parameters, edge: !!pad.getObjectByName('pop-pad-edge'), color: pad.material.color.getHexString(),
      pad: sim.pop.pad, position: {x: pad.position.x, z: pad.position.z}, pops: sim.pop.pops, pending: sim.pop.pending.length, balls: sim.pop.balls.length};
  });
  expect(padBefore.geometry).toMatchObject({width: 2, height: .6}); expect(padBefore.edge).toBe(true); expect(padBefore.color).toBe('ffd23f');
  expect(padBefore.pad).toEqual({x: 1.15, z: 2, halfW: 1, halfD: .3}); expect(padBefore.position).toEqual({x: 1.15, z: 2});
  expect(padBefore).toMatchObject({pops: 1, pending: 1, balls: 3});
  await page.waitForFunction(() => (window as any).popEngine.pop.getObjectByName('pop-pad').material.opacity >= .85);   // lit while a ball waits
  await page.evaluate(() => {(window as any).popEngine.sim.position.x = 1.15;});   // back onto the pad
  await page.waitForFunction(() => (window as any).padCalls.length > 0);
  const padAfter = await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, pad = engine.pop.getObjectByName('pop-pad');
    // Software rendering runs frames 100+ ms apart, so the 0.4 s flash may be over by now: check when it started instead.
    return {calls: (window as any).padCalls, pending: sim.pop.pending.length, balls: sim.pop.balls.length, sinceFlash: engine.elapsed - engine.popPadFlashAt,
      color: pad.material.color.getHexString(), edgeColor: pad.children[0].material.color.getHexString()};
  });
  expect(padAfter.calls).toHaveLength(1); expect(padAfter.calls[0][0]).toBe('pop'); expect(padAfter.calls[0][1]).toBeCloseTo(.2, 6);
  expect(padAfter).toMatchObject({pending: 0, balls: 4, color: 'ffd23f', edgeColor: 'ffd23f'});
  expect(padAfter.sinceFlash).toBeGreaterThanOrEqual(0); expect(padAfter.sinceFlash).toBeLessThan(5);
  await page.evaluate(() => {const sim = (window as any).popEngine.sim; sim.position.x = 1.15; sim.position.z = 3.3; sim.yaw = 0; sim.pitch = -.95;});
  await page.waitForTimeout(600);   // the flash fades; the pad settles to its idle look
  await page.screenshot({path: info.outputPath('pop-pad.png')});
  expect(await page.evaluate(() => (window as any).popEngine.pop.getObjectByName('pop-pad').material.opacity)).toBeCloseTo(.3, 6);
  // The master volume in the top bar is the same level as the Audio setting.
  await page.keyboard.press('Escape');
  const slider = page.getByLabel('Master volume');
  await expect(slider).toHaveValue('20');
  await slider.focus(); await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('19');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).volume)).toBeCloseTo(.19, 6);
  expect(errors).toEqual([]);
});

test('pop: wallbang sends bullets through the peek wall, shows the balls it hides and says when the wall swallowed a shot', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop range smoke test');
  test.setTimeout(180000);
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'pop', weapon: 'ak47', quality: 'auto', spread: false,
      popCount: 3, popSize: 40, popSpacing: 1, popDistance: 10, popWall: 'left'}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'pop');
  // The wall is solid until the switch is on; the material and the x-ray only show with it.
  await expect(page.getByLabel('Wallbang through the wall')).not.toBeChecked();
  await expect(page.getByLabel('Wall material')).toBeHidden();
  await expect(page.getByLabel('See balls through the wall')).toBeHidden();
  await page.getByLabel('Wallbang through the wall').check();
  await expect(page.getByLabel('Wall material')).toHaveValue('wood');
  await expect(page.getByLabel('See balls through the wall')).toBeChecked();
  await expect(page.locator('.sl-ready small')).toContainText('peek wall, left, 3 m, wallbang (wood)');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await popEngine(page);
  await page.waitForFunction(() => (window as any).popEngine.sim.pop.config.wallbang === true && !!(window as any).popEngine.pop.getObjectByName('pop-wall'));
  /** Hangs one ball 10 m straight ahead, hidden by the wall, and taps once from behind the wall's centre. */
  const tap = () => page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, pop = sim.pop;
    sim.position.x = 1.15; sim.position.z = 2; sim.yaw = 0; sim.pitch = 0;
    pop.balls = [{id: 9000 + pop.shots, x: 1.15, y: sim.position.y, z: sim.position.z - 10, radius: .2, hits: 0, vx: 0, vy: 0}];
    sim.start(); sim.release('mouse');
    return {shots: pop.shots, hits: pop.hits, pops: pop.pops, balls: pop.balls.length, caption: engine.hitCaption.textContent};
  });
  // Wood: the AK's bullet comes out the far side and pops the ball the wall hides.
  await page.waitForTimeout(400);
  expect(await tap()).toEqual({shots: 1, hits: 1, pops: 1, balls: 1, caption: 'WALLBANG POP'});
  // The wall keeps its usual look (the material only decides the penetration), and the hidden ball shows through it as a faint ghost.
  await page.waitForFunction(() => !!(window as any).popEngine.pop.getObjectByName('pop-ball-ghost'));
  const wallLook = () => page.evaluate(() => {
    const material = (window as any).popEngine.pop.getObjectByName('pop-wall').material;
    return {color: material.color.getHexString(), emissive: material.emissive.getHexString(), map: material.map?.uuid, normalMap: material.normalMap?.uuid};
  });
  const look = await wallLook();
  expect(look).toMatchObject({color: '8a949a', emissive: '30363e'}); expect(look.map).toBeTruthy();
  const wood = await page.evaluate(() => {
    const engine = (window as any).popEngine, ghost = engine.pop.getObjectByName('pop-ball-ghost');
    return {ghosts: engine.pop.children.filter((child: any) => child.children.some((c: any) => c.name === 'pop-ball-ghost')).length,
      depthFunc: ghost.material.depthFunc, transparent: ghost.material.transparent, ghostColor: ghost.material.color.getHexString(), ballColor: engine.popMaterial.color.getHexString()};
  });
  expect(wood).toMatchObject({ghosts: 1, transparent: true});
  expect(wood.depthFunc).toBe(6); expect(wood.ghostColor).toBe(wood.ballColor);   // THREE.GreaterDepth: only where something nearer hides it
  await page.waitForTimeout(600);
  await page.screenshot({path: info.outputPath('pop-wallbang-wood.png')});
  // A ball half hidden by the wall's edge: the visible half is the ball, the hidden half the ghost, with no seam or overlay on the visible part.
  await page.evaluate(() => {
    const engine = (window as any).popEngine, sim = engine.sim, ball = sim.pop.balls[0];
    sim.position.x = .3; sim.position.z = 2; Object.assign(ball, {x: -4.7, y: sim.position.y, z: -8, radius: .5});
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  });
  await page.waitForTimeout(600);
  await page.screenshot({path: info.outputPath('pop-wallbang-edge.png')});
  // Concrete that thick stops the AK: the shot reads BLOCKED and the ball stays up.
  await page.keyboard.press('Escape');
  await page.getByLabel('Wall material').selectOption('concrete');
  await expect(page.locator('.sl-ready small')).toContainText('wallbang (concrete)');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => (window as any).popEngine.sim.pop.config.wallMaterial === 'concrete');
  await page.waitForTimeout(400);
  expect(await tap()).toEqual({shots: 1, hits: 0, pops: 0, balls: 1, caption: 'BLOCKED'});
  expect(await wallLook()).toEqual(look);   // concrete looks exactly like wood
  // Turning the x-ray off takes the ghosts away without restarting the session.
  await page.keyboard.press('Escape');
  await page.getByLabel('See balls through the wall').uncheck();
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !(window as any).popEngine.pop.getObjectByName('pop-ball-ghost'));
  expect(await page.evaluate(() => (window as any).popEngine.sim.pop.shots)).toBe(1);
  // Wallbang off: the wall is solid again, whatever the material, and shots into it read MISS.
  await page.keyboard.press('Escape');
  await page.getByLabel('Wallbang through the wall').uncheck();
  await expect(page.getByLabel('Wall material')).toBeHidden();
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => (window as any).popEngine.sim.pop.config.wallbang === false);
  await page.waitForTimeout(400);
  expect(await tap()).toEqual({shots: 1, hits: 0, pops: 0, balls: 1, caption: 'MISS'});
  expect(await wallLook()).toEqual(look);   // and so does the solid wall
  expect(errors).toEqual([]);
});
