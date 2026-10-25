import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';

test('3D balls: switch appearance without resetting targets and save it in presets', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL appearance check');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', popVariant: 'classic', popSize: 60, popDistance: 8, popCount: 3, popHits: 2,
      weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
      autoFullscreen: false, protectShortcuts: false, volume: 0,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  await expect(page.getByRole('switch', {name: '3D balls', exact: true})).not.toBeChecked();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).appearanceEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).appearanceEngine?.sim.pop);
  const before = await page.evaluate(() => {
    const engine = (window as any).appearanceEngine; (window as any).appearanceField = engine.sim.pop;
    return engine.sim.pop.balls.map((ball: any) => ({...ball}));
  });
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.screenshot({path: info.outputPath('glow-balls.png')});
  await page.keyboard.press('Escape');
  await page.getByRole('switch', {name: '3D balls', exact: true}).check();
  await page.waitForFunction(() => {
    const engine = (window as any).appearanceEngine, ball = engine.sim.pop.balls[0];
    return engine.pop.getObjectByName(`pop-ball-${ball.id}`).material.type === 'MeshMatcapMaterial';
  });
  expect(await page.evaluate(() => (window as any).appearanceEngine.sim.pop === (window as any).appearanceField)).toBe(true);
  expect(await page.evaluate(() => (window as any).appearanceEngine.sim.pop.balls)).toEqual(before);
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.screenshot({path: info.outputPath('3d-balls.png')});
  await page.evaluate(() => {
    const sim = (window as any).appearanceEngine.sim, ball = sim.pop.balls[0];
    sim.resetRecovery();
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    sim.start(); sim.release('mouse'); sim.yaw = sim.pitch = 0;
  });
  await page.waitForFunction(() => {
    const engine = (window as any).appearanceEngine, ball = engine.sim.pop.balls[0], material = engine.pop.getObjectByName(`pop-ball-${ball.id}`).material;
    return ball.hits === 1 && material.type === 'MeshMatcapMaterial' && material.color.r < engine.popSphereMaterial.color.r;
  });
  await page.keyboard.press('Escape');
  await page.getByLabel('Preset name').fill('3D spheres');
  await page.getByRole('button', {name: 'Save preset', exact: true}).click();
  const saved = await page.getByLabel('Pop preset', {exact: true}).inputValue();
  await page.getByRole('switch', {name: '3D balls', exact: true}).uncheck();
  await page.waitForFunction(() => {
    const engine = (window as any).appearanceEngine, ball = engine.sim.pop.balls[0];
    return ball.hits === 1 && engine.pop.getObjectByName(`pop-ball-${ball.id}`).material.type === 'MeshStandardMaterial';
  });
  await page.getByLabel('Pop preset', {exact: true}).selectOption(saved);
  await page.reload(); await selectDrill(page, 'pop');
  await expect(page.getByRole('switch', {name: '3D balls', exact: true})).toBeChecked();
  await page.getByLabel('Pop mode', {exact: true}).selectOption('wide');
  await expect(page.getByRole('switch', {name: '3D balls', exact: true})).toBeChecked();
  expect(errors).toEqual([]);
});

