// Usage: node tools/import-reload-timing.mjs <fresh decoded reload folder>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const root=process.argv[2];assert(root,'Provide the decoded installed reload folder');
const clocks=JSON.parse(execFileSync('python3',['tools/read-native-clip-timing.py',root],{encoding:'utf8',maxBuffer:1e6}));
const inventory=JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json'));
const weapons={};
for(const [id,weapon] of Object.entries(inventory.weapons)) {
  if(id.endsWith('-legacy'))continue;
  const actions={};
  for(const [action,clip] of Object.entries(weapon.clips)) {
    if(!['reload','reload-empty'].includes(action))continue;
    const relative=clip.path.replace(/_c$/,''),bytes=fs.readFileSync(path.join(root,relative));
    const parsed=parseKv3(bytes.toString()),clock=clocks[relative.replace(/\.vnmclip$/,'.dmx')];assert(clock);
    const events=(parsed.m_eventTracks??[]).flatMap(track=>track.m_events??[]).filter(e=>e._class==='CNmClipDocEvent_ID');
    const insert=events.find(e=>e.m_ID==='WPN_RELOAD_ADD_AMMO');
    const silent=events.filter(e=>e.m_ID==='WPN_RELOAD_SILENT').map(e=>({start:e.m_flStartTime/clock.fps,end:(e.m_flStartTime+e.m_flDuration)/clock.fps}));
    actions[action==='reload'?'normal':'empty']={source:clip.path,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),...clock,
      ...(insert?{insert:insert.m_flStartTime/clock.fps}:{}),silent};
  }
  if(Object.keys(actions).length)weapons[id]=actions;
}
const data={build:'2000927',gate:{holdDelay:.2,slowRate:.5,releasedRate:.99,
  binarySha256:'99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12',function:'0x148b5b0'},weapons};
fs.writeFileSync('src/range/native-reload-timing.json',JSON.stringify(data,null,2)+'\n');
console.log(`Imported ${Object.keys(weapons).length} weapon reload clocks and animation-event sections.`);
