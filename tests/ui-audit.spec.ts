import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('spraylab.range.v2')) return;
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',weapon:'ak47',sidearm:'deagle',sensitivity:1.4,quality:'performance',resolution:'native',volume:0,protectShortcuts:false}));
    for (const kind of ['botz','reflex','redline']) localStorage.setItem(`spraylab.${kind}.v1`,JSON.stringify({botCount:2,sessionSeconds:0,shortcutProtection:false}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:1,skill:1,shortcutProtection:false}));
    localStorage.setItem('spraylab.setup-hint.v1','seen');
    Object.defineProperty(HTMLElement.prototype,'requestPointerLock',{value:undefined,configurable:true});
  });
});

test('all eleven drills can be selected, started and returned to setup', async ({page}) => {
  test.setTimeout(240000);
  await page.setViewportSize({width:1000,height:700});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('Training mode').locator('option')).toHaveCount(11);
  for (const mode of ['guided','spray','transfer','peek','precision','burst','duel','botz','reflex','redline','hearing']) {
    await selectDrill(page,mode);
    await page.locator('.sl-go').click({timeout:90000});
    if(mode==='hearing') {
      await expect(page.getByRole('region',{name:'Hearing practice',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Back to Play'}).click();
    } else {
      await expect(page.locator('.sl-esc-hint button')).toBeVisible();
      await expect(page.getByLabel('Play setup')).toBeHidden();
      await page.locator('.sl-esc-hint button').click();
    }
    await expect(page.getByLabel('Play setup')).toBeVisible();
    await expect(page.getByLabel('Training mode')).toHaveValue(mode);
  }
  expect(errors).toEqual([]);
});

test('Home equipment shortcuts, page navigation and drill defaults retain unrelated preferences', async ({page}) => {
  test.setTimeout(180000);
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:'SprayLab home'}).click();
  for(const slot of ['sidearm','knife','zeus','primary']) {
    await page.getByRole('button',{name:`Open ${slot} loadout`}).click();
    const dialog=page.getByRole('dialog',{name:'Loadout',exact:true});
    await expect(dialog.getByRole('button',{name:`Select ${slot} slot`})).toHaveAttribute('aria-pressed','true');
    await expect(dialog.getByRole('button',{name:'Loadout',exact:true})).toHaveAttribute('aria-current','page');
    await dialog.getByRole('button',{name:'Close panel',exact:true}).click();
  }
  await page.getByRole('button',{name:'Loadout',exact:true}).click();
  await page.getByRole('dialog',{name:'Loadout',exact:true}).getByRole('button',{name:/^Session/}).click();
  await expect(page.getByRole('dialog',{name:'Session history'}).getByRole('button',{name:/^Session/})).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.getByLabel('Burst length').selectOption('5');
  await page.getByLabel('Practice spread').check();
  await page.getByRole('button',{name:'Restore drill defaults'}).click();
  await expect(page.getByLabel('Burst length')).toHaveValue('0');
  await expect(page.getByLabel('Practice spread')).not.toBeChecked();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.range.v2')!));
  expect(saved).toMatchObject({weapon:'ak47',sidearm:'deagle',sensitivity:1.4,quality:'performance',mode:'guided'});
  for(const [mode,count] of [['botz','10'],['reflex','5'],['redline','3'],['duel','1']]) {
    await selectDrill(page,mode);
    const bots=page.getByLabel('Number of bots',{exact:true});
    await bots.press('Home');
    for(let i=0;i<3;i++) await bots.press('ArrowRight');
    await page.getByRole('button',{name:'Restore drill defaults'}).click();
    await expect(bots).toHaveValue(count);
  }
});

test('range HUD reload progress follows the native reload clock', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.locator('.sl-go').click();
  await page.locator('canvas[data-range]').click();
  await expect(page.getByRole('button',{name:'Reload',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Reload',exact:true}).click();
  await expect(page.getByRole('progressbar',{name:'Reload progress'})).toBeVisible();
  await expect(page.locator('.hud-ammo')).toContainText('Reloading');
  await expect(page.getByRole('progressbar',{name:'Reload progress'})).toHaveCount(0,{timeout:10000});
});
