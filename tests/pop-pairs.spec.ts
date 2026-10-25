import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

async function setup(page: Page, variant: string) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', weapon: 'ak47', primaryEnabled: true, quality: 'performance', spread: false, follow: false,
      pop3D: true, autoFullscreen: false, protectShortcuts: false, volume: 0,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  await page.getByLabel('Pop mode', {exact: true}).selectOption(variant);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).pairEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).pairEngine?.sim.pop);
}

async function aimFirst(page: Page) {
  return page.evaluate(() => {
    const sim = (window as any).pairEngine.sim, [ball, survivor] = sim.pop.balls;
    sim.resetRecovery();
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    return {id: ball.id, survivor: {...survivor}, pops: sim.pop.pops};
  });
}

test('Close Pairs: shoot successive nearby targets and persist its controls', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL check'); test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page, 'closepairs');
  await expect(page.getByLabel('Target spacing', {exact: true})).toHaveValue('0.35');
  await expect(page.getByLabel('Center radius', {exact: true})).toHaveValue('1');
  await page.getByLabel('Target size', {exact: true}).fill('20');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.screenshot({path: info.outputPath('close-pairs.png')});
  for (let i = 0; i < 8; i++) {
    const before = await aimFirst(page);
    // Keep a tap atomic under software rendering; separate mouse RPCs can hold the AK for several rounds.
    await page.evaluate(() => {const sim = (window as any).pairEngine.sim; sim.pressTrigger(); sim.release('mouse');});
    await page.waitForFunction(pops => (window as any).pairEngine.sim.pop.pops === pops + 1, before.pops, {timeout: 10000});
    const after = await page.evaluate(() => (window as any).pairEngine.sim.pop.balls);
    expect(after).toHaveLength(2); expect(after[0]).toEqual(before.survivor); expect(after[1].id).not.toBe(before.id);
    expect(Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y)).toBeCloseTo(.35);
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Escape');
  await page.getByLabel('Target spacing', {exact: true}).fill('0.25');
  await page.getByLabel('Center radius', {exact: true}).fill('0.6');
  await page.getByLabel('Preset name').fill('Close pair practice');
  await page.getByRole('button', {name: 'Save preset', exact: true}).click();
  await page.reload(); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('closepairs');
  await expect(page.getByLabel('Target spacing', {exact: true})).toHaveValue('0.25');
  await expect(page.getByLabel('Center radius', {exact: true})).toHaveValue('0.6');
  await expect(page.getByRole('switch', {name: '3D balls', exact: true})).toBeChecked();
  expect(errors).toEqual([]);
});

test('Pokeball: real held mouse clears dots, release and pause stop progress, presets survive reload', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL check'); test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page, 'pokeball');
  await expect(page.getByLabel('Hold time', {exact: true})).toHaveValue('150');
  await expect(page.getByLabel('Hits to pop', {exact: true})).toHaveCount(0);
  await page.getByLabel('Hold time', {exact: true}).fill('500');
  await page.getByLabel('Target size', {exact: true}).fill('20');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await expect(page.getByTestId('pop-hold-cue')).toBeVisible();
  await aimFirst(page); await page.mouse.down();
  await page.waitForFunction(() => (window as any).pairEngine.sim.pop.balls[0].hits > .15);
  await page.mouse.up();
  const partial = await page.evaluate(() => {
    const sim = (window as any).pairEngine.sim; return {ball: {...sim.pop.balls[0]}, held: sim.pop.heldSeconds};
  });
  expect(partial.ball.hits).toBeGreaterThan(0); expect(partial.ball.hits).toBeLessThan(1);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).pairEngine.sim.pop.balls[0])).toEqual(partial.ball);
  await page.screenshot({path: info.outputPath('pokeball-partial.png')});
  await page.keyboard.press('Escape'); await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).pairEngine.sim.pop.heldSeconds)).toBe(partial.held);
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.mouse.down();
  for (let i = 0; i < 4; i++) {
    const before = await aimFirst(page);
    await page.waitForFunction(pops => (window as any).pairEngine.sim.pop.pops >= pops + 1, before.pops, {timeout: 10000});
    expect(await page.evaluate(() => (window as any).pairEngine.sim.pop.balls[0])).toEqual(before.survivor);
  }
  // A miss while held is counted as off-target time and cannot pop another dot.
  const beforeMiss = await page.evaluate(() => {const sim = (window as any).pairEngine.sim; sim.yaw = Math.PI / 2; return sim.pop.pops;});
  await page.waitForTimeout(350); await page.mouse.up();
  const scored = await page.evaluate(() => {
    const sim = (window as any).pairEngine.sim;
    return {pops: sim.pop.pops, held: sim.pop.heldSeconds, on: sim.pop.onTargetSeconds, ammo: sim.loadedAmmo, recoil: sim.recoil, shots: sim.pop.shots};
  });
  expect(scored.pops).toBeGreaterThanOrEqual(4); expect(scored.pops).toBe(beforeMiss); expect(scored.held).toBeGreaterThan(scored.on); expect(scored.ammo).toBe(30);
  expect(scored.recoil).toEqual({yaw: 0, pitch: 0}); expect(scored.shots).toBe(0);
  await page.evaluate(() => {(window as any).pairEngine.sim.yaw = (window as any).pairEngine.sim.pitch = 0;});
  await page.screenshot({path: info.outputPath('pokeball.png')});
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).pairEngine.sim.latest.pokeball.pops)).toBe(scored.pops);
  await page.getByLabel('Hold time', {exact: true}).fill('200');
  await page.getByLabel('Preset name').fill('Pokeball settling');
  await page.getByRole('button', {name: 'Save preset', exact: true}).click();
  const saved = await page.getByLabel('Pop preset', {exact: true}).inputValue();
  await page.getByLabel('Pop mode', {exact: true}).selectOption('classic');
  await page.getByLabel('Pop preset', {exact: true}).selectOption(saved);
  await expect(page.getByLabel('Hold time', {exact: true})).toHaveValue('200');
  await page.reload(); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('pokeball');
  await expect(page.getByLabel('Hold time', {exact: true})).toHaveValue('200');
  await expect(page.getByRole('switch', {name: '3D balls', exact: true})).toBeChecked();
  expect(errors).toEqual([]);
});
