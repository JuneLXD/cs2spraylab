import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, loadoutWeapon, sanitizeSettings, weaponIds, type Settings} from './config';
import {MAX_POP_PRESET_NAME, MAX_SAVED_POP_PRESETS, PopPresetStore, capturePopPreset, matchesPopPreset, popBuiltInPresets, popCoreKeys, popLookKeys,
  popPersonalKeys, popPresetKeys, popPresetPatch, sanitizePopPresetSettings, sanitizeSavedPopPresets, type PopPresetStorage} from './pop-presets';
import {Simulation} from './simulation';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
/** A tiny stand-in for localStorage; `fail` makes every write throw, as a full or blocked browser store does. */
function memory(initial?: string, fail = false): PopPresetStorage & {data: Map<string, string>} {
  const data = new Map<string, string>(initial === undefined ? [] : [['spraylab.pop.presets.v1', initial]]);
  return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => {if (fail) throw new Error('quota'); data.set(key, String(value));}};
}
const stored = (storage: {data: Map<string, string>}) => JSON.parse(storage.data.get('spraylab.pop.presets.v1') ?? '[]') as {id: string; name: string; weapon?: string; settings: Record<string, unknown>}[];
const sequence = () => {let n = 0; return () => `user-${++n}`;};
const custom = (patch: Partial<Settings> = {}) => sanitizeSettings({...defaults, mode: 'pop', popSize: 44, popCount: 7, popWall: 'right', popWallbang: true, popWallMaterial: 'metal',
  popColor: '#4df3ff', popAmmo: 'off', popSound: 'pop', popMuteGun: true, weapon: 'm4a4', primaryEnabled: true, ...patch});

describe('what a Pop preset holds', () => {
  it('puts every Pop setting either in a preset or in the personal ones a preset never touches', () => {
    const popKeys = Object.keys(defaults).filter(key => key.startsWith('pop')).sort();
    expect([...popPresetKeys, ...popPersonalKeys].sort()).toEqual(popKeys);
    expect(popCoreKeys.every(key => (popPresetKeys as readonly string[]).includes(key))).toBe(true);
    expect(popLookKeys.every(key => (popPresetKeys as readonly string[]).includes(key))).toBe(true);
    expect(popCoreKeys.some(key => (popLookKeys as readonly string[]).includes(key))).toBe(false);
  });

  it('captures the balls and environment, never the personal options, and ties the weapon you start with only when asked', () => {
    const settings = custom({pop3D: true});
    const captured = capturePopPreset(settings, false);
    expect(Object.keys(captured.settings).sort()).toEqual([...popPresetKeys].sort());
    expect(captured.settings).toMatchObject({popSize: 44, popCount: 7, popWall: 'right', popWallbang: true, popWallMaterial: 'metal', popColor: '#4df3ff', pop3D: true});
    for (const key of popPersonalKeys) expect(captured.settings).not.toHaveProperty(key);
    expect(captured.weapon).toBeUndefined();
    expect(capturePopPreset(settings, true).weapon).toBe('m4a4');
    // With no primary carried the tie is the sidearm you start with.
    expect(capturePopPreset(custom({primaryEnabled: false, sidearm: 'usp'}), true).weapon).toBe('usp');
  });

  it('loads as the same settings plus the weapon, picked as the Loadout screen picks it', () => {
    expect(popPresetPatch({settings: {popSize: 25}})).toEqual({popVariant: 'classic', popSize: 25});
    expect(popPresetPatch({settings: {popSize: 25}, weapon: 'awp'})).toEqual({popVariant: 'classic', popSize: 25, weapon: 'awp', primaryEnabled: true});
    expect(popPresetPatch({settings: {popSize: 25}, weapon: 'deagle'})).toEqual({popVariant: 'classic', popSize: 25, sidearm: 'deagle', primaryEnabled: false});
    const preset = {settings: capturePopPreset(custom(), false).settings, weapon: 'deagle' as const};
    const loaded = {...defaults, ...popPresetPatch(preset)};
    expect(loadoutWeapon(loaded)).toBe('deagle');
    expect(matchesPopPreset(preset, loaded)).toBe(true);
    expect(matchesPopPreset(preset, {...loaded, popCount: 2})).toBe(false);
    expect(matchesPopPreset(preset, {...loaded, primaryEnabled: true})).toBe(false);
  });

  it('matches only on the keys a preset sets, so your colours do not matter to a built-in one', () => {
    const classic = popBuiltInPresets.find(preset => preset.id === 'builtin-classic')!;
    expect(matchesPopPreset(classic, defaults)).toBe(true);
    expect(matchesPopPreset(classic, {...defaults, popColor: '#ffffff', popBackground: '#000000', popAmmo: 'off', popPadColor: '#ff6a4d'})).toBe(true);
    expect(matchesPopPreset(classic, {...defaults, popDistance: 20})).toBe(false);
    // A tied preset also needs its weapon; an untied one does not care which weapon you hold.
    const awp = popBuiltInPresets.find(preset => preset.id === 'builtin-long-range')!;
    const held = {...defaults, ...popPresetPatch(awp)};
    expect(matchesPopPreset(awp, held)).toBe(true);
    expect(matchesPopPreset(awp, {...held, weapon: 'ak47'})).toBe(false);
    expect(matchesPopPreset(classic, {...defaults, weapon: 'ak47'})).toBe(true);
  });

  it('bounds the values of a preset like the settings screen does and drops what is not a preset key', () => {
    expect(sanitizePopPresetSettings({popSize: 500, popWall: 'up', popCount: 3.4, popWallMaterial: 'glass', popAmmo: 'off', evil: 1, popColor: 'red'}))
      .toEqual({popSize: 80, popWall: 'off', popCount: 3, popWallMaterial: 'wood', popColor: '#ff6a4d'});
    expect(sanitizePopPresetSettings(null)).toEqual({});
    expect(sanitizePopPresetSettings({popWallbang: 'yes'})).toEqual({popWallbang: false});
  });
});

