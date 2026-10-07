// CS2 button names, as listed by Source 2's inputsystem.dll (build 2000927).
// Letters are lowercase; every other name is matched case-insensitively.
const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
const digits = '0123456789'.split('');
const functionKeys = Array.from({length: 24}, (_, i) => `F${i + 1}`);
export const keyboardKeys = [
  ...digits, ...letters,
  ...digits.map(d => `KP_${d}`), 'KP_DIVIDE', 'KP_MULTIPLY', 'KP_MINUS', 'KP_PLUS', 'KP_ENTER', 'KP_DEL',
  '<', '[', ']', 'SEMICOLON', "'", '`', ',', '.', '/', '\\', '-', '=',
  'ENTER', 'SPACE', 'BACKSPACE', 'TAB', 'CAPSLOCK', 'NUMLOCK', 'ESCAPE', 'SCROLLLOCK',
  'INS', 'DEL', 'HOME', 'END', 'PGUP', 'PGDN', 'PAUSE',
  'SHIFT', 'RSHIFT', 'ALT', 'RALT', 'CTRL', 'RCTRL', 'LWIN', 'RWIN', 'APP',
  'UPARROW', 'LEFTARROW', 'DOWNARROW', 'RIGHTARROW', ...functionKeys, 'PRINTSCREEN',
] as const;
export const mouseKeys = ['MOUSE1', 'MOUSE2', 'MOUSE3', 'MOUSE4', 'MOUSE5', 'MWHEELUP', 'MWHEELDOWN'] as const;

const known = new Map<string, string>([...keyboardKeys, ...mouseKeys].map(key => [key.toLowerCase(), key]));
// CS:GO-era spellings still found in shared configs.
const legacy: Record<string, string> = {
  kp_ins: 'KP_0', kp_end: 'KP_1', kp_downarrow: 'KP_2', kp_pgdn: 'KP_3', kp_leftarrow: 'KP_4',
  kp_rightarrow: 'KP_6', kp_home: 'KP_7', kp_uparrow: 'KP_8', kp_pgup: 'KP_9', kp_slash: 'KP_DIVIDE',
  ';': 'SEMICOLON', lshift: 'SHIFT', lctrl: 'CTRL', lalt: 'ALT', escape: 'ESCAPE', esc: 'ESCAPE',
  return: 'ENTER', insert: 'INS', delete: 'DEL', pageup: 'PGUP', pagedown: 'PGDN',
};

/** Canonical CS2 name for a key, or undefined when it cannot be a key name. */
export function canonicalKey(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  if (!lower) return undefined;
  const key = known.get(lower) ?? legacy[lower];
  if (key) return key;
  // Rare extended Source 2 names (AUDIOMUTE, KP_HEXADECIMAL...) are kept for round trips.
  return /^[a-z][a-z0-9_]{1,31}$/.test(lower) ? lower.toUpperCase() : undefined;
}

const codes: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: 'SEMICOLON', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<',
  Enter: 'ENTER', Space: 'SPACE', Backspace: 'BACKSPACE', Tab: 'TAB', CapsLock: 'CAPSLOCK',
  NumLock: 'NUMLOCK', Escape: 'ESCAPE', ScrollLock: 'SCROLLLOCK', Insert: 'INS', Delete: 'DEL',
  Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN', Pause: 'PAUSE', PrintScreen: 'PRINTSCREEN',
  ShiftLeft: 'SHIFT', ShiftRight: 'RSHIFT', AltLeft: 'ALT', AltRight: 'RALT', ControlLeft: 'CTRL',
  ControlRight: 'RCTRL', MetaLeft: 'LWIN', MetaRight: 'RWIN', OSLeft: 'LWIN', OSRight: 'RWIN', ContextMenu: 'APP',
  ArrowUp: 'UPARROW', ArrowLeft: 'LEFTARROW', ArrowDown: 'DOWNARROW', ArrowRight: 'RIGHTARROW',
  NumpadDivide: 'KP_DIVIDE', NumpadMultiply: 'KP_MULTIPLY', NumpadSubtract: 'KP_MINUS', NumpadAdd: 'KP_PLUS',
  NumpadEnter: 'KP_ENTER', NumpadDecimal: 'KP_DEL',
};
for (const letter of letters) codes[`Key${letter.toUpperCase()}`] = letter;
for (const digit of digits) {codes[`Digit${digit}`] = digit; codes[`Numpad${digit}`] = `KP_${digit}`;}
for (const key of functionKeys) codes[key] = key;
const keyCodes = new Map(Object.entries(codes).filter(([code]) => !code.startsWith('OS')).map(([code, key]) => [key, code]));

/** CS2 key for a KeyboardEvent.code. Physical positions match CS2's scan-code input. */
export const keyFromCode = (code: string): string | undefined => codes[code];
/** KeyboardEvent.code for a CS2 key, used for the Keyboard Lock API. */
export const codeFromKey = (key: string): string | undefined => keyCodes.get(key);
/** CS2 mouse button for MouseEvent.button (0 primary, 1 middle, 2 secondary, 3 back, 4 forward). */
export const keyFromMouseButton = (button: number): string | undefined => ['MOUSE1', 'MOUSE3', 'MOUSE2', 'MOUSE4', 'MOUSE5'][button];
/** PointerEvent.buttons bit for each CS2 mouse button. */
export const mouseButtonBits = [[1, 'MOUSE1'], [2, 'MOUSE2'], [4, 'MOUSE3'], [8, 'MOUSE4'], [16, 'MOUSE5']] as const;

/** How CS2 writes a key name: uppercase, except punctuation. */
export const displayKey = (key: string) => key.toUpperCase();

const descriptions: Record<string, string> = {
  MOUSE1: 'Left mouse button', MOUSE2: 'Right mouse button', MOUSE3: 'Middle mouse button',
  MOUSE4: 'Mouse back button', MOUSE5: 'Mouse forward button', MWHEELUP: 'Mouse wheel up', MWHEELDOWN: 'Mouse wheel down',
  SEMICOLON: 'Semicolon', '<': 'ISO extra key beside left Shift', RSHIFT: 'Right Shift', RCTRL: 'Right Ctrl',
  RALT: 'Right Alt (AltGr)', LWIN: 'Left Windows key', RWIN: 'Right Windows key', APP: 'Menu key', KP_DEL: 'Numpad decimal',
};
/** Plain-language description for a key, for titles and screen readers. */
export function describeKey(key: string) {
  if (descriptions[key]) return descriptions[key];
  if (key.startsWith('KP_')) return `Numpad ${key.slice(3).toLowerCase()}`;
  return displayKey(key);
}

/** Keys a browser page cannot reliably receive or that leave the trainer. */
export const browserReservedKeys: Record<string, string> = {
  ESCAPE: 'Esc always releases the mouse and pauses the trainer.',
  F11: 'Browsers use F11 for fullscreen.',
  F12: 'Browsers open developer tools on F12.',
  LWIN: 'Windows opens the Start menu.',
  RWIN: 'Windows opens the Start menu.',
  PRINTSCREEN: 'Windows takes a screenshot instead of sending the key.',
};
