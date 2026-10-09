import {expect, test} from '@playwright/test';
test('loadout keeps primary and sidearm independent, equips finishes and opens the Armory', async ({page}) => {
  test.setTimeout(120000);
  const errors:string[]=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('spraylab.range.v2'))localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'guided',weapon:'ak47',quality:'performance',volume:0}));});
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:'Loadout',exact:true}).click();
  const availableNames = await page.evaluate(async () => {
    const url = new URL('/src/range/config.ts', location.href).href;
    const {weaponNames} = await import(/* @vite-ignore */ url);
    return Object.entries(weaponNames).filter(([id])=>id !== 'zeus').map(([,name])=>name).sort();
  });
  const listedNames:string[]=[];
  for(const category of ['Rifles','Snipers','SMGs','Heavy']) {
    await page.getByRole('tab',{name:category,exact:true}).click();
    listedNames.push(...await page.locator('.sl-weapon-tiles button span').allTextContents());
  }
  await page.getByRole('button',{name:'Select sidearm slot'}).click();
  listedNames.push(...await page.locator('.sl-weapon-tiles button span').allTextContents());
  expect(listedNames.sort()).toEqual(availableNames);
  await page.getByRole('button',{name:'Select primary slot'}).click();
  await page.getByRole('tab',{name:'Rifles',exact:true}).click();
  await page.getByRole('button',{name:'Equip AUG',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.range.v2')!).weapon)).toBe('aug');
  await page.getByRole('tab',{name:'Snipers',exact:true}).click();
  await page.getByRole('button',{name:'Equip AWP',exact:true}).click();
  await page.getByRole('button',{name:'Equip AWP skin Printstream',exact:true}).click();
  await expect(page.getByRole('button',{name:'Equip AWP skin Printstream',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:'test-results/ui-loadout-1600.png'});
  await page.getByRole('button',{name:'Select sidearm slot'}).click();
  await page.getByRole('button',{name:'Equip Desert Eagle',exact:true}).click();
  await expect(page.getByLabel('Carry a primary weapon')).toBeChecked();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.range.v2')!).weapon)).toBe('awp');
  await page.getByRole('button',{name:'Select primary slot'}).click();
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:width===390?844:720});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/ui-loadout-${width}.png`});
  }
  await page.getByRole('button',{name:'Select agent slot'}).click();
  await page.getByRole('button',{name:'Open the armory: weapon finishes, knives, gloves and agents'}).click();
  await expect(page.locator('dialog.progression-armory')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Close panel',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Loadout',exact:true}).click();
  await expect(page.getByRole('button',{name:'Equip AWP skin Printstream',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});
