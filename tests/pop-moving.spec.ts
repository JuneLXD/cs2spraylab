import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';

for (const [variant, name] of [['floatingheads', 'Floating Heads'], ['pasu', 'Pasu Micro'], ['driftts', 'DriftTS']] as const) {
  test(`${name}: continuous moving spheres, scoring, pause and saved controls`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium', 'Desktop WebGL check'); test.setTimeout(180000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
        mode: 'pop', weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
        pop3D: true, autoFullscreen: false, protectShortcuts: false, volume: 0,
      }));
    });
    await page.goto('/'); await selectDrill(page, 'pop');
    await page.getByLabel('Pop mode', {exact: true}).selectOption(variant);
    await expect(page.getByLabel('Moving targets', {exact: true})).toHaveValue('3');
    await expect(page.getByLabel('Center radius', {exact: true})).toHaveValue('1');
    await page.getByLabel('Target size', {exact: true}).fill('20');
    if (variant === 'driftts') await expect(page.getByLabel('Hold time', {exact: true})).toHaveValue('200');
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
      const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
      RangeEngine.prototype.tick = function(time: number) {(window as any).movingEngine = this; tick.call(this, time);};
    });
    await page.waitForFunction(() => !!(window as any).movingEngine?.sim.pop);
    await page.getByRole('button', {name: 'Enter range', exact: true}).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    const sampled = await page.evaluate(async () => {
      const engine = (window as any).movingEngine, sim = engine.sim, began = sim.time;
      const initial = sim.pop.balls.map((ball: any) => ({...ball, mesh: engine.pop.getObjectByName(`pop-ball-${ball.id}`).uuid}));
      const frames: any[] = [];
      while (sim.time < began + 1.4) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        frames.push({time: sim.time, balls: sim.pop.balls.map((ball: any) => {
          const mesh = engine.pop.getObjectByName(`pop-ball-${ball.id}`);
          return {...ball, mesh: mesh.uuid, xRendered: mesh.position.x, yRendered: mesh.position.y, visible: mesh.visible};
        })});
      }
      return {began, initial, frames, center: {x: sim.pop.region.x, y: sim.pop.region.y}};
    });
    let previous = {time: sampled.began, balls: sampled.initial};
    for (const frame of sampled.frames) {
      expect(frame.balls).toHaveLength(3);
      frame.balls.forEach((ball: any, i: number) => {
        expect(ball.mesh).toBe(sampled.initial[i].mesh); expect(ball.visible).toBe(true);
        expect(ball.xRendered).toBeCloseTo(ball.x, 8); expect(ball.yRendered).toBeCloseTo(ball.y, 8);
        expect(Math.hypot(ball.x - sampled.center.x, ball.y - sampled.center.y)).toBeLessThanOrEqual(1 + 1e-8);
        const elapsed = frame.time - previous.time;
        expect(Math.hypot(ball.x - previous.balls[i].x, ball.y - previous.balls[i].y)).toBeLessThanOrEqual(elapsed * .7 + .00001);
      });
      previous = frame;
    }
    expect(previous.balls.some((ball: any, i: number) => Math.hypot(ball.x - sampled.initial[i].x, ball.y - sampled.initial[i].y) > .05)).toBe(true);
    await page.screenshot({path: info.outputPath(`${variant}-moving.png`)});

    if (variant === 'driftts') {
      await page.evaluate(() => {
        (window as any).followMovingDot = true;
        const aim = () => {
          if (!(window as any).followMovingDot) return;
          const sim = (window as any).movingEngine.sim, ball = sim.pop.balls[0];
          const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
          sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
          requestAnimationFrame(aim);
        };
        aim();
      });
      await page.mouse.down();
      await page.waitForFunction(() => (window as any).movingEngine.sim.pop.pops >= 3, null, {timeout: 20000});
      await page.mouse.up();
      const stopped = await page.evaluate(() => {
        (window as any).followMovingDot = false;
        const sim = (window as any).movingEngine.sim; sim.yaw = sim.pitch = 0;
        return {held: sim.pop.heldSeconds, ammo: sim.loadedAmmo, shots: sim.pop.shots, pops: sim.pop.pops};
      });
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => (window as any).movingEngine.sim.pop.heldSeconds)).toBe(stopped.held);
      expect(stopped.ammo).toBe(30); expect(stopped.shots).toBe(0);
      await expect(page.getByTestId('pop-hold-cue')).toBeVisible();
    } else {
      for (let i = 0; i < 3; i++) {
        const hit = await page.evaluate(() => {
          const sim = (window as any).movingEngine.sim, ball = sim.pop.balls[0], before = sim.pop.pops;
          sim.resetRecovery();
          const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
          sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
          sim.pressTrigger(); sim.release('mouse'); sim.yaw = sim.pitch = 0;
          return {before, after: sim.pop.pops, count: sim.pop.balls.length};
        });
        expect(hit.after).toBe(hit.before + 1); expect(hit.count).toBe(3);
        await page.waitForTimeout(350);
      }
    }
    await page.screenshot({path: info.outputPath(`${variant}-scored.png`)});
    await page.keyboard.press('Escape');
    const paused = await page.evaluate(() => (window as any).movingEngine.sim.pop.balls);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).movingEngine.sim.pop.balls)).toEqual(paused);
    if (variant === 'driftts') expect(await page.evaluate(() => (window as any).movingEngine.sim.latest.pokeball.variant)).toBe('driftts');
    await page.getByLabel('Moving targets', {exact: true}).fill('4');
    await page.getByLabel('Target speed', {exact: true}).fill('0.9');
    await page.getByLabel('Center radius', {exact: true}).fill('0.8');
    const special = variant === 'floatingheads' ? 'Vertical bob' : 'Direction changes', value = variant === 'floatingheads' ? '8' : '1.8';
    await page.getByLabel(special, {exact: true}).fill(value);
    await page.waitForFunction(() => (window as any).movingEngine.sim.pop.balls.length === 4);
    await page.getByLabel('Preset name').fill(name + ' practice');
    await page.getByRole('button', {name: 'Save preset', exact: true}).click();
    const saved = await page.getByLabel('Pop preset', {exact: true}).inputValue();
    await page.getByLabel('Pop mode', {exact: true}).selectOption('classic');
    await page.getByLabel('Pop preset', {exact: true}).selectOption(saved);
    await page.reload(); await selectDrill(page, 'pop');
    await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue(variant);
    await expect(page.getByLabel('Moving targets', {exact: true})).toHaveValue('4');
    await expect(page.getByLabel('Target speed', {exact: true})).toHaveValue('0.9');
    await expect(page.getByLabel('Center radius', {exact: true})).toHaveValue('0.8');
    await expect(page.getByLabel(special, {exact: true})).toHaveValue(value);
    await expect(page.getByRole('switch', {name: '3D balls', exact: true})).toBeChecked();
    expect(errors).toEqual([]);
  });
}
