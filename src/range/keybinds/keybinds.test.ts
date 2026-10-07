import {describe, expect, it} from 'vitest';
import {canonicalKey, codeFromKey, keyboardKeys, keyFromCode, keyFromMouseButton} from './keys';
import {parseKeyValues, splitCommands, tokenize} from './console';
import {bindRows, cs2DefaultBinds, defaultKeyboard, keyboardPage, keysFor, otherBinds, sanitizeKeyboard, trainerDefaultBinds, type KeyboardProfile} from './profile';
import {BindRuntime, cycleSlot, trainerSlot, type BindEvent} from './runtime';
import {exportCfg, importCs2Config, parseBindLine} from './cs2-import';
import {classicViewmodel, sanitizeViewmodel} from '../config';

const profile = (patch: Partial<KeyboardProfile> = {}): KeyboardProfile => ({...defaultKeyboard, ...patch});
function runtime(patch: Partial<KeyboardProfile> = {}) {
  const events: BindEvent[] = [];
  const bindings = new BindRuntime(profile(patch), event => events.push(event));
  return {bindings, events, take: () => events.splice(0)};
}

// Synthetic config using the patterns found in real autoexec files.
const autoexec = `// movement on TFGH
bind "t" "+forward"; bind "g" "+back"
bind "f" "+left"; bind "h" "+right"
bind "j" "+sprint"
bind "c" "+duck"; bind "ALT" "+duck"
bind "k" +jump;
bind "kp_minus" "-attack";
bind "y" "+voicerecord"";
unbind "1"; unbind "w"
alias +knife slot3; alias -knife slot1;
alias "sniperMode" "bind i +knife;bind 1 rifleMode";
alias "rifleMode" "bind i slot1; bind 1 sniperMode";
bind 1 rifleMode;
alias "afk_on" "+left; alias afk_toggle afk_off"
alias "afk_off" "-left; alias afk_toggle afk_on"
alias "afk_toggle" "afk_on"
bind "tab" "afk_toggle"
bind "KP_END" "say .prac"
bind "F12" "+left;volume 0"
sensitivity "1.25"
viewmodel_fov 65; viewmodel_offset_x -0.5; viewmodel_offset_y 1; viewmodel_offset_z -2; viewmodel_presetpos 1;
exec movement_extras
host_writeconfig`;

describe('CS2 key names', () => {
  it('canonicalizes CS2 and CS:GO spellings', () => {
    expect(canonicalKey('V')).toBe('v');
    expect(canonicalKey('kp_end')).toBe('KP_1');
    expect(canonicalKey('kp_minus')).toBe('KP_MINUS');
    expect(canonicalKey(';')).toBe('SEMICOLON');
    expect(canonicalKey('mwheelup')).toBe('MWHEELUP');
    expect(canonicalKey('`')).toBe('`');
    expect(canonicalKey('two words')).toBeUndefined();
  });
  it('maps physical browser keys and mouse buttons to CS2 names', () => {
    expect(keyFromCode('KeyW')).toBe('w');
    expect(keyFromCode('Numpad5')).toBe('KP_5');
    expect(keyFromCode('ShiftRight')).toBe('RSHIFT');
    expect(keyFromCode('IntlBackslash')).toBe('<');
    expect([0, 1, 2, 3, 4].map(keyFromMouseButton)).toEqual(['MOUSE1', 'MOUSE3', 'MOUSE2', 'MOUSE4', 'MOUSE5']);
    for (const key of keyboardKeys) expect(keyFromCode(codeFromKey(key)!)).toBe(key);
  });
});

describe('console text', () => {
  it('splits commands like the CS2 console', () => {
    expect(splitCommands('bind "a" "x; y"; unbind b // comment ; ignored\nalias z')).toEqual(['bind "a" "x; y"', 'unbind b', 'alias z']);
    // An unterminated quote runs to the end of the line, swallowing the semicolon.
    expect(splitCommands('bind "y" "+voicerecord"";\nbind k +jump').map(tokenize)).toEqual([['bind', 'y', '+voicerecord', ';'], ['bind', 'k', '+jump']]);
    expect(tokenize('alias "say_chat1" "say .prac; alias next say_chat2"')).toEqual(['alias', 'say_chat1', 'say .prac; alias next say_chat2']);
  });
  it('parses KeyValues config files', () => {
    expect(parseKeyValues('"config"\n{\n\t"bindings"\n\t{\n\t\t"MOUSE4"\t\t"<unbound>" // x\n\t\t"t"\t"+forward"\n\t}\n}')).toEqual({config: {bindings: {MOUSE4: '<unbound>', t: '+forward'}}});
  });
});

