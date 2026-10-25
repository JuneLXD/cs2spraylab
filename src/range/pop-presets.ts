import {defaults, loadoutWeapon, pistolIds, sanitizeSettings, weaponIds, type Pistol, type Settings, type Weapon} from './config';
import type {PopVariant} from './pop';

/** Pop presets: a named setup of the balls and the environment that can be loaded in one click, saved under your own name,
 * and optionally tied to a weapon (loading it then equips that weapon). A preset never touches your ammo mode, sounds or
 * HUD options: those are about you, not the scenario. */

/** What every preset sets: the balls, how popped balls come back, and the peek wall with its wallbang switch. Built-in
 * presets set exactly these, so loading one fully replaces the scenario. */
export const popCoreKeys = ['popVariant', 'popPairGap', 'popPairRadius', 'popHoldTime', 'popPrecisionSpeed', 'popFlickStep', 'popFlickRadius', 'popClusterCount', 'popClusterWidth', 'popClusterHeight', 'popSize', 'popCount', 'popSpacing', 'popDistance', 'popHits', 'popRespawn', 'popRespawnMode',
  'popMoveX', 'popRangeX', 'popFlipX', 'popMoveY', 'popRangeY', 'popFlipY', 'popMoveChance', 'popWall', 'popWallWidth', 'popWallbang'] as const;
/** Everything a saved preset keeps. The extra keys (wall material, pad size, colours, see-through balls) are details a
 * built-in preset leaves as you have them, unless it is about that detail (the wallbang presets pick a material). */
export const popPresetKeys = [...popCoreKeys, 'popWallMaterial', 'popPadWidth', 'popPadDepth', 'popWallXray', 'popColor', 'popBackground', 'popPadColor', 'pop3D'] as const;
/** The look of the balls and the environment: built-in presets never change these. */
export const popLookKeys = ['popWallXray', 'popColor', 'popBackground', 'popPadColor', 'pop3D'] as const;
/** Pop settings that are about you, not the scenario; no preset touches them. */
export const popPersonalKeys = ['popAmmo', 'popSound', 'popMuteGun', 'popHideImpacts', 'popHideHud', 'popPadSound'] as const;
export type PopCoreKey = typeof popCoreKeys[number];
export type PopPresetKey = typeof popPresetKeys[number];
export type PopPresetSettings = Partial<Pick<Settings, PopPresetKey>>;
export type PopPreset = {id: string; name: string; settings: PopPresetSettings; weapon?: Weapon; note?: string; builtIn?: true};
export type CapturedPopPreset = {settings: PopPresetSettings; weapon?: Weapon};

/** Selecting a drill starts its recommended setup, preserving personal options, weapon and colours. */
export function popVariantPatch(popVariant: PopVariant): PopPresetSettings {
  const core = Object.fromEntries(popCoreKeys.map(key => [key, defaults[key]])) as PopPresetSettings;
  if (popVariant === 'classic') return core;
  return {...core, popVariant, popCount: popVariant === 'closepairs' || popVariant === 'pokeball' ? 2 : 1, popDistance: 8, popSize: 8};
}

export const MAX_SAVED_POP_PRESETS = 50, MAX_POP_PRESET_NAME = 40;
const STORAGE_KEY = 'spraylab.pop.presets.v1';
const isWeapon = (value: unknown): value is Weapon => typeof value === 'string' && (weaponIds as readonly string[]).includes(value);
const isPistol = (id: Weapon): id is Pistol => (pistolIds as readonly string[]).includes(id);

/** The preset keys found in `raw`, each bounded by the same rules as the settings screen; anything else is dropped. */
export function sanitizePopPresetSettings(raw: unknown): PopPresetSettings {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const present = popPresetKeys.filter(key => key in source);
  const clean = sanitizeSettings({...defaults, ...Object.fromEntries(present.map(key => [key, source[key]]))});
  return Object.fromEntries(present.map(key => [key, clean[key]])) as PopPresetSettings;
}

/** The current balls and environment as a preset, tied to the weapon you start with when `tieWeapon` is set. */
export function capturePopPreset(settings: Settings, tieWeapon: boolean): CapturedPopPreset {
  return {settings: Object.fromEntries(popPresetKeys.map(key => [key, settings[key]])) as PopPresetSettings,
    ...(tieWeapon ? {weapon: loadoutWeapon(settings)} : {})};
}

/** What loading a preset changes: its settings and, when it is tied to a weapon, that weapon, picked the way the Loadout
 * screen picks it (a pistol is carried as the sidearm with no primary, anything else as the primary). */
