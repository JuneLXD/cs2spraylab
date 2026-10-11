// Isolated real-skeleton captures without loading a map, weapon skins or game HUD.
// Run under the host memory cap against Vite:
// node tools/capture-death-preview.mjs <output-directory> [JSON-options] [frame-count]
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium',args:['--renderer-process-limit=1']});
try {
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://192.168.0.18:5184/tools/death-preview.html');
  await page.waitForFunction(()=>window.deathPreview,undefined,{timeout:60000});
  const frames=[];
  const options=JSON.parse(process.argv[3]??'{}');
  await page.evaluate(options=>window.deathPreview.reset(options),options);
  if(options.camera)await page.evaluate(options=>window.deathPreview.view(options.camera,options.target??[0,.6,0]),options);
  for(let i=0;i<Number(process.argv[4]??13);i++) {
    const file=`death-${String(i).padStart(2,'0')}.png`;
    await page.screenshot({path:path.join(out,file)});
    frames.push({file,...await page.evaluate(()=>window.deathPreview.sample())});
    await page.evaluate(()=>window.deathPreview.advance(.1));
  }
  fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({options,errors,frames},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({out,errors,final:frames.at(-1)},null,2));
} finally {await browser.close();}
