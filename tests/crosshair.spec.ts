import {expect, test, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

const convars = `"config"
{
	"convars"
	{
		"cl_crosshairsize"		"-1"
		"cl_crosshairgap"		"-3"
		"cl_crosshairthickness"		"1.5"
		"cl_crosshairdot"		"true"
		"cl_crosshaircolor"		"5"
		"cl_crosshaircolor_r"		"255"
		"cl_crosshaircolor_g"		"0"
		"cl_crosshaircolor_b"		"0"
		"cl_crosshairstyle"		"4"
	}
}
`;
const autoexec = `alias "xhair_cross" "cl_crosshairsize 3; cl_crosshairgap 0; cl_crosshairthickness 0.5; cl_crosshairdot 0; bind KP_5 xhair_dot"
alias "xhair_dot" "cl_crosshairsize -1; cl_crosshairdot 1; cl_crosshairthickness 1.5; bind KP_5 xhair_cross"
bind KP_5 xhair_cross
bind KP_6 "toggle cl_crosshaircolor_g 0 255"
bind v "toggle cl_radar_scale 0.3 1"
`;
const video = '"video.cfg"\n{\n\t"setting.defaultres"\t\t"1920"\n\t"setting.defaultresheight"\t\t"1080"\n}\n';

const crosshairStyle = (page: Page) => page.locator('.duel-view .crosshair').getAttribute('style');
/** CS2 pixels at 1080p in this browser's CSS pixels: crosshairs keep their on-screen size. */
const cssPixels = async (page: Page) => {
  const scale = await page.evaluate(() => screen.height / 1080);
  return (pixels: number) => `${Math.round(pixels * scale * 100) / 100}px`;
};

test('imports the CS2 crosshair, and keys bound to crosshair convars change it in game', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop keyboard workflow');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Keyboard / Mouse', exact: true}).click();
  await page.getByLabel('Import CS2 config files').setInputFiles([
    {name: 'cs2_user_convars_0_slot0.vcfg', mimeType: 'text/plain', buffer: Buffer.from(convars)},
    {name: 'autoexec.cfg', mimeType: 'text/plain', buffer: Buffer.from(autoexec)},
    {name: 'cs2_video.txt', mimeType: 'text/plain', buffer: Buffer.from(video)},
  ]);
  await expect(page.locator('.kb-report')).toContainText('crosshair (1080p)');
  await page.getByRole('tab', {name: 'Crosshair', exact: true}).click();
  await expect(page.getByText('Matches your CS2 crosshair convars at 1080p')).toBeVisible();
  // size -1 hides the bars; thickness 1.5 is 3 px at 1080p; gap -3 leaves 1 px.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).crosshair);
  const scale = await page.evaluate(() => screen.height / 1080);
  expect(stored).toMatchObject({size: 0, color: '#ff0000', dot: true, dynamic: false});
  expect(stored.gap).toBeCloseTo(scale, 2);
  expect(stored.thickness).toBeCloseTo(3 * scale, 2);
  await expect(page.getByLabel('Center dot')).toBeChecked();

  const download = page.waitForEvent('download');
  await page.getByRole('tab', {name: 'Keyboard / Mouse', exact: true}).click();
  await page.getByRole('button', {name: 'Export .cfg', exact: true}).click();
  const cfg = await readFile(await (await download).path(), 'utf8');
  expect(cfg).toContain('cl_crosshair_thickness "3"');
  expect(cfg).toContain('cl_crosshair_screen_height "1080"');
  expect(cfg).toContain('cl_crosshaircolor_r "255"');
  await page.getByRole('button', {name: 'Done', exact: true}).click();

  await page.getByLabel('Protect Ctrl+W').uncheck();
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  const px = await cssPixels(page);
  expect(await crosshairStyle(page)).toContain(`--cross-thickness: ${px(3)}`);
  await page.keyboard.press('Numpad5');
  await expect.poll(() => crosshairStyle(page)).toContain(`--cross-size: ${px(7)}`);
  expect(await crosshairStyle(page)).toContain(`--cross-gap: ${px(4)}`);
  expect(await crosshairStyle(page)).toContain(`--cross-thickness: ${px(1)}`);
  await page.keyboard.press('Numpad5');
  await expect.poll(() => crosshairStyle(page)).toContain('--cross-size: 0px');
  // 1920x1440 by default: the crosshair stretches with the 4:3 world, as in CS2.
  const view = await page.locator('canvas[data-duel]').boundingBox();
  const stretch = Number(await page.locator('.duel-view .follow-origin').evaluate(element => getComputedStyle(element).getPropertyValue('--cross-stretch')));
  expect(stretch).toBeCloseTo(view!.width / view!.height / (4 / 3), 2);
  await page.keyboard.press('Numpad6');
  await expect.poll(() => crosshairStyle(page)).toContain('--cross-color: #ffff00');

  // `toggle cl_radar_scale 0.3 1` zooms the radar without restarting the round.
  await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
  const ammo = async () => Number((await page.locator('.duel-ammo strong').innerText()).split('/')[0].trim());
  await expect.poll(ammo).toBeLessThan(30);
  const left = await ammo();
  await page.keyboard.press('KeyV');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.duel.v1')!).radarScale)).toBe(.3);
  expect(await ammo()).toBe(left);

  await page.reload();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Crosshair', exact: true}).click();
  await expect(page.getByText('Matches your CS2 crosshair convars at 1080p')).toBeVisible();
  await expect(page.getByLabel('Length', {exact: true})).toHaveValue('0');
  await page.getByLabel('Length', {exact: true}).press('ArrowRight');
  await expect(page.getByText('Matches your CS2 crosshair convars')).toHaveCount(0);
  expect(errors).toEqual([]);
});
