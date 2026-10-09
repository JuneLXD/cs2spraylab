import type {Equipment} from '../equipment';
import type {DuelEvent} from './types';
export type KillEntry = {id:number; at:number; shooter:number; victim:number; shooterName:string; victimName:string; weapon:Equipment; headshot:boolean; fading?:boolean};
export class KillFeedBuffer {
  private entries:KillEntry[]=[];
  private nextId=1;
  add(event:Extract<DuelEvent,{kind:'hit'}>, weapon:Equipment, at:number, name:(id:number)=>string) {
    if (!event.lethal) return;
    this.entries.push({id:this.nextId++,at,shooter:event.shooter,victim:event.victim,shooterName:name(event.shooter),victimName:name(event.victim),weapon,headshot:event.group==='head'});
    if (this.entries.length>5) this.entries.splice(0,this.entries.length-5);
  }
  visible(now:number):KillEntry[] {
    this.entries=this.entries.filter(entry=>now-entry.at<6);
    return [...this.entries].reverse().map(entry=>({...entry,fading:now-entry.at>=5}));
  }
  clear(){this.entries=[];}
}
