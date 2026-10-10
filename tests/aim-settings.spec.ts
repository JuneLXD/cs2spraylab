import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.use({viewport: {width: 960, height: 720}});

for (const mode of ['guided', 'duel'] as const) test(`${mode}: imported video and mouse axes are saved and drive aiming`, async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop config and pointer lock');
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(mode => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'ak47',
      quality: 'performance', volume: 0, autoFullscreen: false, protectShortcuts: false}));
  }, mode);
  await page.goto('/');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Keyboard / Mouse', exact: true}).click();
  await page.getByLabel('Import CS2 config files').setInputFiles([
    {name: 'autoexec.cfg', mimeType: 'text/plain', buffer: Buffer.from('sensitivity 1.5; m_yaw -0.0165; m_pitch -0.044; sensitivity_y_scale 0.5; bind mouse_x !yaw; bind mouse_y !pitch')},
    {name: 'cs2_video.txt', mimeType: 'text/plain', buffer: Buffer.from('"video.cfg" { "setting.defaultres" "1600" "setting.defaultresheight" "1200" }')},
  ]);
  await expect(page.locator('.kb-report')).toContainText('resolution 1600x1200');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export .cfg', exact: true}).click();
  const cfg = await readFile(await (await downloading).path(), 'utf8');
  for (const command of ['m_yaw "-0.0165"', 'm_pitch "-0.044"', 'sensitivity_y_scale "0.5"', 'bind "mouse_x" "!yaw"', 'bind "mouse_y" "!pitch"']) expect(cfg).toContain(command);
  await page.getByRole('tab', {name: 'Video', exact: true}).click();
  await expect(page.getByLabel('Resolution', {exact: true})).toHaveValue('1600x1200');
  await expect(page.getByRole('tabpanel')).toContainText('even with 1920 x 1440 selected');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  expect(saved).toMatchObject({resolution: '1600x1200', mouseYaw: -.0165, mousePitch: -.044, sensitivityYScale: .5, invertX: true, invertY: true});
  await page.getByRole('button', {name: 'Close panel', exact: true}).click();
  const path = mode === 'duel' ? '/src/range/duel/DuelEngine.ts' : '/src/range/engine.ts';
  await page.waitForFunction(path => performance.getEntriesByType('resource').some(e => new URL(e.name).pathname === path), path);
  await page.evaluate(async ({path, mode}) => {
    const url = performance.getEntriesByType('resource').reverse().find(e => new URL(e.name).pathname === path)!.name;
    const module = await import(/* @vite-ignore */ url);
    const proto = (mode === 'duel' ? module.DuelEngine : module.RangeEngine).prototype, tick = proto.tick;
    proto.tick = function(time: number) {(window as any).aimSettingsEngine = this; return tick.call(this, time);};
  }, {path, mode});
  await page.waitForFunction(mode => {
    const e = (window as any).aimSettingsEngine;
    return e && !e.disposed && (mode === 'duel' || e.loadedTarget && e.modelCache.has(e.sim.equipped));
  }, mode);
  await page.getByRole('button', {name: mode === 'duel' ? 'Enter duel' : 'Enter range', exact: true}).click();
  await page.waitForFunction(() => document.pointerLockElement === (window as any).aimSettingsEngine.renderer.domElement);
  const observed = await page.evaluate(mode => {
    const e = (window as any).aimSettingsEngine;
    const pose = () => mode === 'duel' ? e.sim.renderSnapshot()[0] : {yaw: e.sim.yaw, pitch: e.sim.pitch};
    const before = pose();
    window.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse', movementX: 100, movementY: 40, bubbles: true}));
    const after = pose();
    return {yaw: (after.yaw - before.yaw) * 180 / Math.PI, pitch: (after.pitch - before.pitch) * 180 / Math.PI, aspect: e.camera.aspect};
  }, mode);
  expect(observed.yaw).toBeCloseTo(-2.475, 8);
  expect(observed.pitch).toBeCloseTo(-1.32, 8);
  expect(observed.aspect).toBeCloseTo(4 / 3, 10);
  expect(errors).toEqual([]);
});
