import {memo,useState} from 'react';
import {X} from 'lucide-react';
import {modeNames,type Mode} from '../../config';
import type {Result} from '../../simulation';
import type {loadAttempts} from '../../../lib/storage';
import type {DuelStatus} from '../../duel/DuelEngine';
import type {SessionHistories} from '../session-data';
import {BotzScorecard} from '../../duel/BotzPanel';
import {DuelScorecard} from '../../duel/DuelScorecard';
import {IconButton,Tabs} from '../primitives';
import {RangeHistory} from './RangeHistory';
type Tab='range'|'botz'|'reflex'|'redline'|'duel';
const tabs:{id:Tab;label:string}[]=[{id:'range',label:'Range attempts'},...(['botz','redline','reflex','duel'] as const).map(id=>({id,label:modeNames[id]}))];
export const SessionScreen=memo(function SessionScreen({results,legacy,histories,mode,snapshot,close}:{results:Result[];legacy:ReturnType<typeof loadAttempts>;histories:SessionHistories;mode:Mode;snapshot?:DuelStatus;close:()=>void}) {
  const [tab,setTab]=useState<Tab>(['botz','redline','reflex','duel'].includes(mode)?mode as Tab:'range');
  return <div className="sl-session-screen"><header className="sl-screen-title"><h1 id="panel-title">Session history</h1><IconButton label="Close panel" onClick={close}><X size={22}/></IconButton></header><Tabs label="Session drills" value={tab} items={tabs} onChange={setTab}/><div className="sl-session-content">{tab==='range'?<RangeHistory results={results} legacy={legacy}/>:tab==='duel'?<DuelScorecard review={mode==='duel'?snapshot?.review:undefined} history={histories.duel}/>:<BotzScorecard name={modeNames[tab]} island={tab==='reflex'} summary={mode===tab?snapshot?.botz:undefined} history={histories[tab]}/>}</div></div>;
});
