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

  for (const [variant, name] of [['precision', 'Precision'], ['wide', 'Wide Flicks'], ['microshot', 'Microshot']]) {
    await page.getByLabel('Pop mode', {exact: true}).selectOption(variant);
    await expect(page.getByLabel('Balls at once')).toHaveCount(0);
    await expect(page.locator('.sl-ready small')).toContainText(name);
    await page.getByRole('button', {name: 'Enter range', exact: true}).click();
    await page.waitForFunction(variant => (window as any).popModeEngine?.sim?.pop?.config.variant === variant && !!(window as any).popModeEngine.pop.getObjectByName('pop-panel'), variant);
    await expect(page.locator('.target-label')).toContainText(name);
    const observed = await page.evaluate(() => {
      const engine = (window as any).popModeEngine, sim = engine.sim, field = sim.pop, ball = field.balls[0];
      const mesh = engine.pop.getObjectByName(`pop-ball-${ball.id}`), panel = engine.pop.getObjectByName('pop-panel');
      const before = {count: field.balls.length, square: mesh.geometry.type === 'ShapeGeometry', panel: panel.geometry.parameters,
        region: field.region, color: engine.popMaterial.color.getHexString(), oldX: ball.x};
      const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
      sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      sim.start(); sim.release('mouse');
      sim.yaw = sim.pitch = 0;
      return {...before, pops: field.pops, shots: field.shots, newX: field.balls[0].x, caption: engine.hitCaption.textContent};
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
