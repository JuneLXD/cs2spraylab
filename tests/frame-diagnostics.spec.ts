import {test,expect} from '@playwright/test';
test('saves bounded gameplay frame timings after leaving pointer lock',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'guided',weapon:'ak47',quality:'performance',volume:0,showFps:true,protectShortcuts:false})));
  await page.goto('/');
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect(page.getByRole('button',{name:'Performance monitor'})).toContainText('p95');
  await page.waitForTimeout(700);await page.keyboard.press('Escape');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Performance monitor'}).click();
  const file=await download;expect(file.suggestedFilename()).toBe('spraylab-frame-times.json');
  const stream=await file.createReadStream();let body='';for await(const chunk of stream!)body+=chunk;
  const report=JSON.parse(body);expect(report.frames.length).toBeGreaterThan(0);expect(report.frames.length).toBeLessThanOrEqual(2048);
  expect(report.frames.every((f:{intervalMs:number;cpuMs:number})=>f.intervalMs>0&&f.cpuMs>=0)).toBe(true);
  expect(report.note).toContain('not physical input latency');
});
