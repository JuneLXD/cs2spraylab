import type {CSSProperties} from 'react';
import type {Crosshair} from '../config';

export function CrosshairView({ value }: { value: Crosshair }) {
  const style = { '--cross-color': value.color, '--cross-size': `${value.size}px`, '--cross-gap': `${value.gap}px`, '--cross-thickness': `${value.thickness}px`, '--cross-outline': `${value.outline}px`, opacity: value.alpha } as CSSProperties;
  return <div className={`crosshair ${value.t ? 't-style' : ''} ${value.size === 0 ? 'dot-only' : ''}`} style={style} aria-hidden="true">
    <i className="arm top" /><i className="arm right" /><i className="arm bottom" /><i className="arm left" />{value.dot && <i className="dot" />}
  </div>;
}
