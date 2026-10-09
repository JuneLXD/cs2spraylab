import {historyModeNames, type Mode} from '../config';
import {equipmentNames, type Equipment} from '../equipment';
import {loadBotzHistory, type BotzHistory} from '../duel/botz';
import {loadDuelHistory, type DuelHistory} from '../duel/coaching';
import {clock} from '../duel/BotzPanel';
import type {Result} from '../simulation';
export type SessionHistories = {botz: BotzHistory[]; reflex: BotzHistory[]; redline: BotzHistory[]; duel: DuelHistory[]};
export const readSessionHistories = (): SessionHistories => ({botz:loadBotzHistory(),reflex:loadBotzHistory('island'),redline:loadBotzHistory('redline'),duel:loadDuelHistory()});
export type RecentSession = {id:string; date:string; mode:Mode; title:string; detail:string; value:string; unit:string; weapon?:Equipment};
export function recentSessions(results: Result[], histories: SessionHistories): RecentSession[] {
  const rows:RecentSession[] = results.map(result=>({id:result.id,date:result.date,mode:result.mode==='tracking'?'spray':result.mode,title:historyModeNames[result.mode],weapon:result.weapon,
    detail:`${equipmentNames[result.weapon]} · ${result.hits}/${result.shots} hits · ${clock(result.seconds)}`,
    value:result.mode==='precision' ? result.drill?.movementScore===undefined?'—':String(result.drill.movementScore) : `${Math.round(result.mode==='tracking'?result.tracking:result.shots?result.hits/result.shots*100:0)}%`,unit:result.mode==='precision'?'MOVEMENT':'HIT RATE'}));
  for (const mode of ['botz','reflex','redline'] as const) histories[mode].forEach((entry,index)=>rows.push({id:`${mode}-${entry.date}-${index}`,date:entry.date,mode,title:historyModeNames[mode],weapon:entry.weapon,
    detail:`${equipmentNames[entry.weapon]??entry.weapon} · ${clock(entry.seconds)} · ${entry.headshotRate.toFixed(0)}% HS`,value:mode==='reflex'?String(entry.kills):entry.killsPerMinute.toFixed(1),unit:mode==='reflex'?'KILLS':'KILLS / MIN'}));
  histories.duel.forEach((entry,index)=>rows.push({id:`duel-${entry.date}-${index}`,date:entry.date,mode:'duel',title:'AI Duel',detail:`${entry.review.kills} kills · ${Math.round(entry.review.damage)} damage`,value:entry.outcome.toUpperCase(),unit:'ROUND'}));
  return rows.filter(row=>Number.isFinite(Date.parse(row.date))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
