import type {DuelActorSnapshot} from './types';

/** A reduced directional transition; the native planted-foot graph is more complex. */
export class StrafeBlend {
  private weights=new Float64Array(8);
  private from=new Float64Array(8);
  private target=new Float64Array(8);
  private angle?:number;
  private elapsed=.1;
  private rest=0;
  private generation?:number;
  sample(actor:DuelActorSnapshot,dt:number) {
    if(actor.generation!==this.generation){this.generation=actor.generation;this.angle=undefined;this.elapsed=.1;}
    const x=actor.velocity.x*Math.cos(actor.yaw)-actor.velocity.z*Math.sin(actor.yaw);
    const z=-actor.velocity.x*Math.sin(actor.yaw)-actor.velocity.z*Math.cos(actor.yaw);
    if(Math.hypot(x,z)<.025){this.rest+=dt;if(this.rest>.15)this.angle=undefined;return undefined;}
    this.rest=0;
    const angle=Math.atan2(x,z),sector=(angle/(Math.PI/4)+8)%8,low=Math.floor(sector),fraction=sector-low;
    this.target.fill(0);this.target[low]=1-fraction;this.target[(low+1)%8]=fraction;
    const delta=this.angle===undefined?0:Math.abs(Math.atan2(Math.sin(angle-this.angle),Math.cos(angle-this.angle)));
    if(this.angle===undefined){this.weights.set(this.target);this.elapsed=.1;}
    else if(delta>Math.PI/2){this.from.set(this.weights);this.elapsed=0;}
    this.angle=angle;this.elapsed=Math.min(.1,this.elapsed+Math.max(0,dt));
    const t=this.elapsed/.1;
    for(let i=0;i<8;i++)this.weights[i]=this.from[i]*(1-t)+this.target[i]*t;
    return this.weights;
  }
}
