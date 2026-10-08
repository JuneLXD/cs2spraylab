import {expect, test} from '@playwright/test';

test('native head capsules follow rendered crouch/turn poses and real clicks use the displayed life', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'performance', frameLimit: 0,
      volume: 0, spread: false, resolution: '1920x1440', protectShortcuts: false}));
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, skill: 1, shortcutProtection: false}));
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).hitboxEngine = this; return tick.call(this, time);};
  });
  await page.waitForFunction(() => {
    const e = (window as any).hitboxEngine; return e?.motionReady && e.worldLoading.size === 0 && e.hitboxPoses.has(1);
  });
  await page.evaluate(() => {
    const e = (window as any).hitboxEngine; cancelAnimationFrame(e.frame);
    e.inputClock.advance = () => {}; e.sim.start(); e.paused = false;
    e.sim.arena.solids = []; e.covers.visible = false; e.sim.command(1, {});
    e.fixtureHits = []; const emit = e.sim.emit;
    e.sim.emit = function(event: any) {if (event.kind === 'hit') e.fixtureHits.push(event); return emit.call(this, event);};
    e.report(); e.renderer.domElement.focus();
  });
  const heights: number[] = [], canvas = page.locator('canvas[data-duel]'), box = (await canvas.boundingBox())!;
  for (const duck of [0, .5, 1]) {
    const pose = await page.evaluate(async duck => {
      const e = (window as any).hitboxEngine, player = e.sim.actors[0], bot = e.sim.actors[1];
      const path = '/src/range/duel/weapon-state.ts', module = await import(/* @vite-ignore */ path);
      player.weapon = new module.DuelWeaponState('ak47', () => 0, {spread: false});
      player.position = {x: 0, y: 1.6256, z: 4}; player.yaw = 0; player.pitch = 0;
      bot.position = {x: 0, y: 1.6256, z: -4}; bot.feet = 0; bot.duckAmount = duck; bot.crouched = duck > .5;
      bot.yaw = Math.PI + duck; bot.velocity = {x: 1, z: 0}; bot.health = 500; bot.armor = 0;
      e.sim.history = []; e.animationTimes.clear();
      e.tick(Math.max(performance.now(), e.last) + 250); cancelAnimationFrame(e.frame);
      const shown = e.sim.displayed[1], head = shown.hitboxes.find((h: any) => h.group === 'head');
      const target = {x: (head.start.x + head.end.x) / 2, y: (head.start.y + head.end.y) / 2, z: (head.start.z + head.end.z) / 2};
      const dx = target.x - player.position.x, dy = target.y - player.position.y, dz = target.z - player.position.z;
      player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // The next simulation position differs from the last displayed skeleton.
      bot.position.x = 2;
      return {count: shown.hitboxes.length, height: target.y, radius: head.radius, head: JSON.stringify(head)};
    }, duck);
    expect(pose.count).toBe(19); expect(pose.radius).toBeCloseTo(4.3 * .0254, 5); heights.push(pose.height);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const shot = await page.evaluate(() => {
      const e = (window as any).hitboxEngine;
      return {hit: e.fixtureHits.at(-1), health: e.sim.actors[1].health,
        head: JSON.stringify(e.sim.displayed[1].hitboxes.find((h: any) => h.group === 'head'))};
    });
    expect(shot.hit).toMatchObject({victim: 1, group: 'head', armorDamage: 0});
    expect(shot.health).toBeLessThan(370); expect(shot.head).toBe(pose.head);
  }
  expect(heights[0] - heights[2]).toBeGreaterThan(.2);
  expect(errors).toEqual([]);
});
