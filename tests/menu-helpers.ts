import {expect, type Page} from '@playwright/test';
/** Drill selection moved from the toolbar into the pause/setup menu. */
export async function selectDrill(page: Page, mode: string) {
  const select = page.getByLabel('Training mode');
  if (!await select.isVisible()) {
    const close = page.getByRole('button', {name: 'Close panel', exact: true});
    if (await close.isVisible()) await close.click();
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape');
    const back = page.getByRole('button', {name: 'Back to Play', exact: true});
    if (await back.isVisible()) await back.click();
    const play = page.getByRole('button', {name: 'Play', exact: true});
    if (await play.isVisible()) await play.click();
  }
  await expect(select).toBeVisible();
  await select.selectOption(mode);
}
