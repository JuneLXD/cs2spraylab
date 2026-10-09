import {useEffect, useId, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode} from 'react';

export function Button({primary, className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {primary?: boolean}) {
  return <button type="button" className={`sl-button ${primary ? 'sl-button-primary' : ''} ${className}`} {...props}/>;
}

export function IconButton({label, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return <Button aria-label={label} title={label} {...props} className={`sl-icon-button ${props.className ?? ''}`}/>;
}

export function Tabs<T extends string>({label, value, items, onChange}: {label: string; value: T; items: readonly {id: T; label: string}[]; onChange: (value: T) => void}) {
  return <div className="sl-tabs" role="tablist" aria-label={label}>{items.map(item => <button type="button" key={item.id}
    role="tab" aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
    onClick={() => onChange(item.id)} onKeyDown={event => {
      const index = items.findIndex(candidate => candidate.id === item.id);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : -1;
      if (next < 0) return;
      event.preventDefault(); onChange(items[next].id);
      (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
    }}>{item.label}</button>)}</div>;
}

export function Panel({title, action, children, className = ''}: {title?: string; action?: ReactNode; children: ReactNode; className?: string}) {
  return <section className={`sl-panel ${className}`}>{title && <header><h2>{title}</h2>{action}</header>}{children}</section>;
}

export function SettingRow({label, children, className = '', htmlFor}: {label: string; children: ReactNode; className?: string; htmlFor?: string}) {
  return <div className={`sl-setting-row ${className}`}><label htmlFor={htmlFor}>{label}</label>{children}</div>;
}

export function SliderRow({label, value, min, max, step = 1, suffix = '', onChange}: {label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void}) {
  const id = useId();
  const fill = Math.max(0, Math.min(100, (value - min) / (max - min || 1) * 100));
  return <SettingRow label={label} htmlFor={id} className="sl-slider-row"><div className="sl-slider-control">
    <input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value}
      style={{'--sl-fill': `${fill}%`} as CSSProperties} onChange={event => onChange(+event.target.value)}/>
    <output htmlFor={id}>{value}{suffix}</output>
  </div></SettingRow>;
}

export function SwitchRow({label, checked, onChange, disabled = false}: {label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean}) {
  const id = useId();
  return <SettingRow label={label} htmlFor={id}><input className="sl-switch" id={id} type="checkbox" role="switch"
    checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/></SettingRow>;
}

export function NumberField({label, value, min, max, step = 1, onCommit}: {label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input className="sl-number" aria-label={label} type="number" min={min} max={max} step={step} value={draft}
    onChange={event => setDraft(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}}
    onBlur={() => {const parsed = Number(draft), next = draft.trim() && Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value; setDraft(String(next)); onCommit(next);}}/>;
}

export function Tile({selected, children, className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {selected?: boolean}) {
  return <button type="button" className={`sl-tile ${className}`} aria-pressed={selected} {...props}>{children}</button>;
}

export function Chip({children}: {children: ReactNode}) {return <span className="sl-chip">{children}</span>;}
export function Tag({children, tone = 'gold'}: {children: ReactNode; tone?: 'blue' | 'gold'}) {return <span className={`sl-tag sl-tag-${tone}`}>{children}</span>;}
