import native from './native-fx-data.json';
import source from './weapon-fx-data.json';
import type {Equipment} from './equipment';

export const FX_UNIT = .0254;
export type TracerProfile = {kind:'trail';speed:number;radius:number;trail:number[];maxLength:number;lengthFade:number;
  radiusScale:number;alpha:number[];fadeIn:number[];fadeOut:number} |
  {kind:'rope';controls:{input:number[];output:number[]}[]};
const profiles = native.tracers as Record<string,TracerProfile>;
export function tracerProfile(equipment:Equipment):TracerProfile {
  const key=(native.weapons[equipment] as {tracer?:string}).tracer;
  return profiles[key??'weapon_tracers_assrifle'];
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
export function tracerDuration(profile:TracerProfile,distance:number) {
  if(profile.kind==='trail') return distance/(profile.speed*FX_UNIT);
  return profile.controls.reduce((life,c)=>life*(c.output[0]+(c.output[1]-c.output[0])*
    clamp((distance/FX_UNIT-c.input[0])/(c.input[1]-c.input[0]))),1);
}
/** Cosmetic position only: hit registration is already complete before this runs. */
export function tracerSegment(profile:TracerProfile,distance:number,age:number,out:{start:number;end:number;alpha:number}) {
  const duration=tracerDuration(profile,distance), t=clamp(age/Math.max(duration,1e-9));
  if(profile.kind==='rope') {out.start=0;out.end=distance;out.alpha=(1-t)*.7;return out;}
  const head=Math.min(distance,Math.max(0,age)*profile.speed*FX_UNIT);
  const trail=Math.min(profile.maxLength*FX_UNIT,(profile.trail[0]+profile.trail[1])*.5*profile.speed*FX_UNIT*
    clamp(age/Math.max(profile.lengthFade,1e-9)));
  out.start=Math.max(0,head-trail);out.end=head;
  out.alpha=clamp((t-profile.fadeIn[0])/Math.max(1e-9,profile.fadeIn[1]-profile.fadeIn[0]))*
    clamp((1-t)/Math.max(1e-9,1-profile.fadeOut))*(profile.alpha[0]+profile.alpha[1])*.5;
  return out;
}
export function muzzleProfile(equipment:Equipment) {
  const p=(source.weapons[equipment] as {muzzleParticle?:string}).muzzleParticle??'';
  if(source.weapons[equipment].silenced) return native.flashes.silencedPistol;
  if(p.includes('pistol'))return native.flashes.pistol;
  if(p.includes('smg'))return native.flashes.smg;
  if(p.includes('huntingrifle'))return native.flashes.sniper;
  if(['nova','xm1014','mag7','sawedoff'].includes(equipment))return native.flashes.shotgun;
  return native.flashes.rifle;
}
