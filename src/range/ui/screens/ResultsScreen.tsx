import {memo} from 'react';
import {modeNames,type Mode,type Settings} from '../../config';
import {cosmeticLabel,cosmeticPreview} from '../../cosmetics';
import type {ProgressionProfile} from '../../progression';
import type {DuelStatus} from '../../duel/DuelEngine';
import {BotzScorecard,clock} from '../../duel/BotzPanel';
import {DuelScorecard} from '../../duel/DuelScorecard';
import {Button} from '../primitives';
export const ResultsScreen = memo(function ResultsScreen({status,mode,settings,profile,home,setup,newSession,setupSummary}:{setupSummary:string;status:DuelStatus;mode:Mode;settings:Settings;profile:ProgressionProfile;home:()=>void;setup:()=>void;newSession:()=>void}) {
  const summary=status.botz, equipment=status.equipped??settings.weapon;
  return <section className="sl-results sl-menu-page" aria-label="Session complete"><header className="sl-result-banner" role="status"><div><small>SESSION COMPLETE · {mode==='duel'?'AI DUEL':'AIM BOTZ'}</small><h1>{modeNames[mode]}</h1><p>{cosmeticLabel(profile,equipment)} · {clock(summary?.seconds??status.seconds)}</p><p>{setupSummary}</p></div><img src={cosmeticPreview(profile,equipment)} alt=""/></header><div className="sl-results-scroll"><div className="sl-result-tiles">{[
    ['Kills',summary?.kills??status.kills,'blue'],['Kills per minute',summary?.killsPerMinute.toFixed(1)??'—',''],['Headshot kills',summary?`${summary.headshots} · ${summary.headshotRate.toFixed(0)}%`:'—','gold'],['Accuracy',`${(summary?.accuracy??status.review?.accuracy??0).toFixed(0)}%`,''],
  ].map(([label,value,tone])=><div className={`sl-result-tile ${tone}`} key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <div className="sl-result-detail">{summary?<BotzScorecard headlineStats={false} currentDate={summary.shots || summary.kills ? status.botzHistory?.[0]?.date : undefined} name={modeNames[mode]} island={mode==='reflex'} summary={summary} history={status.botzHistory??[]}/>:<DuelScorecard review={status.review} history={status.history??[]}/>}</div></div>
    <footer className="sl-result-footer"><Button onClick={home}>Main menu</Button><Button onClick={setup}>Change setup</Button><Button primary onClick={newSession}>New session</Button></footer></section>;
});
