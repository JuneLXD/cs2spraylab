import {keyFromCode, mouseButtonBits} from './keys';
import type {BindRuntime} from './runtime';

type Listen = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => void;
export type BindInputOptions = {
  canvas: HTMLElement;
  runtime: BindRuntime;
  /** Whether gameplay input is live (session started and not paused). */
  active: () => boolean;
  /** Registers a listener and its cleanup with the owning engine. */
  listen: Listen;
};

const typing = (target: EventTarget | null) => target instanceof HTMLElement && target.matches('input,select,textarea,button');

/**
 * Sends keyboard keys, mouse buttons and wheel notches through the CS2 bind
 * table. Mouse buttons are read from PointerEvent.buttons so chorded presses
 * (holding Mouse 1, then pressing Mouse 2) register; a click that starts or
 * resumes a session is never also a shot. Esc stays with the engines.
 */
export function attachBindInput({canvas, runtime, active, listen}: BindInputOptions) {
  const owned = (target: EventTarget | null) => target === canvas || document.pointerLockElement === canvas;
  listen(window, 'keydown', (event => {
    const e = event as KeyboardEvent;
    if (e.code === 'Escape' || !active() || typing(e.target)) return;
    const key = keyFromCode(e.code);
    // Repeats reach the browser too, so keep cancelling them for bound keys.
    if (key && (runtime.isPressed(key) || runtime.keyDown(key))) e.preventDefault();
  }) as EventListener);
  listen(window, 'keyup', (event => {
    const e = event as KeyboardEvent, key = keyFromCode(e.code);
    if (key && runtime.keyUp(key)) e.preventDefault();
  }) as EventListener);

  let buttons = 0;
  const sync = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType !== 'mouse') return;
    const live = active() && owned(e.target);
    for (const [bit, key] of mouseButtonBits) {
      const down = (e.buttons & bit) !== 0, was = (buttons & bit) !== 0;
      if (down && !was) {buttons |= bit; if (live) runtime.keyDown(key);}
      else if (!down && was) {buttons &= ~bit; runtime.keyUp(key);}
    }
  };
  // Window capture runs before the engines' own pointerdown, which may start the session.
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) listen(window, type, sync, {capture: true});
  // Keep browser defaults off trainer buttons: back/forward navigation and middle-click autoscroll.
  const block = (event: Event) => {const e = event as MouseEvent; if (e.button > 0 && active() && owned(e.target)) e.preventDefault();};
  for (const type of ['mousedown', 'mouseup', 'auxclick']) listen(window, type, block, {capture: true});

  let wheel = 0, wheelAt = -Infinity;
  listen(canvas, 'wheel', (event => {
    const e = event as WheelEvent;
    if (!active() || !e.deltaY) return;
    e.preventDefault();
    if (e.timeStamp - wheelAt > 250 || Math.sign(e.deltaY) !== Math.sign(wheel)) wheel = 0;
    wheelAt = e.timeStamp;
    // A notched wheel sends one large delta per notch; touchpads send many small ones.
    if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) wheel = Math.sign(e.deltaY) * 100;
    else wheel += e.deltaY;
    if (Math.abs(wheel) < 100) return;
    runtime.tap(wheel < 0 ? 'MWHEELUP' : 'MWHEELDOWN');
    wheel = 0;
  }) as EventListener, {passive: false});

  return {
    /** Forget button state after a pause or focus loss; the runtime releases separately. */
    reset() {buttons = 0; wheel = 0;},
  };
}