describe('CS2 keyboard page data', () => {
  it('mirrors the installed Keyboard / Mouse settings page', () => {
    expect(keyboardPage.sections.map(section => section.title)).toEqual(['Keyboard & Mouse Settings', 'Movement Keys', 'Weapon Keys', 'UI Keys', 'Communication Options', 'Chat Wheel Keys']);
    expect(bindRows.find(row => row.bind === '+left')?.label).toBe('Move Left (strafe)');
    expect(bindRows.find(row => row.bind === 'slot11')?.label).toBe('Zeus x27');
    expect(cs2DefaultBinds).toMatchObject({w: '+forward', a: '+left', SHIFT: '+sprint', CTRL: '+duck', MOUSE1: '+attack', MWHEELDOWN: 'invnext', q: 'lastinv', c: '+radialradio'});
  });
  it('keeps the trainer extras on top of CS2 defaults', () => {
    expect(trainerDefaultBinds).toMatchObject({c: '+duck', '4': 'slot11', RSHIFT: '+sprint', RCTRL: '+duck', w: '+forward'});
    expect(sanitizeKeyboard(undefined)).toEqual(defaultKeyboard);
    expect(sanitizeKeyboard({binds: {V: 'drop', 'not a key': 'x'}, aliases: {AFK: '+left', 'bad name': 'x'}, zoomSensitivity: 9}))
      .toMatchObject({binds: {v: 'drop'}, aliases: {afk: '+left'}, zoomSensitivity: 3});
  });
});

describe('bind runtime', () => {
  it('holds a button until every key that pressed it is released', () => {
    const {bindings, take} = runtime({binds: {w: '+forward', t: '+forward'}});
    bindings.keyDown('w'); bindings.keyDown('t');
    expect(take()).toEqual([{kind: 'press', action: 'forward'}]);
    bindings.keyUp('w');
    expect(bindings.isHeld('forward')).toBe(true);
    bindings.keyUp('t');
    expect(take()).toEqual([{kind: 'release', action: 'forward'}]);
  });
  it('supports duck and walk toggles', () => {
    const {bindings} = runtime({binds: {c: '+duck'}, duckToggle: true});
    bindings.keyDown('c'); bindings.keyUp('c');
    expect(bindings.isHeld('duck')).toBe(true);
    bindings.keyDown('c'); bindings.keyUp('c');
    expect(bindings.isHeld('duck')).toBe(false);
  });
  it('runs +/- aliases and self-rebinding toggle scripts', () => {
    const {bindings, take} = runtime(importCs2Config([{name: 'autoexec.cfg', text: autoexec}], defaultKeyboard).profile);
    const press = (key: string) => {bindings.keyDown(key); bindings.keyUp(key);};
    press('1');
    expect(bindings.binding('i')).toBe('slot1');
    expect(bindings.binding('1')).toBe('sniperMode');
    press('1');
    expect(bindings.binding('i')).toBe('+knife');
    expect(take()).toEqual([]);
    bindings.keyDown('i');
    expect(take()).toEqual([{kind: 'slot', slot: 3}]);
    bindings.keyUp('i');
    expect(take()).toEqual([{kind: 'slot', slot: 1}]);
  });
  it('keeps console-held buttons and releases them from a keyless -command', () => {
    const {bindings} = runtime(importCs2Config([{name: 'autoexec.cfg', text: autoexec}], defaultKeyboard).profile);
    bindings.keyDown('TAB'); bindings.keyUp('TAB');
    expect(bindings.isHeld('left')).toBe(true);
    bindings.keyDown('f'); bindings.keyUp('f');
    expect(bindings.isHeld('left')).toBe(true);
    bindings.keyDown('TAB'); bindings.keyUp('TAB');
    expect(bindings.isHeld('left')).toBe(false);
  });
  it('lets a -attack bind release a held fire button, as jump-throw binds rely on', () => {
    const {bindings, take} = runtime({binds: {MOUSE1: '+attack', KP_MINUS: '-attack'}});
    bindings.keyDown('MOUSE1'); bindings.keyDown('KP_MINUS');
    expect(take()).toEqual([{kind: 'press', action: 'attack'}, {kind: 'release', action: 'attack'}]);
  });
  it('survives recursive aliases and releases everything on pause', () => {
    const {bindings, take} = runtime({binds: {x: 'loop', w: '+forward'}, aliases: {loop: 'loop; loop'}});
    expect(bindings.keyDown('x')).toBe(true);
    bindings.keyDown('w'); take();
    bindings.releaseAll();
    expect(take()).toEqual([{kind: 'release', action: 'forward'}]);
    expect(bindings.isPressed('w')).toBe(false);
  });
  it('maps CS2 weapon slots onto the trainer loadout', () => {
    expect(trainerSlot(3, 1)).toBe(3);
    expect(trainerSlot(3, 3)).toBe(4);
    expect(trainerSlot(11, 2)).toBe(4);
    expect(trainerSlot(4, 1)).toBeUndefined();
    expect(cycleSlot(4, 1, [1, 2, 3, 4])).toBe(1);
    expect(cycleSlot(2, -1, [2, 3, 4])).toBe(4);
  });
});

