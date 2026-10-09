import {expect,test} from '@playwright/test';
test('kill feed uses shot events, shows headshots, bounds entries and clears on restart',async({page})=>{
  test.setTimeout(120000);
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'botz',weapon:'ak47',quality:'performance',volume:0}));
    localStorage.setItem('spraylab.botz.v1',JSON.stringify({botCount:1,shortcutProtection:false}));
  });
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */ url);const report=DuelEngine.prototype.report;
    DuelEngine.prototype.report=function(){(window as any).feedEngine=this;return report.call(this);};
  });
  await page.waitForFunction(()=>!!(window as any).feedEngine);
  await page.getByRole('button',{name:'Start Aim Botz',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause Aim Botz'})).toBeVisible();
  await page.evaluate(()=>{
    const engine=(window as any).feedEngine, actor=engine.sim.actors[0], victim=engine.sim.actors[1];
    // A multi-tick frame can deliver a lethal event after its victim has respawned.
    for(let i=0;i<7;i++)engine.processEvents([
      {kind:'fire',tick:i,actorId:0,shotId:900+i,equipment:'deagle',origin:{...actor.position},direction:{x:0,y:0,z:-1}},
      {kind:'hit',tick:i,shooter:0,victim:1,shotId:900+i,group:'head',point:{...victim.position},healthDamage:100,armorDamage:0,lethal:true},
    ]);
    engine.report();
  });
  await expect(page.locator('.sl-kill-feed li')).toHaveCount(5);
  await expect(page.locator('.sl-kill-feed li').first()).toHaveAttribute('aria-label','You killed Bot 1 with Desert Eagle, headshot');
  await page.screenshot({path:'test-results/ui-kill-feed.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause Aim Botz'})).toBeVisible();
  await expect(page.locator('.sl-kill-feed li')).toHaveCount(0);
});
