import type {Settings} from './config';

export type MouseSettings = Pick<Settings, 'sensitivity' | 'mouseYaw' | 'mousePitch' | 'sensitivityYScale' | 'invertX' | 'invertY'>;
export function mouseAngle(count: number, sensitivity: number, coefficient = .022) {
  return count * coefficient * sensitivity * Math.PI / 180;
}

/** Signed convars and analog-binding inversion are independent in a CS2 config. */
export function mouseLook(dx: number, dy: number, settings: MouseSettings, touch = false) {
  const x = touch ? .0025 : mouseAngle(1, settings.sensitivity, settings.mouseYaw) * (settings.invertX ? -1 : 1);
  const y = touch ? .0025 : mouseAngle(1, settings.sensitivity, settings.mousePitch) * settings.sensitivityYScale;
  return {yaw: -dx * x, pitch: -dy * y * (settings.invertY ? -1 : 1)};
}
