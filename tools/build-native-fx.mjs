// Build a small, reproducible presentation subset from decoded installed particles.
// Usage: node tools/build-native-fx.mjs <decoded particle folder> <decoded texture folder>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';
import {additiveLinearAlpha} from './additive-texture.mjs';
const [folder, textures] = process.argv.slice(2);
assert(folder && textures, 'Provide decoded particle and texture folders');
const fx = JSON.parse(fs.readFileSync('src/range/weapon-fx-data.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sources = {};
function read(name) {
  const bytes = fs.readFileSync(path.join(folder, path.basename(name)));
  sources[path.basename(name)] = hash(bytes);
  return parseKv3(bytes.toString());
}
const field = (d, output) => d.m_Initializers?.find(i => i._class === 'C_INIT_InitFloat' && (i.m_nOutputField ?? 3) === output)?.m_InputValue;
const range = (v, fallback) => v?.m_nType === 'PF_TYPE_LITERAL' ? [v.m_flLiteralValue, v.m_flLiteralValue]
  : v?.m_nType?.includes('RANDOM') ? [v.m_flRandomMin, v.m_flRandomMax] : fallback;
const tracers = {};
for(const name of new Set(Object.values(fx.weapons).map(w=>w.tracerParticle).filter(n=>n?.includes('weapon_tracers_')&&!n.includes('taser')))) {
 let d=read(name);
 // AUG/SMGs/machine guns use ropes with distance-controlled lifetime.
 const fallback=!d.m_Initializers?.some(i=>i._class==='C_INIT_MoveBetweenPoints');
 if(fallback) {
   const controls=d.m_PreEmissionOperators.filter(o=>o._class==='C_OP_DistanceBetweenCPsToCP')
     .map(o=>({input:[o.m_flInputMin??0,o.m_flInputMax??1],output:[o.m_flOutputMin??0,o.m_flOutputMax??1]}));
   assert.equal(controls.length,2);
   tracers[path.basename(name,'.vpcf')]={kind:'rope',controls}; continue;
 }
 const move=d.m_Initializers.find(i=>i._class==='C_INIT_MoveBetweenPoints');
 const renderer=d.m_Renderers.find(r=>r._class==='C_OP_RenderTrails');
 assert(move && renderer, `Unsupported tracer ${name}`);
 const fade=d.m_Operators.find(o=>o._class==='C_OP_FadeAndKillForTracers');
 tracers[path.basename(name,'.vpcf')]={kind:'trail',speed:move.m_flSpeedMin.m_flLiteralValue,
   radius:range(field(d,3),[1,1])[0], trail:range(field(d,10),[.05,.05]),
   maxLength:renderer.m_flMaxLength, lengthFade:renderer.m_flLengthFadeInTime,
   radiusScale:typeof renderer.m_flRadiusScale==='number'?renderer.m_flRadiusScale:renderer.m_flRadiusScale.m_flLiteralValue, alpha:range(field(d,7),[1,1]),
   fadeIn:[fade?.m_flStartFadeInTime??0,fade?.m_flEndFadeInTime??0], fadeOut:fade?.m_flStartFadeOutTime??1};
}
const vent=read('weapon_muzzle_flash_assaultrifle_vent_fp.vpcf');
const noise=vent.m_Initializers.find(i=>i._class==='C_INIT_CreationNoise');
const smoke=read('weapon_muzzle_flash_smoke_small2.vpcf');
const profiles={
 rifle:{life:range(field(vent,1)),radius:[noise.m_flOutputMin,noise.m_flOutputMax],alpha:range(field(vent,7)),overbright:4,texture:'vent',fade:.025},
};
for(const [family,file] of Object.entries({pistol:'pistol_main2',silencedPistol:'pistol_main2_silenced',smg:'smg_main2',sniper:'huntingrifle_main2',shotgun:'shotgun_main2'})) {
 const d=read(`weapon_muzzle_flash_${file}.vpcf`), life=field(d,1);
 // Animated emission/radius curves are reduced to a bounded sprite envelope here.
 const lifetimes=range(life, [life.m_flOutput0,life.m_flOutput1].sort());
 profiles[family]={life:lifetimes,radius:family==='sniper'||family==='shotgun'?[3,6]:[3,5],alpha:range(field(d,7),[.2,.35]),
   overbright:family==='silencedPistol'?1:4,texture:'flame',fade:family.includes('Pistol')||family==='pistol'?.015:Math.min(...lifetimes)};
}
const exported={};
for(const [id,file] of Object.entries({vent:'materials/effects/muzzleflashx.png',flame:'materials/effects/muzzleflash4.png',glow:'materials/particle/particle_glow_04.png',smoke:'materials/particle/smoke1/smoke1_seq0.png'})) {
 const input=fs.readFileSync(path.join(textures,file));
 const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let pixels=data;
 if(id!=='smoke') pixels=additiveLinearAlpha(data);
 else {pixels=Buffer.from(data); for(let i=0;i<pixels.length;i+=4) pixels[i]=pixels[i+1]=pixels[i+2]=255;}
 const out=await sharp(pixels,{raw:info}).webp({lossless:true}).toBuffer();
 const url=`/textures/weapon-${id}.webp`;
 fs.writeFileSync(`public/revamp${url}`,out);
 exported[id]={url,source:file,sourceSha256:hash(input),sha256:hash(out),width:info.width,height:info.height};
}
const weapons=Object.fromEntries(Object.entries(fx.weapons).map(([id,row])=>[id,{
 ...(row.tracerParticle?.includes('weapon_tracers_')?{tracer:path.basename(row.tracerParticle,'.vpcf')}:{})
}]));
const output={build:'2000927',units:'Source inches; convert by 0.0254',sources,textures:exported,tracers,flashes:profiles,
 smoke:{life:range(field(smoke,1))[0],alpha:range(field(smoke,7)),radius:[4,7],endScale:3,fade:.18,speed:[100,120]},weapons,
 limits:'Reduced browser particle subset, not Source 2 graph/shader parity. Muzzle families and non-rifle radius envelopes remain presentation approximations; trail seed, CP3 scaling, some distance operators and two-layer native materials are not reproduced.'};
fs.writeFileSync('src/range/native-fx-data.json',JSON.stringify(output,null,2)+'\n');
console.log(`Built ${Object.keys(tracers).length} tracer profiles, ${Object.keys(profiles).length} flash envelopes and ${Object.keys(exported).length} textures.`);
