import {expect, test} from '@playwright/test';

test('full-screen settings preserve controls, crosshair preview and the current loadout', async ({page}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', weapon: 'ak47', sidearm: 'deagle', quality: 'performance', showFps: false})); });
  await page.setViewportSize({width: 1600, height: 900});
  await page.goto('/');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  const box = (await dialog.boundingBox())!;
  expect(box).toMatchObject({x: 0, y: 0, width: 1600, height: 900});
  await page.getByLabel('Sensitivity', {exact: true}).fill('1.35');
  await page.getByLabel('Sensitivity', {exact: true}).press('Enter');
  await page.getByRole('tab', {name: 'Video', exact: true}).click();
  await page.getByLabel('Low-latency rendering').focus();
  await expect(page.getByRole('complementary', {name: 'About this setting'})).toContainText('Low-latency rendering');
  await page.getByLabel('Resolution', {exact: true}).selectOption('1920x1440');
  await page.getByLabel('Show FPS counter').check();
  await page.screenshot({path: 'test-results/ui-settings-video-1600.png'});
  await page.getByRole('tab', {name: 'Crosshair', exact: true}).click();
  await page.getByRole('button', {name: 'Dot', exact: true}).click();
  await expect(page.getByLabel('Center dot', {exact: true})).toBeChecked();
  await expect(page.getByRole('button', {name: 'Dot', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Compact', exact: true}).click();
  await page.getByLabel('Dynamic gap').check();
  // The motion gap comes from the engine's parent node, not a shadowing zero on the crosshair.
  const gapChange = await page.locator('.range-view .follow-origin').evaluate(element => {
    const host = element as HTMLElement, arm = element.querySelector('.crosshair .top')!;
    host.style.setProperty('--motion-gap', '0px');
    const before = parseFloat(getComputedStyle(arm).bottom);
    host.style.setProperty('--motion-gap', '8px');
    const after = parseFloat(getComputedStyle(arm).bottom);
    host.style.removeProperty('--motion-gap');
    return after - before;
  });
  expect(gapChange).toBe(8);
  await page.screenshot({path: 'test-results/ui-settings-crosshair-1600.png'});
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 720});
    await expect(page.getByRole('button', {name: 'Done', exact: true})).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `test-results/ui-settings-crosshair-${width}.png`});
    await page.getByRole('tab', {name: 'Video', exact: true}).click();
    await expect(page.getByLabel('Resolution')).toBeVisible();
    await page.screenshot({path: `test-results/ui-settings-video-${width}.png`});
    await page.getByRole('tab', {name: 'Crosshair', exact: true}).click();
  }
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.reload();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('1.35');
  await page.getByRole('tab', {name: 'Video', exact: true}).click();
  await expect(page.getByLabel('Resolution')).toHaveValue('1920x1440');
  await expect(page.getByLabel('Show FPS counter')).toBeChecked();
  await page.getByRole('button', {name: 'Restore defaults', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', {name: 'Settings', exact: true})).toBeFocused();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  expect(saved).toMatchObject({mode: 'guided', weapon: 'ak47', sidearm: 'deagle'});
  expect(errors).toEqual([]);
});
