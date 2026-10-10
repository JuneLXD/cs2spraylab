import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseKv3 } from './kv3.mjs';

// Metadata only: no GLB binary payloads, rendering, game processes, or asset export.
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(root, '../native-audit/reports/animation-timing'));
fs.mkdirSync(output, {recursive: true});
const ids = ['ak47', 'awp', 'nova', 'xm1014'];
const read = p => fs.readFileSync(path.join(root, p));
const json = p => JSON.parse(read(p));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const source = p => ({ path: p, sha256: sha(read(p)) });
const inventory = json('docs/weapon-animation-inventory.json').weapons;
const stats = json('src/range/game-data.json').weapons;
const sounds = json('src/range/sound-events-data.json').timelines;
const listing = read('research/reaudit-animation/listing.txt').toString();
const manifest = new Map([...listing.matchAll(/^(.+?) CRC:(\w+) size:(\d+)\s*$/gm)].map(m => [m[1], { crc: m[2], bytes: Number(m[3]) }]));
const omit = new Set(['m_ID', 'm_position', 'm_inputPins', 'm_outputPins', 'm_pChildGraph', 'm_pSecondaryGraph', 'm_nodes', 'm_connections', 'm_floatingComment', 'm_viewOffset', 'm_flViewZoom']);
function graph(p) {
  const doc = parseKv3(read(p).toString());
  const nodes = [], connections = [];
  function walk(v, chain = []) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, chain); return; }
    const state = /State(Node|MachineNode)$/.test(v._class ?? '') && v.m_name;
    const next = state ? [...chain, v.m_name] : chain;
    if (v.m_ID && v._class?.endsWith('Node')) {
      nodes.push({ id: v.m_ID, path: next.join('/'), data: Object.fromEntries(Object.entries(v).filter(([k]) => !omit.has(k))), pins: [...(v.m_inputPins ?? []), ...(v.m_outputPins ?? [])] });
    }
    if (v.m_connections) connections.push(...v.m_connections);
    for (const [k,x] of Object.entries(v)) if (k !== 'm_connections') walk(x, next);
  }
  walk(doc);
  const byId = new Map(nodes.map(n=>[n.id,n]));
  const label = id => { const n=byId.get(id); return n ? `${n.path}:${n.data.m_name || n.data._class.replace('CNmGraphDoc','')}` : id; };
  return {
    ...source(p),
    nodes: nodes.map(({id,path:statePath,data,pins})=>({id,path:statePath,...data,
      incoming: connections.filter(c=>c.m_toNodeID===id).map(c=>({fromId:c.m_fromNodeID,from:label(c.m_fromNodeID), pin:pins.find(p=>p.m_ID===c.m_inputPinID)?.m_name})),
      outgoing: connections.filter(c=>c.m_fromNodeID===id).map(c=>({toId:c.m_toNodeID,to:label(c.m_toNodeID), pin:byId.get(c.m_toNodeID)?.pins.find(p=>p.m_ID===c.m_inputPinID)?.m_name})),
    })),
  };
}
function glb(p) {
  const fd=fs.openSync(path.join(root,p),'r');
  try {
    const header=Buffer.alloc(20); fs.readSync(fd,header,0,20,0);
    if(header.toString('ascii',0,4)!=='glTF' || header.readUInt32LE(16)!==0x4e4f534a) throw new Error(`Not GLB: ${p}`);
    const b=Buffer.alloc(header.readUInt32LE(12)); fs.readSync(fd,b,0,b.length,20);
    const data=JSON.parse(b.toString());
    return {path:p,jsonSha256:sha(b),bytes:fs.fstatSync(fd).size,animations:(data.animations??[]).map(a=>({
      name:a.name, channels:a.channels.length, inputs:[...new Set(a.samplers.map(s=>s.input))].map(i=>({count:data.accessors[i].count,min:data.accessors[i].min,max:data.accessors[i].max})),
    }))};
  } finally {fs.closeSync(fd);}
}
const native=glb('research/reaudit-animation/native-composed.glb');
const result={schema:1,scope:'AK/AWP/Nova/XM metadata only',provenance:source('research/reaudit-animation/provenance.json'),inputs:['docs/weapon-animation-inventory.json','src/range/game-data.json','src/range/sound-events-data.json'].map(source),listingSha256:sha(listing),native:{...native,animations:native.animations.filter(a=>a.name.includes('/viewmodel/') && /(_ak|_awp|_nova)$/.test(a.name))},weapons:{}};
for(const id of ids) {
  const g=graph(`research/reaudit-animation/animation/graphs/viewmodel/viewmodel_gun.vnmgraph+${id}.vnmgraph`);
  const clips=Object.fromEntries(Object.entries(inventory[id].clips).map(([action,c])=>[action,{...c,currentManifest:manifest.get(c.path),matchesCurrentManifest:manifest.get(c.path)?.crc===c.crc && manifest.get(c.path)?.bytes===c.bytes}]));
  const events={};
  for(const [action,c] of Object.entries(clips)) {
    if(!['draw','reload','fire'].includes(action))continue;
    let p=`research/reaudit-animation/${c.path.replace(/_c$/,'')}`;
    if(!fs.existsSync(path.join(root,p)))p=`research/${path.basename(c.path).replace(/_c$/,'')}`;
    if(fs.existsSync(path.join(root,p)))events[action]={...source(p),doc:parseKv3(read(p).toString())};
  }
  fs.writeFileSync(path.join(output,`${id}-graph.json`),JSON.stringify(g,null,2)+'\n');
  result.weapons[id]={stats:Object.fromEntries(['deploy','cycle','reload'].map(k=>[k,stats[id][k]])),importBuild:inventory[id].build,clips,import:glb(`public/revamp/models/view-${id}.glb`),graph:{path:g.path,sha256:g.sha256,nodes:g.nodes.length},events,sounds:sounds[id]};
}
fs.writeFileSync(path.join(output,'metadata-results.json'),JSON.stringify(result,null,2)+'\n');
for(const [id,w] of Object.entries(result.weapons))console.log(JSON.stringify({id,stats:w.stats,importBuild:w.importBuild,clips:Object.fromEntries(Object.entries(w.clips).map(([k,c])=>[k,{seconds:c.seconds,current:c.matchesCurrentManifest}])),animations:w.import.animations.map(a=>({name:a.name,last:Math.max(...a.inputs.map(x=>x.max?.[0]??0))}))}));
