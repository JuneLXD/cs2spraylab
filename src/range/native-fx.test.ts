import {describe,expect,it} from 'vitest';
import {Group,Matrix4,Quaternion,Texture,Vector3,Object3D,Color} from 'three';
import {muzzleProfile,tracerDuration,tracerProfile,tracerSegment} from './native-fx';
import {MuzzleFlashes,ShotEffects} from './weapon-effects';
import {defaults,sanitizeSettings} from './config';

describe('native particle presentation subset',()=>{
 it('uses distance-dependent cosmetic travel and never moves the physical endpoint',()=>{
   const p=tracerProfile('ak47'),sample={start:0,end:0,alpha:0};
   expect(tracerDuration(p,52.07)).toBeCloseTo(.1);
   tracerSegment(p,52.07,.05,sample);expect(sample.end).toBeCloseTo(26.035);expect(sample.start).toBeGreaterThanOrEqual(0);
   expect(sample.alpha).toBeGreaterThan(0);
   const fx=new ShotEffects(new Group(),4,4),from=new Vector3(),to=new Vector3(0,0,-52.07);
   fx.trace('ak47',0,from,to,0,new Color());fx.update(.05);
   const matrix=new Matrix4(),position=new Vector3(),scale=new Vector3();fx.beams.getMatrixAt(0,matrix);
   matrix.decompose(position,new Quaternion(),scale);
   expect(scale.z).toBeLessThan(52.07);expect(Number.isFinite(scale.x)).toBe(true);
   expect(fx.tracers.geometry.getAttribute('position').getZ(1)).toBeCloseTo(-52.07,4);
   fx.update(.11);expect(fx.beams.visible).toBe(false);fx.dispose();
 });
 it('retains rope behavior for native rope weapons and a bounded lifetime',()=>{
   for(const gun of ['aug','mp9','negev'] as const) {
     const p=tracerProfile(gun);expect(p.kind).toBe('rope');
     const sample=tracerSegment(p,20,.02,{start:0,end:0,alpha:0});
     expect(sample.start).toBe(0);expect(sample.end).toBe(20);
     expect(tracerDuration(p,20)).toBeGreaterThan(.02);expect(tracerDuration(p,20)).toBeLessThan(.2);
   }
 });
 it('fades the native rifle flame separately from the short glow and drifting smoke',()=>{
   const parent=new Group(),anchor=new Object3D();parent.add(anchor);
   const fx=new MuzzleFlashes(parent,2,new Texture());fx.fire(anchor,'ak47',0);fx.update(0);
   const alpha=fx.sprites[0].material.opacity;expect(muzzleProfile('ak47').life).toEqual([.028,.03]);
   anchor.position.x=2;fx.update(.02);
   expect(fx.glows[0].visible).toBe(false);expect(fx.sprites[0].position.x).toBe(2);
   expect(fx.sprites[0].material.opacity).toBeLessThan(alpha);expect(fx.smoke[0].position.x).toBe(0);
   expect(fx.smoke[0].position.z).toBeGreaterThan(0);
   fx.update(.04);expect(fx.sprites[0].visible).toBe(false);expect(fx.smoke[0].visible).toBe(true);
   fx.update(.21);expect(fx.smoke[0].visible).toBe(false);fx.dispose();
 });
 it('defaults to CS2 presentation while preserving explicit practice and off settings',()=>{
   expect(defaults.tracers).toBe('native');expect(sanitizeSettings({}).tracers).toBe('native');
   expect(sanitizeSettings({tracers:'every'}).tracers).toBe('every');expect(sanitizeSettings({tracers:'off'}).tracers).toBe('off');
 });
});
