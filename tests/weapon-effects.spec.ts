import {expect, test} from '@playwright/test';
import {canvasColors} from './render-frame';

test('range resolves hits immediately, flashes at the barrel, and suppressed weapons never trace', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',volume:0,spread:false})));
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).fxEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).fxEngine?.loadedTarget && (window as any).fxEngine.modelCache.has('ak47'));
  const result = await page.evaluate(async () => {
    const e = (window as any).fxEngine, Vector = e.camera.position.constructor;
    e.sim.active = true; e.sim.start();
    const marks = [...e.impactClouds.values()].reduce((sum: number, cloud: any) => sum + cloud.mesh.count, 0);
    const immediate = {shots: e.sim.shots, marks, action:e.viewAnimations.get('ak47').activeAction};
    e.sim.release('mouse'); e.sim.active = false;
    const muzzle = e.viewMuzzles.get('ak47').main, flash = e.viewFlashes.sprites.find((s: any) => s.visible);
    const projected = muzzle.getWorldPosition(new Vector()).project(e.viewCamera);
    const original = Array.from(e.shotEffects.tracers.geometry.getAttribute('position').array).slice(0,6);
    e.camera.position.x += 1; e.shotEffects.update(e.elapsed);
    const moved = Array.from(e.shotEffects.tracers.geometry.getAttribute('position').array).slice(0,6);
    const textureReady = !!flash?.material.map?.image;
    const count = e.shotEffects.nextTrace;
    for (const weapon of ['usp','m4a1s','mp5sd']) e.shotEffects.trace(weapon,0,new Vector(0,1,0),new Vector(1,1,-20),e.elapsed,e.traceColor);
    return {immediate, projected:projected.toArray(), flash:!!flash, textureReady, original, moved,
      tracesBefore:count, tracesAfter:e.shotEffects.nextTrace, visibleObjects:e.scene.children.length};
  });
  expect(result.immediate.shots).toBe(1); expect(result.immediate.marks).toBeGreaterThan(0);
  expect(result.immediate.action).toBe('fire'); expect(result.flash).toBe(true); expect(result.textureReady).toBe(true);
  expect(Math.abs(result.projected[0])).toBeLessThan(1); expect(Math.abs(result.projected[1])).toBeLessThan(1);
  expect(result.original).toEqual(result.moved); expect(result.tracesAfter).toBe(result.tracesBefore);
  expect(await canvasColors(page, 'canvas[data-range]')).toBeGreaterThan(8);
  await page.screenshot({path:`research/firing-${info.project.name}.png`});
  expect(errors).toEqual([]);
});

test('practice tracers follow every round of a held spray to its impact', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop mouse workflow');
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', volume: 0}));
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {value: undefined});
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).fxEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).fxEngine?.loadedTarget && (window as any).fxEngine.modelCache.has('ak47'));
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  const box = (await page.locator('canvas[data-range]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(450);
  const spray = await page.evaluate(() => {
    const e = (window as any).fxEngine, fx = e.shotEffects;
    return {shots: e.sim.shots, traced: fx.nextTrace, beams: fx.beams.visible, lines: fx.tracers.visible};
  });
  await page.screenshot({path: `test-results/${info.project.name}-practice-tracers.png`});
  await page.mouse.up();
  expect(spray.shots).toBeGreaterThan(2);
  expect(spray.traced).toBe(spray.shots);
  expect(spray.beams).toBe(true); expect(spray.lines).toBe(true);
});

test('knife armory filters by native model and equips any native finish with its preview', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',volume:0}));
  });
  await page.goto('/');
  await page.locator('.weapon-select').click();
  await page.getByRole('dialog',{name:'Loadout'}).getByRole('button',{name:/^Open the armory/}).click();
  const armory = page.getByRole('dialog',{name:'Armory'});
  await armory.getByRole('tab',{name:'Knives',exact:true}).click();
  const filter = armory.getByLabel('Knife type');
  await expect(filter.locator('option')).toHaveCount(23);
  await filter.selectOption('knife-karambit');
  expect(await armory.locator('.progression-choice').count()).toBeGreaterThan(10);
  expect(await armory.locator('.progression-choice').count()).toBeLessThan(40);
  const emerald = armory.locator('.progression-choice').filter({hasText:'Karambit | Gamma Doppler Emerald'});
  await expect(emerald).toHaveCount(1);
  const image = emerald.locator('img'); await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await emerald.getByRole('button').click();
  await expect(emerald).toHaveClass(/is-equipped/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).equipped.knife)).toContain('knife-karambit');
});
