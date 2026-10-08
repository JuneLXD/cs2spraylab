import {describe,expect,it} from 'vitest';
import {StrafeBlend} from './strafe-blend';
import {locomotionWeights} from './animation';
import type {DuelActorSnapshot} from './types';
const actor={generation:1,velocity:{x:3,z:0},yaw:0,duckAmount:0} as DuelActorSnapshot;
describe('direction-only animation transitions',()=>{
 it('blends a reversal over time while stance follows the displayed actor immediately',()=>{
   const blend=new StrafeBlend();expect(blend.sample(actor,0)![2]).toBe(1);
   const reverse={...actor,velocity:{x:-3,z:0},duckAmount:1};
   const halfway=blend.sample(reverse,.05)!;expect(halfway[2]).toBeCloseTo(.5);expect(halfway[6]).toBeCloseTo(.5);
   const {weights}=locomotionWeights(reverse,'rifle',halfway);
   expect(weights.get('run_e_rifle')).toBe(0);expect(weights.get('crouch_e_rifle')).toBeCloseTo(.5);
   expect(blend.sample(reverse,.05)![6]).toBe(1);
 });
 it('does not carry a previous life or long-rest transition into the next pose',()=>{
   const blend=new StrafeBlend();blend.sample(actor,0);
   expect(blend.sample({...actor,generation:2,velocity:{x:-3,z:0}},0)![6]).toBe(1);
   blend.sample({...actor,generation:2,velocity:{x:0,z:0}},.2);
   expect(blend.sample({...actor,generation:2},0)![2]).toBe(1);
 });
 it.each([30,60,120,240])('finishes consistently at %s animation samples per second',hz=>{
   const blend=new StrafeBlend();blend.sample(actor,0);
   let result:Float64Array|undefined;
   for(let i=0;i<Math.ceil(hz*.1);i++)result=blend.sample({...actor,velocity:{x:-3,z:0}},1/hz);
   expect(result![6]).toBeCloseTo(1);expect([...result!].reduce((a,b)=>a+b)).toBeCloseTo(1);
 });
});