describe('built-in Pop presets', () => {
  it('are named, unique and set the whole scenario without touching your colours, ammo, sound or HUD', () => {
    expect(popBuiltInPresets.length).toBeGreaterThanOrEqual(8);
    expect(new Set(popBuiltInPresets.map(preset => preset.id)).size).toBe(popBuiltInPresets.length);
    expect(new Set(popBuiltInPresets.map(preset => preset.name)).size).toBe(popBuiltInPresets.length);
    for (const preset of popBuiltInPresets) {
      expect(preset.id).toMatch(/^builtin-[a-z-]+$/); expect(preset.builtIn).toBe(true); expect(preset.note).toBeTruthy();
      for (const key of popCoreKeys) expect(preset.settings, `${preset.id} ${key}`).toHaveProperty(key);
      for (const key of [...popLookKeys, ...popPersonalKeys]) expect(preset.settings, `${preset.id} ${key}`).not.toHaveProperty(key);
      expect(sanitizePopPresetSettings(preset.settings)).toEqual(preset.settings);
      if (preset.weapon) expect((weaponIds as readonly string[]).includes(preset.weapon)).toBe(true);
    }
  });

  it('tie some presets to weapons and leave others for any weapon', () => {
    const tied = popBuiltInPresets.filter(preset => preset.weapon);
    expect(tied.map(preset => [preset.id, preset.weapon])).toEqual([['builtin-long-range', 'awp'], ['builtin-spray-control', 'ak47'], ['builtin-pistol-heads', 'deagle'], ['builtin-wallbang-concrete', 'awp']]);
    expect(popBuiltInPresets.length - tied.length).toBeGreaterThanOrEqual(3);
  });

  it('include the wallbang drills, one of them a concrete wall that only the heavy hitters shoot through', () => {
    const wood = popBuiltInPresets.find(preset => preset.id === 'builtin-wallbang-wood')!, concrete = popBuiltInPresets.find(preset => preset.id === 'builtin-wallbang-concrete')!;
    expect(wood.settings).toMatchObject({popWall: 'both', popWallbang: true, popWallMaterial: 'wood'});
    expect(concrete.settings).toMatchObject({popWall: 'both', popWallbang: true, popWallMaterial: 'concrete'});
    expect(popBuiltInPresets.filter(preset => !preset.settings.popWallbang).every(preset => !('popWallMaterial' in preset.settings))).toBe(true);
  });

  it('each start a Pop session with the balls, wall and weapon they describe', () => {
    for (const preset of popBuiltInPresets) {
      const settings = sanitizeSettings({...defaults, mode: 'pop', ...popPresetPatch(preset)});
      const sim = new Simulation(settings, lcg(3));
      expect(sim.pop!.balls, preset.id).toHaveLength(preset.settings.popCount!);
      expect(sim.pop!.config).toMatchObject({count: preset.settings.popCount, distance: preset.settings.popDistance, hits: preset.settings.popHits,
        wall: preset.settings.popWall, wallbang: preset.settings.popWallbang, respawnMode: preset.settings.popRespawnMode});
      expect(!!sim.pop!.wall, preset.id).toBe(preset.settings.popWall !== 'off');
      if (preset.weapon) expect(sim.equipped, preset.id).toBe(preset.weapon);
    }
  });
});

