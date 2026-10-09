import {memo} from 'react';
import {ChevronRight, Crosshair} from 'lucide-react';
import type {RecentSession} from './session-data';
export const RecentSessions = memo(function RecentSessions({rows,open,limit=7,title='Recent sessions'}:{rows:RecentSession[];open:()=>void;limit?:number;title?:string}) {
  return <section className="sl-recent"><header><h2>{title}</h2><span>{rows.length} SAVED</span></header><div>{rows.length?rows.slice(0,limit).map(row=><button className="sl-recent-row" key={row.id} onClick={open}>{row.weapon?<img src={`/models/${row.weapon}.png`} alt=""/>:<Crosshair size={24}/>}<span><strong>{row.title}</strong><small>{row.detail}</small></span><b>{row.value}<small>{row.unit}</small></b></button>):<p className="sl-empty">Your completed practice sessions will appear here.</p>}</div><button className="sl-recent-link" onClick={open}>Session history<ChevronRight size={16}/></button></section>;
});