test('Micro Flicks: short random hops stay near the fixed center and controls persist', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', popVariant: 'wide', popSize: 8, popDistance: 8,
      weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
      autoFullscreen: false, protectShortcuts: false, volume: 0,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true}).locator('option:checked')).toHaveText('Micro Flicks');
  await expect(page.getByLabel('Jump distance', {exact: true})).toHaveValue('0.3');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).flickEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).flickEngine?.sim.pop);
  const initial = await page.evaluate(() => {
    const engine = (window as any).flickEngine, field = engine.sim.pop;
    return {ball: {...field.balls[0]}, region: field.region, panel: !!engine.pop.getObjectByName('pop-panel')};
  });
  expect(initial.ball.x).toBe(initial.region.x); expect(initial.ball.y).toBe(initial.region.y); expect(initial.panel).toBe(false);
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).flickEngine.sim.pop.balls[0])).toEqual(initial.ball);
  for (let rep = 0; rep < 10; rep++) {
    const hit = await page.evaluate(async () => {
      const engine = (window as any).flickEngine, sim = engine.sim, before = {...sim.pop.balls[0]};
      const mesh = engine.pop.getObjectByName(`pop-ball-${before.id}`), meshId = mesh.uuid;
      sim.resetRecovery();
      const dx = before.x - sim.position.x, dy = before.y - sim.position.y, dz = before.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      sim.start(); sim.release('mouse'); sim.yaw = sim.pitch = 0;
      const immediate = {...sim.pop.balls[0]}, at = sim.time, samples = [];
      do {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const ball = sim.pop.balls[0], rendered = engine.pop.getObjectByName(`pop-ball-${before.id}`);
        samples.push({x: ball?.x, y: ball?.y, count: sim.pop.balls.length, meshId: rendered?.uuid,
          meshX: rendered?.position.x, meshY: rendered?.position.y, visible: rendered?.visible});
      } while (sim.time < at + .25);
      return {before, immediate, samples, meshId, after: {...sim.pop.balls[0]}, count: sim.pop.balls.length, pops: sim.pop.pops, shots: sim.pop.shots};
    });
    expect(hit.count).toBe(1); expect(hit.pops).toBe(rep + 1); expect(hit.shots).toBe(rep + 1);
    expect(hit.immediate).toEqual(hit.before); expect(hit.after.id).toBe(hit.before.id);
    expect(hit.samples.some(sample => {
      const distance = Math.hypot(sample.x - hit.before.x, sample.y - hit.before.y); return distance > .01 && distance < .29;
    })).toBe(true);
    for (const sample of hit.samples) {
      expect(sample.count).toBe(1); expect(sample.meshId).toBe(hit.meshId); expect(sample.visible).toBe(true);
      expect(sample.meshX).toBeCloseTo(sample.x, 8); expect(sample.meshY).toBeCloseTo(sample.y, 8);
      expect(Math.hypot(sample.x - initial.region.x, sample.y - initial.region.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(Math.hypot(hit.after.x - hit.before.x, hit.after.y - hit.before.y)).toBeCloseTo(.3, 8);
    expect(Math.hypot(hit.after.x - initial.region.x, hit.after.y - initial.region.y)).toBeLessThanOrEqual(1 + 1e-9);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => (window as any).flickEngine.sim.pop.balls[0])).toEqual(hit.after);
    if (rep === 0 || rep === 9) await page.screenshot({path: info.outputPath(`micro-flicks-hit-${rep + 1}.png`)});
  }
  await page.keyboard.press('Escape');
  await page.getByLabel('Center radius', {exact: true}).fill('0.5');
  await page.getByLabel('Jump distance', {exact: true}).fill('0.15');
  await page.waitForFunction(() => {
    const field = (window as any).flickEngine.sim.pop;
    return field.config.flickStep === .15 && field.config.flickRadius === .5 && field.balls[0].x === field.region.x && field.balls[0].y === field.region.y;
  });
  await page.getByLabel('Preset name').fill('Small center hops');
  await page.getByRole('button', {name: 'Save preset', exact: true}).click();
  const saved = await page.getByLabel('Pop preset', {exact: true}).inputValue();
  await page.reload(); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop preset', {exact: true})).toHaveValue(saved);
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('wide');
  await expect(page.getByLabel('Jump distance', {exact: true})).toHaveValue('0.15');
  await expect(page.getByLabel('Center radius', {exact: true})).toHaveValue('0.5');
  await page.getByLabel('Pop mode', {exact: true}).selectOption('classic');
  await expect(page.getByLabel('Jump distance', {exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('specific Pop modes: select, render, shoot, save, reload and return to Classic', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false,
      autoFullscreen: false, protectShortcuts: false, volume: 0, popColor: '#4df3ff', popBackground: '#151a28',
    }));
  });
  await page.goto('/');
  await selectDrill(page, 'pop');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).popModeEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).popModeEngine?.sim?.pop);

  for (const [variant, name] of [['precision', 'Center Return'], ['wide', 'Micro Flicks'], ['microshot', 'Microshot']]) {
    await page.getByLabel('Pop mode', {exact: true}).selectOption(variant);
    await expect(page.getByLabel('Balls at once')).toHaveCount(0);
    await expect(page.locator('.sl-ready small')).toContainText(name);
    await page.getByRole('button', {name: 'Enter range', exact: true}).click();
    await page.waitForFunction(variant => (window as any).popModeEngine?.sim?.pop?.config.variant === variant && (variant === 'wide' || !!(window as any).popModeEngine.pop.getObjectByName('pop-panel')), variant);
    await expect(page.locator('.target-label')).toContainText(name);
    if (variant === 'precision') await page.waitForFunction(() => (window as any).popModeEngine.sim.pop.balls.length === 1);
    const observed = await page.evaluate(() => {
      const engine = (window as any).popModeEngine, sim = engine.sim, field = sim.pop, ball = field.balls[0];
      const mesh = engine.pop.getObjectByName(`pop-ball-${ball.id}`), panel = engine.pop.getObjectByName('pop-panel');
      const before = {count: field.balls.length, square: mesh.geometry.type === 'ShapeGeometry', panel: panel?.geometry.parameters,
        region: field.region, color: engine.popMaterial.color.getHexString(), oldX: ball.x};
      const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      sim.start(); sim.release('mouse');
      sim.yaw = sim.pitch = 0;
      return {...before, pops: field.pops, shots: field.shots, newX: field.balls[0]?.x, caption: engine.hitCaption.textContent};
    });
    expect(observed.count).toBe(variant === 'microshot' ? 3 : 1); expect(observed.square).toBe(false);
    expect(observed.color).toBe('4df3ff'); expect(observed.pops).toBe(1); expect(observed.shots).toBe(1); expect(observed.caption).toBe('POP');
    if (variant === 'wide') expect(observed.panel).toBeUndefined();
    else expect(observed.panel.width).toBeCloseTo(observed.region.halfW * 2);
    if (variant === 'precision') expect(observed.panel.height).toBeGreaterThan(observed.panel.width);
    await page.waitForTimeout(350);
    await page.screenshot({path: info.outputPath(`${variant}.png`)});
    await page.keyboard.press('Escape');
  }

  await page.getByLabel('Preset name').fill('Microshot custom');
  await page.getByRole('button', {name: 'Save preset', exact: true}).click();
  const savedId = await page.getByLabel('Pop preset', {exact: true}).inputValue();
  await page.getByLabel('Pop preset', {exact: true}).selectOption('builtin-classic');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('classic');
  await expect(page.getByLabel('Balls at once')).toHaveValue('5');
  await page.getByLabel('Pop mode', {exact: true}).selectOption('precision');
  await expect(page.getByLabel('Pop preset', {exact: true})).toHaveValue('');
  await page.getByLabel('Pop preset', {exact: true}).selectOption(savedId);
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('microshot');
  await page.reload();
  await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('microshot');
  await expect(page.getByLabel('Pop preset', {exact: true})).toHaveValue(savedId);
  await page.getByRole('button', {name: 'Restore drill defaults', exact: true}).click();
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('classic');
  await expect(page.getByLabel('Balls at once')).toHaveValue('5');
  expect(errors).toEqual([]);
});