describe('CS2 config import', () => {
  it('rebuilds binds from defaults, user vcfg and autoexec in load order', () => {
    const keys = '"config"\n{\n\t"bindings"\n\t{\n\t\t"MOUSE4"\t\t"<unbound>"\n\t\t"o"\t\t"slot8"\n\t\t"t"\t\t"+use"\n\t}\n}';
    const convars = '"config"\n{\n\t"convars"\n\t{\n\t\t"sensitivity"\t\t"1.06"\n\t\t"option_duck_method"\t\t"false"\n\t\t"cl_debounce_zoom"\t\t"true"\n\t\t"zoom_sensitivity_ratio"\t\t"0.9"\n\t}\n}';
    const {profile, mouse, viewmodel, report} = importCs2Config([{name: 'autoexec.cfg', text: autoexec}, {name: 'cs2_user_keys_0_slot0.vcfg', text: keys}, {name: 'cs2_user_convars_0_slot0.vcfg', text: convars}], defaultKeyboard);
    expect(viewmodel).toEqual({fov: 65, x: -.5, y: 1, z: -2});
    expect(profile.binds).toMatchObject({t: '+forward', g: '+back', f: '+left', h: '+right', j: '+sprint', ALT: '+duck', k: '+jump', o: 'slot8', y: '+voicerecord ;', KP_1: 'say .prac', s: '+back'});
    expect(profile.binds).not.toHaveProperty('w');
    expect(profile.binds['1']).toBe('rifleMode');
    expect(profile.binds).not.toHaveProperty('MOUSE4');
    expect(profile.binds.c).toBe('+duck');
    expect(profile).toMatchObject({duckToggle: false, zoomRepeat: false, zoomSensitivity: .9});
    // autoexec.cfg runs after the convars file, as CS2 does at startup.
    expect(mouse.sensitivity).toBe(1.25);
    expect(report.missingExec).toEqual(['movement_extras']);
    expect(report.reserved).toEqual([{key: 'F12', reason: expect.stringContaining('developer tools')}]);
    expect(keysFor(profile, '+left')).toEqual(expect.arrayContaining([{key: 'f', direct: true}, {key: 'TAB', direct: false}]));
    expect(otherBinds(profile).map(([key]) => key)).toContain('KP_1');
  });
  it('follows exec into other chosen files once', () => {
    const files = [{name: 'autoexec.cfg', text: 'exec binds/extra.cfg\nbind q drop'}, {name: 'extra.cfg', text: 'bind q lastinv\nbind z noclip'}];
    const {profile, report} = importCs2Config(files, defaultKeyboard);
    expect(profile.binds).toMatchObject({q: 'drop', z: 'noclip'});
    expect(report.missingExec).toEqual([]);
  });
  it('exports a cfg that imports back to the same profile', () => {
    const imported = importCs2Config([{name: 'autoexec.cfg', text: autoexec}], defaultKeyboard).profile;
    const text = exportCfg(imported, {sensitivity: 1.25, invertY: true, viewmodel: {fov: 60, x: 1, y: 1, z: -1}});
    const back = importCs2Config([{name: 'spraylab.cfg', text}], defaultKeyboard);
    expect(back.profile.binds).toEqual(imported.binds);
    expect(back.profile.aliases).toEqual(imported.aliases);
    expect(back.mouse).toEqual({sensitivity: 1.25, invertY: true});
    expect(back.viewmodel).toEqual({fov: 60, x: 1, y: 1, z: -1});
  });
  it('keeps imported viewmodel values within CS2 limits', () => {
    expect(sanitizeViewmodel({fov: 90, x: -9, y: 'a', z: 1.5})).toEqual({fov: 68, x: -2.5, y: 0, z: 1.5});
    expect(sanitizeViewmodel(undefined)).toEqual(classicViewmodel);
  });
  it('reads a typed bind line', () => {
    expect(parseBindLine('bind "KP_ENTER" "say_team hi";')).toEqual({key: 'KP_ENTER', command: 'say_team hi'});
    expect(parseBindLine('nonsense')).toBeUndefined();
  });
});
