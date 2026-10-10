// Actual range/Duel callbacks on bounded, collision-free traversals. Run under 8 GiB cap.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const {Simulation}=await vite.ssrLoadModule('/src/range/simulation.ts');
 const {defaults}=await vite.ssrLoadModule('/src/range/config.ts');
 const {DuelSimulation}=await vite.ssrLoadModule('/src/range/duel/simulation.ts');
 const {sanitizeDuelConfig}=await vite.ssrLoadModule('/src/range/duel/config.ts');
 const {testArena}=await vite.ssrLoadModule('/src/range/duel/geometry.ts');
 const rows=[];
 for(const engine of ['range','duel'])for(const weapon of ['ak47','awp','knife'])for(const stance of ['run','walk','crouch']){
  const primary=weapon==='knife'?'ak47':weapon,events=[];
  const sim=engine==='range'?new Simulation({...defaults,mode:'guided',weapon:primary,burst:0,spread:false}):new DuelSimulation(sanitizeDuelConfig({botCount:1}),42,testArena(),primary);
  if(engine==='range'){if(weapon==='knife')sim.equip(3);sim.active=true;sim.onSound=landing=>{if(!landing)events.push({time:sim.time,position:{...sim.position}})};}
  else{if(weapon==='knife')sim.equipPlayer(3);sim.command(1,{side:0,forward:0,fireHeld:false});sim.start();}
  const advance=()=>{if(engine==='range')sim.advance(1/128);else {sim.step(1/128);for(const e of sim.drainEvents())if(e.kind==='sound'&&e.sound==='footstep'&&e.actorId===0)events.push({time:sim.time,position:e.point});}};
  for(let i=0;i<64;i++)advance();
  const input={side:1,walk:stance==='walk',crouch:stance==='crouch'};
  if(engine==='range')Object.assign(sim.input,input);else sim.command(0,input);
  const speeds=[];
  for(let i=0;i<192;i++){advance();const a=engine==='range'?sim:sim.actors[0];speeds.push(Math.hypot(a.velocity.x,a.velocity.z)/.0254);}
  rows.push({engine,weapon,stance,duration:1.5,events,intervals:events.slice(1).map((e,i)=>e.time-events[i].time),tailSpeed:Math.min(...speeds.slice(-16))});
 }
 writeFileSync(resolve(process.argv[2]??'../native-audit/reports/reaudit-footsteps/trainer-before.json'),JSON.stringify({durationSeconds:1.5,rows,limits:['Short flat dry-ground traversals; audio callback timing, not rendered sound onset.','NPC hearing/mixer, water, ladder and special landing events are outside this probe.']},null,2)+'\n');
}finally{await vite.close()}
