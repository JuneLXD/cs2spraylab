import {expect, type Page, type Locator} from '@playwright/test';
/** Drill selection moved from the toolbar into the pause/setup menu. */
export async function selectDrill(page: Page, mode: Parameters<Locator['selectOption']>[0]) {
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

/** Navigate through the actual menu instead of the removed toolbar button. */
export async function openLoadout(page: Page) {
  const dialog = page.getByRole('dialog', {name: 'Loadout', exact: true});
  if (await dialog.isVisible()) return dialog;
  if (!await page.getByRole('button', {name: 'Loadout', exact: true}).isVisible()) {
    await page.keyboard.press('Escape');
    const pause = page.locator('.sl-esc-hint button');
    if (await pause.isVisible()) await pause.click();
  }
  await page.getByRole('button', {name: 'Loadout', exact: true}).click();
  return dialog;
}
export async function chooseWeapon(page: Page, id: string, close = true) {
  const {weaponNames, pistolIds} = await page.evaluate(async () => {
    const url = new URL('/src/range/config.ts', location.href).href;
    const {weaponNames, pistolIds} = await import(/* @vite-ignore */ url);
    return {weaponNames, pistolIds};
  });
  const dialog = await openLoadout(page);
  const sidearm = (pistolIds as readonly string[]).includes(id);
  if (id === 'zeus') {
    await dialog.getByRole('button', {name: 'Select zeus slot'}).click();
  } else {
    await dialog.getByRole('button', {name: `Select ${sidearm ? 'sidearm' : 'primary'} slot`}).click();
    const category = sidearm ? 'Pistols' : ['awp','ssg08','g3sg1','scar20'].includes(id) ? 'Snipers'
      : ['mp9','mp7','mp5sd','mac10','ump45','p90','bizon'].includes(id) ? 'SMGs'
      : ['m249','negev','nova','xm1014','mag7','sawedoff'].includes(id) ? 'Heavy' : 'Rifles';
    await dialog.getByRole('tab', {name: category, exact: true}).click();
    await dialog.getByRole('button', {name: `Equip ${weaponNames[id as keyof typeof weaponNames]}`, exact: true}).click();
    if (close && sidearm) await dialog.getByLabel('Carry a primary weapon').uncheck();
  }
  if (close) await dialog.getByRole('button', {name: 'Close panel', exact: true}).click();
}