test('Microshot: clear each group before its rectangle moves, then keep playing', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({
    mode: 'pop', popVariant: 'microshot', popSize: 8, popDistance: 8, popClusterCount: 3,
    popClusterWidth: .7, popClusterHeight: .6, popRespawn: .5,
    weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
    autoFullscreen: false, protectShortcuts: false, volume: 0,
  })));
  await page.goto('/'); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Dots per rectangle', {exact: true})).toHaveValue('3');
  await expect(page.getByLabel('Rectangle width', {exact: true})).toHaveValue('0.7');
  await expect(page.getByLabel('Next rectangle delay', {exact: true})).toHaveValue('0.5');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).clusterEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).clusterEngine?.pop.getObjectByName('pop-cluster'));
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  for (let group = 0; group < 2; group++) {
    await page.waitForFunction(() => (window as any).clusterEngine.sim.pop.balls.length === 3);
    await expect(page.getByTestId('pop-cluster-cue')).toHaveText(`3/3 dots left · ${group} cleared`);
    const initial = await page.evaluate(() => {
      const engine = (window as any).clusterEngine;
      return {balls: engine.sim.pop.balls.map((ball: any) => ({...ball})), rectangle: engine.pop.getObjectByName('pop-cluster').position.toArray()};
    });
    await page.screenshot({path: info.outputPath(`microshot-group-${group + 1}.png`)});
    for (let dot = 0; dot < 3; dot++) {
      const hit = await page.evaluate(() => {
        const sim = (window as any).clusterEngine.sim, ball = sim.pop.balls[0];
        sim.resetRecovery();
        const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
        sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        sim.start(); sim.release('mouse'); sim.yaw = sim.pitch = 0;
        return {pops: sim.pop.pops, balls: sim.pop.balls.map((ball: any) => ({...ball})), cleared: sim.pop.clustersCleared};
      });
      expect(hit.pops).toBe(group * 3 + dot + 1);
      expect(hit.balls).toEqual(initial.balls.slice(dot + 1));
      expect(hit.cleared).toBe(group + (dot === 2 ? 1 : 0));
      if (dot < 2) {
        // Longer than the configured delay: a partial group must never refill or relocate.
        await page.waitForTimeout(650);
        const remaining = await page.evaluate(() => {
          const engine = (window as any).clusterEngine;
          return {balls: engine.sim.pop.balls, rectangle: engine.pop.getObjectByName('pop-cluster').position.toArray()};
        });
        expect(remaining.balls).toEqual(hit.balls); expect(remaining.rectangle).toEqual(initial.rectangle);
        await expect(page.getByTestId('pop-cluster-cue')).toHaveText(`${2 - dot}/3 dots left · ${group} cleared`);
      } else {
        await expect(page.getByTestId('pop-cluster-cue')).toHaveText(`Next rectangle… · ${group + 1} cleared`);
        await page.waitForFunction(() => (window as any).clusterEngine.sim.pop.balls.length === 3);
        expect(await page.evaluate(() => (window as any).clusterEngine.pop.getObjectByName('pop-cluster').position.toArray())).not.toEqual(initial.rectangle);
      }
    }
  }
  await page.keyboard.press('Escape');
  await page.getByLabel('Dots per rectangle', {exact: true}).fill('5');
  await page.waitForFunction(() => (window as any).clusterEngine.sim.pop.balls.length === 5);
  await page.getByLabel('Pop mode', {exact: true}).selectOption('classic');
  await page.waitForFunction(() => !(window as any).clusterEngine.pop.getObjectByName('pop-cluster'));
  expect(errors).toEqual([]);
});

