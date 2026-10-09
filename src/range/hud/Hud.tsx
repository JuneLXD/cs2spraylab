import {Pause, RotateCcw, UserRound, X, type LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import type {Settings} from '../config';
import {equipmentNames, type Equipment, type Slot} from '../equipment';
import {cosmeticLabel, cosmeticPreview} from '../cosmetics';
import type {ProgressionProfile} from '../progression';
import {slotKey} from '../keybinds/profile';

export function ScoreBar({children, className = '', bots}: {children: ReactNode; className?: string; bots?: {alive: number; total: number; label: string}}) {
  return <div className={`sl-score-bar ${className}`}>{children}{bots && <div className="sl-bot-count">
    <div aria-hidden="true">{Array.from({length: Math.min(16, bots.total)}, (_, index) => <span key={index} className={index < bots.alive ? 'up' : 'down'}>{index < bots.alive ? <UserRound size={18}/> : <X size={18}/>}</span>)}</div>
    <small>{bots.label}</small>
  </div>}</div>;
}

export function ScoreCell({value, label, tone, testId}: {value: ReactNode; label: string; tone?: 'blue' | 'gold' | 'miss'; testId?: string}) {
  return <div className={`sl-score-cell ${tone ?? ''}`}><strong data-testid={testId}>{value}</strong>{' '}<small>{label}</small></div>;
}

export function StatBlock({value, label, icon: Icon, unit, bar, children, className = ''}: {value: ReactNode; label: string; icon?: LucideIcon; unit?: ReactNode; bar?: number; children?: ReactNode; className?: string}) {
  return <div className={`sl-stat ${className}`}><div>{Icon && <Icon size={24} aria-hidden="true"/>}<strong><b>{value}</b>{unit && <em>{unit}</em>}</strong></div>
    {bar !== undefined && <div className="sl-stat-bar" aria-hidden="true"><i style={{width: `${Math.max(0, Math.min(100, bar))}%`}}/></div>}
    <small>{label}</small>{children}
  </div>;
}

export function AmmoBlock({label, ammo, reserve, state, input, testId, className = '', reload, reloadDisabled, reloadHint, reloadProgress, compactSeparator = false}: {
  label: string; ammo: number | '--'; reserve?: number; state: string; input?: string; testId?: string; className?: string;
  reload?: () => void; reloadDisabled?: boolean; reloadHint?: string; reloadProgress?: number; compactSeparator?: boolean;
}) {
  return <div className={`sl-ammo ${className}${ammo === 0 ? ' empty' : ''}`}>
    <small>{label}</small>
    <div className="sl-ammo-count"><svg aria-hidden="true" viewBox="0 0 10 24"><path d="M2.5 23V9c0-3.2 1.1-6 2.5-8 1.4 2 2.5 4.8 2.5 8v14z" fill="currentColor"/></svg>
      <strong data-testid={testId}>{ammo}{reserve !== undefined && <em>{compactSeparator ? '/ ' : ' / '}{reserve}</em>}</strong>
    </div>
    <span>{state}</span>
    {reloadProgress !== undefined && <progress className="sl-reload-progress" aria-label="Reload progress" max={1} value={reloadProgress}/>}
    {reload && <button className="reload-pistol" disabled={reloadDisabled} title={reloadHint} onClick={reload}><RotateCcw size={13}/>Reload</button>}
    {input && <span className="sl-input-status">{input}</span>}
  </div>;
}

export function WeaponSlotList({settings, equipped, slot: activeSlot, profile, loadout, label, equip}: {
  settings: Settings; equipped: Equipment; slot?: Slot; profile?: ProgressionProfile;
  loadout?: {primary?: Equipment | null; sidearm?: Equipment | null}; label: string; equip: (slot: Slot) => void;
}) {
  return <div className="equipment-slots sl-weapon-slots" role="group" aria-label={label}>
    {([1, 2, 3, 4] as const).filter(slot => (slot !== 1 || (loadout ? !!loadout.primary : settings.primaryEnabled)) && (slot !== 2 || !loadout || !!loadout.sidearm)).map(slot => {
      const id = slot === 1 ? loadout?.primary ?? settings.weapon : slot === 2 ? loadout?.sidearm ?? settings.sidearm : slot === 4 ? 'zeus' : 'knife';
      const name = profile ? cosmeticLabel(profile, id) : equipmentNames[id];
      return <button key={slot} aria-label={`Equip ${equipmentNames[id]}`} title={`${name} (${slotKey(settings.keyboard, slot)})`}
        aria-pressed={activeSlot ? activeSlot === slot : equipped === id} onClick={() => equip(slot)}>
        <span className="sl-slot-name">{equipmentNames[id]}</span><img src={profile ? cosmeticPreview(profile, id) : `/models/${id}.png`} alt=""/><span className="sl-slot-key">{slotKey(settings.keyboard, slot)}</span>
      </button>;
    })}
  </div>;
}

export function EscHint({label, pause, className = ''}: {label: string; pause: () => void; className?: string}) {
  return <div className={`sl-esc-hint ${className}`}><span><kbd>ESC</kbd> Press ESC to exit</span><button className="icon-button" aria-label={label} title={label} onClick={pause}><Pause size={16}/></button></div>;
}