describe('saved Pop presets', () => {
  it('are saved, found again by a new store and kept in order', () => {
    const storage = memory(), store = new PopPresetStore(storage, sequence());
    expect(store.getSnapshot()).toEqual({presets: [], persisted: true});
    const first = store.save('My flicks', capturePopPreset(custom(), true));
    expect(first).toMatchObject({replaced: false, preset: {id: 'user-1', name: 'My flicks', weapon: 'm4a4'}});
    store.save('Long range', capturePopPreset(custom({popDistance: 30}), false));
    expect(store.getSnapshot().presets.map(preset => preset.name)).toEqual(['My flicks', 'Long range']);
    const again = new PopPresetStore(storage, sequence());
    expect(again.getSnapshot().presets).toEqual(store.getSnapshot().presets);
    expect(again.getSnapshot().presets[0].settings).toMatchObject({popSize: 44, popWallMaterial: 'metal', popColor: '#4df3ff'});
    expect(again.getSnapshot().presets[1].weapon).toBeUndefined();
  });

  it('tidy the name, replace a preset saved under the same name and refuse an empty one', () => {
    const storage = memory(), store = new PopPresetStore(storage, sequence());
    expect(store.save('   ', capturePopPreset(custom(), false))).toEqual({error: 'Give the preset a name.'});
    const saved = store.save('  Head   shots  ', capturePopPreset(custom(), false));
    expect(saved).toMatchObject({preset: {name: 'Head shots'}});
    const replaced = store.save('HEAD SHOTS', capturePopPreset(custom({popCount: 2}), true));
    expect(replaced).toMatchObject({replaced: true, preset: {id: 'user-1', name: 'HEAD SHOTS', weapon: 'm4a4'}});
    expect(store.getSnapshot().presets).toHaveLength(1); expect(store.getSnapshot().presets[0].settings.popCount).toBe(2);
    const long = store.save('x'.repeat(100), capturePopPreset(custom(), false));
    expect('preset' in long && long.preset.name).toHaveLength(MAX_POP_PRESET_NAME);
  });

  it('keep at most fifty, though one of them can still be replaced', () => {
    const store = new PopPresetStore(memory(), sequence());
    for (let i = 0; i < MAX_SAVED_POP_PRESETS; i++) expect('preset' in store.save(`Preset ${i}`, capturePopPreset(custom(), false))).toBe(true);
    expect(store.save('One too many', capturePopPreset(custom(), false))).toEqual({error: `You can keep ${MAX_SAVED_POP_PRESETS} saved presets: delete one first.`});
    expect(store.save('preset 7', capturePopPreset(custom({popCount: 1}), false))).toMatchObject({replaced: true});
    expect(store.getSnapshot().presets).toHaveLength(MAX_SAVED_POP_PRESETS);
  });

  it('update a preset in place, rename it, and refuse a name another preset has', () => {
    const storage = memory(), store = new PopPresetStore(storage, sequence());
    store.save('One', capturePopPreset(custom(), true)); store.save('Two', capturePopPreset(custom(), false));
    expect(store.update('user-1', 'One renamed', capturePopPreset(custom({popCount: 3}), false))).toMatchObject({replaced: true, preset: {id: 'user-1', name: 'One renamed'}});
    expect(stored(storage)[0]).toMatchObject({id: 'user-1', name: 'One renamed', settings: {popCount: 3}}); expect(stored(storage)[0]).not.toHaveProperty('weapon');
    expect(store.update('user-1', 'two', capturePopPreset(custom(), false))).toEqual({error: 'Another saved preset already has that name.'});
    expect(store.update('user-9', 'Nope', capturePopPreset(custom(), false))).toEqual({error: 'That preset no longer exists.'});
    expect(store.update('user-1', ' ', capturePopPreset(custom(), false))).toEqual({error: 'Give the preset a name.'});
    expect(store.update('user-2', 'Two', capturePopPreset(custom({popCount: 9}), false))).toMatchObject({preset: {name: 'Two'}});
  });

  it('can be deleted, and every change tells the screens that show them', () => {
    const store = new PopPresetStore(memory(), sequence());
    let calls = 0; const stop = store.subscribe(() => calls++);
    store.save('One', capturePopPreset(custom(), false)); store.save('Two', capturePopPreset(custom(), false));
    expect(store.remove('user-1')).toBe(true); expect(store.remove('user-1')).toBe(false);
    expect(store.getSnapshot().presets.map(preset => preset.name)).toEqual(['Two']); expect(calls).toBe(3);
    stop(); store.remove('user-2'); expect(calls).toBe(3);
  });

  it('remember which preset was chosen for every screen that shows them, and forget it when that preset is deleted', () => {
    const store = new PopPresetStore(memory(), sequence());
    expect(store.getSnapshot().selectedId).toBeUndefined();
    store.save('One', capturePopPreset(custom(), false));
    let calls = 0; store.subscribe(() => calls++);
    store.select('user-1'); expect(store.getSnapshot().selectedId).toBe('user-1'); expect(calls).toBe(1);
    store.select('user-1'); expect(calls).toBe(1);
    store.save('Two', capturePopPreset(custom(), false)); expect(store.getSnapshot().selectedId).toBe('user-1');
    store.select('builtin-classic'); store.remove('user-1'); expect(store.getSnapshot().selectedId).toBe('builtin-classic');
    store.select('user-2'); store.remove('user-2'); expect(store.getSnapshot().selectedId).toBeUndefined();
    store.select(''); expect(store.getSnapshot().selectedId).toBe('');
  });

  it('read back only well-formed, bounded presets from storage', () => {
    const entry = (extra: object) => ({id: 'a', name: 'Fine', settings: {popSize: 25}, ...extra});
    expect(sanitizeSavedPopPresets('nope')).toEqual([]);
    const presets = sanitizeSavedPopPresets([entry({}), entry({}), null, 5, entry({id: ''}), entry({id: 'builtin-classic'}), entry({id: 'b', name: ' '}), entry({id: 'c', weapon: 'sword'}),
      entry({id: 'd', weapon: 'awp', settings: {popSize: 999, popWall: 'up', popAmmo: 'off', evil: 1}}), entry({id: 'e', settings: 'broken'}), {name: 'No id'}]);
    expect(presets.map(preset => preset.id)).toEqual(['a', 'c', 'd', 'e']);
    expect(presets[1]).not.toHaveProperty('weapon'); expect(presets[2]).toMatchObject({weapon: 'awp', settings: {popSize: 80, popWall: 'off'}});
    expect(presets[2].settings).not.toHaveProperty('popAmmo'); expect(presets[3].settings).toEqual({});
    expect(sanitizeSavedPopPresets(Array.from({length: 80}, (_, i) => entry({id: `p${i}`, name: `P${i}`})))).toHaveLength(MAX_SAVED_POP_PRESETS);
    expect(new PopPresetStore(memory('not json'), sequence()).getSnapshot().presets).toEqual([]);
  });

  it('do not overwrite each other when two tabs save, and a tab picks up the other one\'s presets', () => {
    const storage = memory(), tabA = new PopPresetStore(storage, sequence()), tabB = new PopPresetStore(storage, () => 'user-b');
    tabA.save('From A', capturePopPreset(custom(), false)); tabB.save('From B', capturePopPreset(custom(), false));
    expect(stored(storage).map(preset => preset.name)).toEqual(['From A', 'From B']);
    expect(tabA.getSnapshot().presets.map(preset => preset.name)).toEqual(['From A']);
    let calls = 0; tabA.subscribe(() => calls++);
    tabA.reload(); expect(tabA.getSnapshot().presets.map(preset => preset.name)).toEqual(['From A', 'From B']); expect(calls).toBe(1);
    tabA.reload(); expect(calls).toBe(1);
  });

  it('keep working for this tab when storage cannot be written or is missing', () => {
    const blocked = new PopPresetStore(memory(undefined, true), sequence());
    expect(blocked.save('Kept', capturePopPreset(custom(), false))).toMatchObject({replaced: false});
    blocked.save('Also kept', capturePopPreset(custom(), false));
    expect(blocked.getSnapshot().persisted).toBe(false); expect(blocked.getSnapshot().presets.map(preset => preset.name)).toEqual(['Kept', 'Also kept']);
    const none = new PopPresetStore(undefined, sequence());
    expect(none.getSnapshot()).toEqual({presets: [], persisted: false});
    none.save('Memory only', capturePopPreset(custom(), false)); expect(none.getSnapshot().presets).toHaveLength(1); expect(none.remove('user-1')).toBe(true);
    const unreadable = new PopPresetStore({getItem: () => {throw new Error('blocked');}, setItem: () => undefined}, sequence());
    expect(unreadable.getSnapshot()).toEqual({presets: [], persisted: false});
  });
});

