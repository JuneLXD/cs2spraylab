import {commandsOf} from './console';
import {canonicalKey} from './keys';
import type {KeyboardProfile} from './profile';

export type HeldAction = 'forward' | 'back' | 'left' | 'right' | 'walk' | 'duck' | 'jump' | 'attack' | 'attack2' | 'reload' | 'use' | 'inspect';
export type ImpulseCommand = 'lastinv' | 'invnext' | 'invprev' | 'drop' | 'cancelselect';
export type BindEvent = {kind: 'press' | 'release'; action: HeldAction} | {kind: 'slot'; slot: number} | {kind: ImpulseCommand};

// CS2 names first; +moveleft/+moveright/+speed are CS:GO spellings still found in configs.
const buttons: Readonly<Record<string, HeldAction>> = {
  forward: 'forward', back: 'back', left: 'left', moveleft: 'left', right: 'right', moveright: 'right',
  sprint: 'walk', speed: 'walk', duck: 'duck', jump: 'jump', attack: 'attack', attack2: 'attack2',
  reload: 'reload', use: 'use', lookatweapon: 'inspect',
};
const impulses = new Set<string>(['lastinv', 'invnext', 'invprev', 'drop', 'cancelselect']);
const CONSOLE = '';

/**
 * Executes a CS2 bind table the way the console does: a key runs its bound
 * command on press and the `-` form of each top-level `+command` on release.
 * Buttons stay down while any key holds them; a keyless `-command` (from an
 * alias, or a bind such as `-attack`) releases every holder. Aliases and
 * runtime `bind`/`alias`/`unbind` statements make toggle scripts work.
 */
export class BindRuntime {
  private profile!: KeyboardProfile;
  private binds = new Map<string, string>();
  private aliases = new Map<string, string>();
  private readonly holders = new Map<HeldAction, Set<string>>();
  private readonly latched = new Set<HeldAction>();
  private readonly pressed = new Map<string, string>();
  private budget = 0;
  constructor(profile: KeyboardProfile, private readonly emit: (event: BindEvent) => void) {this.load(profile);}

  /** Applies a changed profile. Session-only rebinds made by toggle scripts are discarded. */
  setProfile(profile: KeyboardProfile) {
    if (profile === this.profile) return;
    this.releaseAll(); this.load(profile);
  }
  isHeld(action: HeldAction) {return this.toggled(action) ? this.latched.has(action) : (this.holders.get(action)?.size ?? 0) > 0;}
  isPressed(key: string) {return this.pressed.has(key);}
  /** Current command for a key, including session rebinds. */
  binding(key: string) {return this.binds.get(key);}

  keyDown(key: string) {
    if (this.pressed.has(key)) return true;
    const command = this.binds.get(key);
    if (command === undefined) return false;
    this.pressed.set(key, command);
    this.budget = 512;
    // Only +commands remember their key; anything else runs as if typed in the console.
    for (const args of commandsOf(command)) this.execute(args, args[0].startsWith('+') ? key : undefined, 0);
    return true;
  }
  keyUp(key: string) {
    const command = this.pressed.get(key);
    if (command === undefined) return false;
    this.pressed.delete(key);
    this.budget = 512;
    for (const [name, ...args] of commandsOf(command)) if (name.startsWith('+')) this.execute([`-${name.slice(1)}`, ...args], key, 0);
    return true;
  }
  /** Mouse wheel notches press and release at once. */
  tap(key: string) {return this.keyDown(key) && this.keyUp(key);}
  /** Runs console text without a key, e.g. `+left` from an alias. */
  run(text: string) {
    this.budget = 512;
    for (const args of commandsOf(text)) this.execute(args, undefined, 0);
  }
  /** Releases every key, button and toggle, e.g. when the trainer pauses. */
  releaseAll() {
    for (const key of [...this.pressed.keys()]) this.keyUp(key);
    for (const [action, holders] of this.holders) {
      if (!holders.size) continue;
      holders.clear();
      if (!this.toggled(action)) this.emit({kind: 'release', action});
    }
    for (const action of [...this.latched]) {this.latched.delete(action); this.emit({kind: 'release', action});}
  }

  private load(profile: KeyboardProfile) {
    this.profile = profile;
    this.binds = new Map(Object.entries(profile.binds));
    this.aliases = new Map(Object.entries(profile.aliases));
  }
  private toggled(action: HeldAction) {
    return action === 'duck' ? this.profile.duckToggle : action === 'walk' ? this.profile.walkToggle : false;
  }
  private execute(args: string[], key: string | undefined, depth: number) {
    if (--this.budget < 0 || depth > 32) return;
    const name = args[0].toLowerCase();
    const alias = this.aliases.get(name);
    if (alias !== undefined) {
      for (const command of commandsOf(alias)) this.execute(command, undefined, depth + 1);
      return;
    }
    if (name[0] === '+' || name[0] === '-') {
      const action = buttons[name.slice(1)];
      if (action) this.button(action, name[0] === '+', key);
      return;
    }
    if (name === 'bind' && args.length >= 3) {
      const target = canonicalKey(args[1]);
      if (target) this.binds.set(target, args.slice(2).join(' '));
    } else if (name === 'unbind') {
      const target = canonicalKey(args[1]);
      if (target) this.binds.delete(target);
    } else if (name === 'unbindall') this.binds.clear();
    else if (name === 'alias' && args.length >= 3) this.aliases.set(args[1].toLowerCase(), args.slice(2).join(' '));
    else if (impulses.has(name)) this.emit({kind: name as ImpulseCommand});
    else {
      const slot = /^slot(\d{1,2})$/.exec(name);
      if (slot) this.emit({kind: 'slot', slot: Number(slot[1])});
    }
  }
  private button(action: HeldAction, down: boolean, key: string | undefined) {
    let holders = this.holders.get(action);
    if (!holders) this.holders.set(action, holders = new Set());
    const before = holders.size > 0;
    if (down) holders.add(key ?? CONSOLE);
    else if (key === undefined) holders.clear();
    else holders.delete(key);
    const after = holders.size > 0;
    if (before === after) return;
    if (this.toggled(action)) {
      if (!after) return;
      if (this.latched.has(action)) this.latched.delete(action); else this.latched.add(action);
      this.emit({kind: this.latched.has(action) ? 'press' : 'release', action});
      return;
    }
    this.emit({kind: after ? 'press' : 'release', action});
  }
}

/**
 * Maps CS2 weapon slots to the trainer's four: primary, sidearm, knife and Zeus.
 * CS2 keeps the Zeus in the knife slot (GEAR_SLOT_KNIFE position 1), so slot3
 * cycles knife -> Zeus; slot11 selects the Zeus directly.
 */
export function trainerSlot(slot: number, current: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 | undefined {
  if (slot === 1 || slot === 2) return slot;
  if (slot === 3) return current === 3 ? 4 : 3;
  if (slot === 11) return 4;
  return undefined;
}

/** Next or previous carried slot for invnext/invprev, wrapping like CS2. */
export function cycleSlot(current: 1 | 2 | 3 | 4, direction: 1 | -1, available: readonly (1 | 2 | 3 | 4)[]) {
  const order = ([1, 2, 3, 4] as const).filter(slot => available.includes(slot));
  if (!order.length) return current;
  const index = order.indexOf(current);
  return order[((index < 0 ? 0 : index + direction) % order.length + order.length) % order.length];
}
