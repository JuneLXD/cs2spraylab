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
    for(const duck of [0,1])for(const phase of [0,.25,.5,.75])for(const velocity of [{x:3,z:0},{x:0,z:3}])
      cases.push({duck,phase,velocity,direction:Math.PI/2,yaw:.73});
    for(const pitch of [-1,1])for(const duck of [0,1])cases.push({duck,pitch,direction:Math.PI,yaw:1.1});
    for(const options of cases){
      preview.reset(options);let maxError=0,minY=Infinity,maxLinkError=0,maxPenetration=0,worstPair=null,minBend=Infinity,maxKnee=0,maxElbow=0,maxOffAxis=0,maxHeadRise=0,errorAt,overlapAt;
      const initial=preview.sample();
      const joint=(sample,name)=>sample.joints.find(j=>j.name===name).rendered;
      const torsoDistance=s=>Math.hypot(...joint(s,'neck_0').map((v,i)=>v-joint(s,'pelvis')[i]));
      const torso=torsoDistance(initial);
      for(let i=0;i<216;i++){
        preview.advance(1/60,false);const s=preview.sample();
        for(const j of s.joints){
          const error=Math.hypot(j.solver.x-j.rendered[0],j.solver.y-j.rendered[1],j.solver.z-j.rendered[2]);
          if(error>maxError){maxError=error;errorAt={age:s.age,joint:j.name};}
          minY=Math.min(minY,j.rendered[1]);
        }
        maxLinkError=Math.max(maxLinkError,Math.abs(torsoDistance(s)-torso));
        maxHeadRise=Math.max(maxHeadRise,joint(s,'head_0')[1]-joint(initial,'head_0')[1]);
        for(const angle of s.angles){
          minBend=Math.min(minBend,angle.bend);maxOffAxis=Math.max(maxOffAxis,angle.offAxis);
          if(angle.name.startsWith('leg'))maxKnee=Math.max(maxKnee,angle.bend);
          else maxElbow=Math.max(maxElbow,angle.bend);
        }
        if(s.age>=.2&&s.penetration>maxPenetration){maxPenetration=s.penetration;worstPair=s.worstPair;overlapAt=s.age;}
      }
      const end=preview.sample();
      results.push({options,maxError,minY,maxLinkError,maxPenetration,worstPair,minBend,maxKnee,maxElbow,maxOffAxis,maxHeadRise,
        errorAt,overlapAt,speed:end.stats.speed,sleeping:end.sleeping,headY:joint(end,'head_0')[1],hipY:joint(end,'pelvis')[1]});
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
    assert(r.minBend>-2&&r.maxKnee<112&&r.maxElbow<152,`Knees and elbows must bend within anatomical limits: ${context}`);
    assert(r.maxOffAxis<4,`Knees and elbows must not twist sideways: ${context}`);
    assert(r.maxHeadRise<.15,`Joint limits must not lift a crouched body upright: ${context}`);
    assert(r.sleeping,`Corpse must settle: ${context}`);
    const floor=r.options.boxes?.length ? .6 : 0;
    assert(r.headY<floor+.5&&r.hipY<floor+.4,`Corpse must lie down: ${context}`);
  }
  console.log(`${results.length} real-skeleton falls passed; no browser errors.`);
} finally {await browser.close();}
