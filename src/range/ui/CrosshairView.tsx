import type {CSSProperties} from 'react';
import type {Crosshair} from '../config';

/** The client's bar layout (build 2000930): a whole-pixel thickness t covers ceil(t/2) pixels before the centre line and
 * floor(t/2) after it; fractional CSS thicknesses (another DPI than the game's) keep a symmetric split. */
export const crosshairLead = (thickness: number) => Number.isInteger(thickness) ? Math.ceil(thickness / 2) : thickness / 2;
export function CrosshairView({ value }: { value: Crosshair }) {
  const style = { '--cross-color': value.color, '--cross-size': `${value.size}px`, '--cross-gap': `${Math.max(0, value.gap)}px`, '--cross-thickness': `${value.thickness}px`, '--cross-lead': `${crosshairLead(value.thickness)}px`, '--cross-outline': `${value.outline}px`, opacity: value.alpha } as CSSProperties;
  return <div className={`crosshair ${value.t ? 't-style' : ''} ${value.size === 0 ? 'dot-only' : ''}`} style={style} aria-hidden="true">
    <i className="arm top" /><i className="arm right" /><i className="arm bottom" /><i className="arm left" />{value.dot && <i className="dot" />}
  </div>;
}
