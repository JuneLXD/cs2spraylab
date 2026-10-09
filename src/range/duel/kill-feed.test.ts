import {describe,expect,it} from 'vitest';
import {KillFeedBuffer} from './kill-feed';
import type {DuelEvent} from './types';
const hit=(lethal:boolean,victim=1):Extract<DuelEvent,{kind:'hit'}>=>({kind:'hit',tick:1,shooter:0,victim,shotId:7,group:'head',point:{x:0,y:1,z:0},healthDamage:100,armorDamage:0,lethal});
const name=(id:number)=>id===0?'You':`Bot ${id}`;
describe('bounded combat kill feed',()=>{
  it('records lethal events independently of respawned actor state and excludes other hits',()=>{
    const feed=new KillFeedBuffer();feed.add(hit(false),'ak47',1,name);expect(feed.visible(1)).toEqual([]);
    feed.add(hit(true),'awp',2,name);expect(feed.visible(2)[0]).toMatchObject({shooterName:'You',victimName:'Bot 1',weapon:'awp',headshot:true});
  });
  it('keeps only five recent kills, fades before expiry and clears on restart',()=>{
    const feed=new KillFeedBuffer();for(let i=1;i<=8;i++)feed.add(hit(true,i),'ak47',i,name);
    expect(feed.visible(8).map(entry=>entry.victim)).toEqual([4,5,6,7,8]);
    expect(feed.visible(9).find(entry=>entry.victim===4)?.fading).toBe(true);
    expect(feed.visible(10).map(entry=>entry.victim)).toEqual([5,6,7,8]);
    feed.clear();expect(feed.visible(10)).toEqual([]);
  });
});
