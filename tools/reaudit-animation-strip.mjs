// Deterministic native-clip versus trainer animation strips (one browser process).
// Requires a Vite server on --base; do not run while anyone edits the repository.
// Run with MemoryMax=8G, MemorySwapMax=0, CPUQuota=400%.
// --mode world --action run_e_rifle | --mode view --weapon ak47 --action reload|fire|draw|inspect
// --mode mount --weapon revolver --action sequence compares runtime idle/charge/fire/cancel before and after.
// Native pane samples exported clips; trainer pane uses the actual runtime animator.
// This is an animation comparison, not a reproduction of Source 2 lighting/IK.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i<0?fallback:process.argv[i+1];};
const mode=arg('mode','world'),weapon=arg('weapon','ak47'),action=arg('action',mode==='world'?'run_e_rifle':'reload');
const base=arg('base','http://192.168.0.18:5176'),out=path.resolve(arg('out',`research/reaudit-animation/strips/${mode}-${weapon}-${action}`));
const frames=Number(arg('frames','12')),step=Number(arg('step','0.1'));
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // The Vite origin supplies transformed Three.js/TS modules; the normal application is never booted.
 await page.goto(`${base}/@vite/client`);
 await page.setContent('<style>body{margin:0;background:#202632;color:#fff;font:16px sans-serif}#label{position:absolute;top:48px;left:20px;z-index:2;white-space:pre}.pane{position:absolute;top:16px;width:50%;text-align:center;z-index:2}</style><div class="pane" id="left"></div><div class="pane" id="right" style="left:50%"></div><div id="label"></div>');
 await page.evaluate(async({base,mode,weapon,action})=>{
  const THREE=await import(`${base}/node_modules/three/build/three.module.js`);
  const {GLTFLoader}=await import(`${base}/node_modules/three/examples/jsm/loaders/GLTFLoader.js`);
  const {DuelAnimator}=await import(`${base}/src/range/duel/animation.ts`);
  const {ViewAnimation}=await import(`${base}/src/range/view-animation.ts`);
  const {equipmentStats}=await import(`${base}/src/range/equipment.ts`);
  const selection=await fetch(`${base}/research/reaudit-animation/view-selection.json`).then(r=>r.json());
  const load=url=>new GLTFLoader().loadAsync(`${base}/${url}`);
  const native=await load(mode==='mount'?`research/reaudit-animation/before/view-${weapon}.glb`:'research/reaudit-animation/native-composed.glb');
  const trainer=await load(mode==='world'?'models/target.glb':`models/view-${weapon}.glb`);
  const motion=mode==='world'?await load('models/duel-motion.glb'):null;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#202632');
  scene.add(new THREE.HemisphereLight(0xffffff,0x707080,3));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,5);scene.add(light);
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(1280,720);document.body.append(renderer.domElement);
  // Identical cameras/placement in two independent viewports avoid lateral parallax.
  const camera=new THREE.PerspectiveCamera(45,640/720,.01,30);
  renderer.setScissorTest(true);
  if(mode==='world'){camera.position.set(0,1,4.6);camera.lookAt(0,.95,0);}else{camera.position.set(0,0,-2.6);camera.lookAt(0,0,0);}
  for(const [i,asset]of [native,trainer].entries()){
   asset.scene.traverse(o=>{if(o.isMesh){
    const n=o.name.toLowerCase();o.visible=mode==='world'?n.includes('thirdperson_'):mode==='mount'?true:n.includes('firstperson_');
    o.material=new THREE.MeshStandardMaterial({color:i===0?0x82b8ec:0xe2c18c,roughness:.8});o.frustumCulled=false;
   }});
   asset.scene.position.x=0;scene.add(asset.scene);
  }
  const nativeName=mode==='world'?'/'+action:mode==='mount'?(action==='sequence'?'charge':action):selection[weapon][action].replace(/\.vnmclip_c$/,'');
  const nativeClip=native.animations.find(c=>mode==='world'?c.name.endsWith(nativeName):c.name===nativeName);
  if(!nativeClip)throw new Error('Missing native clip '+nativeName);
  const nm=new THREE.AnimationMixer(native.scene),na=nm.clipAction(nativeClip);if(mode!=='mount'){na.play();na.paused=true;}
  const stats=equipmentStats(weapon),duration=action==='reload'?stats.reload:action==='draw'?stats.deploy:action==='charge'||action==='sequence'?13/64:nativeClip.duration;
  const actor={id:1,equipment:weapon,alive:true,grounded:true,feet:0,velocity:{x:0,z:0},yaw:0,pitch:0,duckAmount:action.startsWith('crouch_')||action.startsWith('idle_crouch')?1:0,position:{x:0,y:1.6256,z:0},health:100};
  const speed=action.startsWith('walk_')?136*.0254:action.startsWith('crouch_')?96*.0254:225*.0254;
  const direction=action.split('_')[1],directions={n:[0,-1],ne:[Math.SQRT1_2,-Math.SQRT1_2],e:[1,0],se:[Math.SQRT1_2,Math.SQRT1_2],s:[0,1],sw:[-Math.SQRT1_2,Math.SQRT1_2],w:[-1,0],nw:[-Math.SQRT1_2,-Math.SQRT1_2]};
  if(directions[direction]&&!action.startsWith('idle')){actor.velocity.x=directions[direction][0]*speed;actor.velocity.z=directions[direction][1]*speed;}
  const animator=mode==='world'?new DuelAnimator(trainer.scene,motion.animations,0,weapon):new ViewAnimation(trainer.scene,trainer.animations);
  const originalAnimator=mode==='mount'?new ViewAnimation(native.scene,native.animations):null;
  if(mode!=='world'){if(action==='fire')animator.playFire(weapon);else if(action==='draw')animator.playDraw(duration);else if(action==='inspect')animator.playInspect();}
  if(originalAnimator){if(action==='fire')originalAnimator.playFire(weapon);else if(action==='draw')originalAnimator.playDraw(duration);else if(action==='inspect')originalAnimator.playInspect();}
  const events=[{time:.2,event:'charge'},{time:.2+13/64,event:'fire'},{time:.65,event:'cancel'},{time:.8,event:'charge'},{time:.9,event:'cancel'}];
  let previous=0,eventIndex=0,charging=false,stage='idle';
  const advance=(view,dt)=>view.update(0,1,dt,{charging,chargeDuration:13/64});
  document.getElementById('left').textContent=mode==='mount'?'Original runtime assembly (blue)':'Native exported clip (blue)';
  document.getElementById('right').textContent='Trainer runtime (gold)';
  window.sampleAnimation=time=>{
   const dt=time-previous;
   if(mode==='mount'&&action==='sequence'){
    let cursor=previous;
    while(eventIndex<events.length&&events[eventIndex].time<=time+1e-8){
     const event=events[eventIndex++];for(const view of [originalAnimator,animator])advance(view,event.time-cursor);cursor=event.time;
     charging=event.event==='charge';stage=event.event;
     for(const view of [originalAnimator,animator]){if(event.event==='fire')view.playFire(weapon);else if(event.event==='cancel')view.cancel();advance(view,0);}
    }
    for(const view of [originalAnimator,animator])advance(view,time-cursor);
   }
   previous=time;
   if(mode==='world'){na.time=nativeClip.duration?time%nativeClip.duration:0;animator.update(actor,dt);}
   else if(action!=='sequence'){na.time=Math.min(nativeClip.duration,time/duration*nativeClip.duration);if(action==='reload')animator.update(Math.max(0,duration-time),duration,dt,{equipment:weapon,reloadPhase:time<duration?'magazine':'idle',reloadProgress:Math.min(1,time/duration)});else animator.update(0,1,dt,{charging:action==='charge',chargeDuration:duration});}
   if(originalAnimator&&action!=='sequence'){
    if(action==='reload')originalAnimator.update(Math.max(0,duration-time),duration,dt,{equipment:weapon,reloadPhase:time<duration?'magazine':'idle',reloadProgress:Math.min(1,time/duration)});
    else originalAnimator.update(0,1,dt,{charging:action==='charge',chargeDuration:duration});
   }
   if(mode!=='mount')nm.update(0);scene.updateMatrixWorld(true);
   for(let pane=0;pane<2;pane++){
    native.scene.visible=pane===0;trainer.scene.visible=pane===1;
    renderer.setViewport(pane*640,0,640,720);renderer.setScissor(pane*640,0,640,720);
    renderer.render(scene,camera);
   }
   native.scene.visible=true;trainer.scene.visible=true;
   const p=asset=>Object.fromEntries(['head_0','arm_lower_L','arm_lower_R','hand_L','hand_R','finger_index_2_R','wpn','hammer'].map(name=>[name,asset.scene.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).sub(asset.scene.position).toArray()]));
   document.getElementById('label').textContent=`${mode} ${weapon} ${action} | t=${time.toFixed(3)} s | ${action==='sequence'?stage:action} | neutral materials`;
   return {time,stage,originalAction:originalAnimator?.activeAction,trainerAction:mode==='world'?action:animator.activeAction,nativeClip:nativeClip.name,nativeDuration:nativeClip.duration,mechanicalDuration:duration,native:p(native),trainer:p(trainer)};
  };
 },{base,mode,weapon,action});
 const rows=[];
 for(let i=0;i<frames;i++){
  rows.push(await page.evaluate(t=>window.sampleAnimation(t),i*step));
  await page.screenshot({path:path.join(out,`${String(i).padStart(3,'0')}.png`)});
 }
 fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({frames:rows.map((row,i)=>({file:`${String(i).padStart(3,'0')}.png`,age:row.time,stage:row.stage}))},null,2));
 fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify({mode,weapon,action,step,rows,errors},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 process.stdout.write(`${out}\n`);
}finally{await browser.close();}
