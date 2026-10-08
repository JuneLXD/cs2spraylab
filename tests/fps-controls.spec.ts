import {expect, test} from '@playwright/test';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

test('FPS controls work before mouse capture across browser engines', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const toggle = page.getByRole('button', {name: 'Toggle FPS counter', exact: true});
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.getByLabel('Performance monitor')).toBeVisible();
  await expect(page.getByLabel('Performance monitor')).toContainText(/\d+ FPS/);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Show FPS counter')).toBeChecked();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByLabel('Training mode').selectOption('guided');
  await expect(page.getByLabel('Performance monitor')).toBeVisible();
  await toggle.click();
  await expect(page.getByLabel('Performance monitor')).toBeHidden();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
