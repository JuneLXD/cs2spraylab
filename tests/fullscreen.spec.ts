import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';
test('fullscreen keeps menus available and the game view fills the stage', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop fullscreen');
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'duel',weapon:'ak47',quality:'performance'})));
  await page.goto('/');
  await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByLabel('Play setup')).toBeVisible();
  await expect(page.locator('.duel-controls')).toBeVisible();
  for (const mode of ['duel','peek']) {
    await selectDrill(page, mode);
    const [view,stage] = [await page.locator('.sl-game-view').boundingBox(),await page.locator('.range-stage').boundingBox()];
    expect(view!.width).toBeCloseTo(stage!.width,0);
    expect(view!.height).toBeCloseTo(stage!.height,0);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByLabel('Play setup')).toBeVisible();
});
