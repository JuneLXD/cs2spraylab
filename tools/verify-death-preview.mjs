// Real-asset contact/mapping checks in the isolated preview. Run under the host memory cap.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chromium',args:['--renderer-process-limit=1']});
try {
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://192.168.0.18:5184/tools/death-preview.html');
  await page.waitForFunction(()=>window.deathPreview,undefined,{timeout:60000});
  const results=await page.evaluate(()=>{
    const preview=window.deathPreview,results=[];
    const cases=[];
    for(const duck of [0,.5,1])for(const direction of [0,Math.PI/2,Math.PI])for(const group of ['chest','head','leg'])
      cases.push({duck,direction,group});
    cases.push({duck:0,direction:0,velocity:{x:2,z:0},phase:.35},{duck:0,direction:0,height:1,velocity:{x:1,z:0}},
      {duck:0,direction:0,height:.6,boxes:[{center:{x:0,y:.3,z:0},size:{x:6,y:.6,z:6}}]});
    for(const options of cases){
      preview.reset(options);let maxError=0,minY=Infinity,maxLinkError=0,maxPenetration=0,worstPair=null;
      const initial=preview.sample();
      const joint=(sample,name)=>sample.joints.find(j=>j.name===name).rendered;
      const torsoDistance=s=>Math.hypot(...joint(s,'neck_0').map((v,i)=>v-joint(s,'pelvis')[i]));
      const torso=torsoDistance(initial);
      for(let i=0;i<36;i++){
        preview.advance(.1);const s=preview.sample();
        for(const j of s.joints){
          maxError=Math.max(maxError,Math.hypot(j.solver.x-j.rendered[0],j.solver.y-j.rendered[1],j.solver.z-j.rendered[2]));
          minY=Math.min(minY,j.rendered[1]);
        }
        maxLinkError=Math.max(maxLinkError,Math.abs(torsoDistance(s)-torso));
        if(s.age>=.2&&s.penetration>maxPenetration){maxPenetration=s.penetration;worstPair=s.worstPair;}
      }
      const end=preview.sample();
      results.push({options,maxError,minY,maxLinkError,maxPenetration,worstPair,sleeping:end.sleeping,headY:joint(end,'head_0')[1],hipY:joint(end,'pelvis')[1]});
    }
    return results;
  });
  fs.writeFileSync(process.argv[2],JSON.stringify({errors,results},null,2));
  assert.deepEqual(errors,[]);
  for(const r of results){
    const context=JSON.stringify(r);
    assert(r.maxError<.055,`Rendered skeleton must follow contacts: ${context}`);
    assert(r.minY>-.035,`Body must stay above floor: ${context}`);
    assert(r.maxLinkError<.035,`Torso must retain its length: ${context}`);
    assert(r.maxPenetration<.025,`Body volumes must remain separated: ${context}`);
    assert(r.sleeping,`Corpse must settle: ${context}`);
    const floor=r.options.boxes?.length ? .6 : 0;
    assert(r.headY<floor+.5&&r.hipY<floor+.4,`Corpse must lie down: ${context}`);
  }
  console.log(`${results.length} real-skeleton falls passed; no browser errors.`);
} finally {await browser.close();}
