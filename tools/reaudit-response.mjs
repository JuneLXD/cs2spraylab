// Reproducible trainer response/presentation measurements; run under the 8 GiB cap.
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {createServer} from 'vite';
const vite = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
  const {mouseAngle, Simulation}=await vite.ssrLoadModule('/src/range/simulation.ts');
  const {defaults}=await vite.ssrLoadModule('/src/range/config.ts');
  const {InputClock,inputTimestamp}=await vite.ssrLoadModule('/src/range/input-clock.ts');
  const {FramePacer,renderPixelRatio}=await vite.ssrLoadModule('/src/range/performance.ts');
  const {viewmodelFov,viewmodelOffset,viewmodelAspect}=await vite.ssrLoadModule('/src/range/viewmodel.ts');
  const {recoilView}=await vite.ssrLoadModule('/src/range/view-recoil.ts');
  const angles=[];
  for(const sensitivity of [.1,1,2,8])for(const count of [-100,1,100])angles.push({sensitivity,count,degrees:mouseAngle(count,sensitivity)*180/Math.PI});
  const clock=new InputClock();clock.reset(0);const elapsed=[];
  for(const timestamp of [10,8,16,16,1016,1020])clock.advance(timestamp,seconds=>elapsed.push({timestamp,seconds}));
  const pacers=[];
  for(const displayHz of [60,144,240])for(const limit of [0,60,120]){
    const p=new FramePacer(),times=[];
    for(let n=0;n<displayHz;n++){const at=n*1000/displayHz;if(p.ready(at,limit))times.push(at);}
    pacers.push({displayHz,limit,renderCount:times.length,intervalsMs:times.slice(1).map((t,i)=>t-times[i])});
  }
  const footsteps=[];
  for(const weapon of ['ak47','awp','glock'])for(const stance of ['run','walk','crouch']){
    const sim=new Simulation({...defaults,mode:'guided',weapon,burst:0,spread:false});sim.active=true;
    const events=[];sim.onSound=landing=>events.push({time:sim.time,landing,position:{...sim.position},speed:Math.hypot(sim.velocity.x,sim.velocity.z)});
    sim.input.side=1;sim.input.walk=stance==='walk';sim.input.crouch=stance==='crouch';
    for(let i=0;i<192;i++)sim.advance(1/128);
    footsteps.push({weapon,stance,events,intervals:events.slice(1).map((e,i)=>e.time-events[i].time)});
  }
  const report={baseline:'c488943',measurementDurationSeconds:1.5,angles,clock:elapsed,timestampCases:[-1,0,990,1001].map(t=>({input:t,now:1000,used:inputTimestamp(t,1000)})),pacers,footsteps,
    nativeQueries:'docs/evidence/reaudit-runtime-settings.json',
    viewmodel:{fov65Vertical:viewmodelFov(65),offset:viewmodelOffset({x:-.5,y:1,z:-2}),aspects:[16/9,4/3].map(a=>({worldAspect:a,modelAspect:viewmodelAspect(1920,1080,a)}))},
    recoilComposition:recoilView(0,0,{pitch:10,yaw:5},{pitch:1,yaw:2}),
    pixelRatios:['high','auto','performance'].map(quality=>({quality,ratio:renderPixelRatio(1920,1080,1,quality)})),
    limitations:['CPU arithmetic only; no claim of physical mouse-to-photon latency.','Footstep cadence, viewmodel recoil fraction, and unusual-aspect cropping require native comparison.','Requested raw pointer lock is not proof of OS-independent device counts.']};
  const out=resolve(process.argv[2]??'../native-audit/reports/reaudit-response-before.json');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');
}finally{await vite.close();}