describe('the Presets block in the Pop settings', () => {
  const render = (settings: Settings) => renderToStaticMarkup(createElement(TrainingSettings, {settings, update: () => undefined}));
  it('lists the built-in presets with their weapons and starts on the one the settings already are', () => {
    const html = render({...defaults, mode: 'pop'});
    expect(html).toContain('aria-label="Pop preset"'); expect(html).toContain('<optgroup label="Built-in">'); expect(html).not.toContain('<optgroup label="Saved">');
    expect(html).toContain('>Long range flicks · AWP</option>'); expect(html).toContain('>Pistol heads · Desert Eagle</option>'); expect(html).toContain('>Classic warm-up</option>');
    expect(html).toMatch(/<option value="builtin-classic" selected="">Classic warm-up<\/option>/);
    expect(html).toContain('Five 30 cm balls 12 m away, one shot each.');
    expect(html).toContain('Tie to my current weapon (AWP)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save preset<\/button>/); expect(html).not.toContain('Update preset');
  });

  it('shows Custom for settings no preset matches and selects a tied preset once its weapon is held', () => {
    expect(render({...defaults, mode: 'pop', popSize: 44})).toMatch(/<option value="" selected="">Custom \(current settings\)<\/option>/);
    expect(render({...defaults, mode: 'pop', ...popPresetPatch(popBuiltInPresets.find(preset => preset.id === 'builtin-spray-control')!)}))
      .toMatch(/<option value="builtin-spray-control" selected="">Spray control · AK-47<\/option>/);
  });

  it('appears only for Pop', () => {
    expect(render({...defaults, mode: 'guided'})).not.toContain('Pop preset');
  });
});
