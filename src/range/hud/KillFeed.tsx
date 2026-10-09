import {memo} from 'react';
import {Skull} from 'lucide-react';
import {equipmentNames} from '../equipment';
import type {KillEntry} from '../duel/kill-feed';
export const KillFeed=memo(function KillFeed({entries}:{entries:readonly KillEntry[]}) {
  return <ol className="sl-kill-feed" aria-label="Kill feed" aria-live="off">{entries.map(entry=><li key={entry.id} className={`${entry.shooter===0?'sl-own-kill':''} ${entry.fading?'sl-kill-fading':''}`} aria-label={`${entry.shooterName} killed ${entry.victimName} with ${equipmentNames[entry.weapon]}${entry.headshot?', headshot':''}`}><span className={entry.shooter===0?'sl-player-name':'sl-bot-name'}>{entry.shooterName}</span><img src={`/models/${entry.weapon}.png`} alt={equipmentNames[entry.weapon]}/>{entry.headshot&&<Skull size={16} aria-label="Headshot"/>}<span className={entry.victim===0?'sl-player-name':'sl-bot-name'}>{entry.victimName}</span></li>)}</ol>;
});
