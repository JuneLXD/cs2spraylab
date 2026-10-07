import {expect, test, type Page} from '@playwright/test';

async function fullscreenFillsWith(page: Page, view: string, panel: string) {
  await expect(page.locator(panel)).toBeVisible();
  await page.getByRole('button', {name: 'Fullscreen', exact: true}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator(panel)).toBeHidden();
  const [viewBox, stageBox] = [await page.locator(view).boundingBox(), await page.locator('.range-stage').boundingBox()];
  expect(Math.abs(viewBox!.width - stageBox!.width)).toBeLessThan(2);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(panel)).toBeVisible();
}

test('fullscreen shows only the game view, without side panels', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop fullscreen');
  await page.goto('/');
  await fullscreenFillsWith(page, '.duel-view', '.duel-controls');
  await page.getByLabel('Training mode').selectOption('peek');
  await fullscreenFillsWith(page, '.range-view', '.drill-panel');
});