test('Center Return: fixed aim gate, moving side target, and mandatory recenter between hits', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({
    mode: 'pop', popVariant: 'precision', popSize: 8, popDistance: 8, popPrecisionSpeed: .4,
    weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
    autoFullscreen: false, protectShortcuts: false, volume: 0,
  })));
  await page.goto('/'); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('precision');
  await expect(page.getByLabel('Target speed')).toHaveValue('0.4');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).centerEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).centerEngine?.pop.getObjectByName('pop-center'));
  expect(await page.evaluate(() => (window as any).centerEngine.sim.pop.balls.length)).toBe(0);
  await page.evaluate(() => {(window as any).centerEngine.sim.yaw = .05;});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForTimeout(350);
  await expect(page.getByTestId('pop-center-cue')).toHaveText('Aim at the center dot');
  await page.screenshot({path: info.outputPath('center-waiting.png')});
  const centers = [];
  for (let rep = 0; rep < 2; rep++) {
    await page.evaluate(() => {const sim = (window as any).centerEngine.sim; sim.resetRecovery(); sim.yaw = sim.pitch = 0;});
    await page.waitForFunction(() => (window as any).centerEngine.sim.pop.balls.length === 1);
    await expect(page.getByTestId('pop-center-cue')).toHaveText('Shoot the moving dot');
    const initial = await page.evaluate(() => {
      const engine = (window as any).centerEngine, field = engine.sim.pop;
      return {ball: {...field.balls[0]}, center: engine.pop.getObjectByName('pop-center').position.toArray(), shots: field.shots};
    });
    centers.push(initial.center); expect(initial.shots).toBe(rep);
    await page.waitForFunction(({id, x}) => {
      const ball = (window as any).centerEngine.sim.pop.balls[0]; return ball?.id === id && Math.abs(ball.x - x) > .04;
    }, {id: initial.ball.id, x: initial.ball.x});
    await page.screenshot({path: info.outputPath(`center-side-target-${rep + 1}.png`)});
    const hit = await page.evaluate(() => {
      const sim = (window as any).centerEngine.sim, ball = sim.pop.balls[0];
      const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      sim.start(); sim.release('mouse'); sim.yaw = .05; sim.pitch = 0;
      return {pops: sim.pop.pops, shots: sim.pop.shots, phase: sim.pop.precisionPhase, count: sim.pop.balls.length};
    });
    expect(hit).toEqual({pops: rep + 1, shots: rep + 1, phase: 'center', count: 0});
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => (window as any).centerEngine.sim.pop.balls.length)).toBe(0);
    await expect(page.getByTestId('pop-center-cue')).toHaveText('Aim at the center dot');
  }
  expect(centers[0]).toEqual(centers[1]);
  await page.keyboard.press('Escape');
  await page.getByLabel('Pop mode', {exact: true}).selectOption('classic');
  await page.waitForFunction(() => !(window as any).centerEngine.pop.getObjectByName('pop-center'));
  await expect(page.getByLabel('Target speed', {exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
