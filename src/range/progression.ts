import type {DuelReview} from './duel/coaching';
import type {SkillLevel} from './duel/config';
import {recordDrillAchievements, recordDuelAchievements, sanitizeAchievements, unlockAchievements, type AchievementState} from './achievements';

export const PROGRESSION_KEY = 'spraylab.progression.v1';
export const PROGRESSION_VERSION = 3;
export const MAX_COMPLETIONS = 1_000_000_000;
export const STANDARD_KNIFE_ID = 'knife-standard';
export type CosmeticCategory = 'weapon' | 'knife' | 'gloves' | 'agent';

/** Main supplies native asset metadata. IDs refer to local cosmetics, never inventory items. Every cosmetic is selectable. */
export type CosmeticDefinition = Readonly<{
  id: string;
  equipment: string;
  label: string;
  isDefault?: boolean;
  swatch?: string;
  imageUrl?: string;
  assetKey?: string;
  category?: CosmeticCategory;
  rarity?: string;
}>;
export type ProgressionProfile = Readonly<{
  version: 3;
  completedDrills: number;
  equipped: Readonly<Record<string, string>>;
  achievements: AchievementState;
}>;
export type ProgressionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type StorageStatus = 'saved' | 'memory-only' | 'unsupported-version';
export type AchievementNotice = Readonly<{id: string; achievementIds: readonly string[]}>;
export type ProgressionSnapshot = Readonly<{
  profile: ProgressionProfile;
  storageStatus: StorageStatus;
  notification: AchievementNotice | null;
}>;
export type AttemptBot = Readonly<{
  id: string;
  skill: SkillLevel;
  health: number;
  armor: boolean;
  helmet?: boolean;
  armorPoints?: number;
  accuracy: number;
  weapon: string;
}>;
export type DuelAttemptSetup = Readonly<{
  playerHealth: number;
  playerArmor: boolean;
  bots: readonly AttemptBot[];
}>;
export type Completion = 'completed' | 'reset' | 'abandoned' | 'settings-changed';
export type DuelAttemptResult = Readonly<{
  completion: Completion;
  outcome: 'won' | 'lost' | 'draw';
  /** Simulated fighting time only; pausing and round review do not count. */
  activeSeconds: number;
  review: Pick<DuelReview, 'score' | 'shots' | 'hits' | 'kills' | 'damage'> & Partial<Pick<DuelReview, 'heads' | 'taken' | 'settled' | 'movingShots' | 'airShots'>>;
  /** Sum player-to-bot healthDamage events, already capped to remaining health. */
  opponents: readonly {id: string; healthDamage: number; killed: boolean}[];
}>;
export type DrillMode = 'guided' | 'spray' | 'transfer' | 'peek' | 'precision' | 'burst';
export type DrillAttemptResult = Readonly<{
  completion: Completion;
  objectiveCompleted: boolean;
  score: number;
  shots: number;
  hits: number;
  activeSeconds: number;
  /** Actual stop/reposition successes, not movement-key presses. */
  movementReps: number;
  targetsHit: number;
}>;
/** Whether an attempt counts toward achievements. */
export type Qualification = Readonly<{
  qualified: boolean;
  reason: 'qualified' | 'not-completed' | 'invalid-result' | 'no-engagement';
}>;
export type AttemptResult = Readonly<{
  recorded: boolean;
  reason: Qualification['reason'] | 'unknown-attempt' | 'settings-changed';
}>;

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number): value is number => finite(value, min, max) && Number.isInteger(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const disqualified = (reason: Exclude<Qualification['reason'], 'qualified'>): Qualification => ({qualified: false, reason});
const QUALIFIED: Qualification = Object.freeze({qualified: true, reason: 'qualified'});

export function cosmeticCategory(item: CosmeticDefinition): CosmeticCategory {
  return item.category ?? (item.equipment === 'knife' || item.equipment === 'gloves' || item.equipment === 'agent' ? item.equipment : 'weapon');
}

export function cosmeticsForEquipment(catalog: readonly CosmeticDefinition[], equipment: string) {
  return catalog.filter(item => item.equipment === equipment);
}

export function prepareCosmeticCatalog(definitions: readonly CosmeticDefinition[] = []): readonly CosmeticDefinition[] {
  const stock: CosmeticDefinition = {id: STANDARD_KNIFE_ID, equipment: 'knife', category: 'knife', label: 'Standard knife', isDefault: true};
  const catalog = new Map<string, CosmeticDefinition>([[stock.id, stock]]);
  for (const raw of definitions.slice(0, 2000)) {
    const item = record(raw);
    if (!identifier(item.id) || !identifier(item.equipment) || typeof item.label !== 'string' || !item.label.trim() ||
      catalog.has(item.id) && item.id !== STANDARD_KNIFE_ID) continue;
    if (item.id === STANDARD_KNIFE_ID && item.equipment !== 'knife') continue;
    const category = cosmeticCategory({equipment: item.equipment} as CosmeticDefinition);
    if (item.category !== undefined && item.category !== category) continue;
    const isDefault = item.id === STANDARD_KNIFE_ID || item.equipment !== 'knife' && item.isDefault === true;
    catalog.set(item.id, Object.freeze({
      id: item.id, equipment: item.equipment, label: item.id === STANDARD_KNIFE_ID ? stock.label : item.label.trim().slice(0, 120),
      isDefault, category,
      ...(typeof item.rarity === 'string' && /^[a-zA-Z][a-zA-Z0-9 -]{0,31}$/.test(item.rarity) ? {rarity: item.rarity} : {}),
      ...(typeof item.swatch === 'string' && /^#[a-f0-9]{6}$/i.test(item.swatch) ? {swatch: item.swatch} : {}),
      ...(typeof item.imageUrl === 'string' && /^\/(?!\/)[^\\\s<>]{1,500}$/.test(item.imageUrl) ? {imageUrl: item.imageUrl} : {}),
      ...(typeof item.assetKey === 'string' && item.assetKey.length <= 256 ? {assetKey: item.assetKey} : {}),
    }));
  }
  return Object.freeze([...catalog.values()].map(item => Object.freeze(item)));
}

/** Reads every save version. Version 1 and 2 XP, credits, ownership and milestones are dropped: every cosmetic is available. */
export function sanitizeProgression(raw: unknown, catalog: readonly CosmeticDefinition[] = prepareCosmeticCatalog()): ProgressionProfile {
  const value = record(raw);
  const known = value.version === 1 || value.version === 2 || value.version === PROGRESSION_VERSION;
  const tracked = known && value.version !== 1;
  const equipped: Record<string, string> = {knife: STANDARD_KNIFE_ID};
  if (known) for (const [equipment, id] of Object.entries(record(value.equipped))) {
    if (!identifier(equipment) || !identifier(id)) continue;
    const item = catalog.find(candidate => candidate.id === id);
    // Retired IDs are kept: the default shows until the finish returns to the catalog.
    if (!item || item.equipment === equipment) equipped[equipment] = id;
  }
  return Object.freeze({version: PROGRESSION_VERSION,
    completedDrills: tracked && integer(value.completedDrills, 0, MAX_COMPLETIONS) ? value.completedDrills : 0,
    equipped: Object.freeze(equipped), achievements: sanitizeAchievements(tracked ? value.achievements : undefined)});
}

export function equippedCosmetic(profile: ProgressionProfile, catalog: readonly CosmeticDefinition[], equipment: string): CosmeticDefinition | undefined {
  return catalog.find(item => item.equipment === equipment && item.id === profile.equipped[equipment]) ??
    catalog.find(item => item.equipment === equipment && item.isDefault);
}

function validSetup(setup: DuelAttemptSetup): boolean {
  return !!setup && finite(setup.playerHealth, 1, 500) && typeof setup.playerArmor === 'boolean' &&
    Array.isArray(setup.bots) && setup.bots.length >= 1 && setup.bots.length <= 5 &&
    new Set(setup.bots.map(bot => bot?.id)).size === setup.bots.length && setup.bots.every(bot => bot && identifier(bot.id) &&
      (bot.skill === '10+' || integer(bot.skill, 1, 10)) && finite(bot.health, 1, 500) && typeof bot.armor === 'boolean' &&
      (bot.helmet === undefined || typeof bot.helmet === 'boolean') &&
      (bot.armorPoints === undefined || finite(bot.armorPoints, 0, 100)) &&
      finite(bot.accuracy, .5, 1.5) && identifier(bot.weapon));
}

function setupKey(setup: DuelAttemptSetup): string {
  return JSON.stringify([setup.playerHealth, setup.playerArmor, [...setup.bots].sort((a, b) => a.id.localeCompare(b.id)).map(bot =>
    [bot.id, bot.skill, bot.health, bot.armor, bot.helmet ?? true, bot.armorPoints ?? 100, bot.accuracy, bot.weapon])]);
}

/** Pure and deterministic. A duel counts once it is completed, internally consistent, and the player dealt damage. */
export function qualifyDuel(setup: DuelAttemptSetup, result: DuelAttemptResult): Qualification {
  if (!result || result.completion !== 'completed') return disqualified('not-completed');
  if (!validSetup(setup) || !['won', 'lost', 'draw'].includes(result.outcome) || !finite(result.activeSeconds,0,3600)) return disqualified('invalid-result');
  const review = result.review;
  if (!review || !integer(review.shots, 0, 100_000) || !integer(review.hits, 0, review.shots) || !integer(review.kills, 0, setup.bots.length) ||
    !finite(review.damage, 0, 2500) || review.score !== null && !finite(review.score, 0, 100) ||
    !Array.isArray(result.opponents) || result.opponents.length !== setup.bots.length ||
    new Set(result.opponents.map(bot => bot?.id)).size !== setup.bots.length) return disqualified('invalid-result');
  let totalDamage = 0, kills = 0;
  for (const bot of setup.bots) {
    const dealt = result.opponents.find(item => item?.id === bot.id);
    if (!dealt || !finite(dealt.healthDamage, 0, bot.health + .001) || typeof dealt.killed !== 'boolean' ||
      dealt.killed !== (dealt.healthDamage >= bot.health - .001)) return disqualified('invalid-result');
    totalDamage += dealt.healthDamage;
    kills += +dealt.killed;
  }
  if (Math.abs(totalDamage - review.damage) > .01 || kills !== review.kills ||
    (result.outcome === 'won' ? kills !== setup.bots.length : kills === setup.bots.length)) return disqualified('invalid-result');
  return totalDamage > 0 ? QUALIFIED : disqualified('no-engagement');
}

const drillModes: readonly DrillMode[] = ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'];
export function qualifyDrill(mode: DrillMode, result: DrillAttemptResult): Qualification {
  if (!result || result.completion !== 'completed' || !result.objectiveCompleted) return disqualified('not-completed');
  if (!drillModes.includes(mode) || !finite(result.score, 0, 100) || !integer(result.shots, 1, 100_000) ||
    !integer(result.hits, 0, result.shots) || !finite(result.activeSeconds, 0, 3600) ||
    !integer(result.movementReps, 0, 10_000) || !integer(result.targetsHit, 0, result.hits)) return disqualified('invalid-result');
  const minimumSeconds = mode === 'precision' || mode === 'burst' ? .25 : 2;
  if (!result.hits || result.activeSeconds < minimumSeconds || !result.targetsHit) return disqualified('no-engagement');
  if ((mode === 'guided' || mode === 'spray' || mode === 'burst') && result.shots < 6 ||
    mode === 'transfer' && result.targetsHit < 2 || (mode === 'precision' || mode === 'burst' || mode === 'peek') && !result.movementReps) return disqualified('not-completed');
  return QUALIFIED;
}

type ActiveAttempt = {id: string; revision: string; kind: 'duel'; setup: DuelAttemptSetup} |
  {id: string; revision: string; kind: 'drill'; mode: DrillMode};
export type ProgressionController = {
  readonly catalog: readonly CosmeticDefinition[];
  getSnapshot(): ProgressionSnapshot;
  subscribe(listener: () => void): () => void;
  /** One active attempt. Starting another abandons the previous one. Store this ID on the round. */
  beginDuel(setup: DuelAttemptSetup, settingsRevision: string): string | null;
  beginDrill(mode: DrillMode, settingsRevision: string): string | null;
  completeDuel(roundId: string, result: DuelAttemptResult, finalSetup: DuelAttemptSetup, settingsRevision: string): AttemptResult;
  completeDrill(attemptId: string, result: DrillAttemptResult, settingsRevision: string): AttemptResult;
  cancelAttempt(attemptId?: string): void;
  /** Any catalog cosmetic for that equipment. */
  equip(equipment: string, cosmeticId: string): boolean;
  resetEquipment(equipment: string): boolean;
  dismissNotification(): void;
  dispose(): void;
};

export function createProgressionController(options: {
  catalog?: readonly CosmeticDefinition[];
  /** null forces session-only storage; omitted uses localStorage when accessible. */
  storage?: ProgressionStorage | null;
  storageKey?: string;
} = {}): ProgressionController {
  const catalog = prepareCosmeticCatalog(options.catalog);
  const key = options.storageKey ?? PROGRESSION_KEY;
  let storage = options.storage ?? null;
  if (options.storage === undefined) try {storage = typeof localStorage === 'undefined' ? null : localStorage;} catch {storage = null;}
  let raw: unknown, storageStatus: StorageStatus = storage ? 'saved' : 'memory-only';
  let savedText: string | null | undefined;
  try {savedText = storage?.getItem(key);} catch {storageStatus = 'memory-only'; storage = null;}
  try {raw = savedText ? JSON.parse(savedText) : undefined;} catch {storageStatus = 'memory-only';}
  const version = record(raw).version;
  if (version !== undefined && version !== 1 && version !== 2 && version !== PROGRESSION_VERSION) storageStatus = 'unsupported-version';
  let snapshot: ProgressionSnapshot = Object.freeze({profile: sanitizeProgression(raw, catalog), storageStatus, notification: null});
  const recognized = unlockAchievements(snapshot.profile, 0);
  if (recognized.ids.length) snapshot = Object.freeze({...snapshot, profile: sanitizeProgression({...snapshot.profile, achievements: recognized.state}, catalog)});
  // Rewrite older saves at once so their XP, credits and ownership records are not carried forward.
  if ((version === 1 || version === 2 || recognized.ids.length) && storage && storageStatus !== 'unsupported-version') {
    try {storage.setItem(key, JSON.stringify(snapshot.profile));} catch {storageStatus = 'memory-only';}
    snapshot = Object.freeze({...snapshot, storageStatus});
  }
  const listeners = new Set<() => void>();
  let active: ActiveAttempt | null = null, disposed = false, serial = 0;
  const session = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const publish = (profile: ProgressionProfile, notification = snapshot.notification) => {
    if (snapshot.storageStatus !== 'unsupported-version') {
      try {if (storage) {storage.setItem(key, JSON.stringify(profile)); storageStatus = 'saved';} else storageStatus = 'memory-only';}
      catch {storageStatus = 'memory-only';}
    }
    snapshot = Object.freeze({profile, storageStatus, notification});
    for (const listener of listeners) listener();
  };
  // Fast consecutive rounds must not erase an achievement before its toast has been read.
  const pendingAchievements = (ids: readonly string[]) => Object.freeze([...new Set([...(snapshot.notification?.achievementIds ?? []), ...ids])]);
  const settle = (attempt: ActiveAttempt, qualification: Qualification, achievements: AchievementState): AttemptResult => {
    if (!qualification.qualified) return {recorded: false, reason: qualification.reason};
    const previous = snapshot.profile;
    const completedDrills = Math.min(MAX_COMPLETIONS, previous.completedDrills + +(attempt.kind === 'drill'));
    const updated = sanitizeProgression({...previous, completedDrills, achievements}, catalog);
    const unlocked = unlockAchievements(updated, Date.now());
    const profile = unlocked.ids.length ? sanitizeProgression({...updated, achievements: unlocked.state}, catalog) : updated;
    publish(profile, unlocked.ids.length ? Object.freeze({id: attempt.id, achievementIds: pendingAchievements(unlocked.ids)}) : snapshot.notification);
    return {recorded: true, reason: 'qualified'};
  };
  const takeAttempt = (id: string, kind: ActiveAttempt['kind']) => {
    if (disposed || !active || active.id !== id || active.kind !== kind) return null;
    const attempt = active;
    active = null;
    return attempt;
  };
  const denied = (reason: AttemptResult['reason']): AttemptResult => ({recorded: false, reason});
  const validRevision = (revision: string) => typeof revision === 'string' && revision.length > 0 && revision.length <= 512;
  return {
    catalog,
    getSnapshot: () => snapshot,
    subscribe(listener) {if (disposed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    beginDuel(setup, revision) {
      active = null;
      if (disposed || !validSetup(setup) || !validRevision(revision)) return null;
      active = {id: `${session}:${++serial}`, kind: 'duel', revision,
        setup: {playerHealth: setup.playerHealth, playerArmor: setup.playerArmor, bots: setup.bots.map(bot => ({...bot}))}};
      return active.id;
    },
    beginDrill(mode, revision) {
      active = null;
      if (disposed || !drillModes.includes(mode) || !validRevision(revision)) return null;
      active = {id: `${session}:${++serial}`, kind: 'drill', revision, mode};
      return active.id;
    },
    completeDuel(id, result, finalSetup, revision) {
      const attempt = takeAttempt(id, 'duel');
      if (attempt?.kind !== 'duel') return denied('unknown-attempt');
      if (attempt.revision !== revision || !validSetup(finalSetup) || setupKey(attempt.setup) !== setupKey(finalSetup)) return denied('settings-changed');
      const qualification = qualifyDuel(attempt.setup, result);
      return settle(attempt, qualification, qualification.qualified ? recordDuelAchievements(snapshot.profile.achievements, attempt.setup, result) : snapshot.profile.achievements);
    },
    completeDrill(id, result, revision) {
      const attempt = takeAttempt(id, 'drill');
      if (attempt?.kind !== 'drill') return denied('unknown-attempt');
      if (attempt.revision !== revision) return denied('settings-changed');
      const qualification = qualifyDrill(attempt.mode, result);
      return settle(attempt, qualification, qualification.qualified ? recordDrillAchievements(snapshot.profile.achievements, attempt.mode) : snapshot.profile.achievements);
    },
    cancelAttempt(id) {if (id === undefined || active?.id === id) active = null;},
    equip(equipment, id) {
      if (disposed || !identifier(equipment)) return false;
      if (!catalog.some(candidate => candidate.equipment === equipment && candidate.id === id)) return false;
      if (snapshot.profile.equipped[equipment] === id) return true;
      publish(sanitizeProgression({...snapshot.profile, equipped: {...snapshot.profile.equipped, [equipment]: id}}, catalog));
      return true;
    },
    resetEquipment(equipment) {
      if (disposed || !identifier(equipment)) return false;
      const equipped = {...snapshot.profile.equipped};
      delete equipped[equipment];
      publish(sanitizeProgression({...snapshot.profile, equipped}, catalog));
      return true;
    },
    dismissNotification() {
      if (!snapshot.notification) return;
      snapshot = Object.freeze({...snapshot, notification: null});
      for (const listener of listeners) listener();
    },
    dispose() {disposed = true; active = null; listeners.clear();},
  };
}