export function popPresetPatch(preset: Pick<PopPreset, 'settings' | 'weapon'>): Partial<Settings> {
  const {weapon} = preset;
  return {popVariant: 'classic', ...preset.settings, ...(weapon ? isPistol(weapon) ? {sidearm: weapon, primaryEnabled: false} : {weapon, primaryEnabled: true} : {})};
}

/** Whether the settings still are the preset: every key it sets, and the weapon it is tied to. */
export function matchesPopPreset(preset: Pick<PopPreset, 'settings' | 'weapon'>, settings: Settings): boolean {
  return (preset.settings.popVariant ?? 'classic') === settings.popVariant
    && (Object.keys(preset.settings) as PopPresetKey[]).every(key => settings[key] === preset.settings[key])
    && (!preset.weapon || loadoutWeapon(settings) === preset.weapon);
}

function builtIn(slug: string, name: string, note: string, overrides: Partial<Pick<Settings, PopCoreKey | 'popWallMaterial'>>, weapon?: Weapon): PopPreset {
  const core = Object.fromEntries(popCoreKeys.map(key => [key, defaults[key]]));
  return {id: `builtin-${slug}`, name, note, builtIn: true, settings: sanitizePopPresetSettings({...core, ...overrides}), ...(weapon ? {weapon} : {})};
}

/** Ready-made setups. Tied ones equip their weapon; none changes your colours, ammo, sound or HUD. */
export const popBuiltInPresets: readonly PopPreset[] = [
  builtIn('classic', 'Classic warm-up', 'Five 30 cm balls 12 m away, one shot each.', {}),
  builtIn('head-sized', 'Head-sized balls', 'Four 20 cm balls, about the size of a head, 15 m away.',
    {popSize: 20, popCount: 4, popSpacing: 1.6, popDistance: 15}),
  builtIn('long-range', 'Long range flicks', 'Three 30 cm balls 30 m away for scoped flicks.',
    {popCount: 3, popSpacing: 3, popDistance: 30}, 'awp'),
  builtIn('spray-control', 'Spray control', 'Two big balls 20 m away that take 8 hits each, so a full spray stays on one ball.',
    {popSize: 60, popCount: 2, popSpacing: 2, popDistance: 20, popHits: 8}, 'ak47'),
  builtIn('pistol-heads', 'Pistol heads', 'Three head-sized balls 14 m away for one-tap pistol practice.',
    {popSize: 20, popCount: 3, popSpacing: 1.5, popDistance: 14}, 'deagle'),
  builtIn('strafing', 'Strafing balls', 'Balls that strafe left and right and change direction suddenly.',
    {popSize: 35, popCount: 3, popSpacing: 2, popDistance: 15, popMoveX: 2.5, popRangeX: 2.5, popFlipX: 1, popMoveChance: 1}),
  builtIn('peek-pad', 'Peek and pop', 'A wall in front of you with the balls past its left edge. Step out to the left and pop them, then step back onto the pad behind the wall to bring them back.',
    {popCount: 4, popDistance: 14, popWall: 'left', popRespawnMode: 'pad'}),
  builtIn('wallbang-wood', 'Wallbang through wood', 'A 3 m wooden pillar straight ahead: every gun shoots through it at the balls behind.',
    {popWall: 'both', popWallWidth: 3, popWallbang: true, popWallMaterial: 'wood'}),
  builtIn('wallbang-concrete', 'Wallbang through concrete', 'A 3 m concrete pillar straight ahead: rifles are stopped, the AWP shoots through.',
    {popSize: 35, popCount: 4, popSpacing: 2, popDistance: 20, popWall: 'both', popWallWidth: 3, popWallbang: true, popWallMaterial: 'concrete'}, 'awp'),
];

const tidyName = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_POP_PRESET_NAME) : '';
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Saved presets as read from storage: malformed entries, repeated ids, ids that imitate a built-in one and anything past the
 * limit are dropped, and every value is bounded like the settings screen does. */
export function sanitizeSavedPopPresets(raw: unknown): PopPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), presets: PopPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const {id, name, weapon, settings} = entry as Record<string, unknown>, clean = tidyName(name);
    if (typeof id !== 'string' || !id || id.startsWith('builtin-') || seen.has(id) || !clean) continue;
    seen.add(id);
    presets.push({id, name: clean, settings: sanitizePopPresetSettings(settings), ...(isWeapon(weapon) ? {weapon} : {})});
    if (presets.length >= MAX_SAVED_POP_PRESETS) break;
  }
  return presets;
}

export type PopPresetStorage = Pick<Storage, 'getItem' | 'setItem'>;
/** The saved presets, whether they reached browser storage (they last only for this tab when it is unavailable), and the preset
 * the user chose last ('' for Custom), which every screen showing the presets agrees on; undefined until one is chosen. */
