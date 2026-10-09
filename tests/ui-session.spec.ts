import {expect,test} from '@playwright/test';
test('Home uses saved sessions and timed practice opens Results with a new-session action',async({page})=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'botz',weapon:'ak47',quality:'performance',volume:0,protectShortcuts:false}));
    localStorage.setItem('spraylab.botz.v1',JSON.stringify({botCount:1,sessionSeconds:30,shortcutProtection:false}));
    localStorage.setItem('spraylab.redline.history.v1',JSON.stringify([{date:new Date().toISOString(),weapon:'awp',distance:'far',movement:'strafe',headshotOnly:false,seconds:120,kills:38,headshotRate:63,accuracy:71,killsPerMinute:19}]));
  });
  await page.setViewportSize({width:1600,height:900});await page.goto('/');
  await page.getByRole('button',{name:'SprayLab home'}).click();
  await expect(page.getByRole('region',{name:'Home',exact:true})).toBeVisible();
  await expect(page.locator('.sl-recent')).toContainText('19.0');
  await page.screenshot({path:'test-results/ui-home-1600.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/ui-home-390.png'});
  await page.getByRole('button',{name:'Session',exact:false}).first().click();
  await page.getByRole('tab',{name:'aim_redline',exact:true}).click();
  await expect(page.getByRole('region',{name:'aim_redline stats'})).toContainText('38 kills');
  await expect(page.getByRole('button',{name:'Export aim_redline history'})).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.setViewportSize({width:1600,height:900});
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */ url);const report=DuelEngine.prototype.report;
    DuelEngine.prototype.report=function(){(window as any).uiSessionEngine=this;return report.call(this);};
  });
  await page.waitForFunction(()=>!!(window as any).uiSessionEngine);
  await page.getByRole('button',{name:'Start Aim Botz',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause Aim Botz'})).toBeVisible();
  // End a timed simulation with a known score to verify result-to-menu data transfer.
  await page.evaluate(()=>{
    const engine=(window as any).uiSessionEngine;
    Object.assign(engine.sim.botzStats,{shots:8,hits:6,kills:5,headshots:3,headHits:4,bestHeadshotStreak:2});
    engine.sim.time=29.99;
  });
  await expect(page.getByRole('region',{name:'Session complete',exact:true})).toBeVisible({timeout:20000});
  await expect(page.locator('.sl-result-tiles')).toContainText('75%');
  await expect(page.locator('.sl-result-banner')).toContainText('30s');
  await expect(page.locator('.sl-session-now')).toContainText('NOW');
  await expect.poll(()=>page.evaluate(()=>!!document.pointerLockElement)).toBe(false);
  await page.screenshot({path:'test-results/ui-results-1600.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/ui-results-390.png'});
  await expect(page.getByRole('button',{name:'New session',exact:true})).toBeInViewport();
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause Aim Botz'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Session complete',exact:true})).toBeHidden();
  expect(errors).toEqual([]);
});
