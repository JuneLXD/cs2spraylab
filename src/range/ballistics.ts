import {recoilTable,recoilTableIndex,type RecoilAngle,type RecoilParameters,type RecoilSelection} from './recoil';
import {PunchRecovery} from './punch-recovery';
import {viewPunchImpulse} from './view-punch';

export type AccuracyParameters=RecoilParameters&{
  stand:number;crouch:number;move:number;fire:number;spread:number;recovery:number;
  recoveryFinal?:number;recoveryCrouch?:number;recoveryCrouchFinal?:number;
  recoveryStart?:number;recoveryEnd?:number;jump?:number;jumpInitial?:number;jumpApex?:number;
  land?:number;spreadSeed?:number;pellets?:number;
};
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const ZERO=()=>({yaw:0,pitch:0});
const ACCURACY_TICK=1/64, f32=Math.fround, LOG_TEN=f32(Math.log(10));
const INDEX_DECAY=f32(Math.exp(f32(f32(-2*LOG_TEN)*ACCURACY_TICK)));

function nativeRecoveryTime(w:AccuracyParameters,index:number,crouch:boolean,airborne:boolean){
  const initial=f32(crouch||airborne?w.recoveryCrouch??w.recovery:w.recovery);
  if(airborne)return f32(4*initial);
  const final=crouch?w.recoveryCrouchFinal:w.recoveryFinal;
  if(final===undefined||final<0)return initial;
  const start=w.recoveryStart??2,end=w.recoveryEnd??5,n=Math.trunc(index);
  const blend=start===end?Number(n>=end):clamp(f32(f32(n-start)/f32(end-start)));
  return f32(initial+f32(blend*f32(f32(final)-initial)));
}

export function recoveryTime(w:AccuracyParameters,index:number,crouch:boolean,airborne=false){
  if(airborne)return 4*(w.recoveryCrouch ?? w.recovery);
  const initial=crouch?w.recoveryCrouch ?? w.recovery:w.recovery;
  const final=crouch?w.recoveryCrouchFinal:w.recoveryFinal;
  const start=w.recoveryStart ?? 2,end=w.recoveryEnd ?? 5;
  const blend=end>start?clamp((Math.floor(index)-start)/(end-start)):0;
  return final===undefined || final<0 ? initial : initial+(final-initial)*blend;
}

// Installed build 2000908: remap 34..95% of weapon cap, then x^0.25
// for running. The walking branch bypasses that exponent (RVA 0x7e71c6).
export function movementInaccuracy(w:AccuracyParameters,speedRatio:number,walking=false){
  const x=clamp((speedRatio-.34)/(.95-.34));
  return w.move*(walking?x:Math.pow(x,.25));
}
export function airborneInaccuracy(w:AccuracyParameters,verticalSpeedUnits:number){
  const initial=w.jumpInitial ?? 0,apex=w.jumpApex ?? 0;
  const fraction=(Math.sqrt(Math.abs(verticalSpeedUnits))/Math.sqrt(301.993)-.25)/.75;
  return clamp(apex+(initial-apex)*fraction,0,2*initial);
}

// A full-auto capture does not encode recovery. Fit impulses to its sample
// points, then use the same recovered damping for interrupted capture playback.
function captureImpulses(w:AccuracyParameters,points:RecoilAngle[]){
  let previous=new PunchRecovery();
  return points.map((_,i)=>{
    const elapsed=i?w.cycle:0,angle=previous.sample(elapsed+1/128),velocity=previous.velocity(elapsed);
    const sampleAt=(v:RecoilAngle)=>new PunchRecovery(angle,{...v,roll:0}).sample(w.cycle,false);
    const desired=points[Math.min(i+1,points.length-1)];
    let guess={...velocity};
    for(let n=0;n<12;n++){
      const sample=sampleAt(guess);
      const error={yaw:desired.yaw/2-sample.yaw,pitch:desired.pitch/2-sample.pitch};
      if(Math.hypot(error.yaw,error.pitch)<1e-5)break;
      const a=sampleAt({...guess,yaw:guess.yaw+.1});
      const b=sampleAt({...guess,pitch:guess.pitch+.1});
      const xx=(a.yaw-sample.yaw)/.1,xy=(b.yaw-sample.yaw)/.1,yx=(a.pitch-sample.pitch)/.1,yy=(b.pitch-sample.pitch)/.1;
      const determinant=xx*yy-xy*yx;
      if(Math.abs(determinant)<1e-10)break;
      guess.yaw+=(error.yaw*yy-error.pitch*xy)/determinant;
      guess.pitch+=(error.pitch*xx-error.yaw*yx)/determinant;
    }
    const impulse={yaw:guess.yaw-velocity.yaw,pitch:guess.pitch-velocity.pitch};
    previous=new PunchRecovery(angle,{...guess,roll:0});return impulse;
  });
}

