import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';

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

  for (const [variant, name] of [['precision', 'Center Return'], ['wide', 'Wide Flicks'], ['microshot', 'Microshot']]) {
    await page.getByLabel('Pop mode', {exact: true}).selectOption(variant);
    await expect(page.getByLabel('Balls at once')).toHaveCount(0);
    await expect(page.locator('.sl-ready small')).toContainText(name);
    await page.getByRole('button', {name: 'Enter range', exact: true}).click();
    await page.waitForFunction(variant => (window as any).popModeEngine?.sim?.pop?.config.variant === variant && !!(window as any).popModeEngine.pop.getObjectByName('pop-panel'), variant);
    await expect(page.locator('.target-label')).toContainText(name);
    if (variant === 'precision') await page.waitForFunction(() => (window as any).popModeEngine.sim.pop.balls.length === 1);
    const observed = await page.evaluate(() => {
      const engine = (window as any).popModeEngine, sim = engine.sim, field = sim.pop, ball = field.balls[0];
      const mesh = engine.pop.getObjectByName(`pop-ball-${ball.id}`), panel = engine.pop.getObjectByName('pop-panel');
      const before = {count: field.balls.length, square: mesh.geometry.type === 'ShapeGeometry', panel: panel.geometry.parameters,
        region: field.region, color: engine.popMaterial.color.getHexString(), oldX: ball.x};
      const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      sim.start(); sim.release('mouse');
      sim.yaw = sim.pitch = 0;
      return {...before, pops: field.pops, shots: field.shots, newX: field.balls[0]?.x, caption: engine.hitCaption.textContent};
    });
    expect(observed.count).toBe(1); expect(observed.square).toBe(variant === 'microshot');
    expect(observed.color).toBe('4df3ff'); expect(observed.pops).toBe(1); expect(observed.shots).toBe(1); expect(observed.caption).toBe('POP');
    expect(observed.panel.width).toBeCloseTo(observed.region.halfW * 2);
    if (variant === 'wide') expect(observed.newX * observed.oldX).toBeLessThan(0);
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