export type PopPresetSnapshot = {presets: readonly PopPreset[]; persisted: boolean; selectedId?: string};
export type PopPresetResult = {preset: PopPreset; replaced: boolean} | {error: string};

function browserStorage(): PopPresetStorage | undefined {
  try {return typeof localStorage === 'undefined' ? undefined : localStorage;} catch {return undefined;}
}
const newId = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The user's saved presets. Every change re-reads storage first, so two tabs adding presets do not overwrite each other,
 * and it keeps working in memory when storage is unavailable. Shaped for useSyncExternalStore. */
export class PopPresetStore {
  private snapshot: PopPresetSnapshot;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: PopPresetStorage | undefined = browserStorage(), private readonly makeId: () => string = newId) {
    const stored = this.read();
    this.snapshot = {presets: stored ?? [], persisted: !!storage && stored !== undefined};
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};

  /** Saves under `name`; a saved preset with the same name (ignoring case) is replaced. */
  save(name: string, captured: CapturedPopPreset): PopPresetResult {
    const clean = tidyName(name);
    if (!clean) return {error: 'Give the preset a name.'};
    const base = this.base(), existing = base.find(preset => sameName(preset.name, clean));
    if (!existing && base.length >= MAX_SAVED_POP_PRESETS) return {error: `You can keep ${MAX_SAVED_POP_PRESETS} saved presets: delete one first.`};
    const preset = this.build(existing?.id ?? this.makeId(), clean, captured);
    this.commit(existing ? base.map(item => item === existing ? preset : item) : [...base, preset]);
    return {preset, replaced: !!existing};
  }
  /** Replaces the preset `id` with the captured setup, renaming it when `name` differs. */
  update(id: string, name: string, captured: CapturedPopPreset): PopPresetResult {
    const clean = tidyName(name), base = this.base(), existing = base.find(preset => preset.id === id);
    if (!existing) return {error: 'That preset no longer exists.'};
    if (!clean) return {error: 'Give the preset a name.'};
    if (base.some(preset => preset.id !== id && sameName(preset.name, clean))) return {error: 'Another saved preset already has that name.'};
    const preset = this.build(id, clean, captured);
    this.commit(base.map(item => item === existing ? preset : item));
    return {preset, replaced: true};
  }
  remove(id: string): boolean {
    const base = this.base();
    if (!base.some(preset => preset.id === id)) return false;
    this.commit(base.filter(preset => preset.id !== id), id);
    return true;
  }
  /** Records the preset the user chose ('' for Custom), so the Play screen and Settings show the same one. */
  select(id: string | undefined) {
    if (id !== this.snapshot.selectedId) this.publish({selectedId: id});
  }
  /** Picks up changes another tab made. */
  reload() {
    const stored = this.read();
    if (stored && JSON.stringify(stored) !== JSON.stringify(this.snapshot.presets)) this.publish({presets: stored, persisted: true});
  }
  /** Follows saves from other tabs for as long as it is called for; returns the stop function. */
  watchStorage(): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {if (event.key === STORAGE_KEY || event.key === null) this.reload();};
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  private build(id: string, name: string, captured: CapturedPopPreset): PopPreset {
    return {id, name, settings: sanitizePopPresetSettings(captured.settings), ...(isWeapon(captured.weapon) ? {weapon: captured.weapon} : {})};
  }
  /** What storage holds now, or undefined when it cannot be read. */
  private read(): PopPreset[] | undefined {
    if (!this.storage) return undefined;
    try {
      const text = this.storage.getItem(STORAGE_KEY);
      return text === null ? [] : sanitizeSavedPopPresets(JSON.parse(text));
    } catch {return undefined;}
  }
  /** The list to change: what storage holds, unless it is unavailable (or a write failed), then what this tab has. */
  private base(): readonly PopPreset[] {return (this.snapshot.persisted ? this.read() : undefined) ?? this.snapshot.presets;}
  /** Stores the new list; the chosen preset stays chosen unless it is the `removed` one. */
  private commit(presets: readonly PopPreset[], removed?: string) {
    let persisted = false;
    try {this.storage?.setItem(STORAGE_KEY, JSON.stringify(presets)); persisted = !!this.storage;} catch {/* Kept for this tab only. */}
    this.publish({presets, persisted, selectedId: removed !== undefined && removed === this.snapshot.selectedId ? undefined : this.snapshot.selectedId});
  }
  private publish(change: Partial<PopPresetSnapshot>) {this.snapshot = {...this.snapshot, ...change}; this.listeners.forEach(listener => listener());}
}

/** The one store the settings screens share. */
export const popPresetStore = new PopPresetStore();