export class WeaponRecovery {
  angle=ZERO();velocity=ZERO();index=0;penalty:number;lastShot=-Infinity;time=0;
  private punch=new PunchRecovery();private anchorAt=0;private roll=0;
  private impulses:RecoilAngle[];
  private viewImpulses:RecoilAngle[];
  private accuracyClock=0;private nextAccuracyTick=1;
  private accuracyCrouch=false;private accuracyAirborne=false;
  private readonly capturedPattern: boolean;
  lastViewPunch:RecoilAngle=ZERO();
  constructor(public weapon:AccuracyParameters,capture?:RecoilAngle[],private readonly primaryCycle=weapon.cycle){
    this.capturedPattern=!!capture;
    this.penalty=f32(weapon.stand);
    this.impulses=capture?captureImpulses(weapon,capture):recoilTable(weapon).map(p=>{
      const radians=Math.fround(p.angle*Math.fround(Math.PI/180));
      return {yaw:Math.fround(Math.sin(radians)*p.magnitude),pitch:Math.fround(Math.cos(radians)*p.magnitude)};
    });
    this.viewImpulses=capture?this.impulses.map(p=>({yaw:p.yaw*.055,pitch:p.pitch*.055}))
      :recoilTable(weapon).map(p=>viewPunchImpulse(p.angle,p.magnitude));
  }
  get recoil(){return{yaw:this.angle.yaw*2,pitch:this.angle.pitch*2};}
  /** Held fire is processed on a server tick, but its punch uses the exact
   * scheduled command time. Delay is local to this recovery clock. */
  recoilBefore(delay=0){
    const angle=this.punch.sample(this.time-this.anchorAt-Math.max(0,delay));
    return {yaw:angle.yaw*2,pitch:angle.pitch*2};
  }
  setParameters(weapon: AccuracyParameters) {
    if (this.weapon === weapon) return;
    // Native mode changes preserve the accumulated penalty. PostThink applies
    // the new baseline through the normal snap-up/decay rule.
    this.weapon = weapon;
    this.impulses = recoilTable(weapon).map(p => {
      const radians = Math.fround(p.angle * Math.fround(Math.PI / 180));
      return {yaw: Math.fround(Math.sin(radians) * p.magnitude), pitch: Math.fround(Math.cos(radians) * p.magnitude)};
    });
    this.viewImpulses = recoilTable(weapon).map(p => viewPunchImpulse(p.angle, p.magnitude));
  }
  advance(dt:number,crouch=false,airborne=false,deferAccuracy=false,clock=this.accuracyClock+dt){
    // Punch has a continuous local clock. Accuracy uses the simulation's 64 Hz
    // clock, including weapons created part-way through a round.
    if(Math.abs(this.accuracyClock-(clock-dt))>1e-8)
      this.nextAccuracyTick=Math.floor((clock-dt)*64+1e-8)+1;
    this.time+=dt;
    this.accuracyClock=clock;this.accuracyCrouch=crouch;this.accuracyAirborne=airborne;
    this.recoverThrough(deferAccuracy?clock-1e-8:clock);
    const elapsed=this.time-this.anchorAt,angle=this.punch.sample(elapsed),velocity=this.punch.velocity(elapsed);
    this.angle={yaw:angle.yaw,pitch:angle.pitch};this.roll=angle.roll;
    this.velocity={yaw:velocity.yaw,pitch:velocity.pitch};
  }
  private updateAccuracy(clock:number){
    const w=this.weapon,crouch=this.accuracyCrouch,airborne=this.accuracyAirborne;
    const baseline=airborne?f32(f32(w.stand)+f32(w.jump??0)):f32(crouch?w.crouch:w.stand);
    const recovery=nativeRecoveryTime(w,this.index,crouch,airborne);
    const decay=recovery>0?f32(Math.exp(f32(f32(LOG_TEN/recovery)*-ACCURACY_TICK))):0;
    this.penalty=this.penalty<baseline?baseline:f32(baseline+f32(f32(f32(this.penalty)-baseline)*decay));
    const last=f32(this.lastShot+this.accuracyClock-this.time);
    if(this.index>0&&f32(clock)>f32(f32(last+f32(this.primaryCycle))+ACCURACY_TICK)){
      this.index=f32(f32(this.index)*INDEX_DECAY);
      if(this.index<=f32(.1))this.index=0;
    }
  }
  private recoverThrough(clock:number){
    while(this.nextAccuracyTick*ACCURACY_TICK<=clock+1e-10){
      this.updateAccuracy(this.nextAccuracyTick*ACCURACY_TICK);this.nextAccuracyTick++;
    }
  }
  /** Called after fractional commands, before the boundary's remaining actions. */
  finishAccuracy(){this.recoverThrough(this.accuracyClock);}
  /** Native fractional shots precede PostThink; exact-boundary shots follow it. */
  beforeShot(processingDelay=0){
    const scheduled=this.accuracyClock-Math.max(0,processingDelay);
    if(Math.abs(scheduled*64-Math.round(scheduled*64))<1e-7)this.finishAccuracy();
  }
  reloadStarted(automatic=false){
    if(!automatic)this.finishAccuracy();
    this.index=f32(f32(this.index)+1);
  }
  reloadFinished(){this.finishAccuracy();this.index=0;}
  /** Native landing hook (server build 2000927): the mode's inaccuracy_land
   * times the landing speed in units/s is added to the accuracy penalty, then
   * recovers like any other penalty. A normal jump adds about half a jump's worth. */
  land(landingSpeedUnits:number){
    this.penalty=f32(f32(this.penalty)+f32(f32(this.weapon.land??0)*f32(Math.max(0,landingSpeedUnits))));
  }
  fire(processingDelay=0,selection?:RecoilSelection){
    const shotTime=this.time-Math.max(0,processingDelay),elapsed=shotTime-this.anchorAt;
    const recoil=this.recoilBefore(processingDelay);
    const selected=this.capturedPattern?Math.floor(this.index)%this.impulses.length
      :recoilTableIndex(this.weapon,this.index,selection);
    const impulse=this.impulses[selected];
    this.lastViewPunch=this.viewImpulses[selected];
    // Native 0x1515420 samples the carried angle at command + 1 tick, but
    // velocity and its new anchor at command + half a tick (64 Hz clock).
    const carried=this.punch.sample(elapsed+1/128),velocity=this.punch.velocity(elapsed);
    this.angle={yaw:carried.yaw,pitch:carried.pitch};this.roll=carried.roll;
    this.velocity={yaw:Math.fround(velocity.yaw+impulse.yaw),pitch:Math.fround(velocity.pitch+impulse.pitch)};
    this.punch=new PunchRecovery({...this.angle,roll:this.roll},{...this.velocity,roll:0});this.anchorAt=shotTime;
    this.penalty=f32(f32(this.penalty)+f32(this.weapon.fire));this.index=f32(f32(this.index)+1);this.lastShot=shotTime;
    // Rendering stays at the processed time; only the impulse's anchor and the
    // bullet's pre-shot punch are sampled at the earlier schedule.
    if(processingDelay>0){
      const angle=this.punch.sample(processingDelay),currentVelocity=this.punch.velocity(processingDelay);
      this.angle={yaw:angle.yaw,pitch:angle.pitch};this.roll=angle.roll;
      this.velocity={yaw:currentVelocity.yaw,pitch:currentVelocity.pitch};
    }
    return recoil;
  }
  predict(seconds:number,afterShot=false,processingDelay=0,selection?:RecoilSelection){
    const copy=Object.assign(Object.create(WeaponRecovery.prototype),this) as WeaponRecovery;
    copy.angle={...this.angle};copy.velocity={...this.velocity};
    copy.punch=this.punch.clone();
    if(afterShot)copy.fire(processingDelay,selection);copy.advance(seconds);return copy.recoil;
  }
  inaccuracy(speedRatio:number,walking=false,airborne=false,verticalSpeedUnits=0){
    return Math.min(1,this.penalty+movementInaccuracy(this.weapon,speedRatio,walking)+(airborne?airborneInaccuracy(this.weapon,verticalSpeedUnits):0));
  }
}
