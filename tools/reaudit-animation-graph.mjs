// Audits graph/clip inventories and event tracks freshly exported by reaudit-animation.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseKv3} from './kv3.mjs';
const root='research/reaudit-animation';
const files=fs.readdirSync(root,{recursive:true});
const source=JSON.parse(fs.readFileSync(`${root}/view-selection.json`));
const listing=fs.readFileSync(`${root}/listing.txt`,'utf8').split(/\r?\n/).map(x=>x.split(' ')[0]);
const graphs=files.filter(f=>f.endsWith('.vnmgraph')).map(file=>{
 const text=fs.readFileSync(path.join(root,file),'utf8');
 return {file,sha256:crypto.createHash('sha256').update(text).digest('hex'),classes:Object.fromEntries([...text.matchAll(/_class = "([^"]+)"/g)].reduce((map,m)=>map.set(m[1],(map.get(m[1])??0)+1),new Map())),clips:[...new Set([...text.matchAll(/m_clip = "([^"]+)"/g)].map(m=>m[1]))]};
});
const refs=new Set(graphs.flatMap(g=>g.clips));
const namespaces=Object.entries(source).map(([id,actions])=>{
 const prefix=actions.idle.slice(0,actions.idle.lastIndexOf('/')+1);
 const native=listing.filter(p=>p.startsWith(prefix)&&p.endsWith('.vnmclip_c')&&!p.slice(prefix.length).includes('/'));
 const selected=Object.values(actions);
 return {id,nativeCount:native.length,selectedCount:selected.length,unselected:native.filter(p=>!selected.includes(p)).map(p=>({path:p,referencedInExportedGraphs:refs.has(p.replace(/_c$/,''))}))};
});
const clips=[];
for(const file of files.filter(f=>f.endsWith('.vnmclip'))){
 const raw=fs.readFileSync(path.join(root,file),'utf8'),data=parseKv3(raw);
 clips.push({file,source:data.m_sourceFilename,skeleton:data.m_animationSkeletonName,additiveType:data.m_additiveType??'None',eventTracks:data.m_eventTracks??[],sha256:crypto.createHash('sha256').update(raw).digest('hex')});
}
const report={schema:1,graphs,namespaces,clips,flinchListing:listing.filter(p=>p.includes('/world/shared/flinch_')&&p.endsWith('.vnmclip_c'))};
fs.writeFileSync('tools/reaudit-animation-graph-results.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({graphs:graphs.length,clips:clips.length,flinchEntries:report.flinchListing.length,unselectedReferenced:namespaces.map(n=>({id:n.id,clips:n.unselected.filter(x=>x.referencedInExportedGraphs).map(x=>path.basename(x.path))})).filter(n=>n.clips.length)},null,2)+'\n');
