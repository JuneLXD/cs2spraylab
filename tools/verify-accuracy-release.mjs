import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const reports = path.resolve(root, '../native-audit/reports');
const require = createRequire(root + '/package.json');
const {chromium, expect} = require('@playwright/test');
const base = 'http://192.168.0.18:3500';
const expected = process.argv[2];
assert(expected, 'Pass expected short commit');
const reportPrefix = process.argv[3] ?? 'reaudit-accuracy-live-release';
assert(/^[a-z0-9-]+$/.test(reportPrefix), 'Report prefix must be a simple filename');
const out = {base, checkedAt: new Date().toISOString(), expected, assets: [], pageErrors: [], failedResponses: []};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const response = await fetch(base + '/', {cache: 'no-store'});
assert.equal(response.status, 200);
out.release = response.headers.get('x-spraylab-release');
assert(out.release?.endsWith('-' + expected), `Unexpected release ${out.release}`);
for (const path of ['models/view-ak47.glb', 'audio/events.json']) {
  const response = await fetch(base + '/' + path, {cache: 'no-store'});
  assert.equal(response.status, 200, path);
  const served = Buffer.from(await response.arrayBuffer());
  const local = await readFile(root + '/public/revamp/' + path);
  assert.equal(hash(served), hash(local), path);
  out.assets.push({path, bytes: served.length, sha256: hash(served)});
}
const browser = await chromium.launch({headless: true, channel: 'chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => out.pageErrors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) out.failedResponses.push({url: response.url(), status: response.status()});});
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({
    mode: 'guided', weapon: 'ak47', quality: 'performance', volume: 0,
    autoFullscreen: false, protectShortcuts: false, burst: 0
  })));
  await page.goto(base + '/', {waitUntil: 'domcontentloaded'});
  await page.locator('canvas[data-range]').waitFor({state: 'visible'});
  const enter = page.getByRole('button', {name: 'Enter range', exact: true});
  await enter.click();
  await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-range]'));
  out.pointerLock = true;
  const ammo = page.getByTestId('ammo');
  await expect(ammo).toHaveText(/^30\s*\//);
  out.ammoBefore = await ammo.textContent();
  await page.mouse.click(640, 450);
  await expect(ammo).not.toHaveText(/^30\s*\//);
  out.ammoAfterFire = await ammo.textContent();
  await page.keyboard.press('r');
  await expect(ammo).toHaveText(/^30\s*\//, {timeout: 15000});
  out.ammoAfterReload = await ammo.textContent();
  await page.screenshot({path: path.join(reports, reportPrefix + '.png')});
  out.title = await page.title();
  out.canvas = await page.locator('canvas[data-range]').evaluate(canvas => ({width: canvas.width, height: canvas.height}));
  assert(out.canvas.width > 0 && out.canvas.height > 0);
  assert.deepEqual(out.pageErrors, []);
  assert.deepEqual(out.failedResponses, []);
  out.status = 'passed';
} finally {
  await browser.close();
  await writeFile(path.join(reports, reportPrefix + '.json'), JSON.stringify(out, null, 2) + '\n');
}
console.log(JSON.stringify(out, null, 2));
