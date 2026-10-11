import type {Vec} from '../actor-physics';
import type {Equipment} from '../equipment';
import {duelDefaults, type DuelConfig, type SkillLevel} from './config';

/** Blitz (after Refrag's Blitz, a user-made Crossfire): on a real map you stand at an arena while swingers, bots that
 * wait out of sight, swing into view at you one after another from different angles. Clear them all and the next
 * arena loads; die and the same arena repeats. The options mirror Refrag's chat commands: .easy/.normal/.hard,
 * .smart (difficulty follows your results), .presets (bot loadouts), .noprimary, .reaction, .repeekreaction,
 * .aimoffset, .hs, .swingers, .repeat, .autoskip and .n/.p (the arena order and start). */
export type BlitzMap = 'de_ancient';
export type BlitzPreset = 'pistol' | 'save' | 'eco' | 'force' | 'default' | 'awp';
export type BlitzDifficulty = 'easy' | 'normal' | 'hard' | 'custom';
export type BlitzConfig = {
  map: BlitzMap;
  /** Bots per arena (.swingers), 1-5. */
  swingers: number;
  /** .easy/.normal/.hard, or a FACEIT level of your own (`skill`). */
  difficulty: BlitzDifficulty; skill: SkillLevel;
  /** .smart: the level follows your results, one step per arena cleared without dying or lost. */
  smart: boolean;
  /** .presets: the bots' loadout. */
  preset: BlitzPreset;
  /** .noprimary: you fight with your sidearm only (the bots use the pistol preset). */
  noPrimary: boolean;
  /** .reaction / .repeekreaction: bot reaction time in ms on first sight and on seeing you again; 0 = the level's own. */
  reactionMs: number; repeekReactionMs: number;
  /** .aimoffset: bot accuracy multiplier (1 = the level's own; lower is sloppier). */
  aimOffset: number;
  /** .hs: only headshots damage the bots. */
  headshotOnly: boolean;
  /** Arena order and where to start (0 = any arena); .repeat: times to repeat a cleared arena, -1 forever. */
  order: 'random' | 'sequence'; arena: number; repeat: number;
  /** .autoskip: in Smart mode, move on after three deaths in one arena. */
  autoskip: boolean;
  /** Seconds before the first swing, and the gap between swings. */
  firstSwingSeconds: number; swingGapMin: number; swingGapMax: number;
  /** Seconds an arena may last before it counts as a draw and repeats. */
  roundSeconds: number;
};

export const blitzDefaults: BlitzConfig = {
  map: 'de_ancient', swingers: 5, difficulty: 'normal', skill: 6, smart: false, preset: 'default', noPrimary: false,
  reactionMs: 0, repeekReactionMs: 0, aimOffset: 1, headshotOnly: false, order: 'random', arena: 0, repeat: 0, autoskip: true,
  firstSwingSeconds: 1, swingGapMin: .35, swingGapMax: 1.1, roundSeconds: 45,
};
export const blitzMaps: Record<BlitzMap, {title: string; credits: string}> = {de_ancient: {title: 'Ancient', credits: 'Valve'}};
export const blitzPresets: Record<BlitzPreset, {label: string; weapons: Equipment[]; armor: boolean; helmet: boolean}> = {
  pistol: {label: 'Pistol round', weapons: ['glock', 'usp'], armor: false, helmet: false},
  save: {label: 'Save round', weapons: ['p250', 'fiveseven', 'tec9', 'deagle'], armor: true, helmet: false},
  eco: {label: 'Eco', weapons: ['glock', 'usp', 'p250'], armor: false, helmet: false},
  force: {label: 'Force buy', weapons: ['galil', 'famas', 'mac10', 'mp9', 'deagle'], armor: true, helmet: false},
  default: {label: 'Full buy', weapons: ['ak47', 'm4a4', 'm4a1s'], armor: true, helmet: true},
  awp: {label: 'AWP', weapons: ['awp'], armor: true, helmet: true},
};
export const blitzDifficultyLevels: Record<Exclude<BlitzDifficulty, 'custom'>, SkillLevel> = {easy: 3, normal: 6, hard: 9};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const level = (value: unknown): SkillLevel => value === '10+' ? '10+'
  : typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10 ? value as SkillLevel : blitzDefaults.skill;

export function sanitizeBlitzConfig(raw: unknown): BlitzConfig {
  const input = record(raw), d = blitzDefaults;
  const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.find(option => option === value) ?? fallback;
  const gapMin = Math.round(finite(input.swingGapMin, d.swingGapMin, 0, 5) * 20) / 20;
  return {
    map: pick(input.map, Object.keys(blitzMaps) as BlitzMap[], d.map),
    swingers: Math.round(finite(input.swingers, d.swingers, 1, 5)),
    difficulty: pick(input.difficulty, ['easy', 'normal', 'hard', 'custom'] as const, d.difficulty), skill: level(input.skill),
    smart: input.smart === true,
    preset: pick(input.preset, Object.keys(blitzPresets) as BlitzPreset[], d.preset),
    noPrimary: input.noPrimary === true,
    reactionMs: Math.round(finite(input.reactionMs, d.reactionMs, 0, 1500) / 10) * 10,
    repeekReactionMs: Math.round(finite(input.repeekReactionMs, d.repeekReactionMs, 0, 1500) / 10) * 10,
    aimOffset: Math.round(finite(input.aimOffset, d.aimOffset, .5, 1.5) * 20) / 20,
    headshotOnly: input.headshotOnly === true,
    order: pick(input.order, ['random', 'sequence'] as const, d.order),
    arena: Math.round(finite(input.arena, d.arena, 0, 999)),
    repeat: Math.round(finite(input.repeat, d.repeat, -1, 20)),
    autoskip: input.autoskip !== false,
    firstSwingSeconds: Math.round(finite(input.firstSwingSeconds, d.firstSwingSeconds, 0, 10) * 10) / 10,
    swingGapMin: gapMin, swingGapMax: Math.max(gapMin, Math.round(finite(input.swingGapMax, d.swingGapMax, 0, 5) * 20) / 20),
    roundSeconds: Math.round(finite(input.roundSeconds, d.roundSeconds, 15, 180)),
  };
}

/** The FACEIT level the bots play at: the difficulty's, your own in Custom, or Smart mode's running level. */
export function blitzLevel(config: BlitzConfig, smartLevel?: SkillLevel): SkillLevel {
  if (config.smart && smartLevel !== undefined) return smartLevel;
  return config.difficulty === 'custom' ? config.skill : blitzDifficultyLevels[config.difficulty];
}
const levelNumber = (value: SkillLevel) => value === '10+' ? 11 : value;
const levelFrom = (value: number): SkillLevel => value >= 11 ? '10+' : Math.max(1, Math.min(10, Math.round(value))) as SkillLevel;
/** Smart mode after an arena: a level up for a clean clear, a level down for a death, else unchanged. */
export function smartStep(current: SkillLevel, outcome: 'won' | 'lost' | 'draw', diedHere: boolean): SkillLevel {
  if (outcome === 'won' && !diedHere) return levelFrom(levelNumber(current) + 1);
  if (outcome === 'lost') return levelFrom(levelNumber(current) - 1);
  return current;
}

/** The duel engine's config for a Blitz arena: swingers as holders with the preset's loadout, no rounds timer beyond
 * the arena's, radar off, no spawn protection. */
export function blitzDuelConfig(config: BlitzConfig, smartLevel?: SkillLevel): DuelConfig {
  const preset = blitzPresets[config.noPrimary ? 'pistol' : config.preset];
  return {...duelDefaults, botCount: config.swingers, skill: blitzLevel(config, smartLevel), weapons: [...preset.weapons],
    armor: preset.armor, helmet: preset.helmet, armorPoints: 100, accuracy: config.aimOffset, behavior: 'holder',
    roundSeconds: config.roundSeconds, feedbackSeconds: 2, radarEnabled: false, respawnSeconds: 0, infiniteAmmo: 'off',
    spawnImmunitySeconds: 0, overrides: []};
}

/** An arena from tools/build-blitz-arenas.mjs: where you stand and the swingers' hold (hidden) and peek (visible) spots. */
export type BlitzSwinger = {hold: Vec; peek: Vec; distance: number; bearing: number};
export type BlitzArena = {id: string; name: string; side: 't' | 'ct'; player: {x: number; y: number; z: number; yaw: number};
  sectors: number; swingers: BlitzSwinger[]};
export type BlitzArenaSet = {map: string; seed: number; candidates: number; arenas: BlitzArena[]};

const arenaSets: Record<BlitzMap, () => Promise<unknown>> = {de_ancient: () => import('./maps/de_ancient.blitz.json')};
/** Loads a map's arenas (a separate chunk). */
export async function loadBlitzArenas(map: BlitzMap): Promise<BlitzArenaSet> {
  const module = await arenaSets[map]() as {default?: BlitzArenaSet} & BlitzArenaSet;
  return (module.default ?? module) as BlitzArenaSet;
}

/** `count` of an arena's swingers, as far apart in bearing as its set allows, shuffled by `random`. */
export function chooseSwingers(arena: BlitzArena, count: number, random: () => number): BlitzSwinger[] {
  const pool = [...arena.swingers].sort(() => random() - .5), chosen: BlitzSwinger[] = [];
  const gap = (a: number, b: number) => {const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d);};
  while (chosen.length < count && pool.length) {
    // The next swinger is the one farthest in bearing from every chosen one.
    let best = 0, bestGap = -1;
    pool.forEach((swinger, index) => {
      const nearest = chosen.length ? Math.min(...chosen.map(other => gap(other.bearing, swinger.bearing))) : 360;
      if (nearest > bestGap) {bestGap = nearest; best = index;}
    });
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

/** When each swinger sets off, in arena seconds: the first after `firstSwingSeconds`, the rest a random gap apart. */
export function swingSchedule(count: number, config: Pick<BlitzConfig, 'firstSwingSeconds' | 'swingGapMin' | 'swingGapMax'>, random: () => number): number[] {
  const times: number[] = [];
  let at = config.firstSwingSeconds;
  for (let i = 0; i < count; i++) {
    times.push(+at.toFixed(4));
    at += config.swingGapMin + random() * (config.swingGapMax - config.swingGapMin);
  }
  return times;
}

/** The next arena after an outcome: a cleared arena repeats `repeat` more times (forever at -1) then moves on in the
 * chosen order; a death keeps the arena, unless Smart mode's autoskip has seen three deaths there. */
export function nextArena(state: {index: number; clears: number; deaths: number}, outcome: 'won' | 'lost' | 'draw',
  config: Pick<BlitzConfig, 'order' | 'repeat' | 'autoskip' | 'smart'>, count: number, random: () => number) {
  const advance = () => {
    if (count <= 1) return state.index;
    if (config.order === 'sequence') return (state.index + 1) % count;
    let next = Math.floor(random() * (count - 1));
    if (next >= state.index) next++;
    return next;
  };
  if (outcome === 'won') {
    const clears = state.clears + 1;
    if (config.repeat < 0 || clears <= config.repeat) return {index: state.index, clears, deaths: state.deaths};
    return {index: advance(), clears: 0, deaths: 0};
  }
  const deaths = state.deaths + (outcome === 'lost' ? 1 : 0);
  if (config.smart && config.autoskip && deaths >= 3) return {index: advance(), clears: 0, deaths: 0};
  return {index: state.index, clears: state.clears, deaths};
}

export type BlitzHistory = {date: string; map: BlitzMap; arena: string; outcome: 'won' | 'lost' | 'draw'; seconds: number; kills: number; level: SkillLevel};
const HISTORY_KEY = 'spraylab.blitz.history.v1';
export function loadBlitzHistory(): BlitzHistory[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(entry => entry && typeof entry.date === 'string' && typeof entry.arena === 'string' &&
      ['won', 'lost', 'draw'].includes(entry.outcome) && Number.isFinite(entry.seconds) && Number.isFinite(entry.kills)) : [];
  } catch {return [];}
}
export function saveBlitzHistory(history: BlitzHistory[]) {
  try {localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));} catch { /* Session-only history. */ }
}
export function blitzSummary(settings: BlitzConfig) {
  const preset = blitzPresets[settings.noPrimary ? 'pistol' : settings.preset].label;
  const difficulty = settings.smart ? 'smart' : settings.difficulty === 'custom' ? `level ${settings.skill}` : settings.difficulty;
  return `${settings.swingers} ${settings.swingers === 1 ? 'swinger' : 'swingers'} · ${difficulty} · ${preset}${settings.noPrimary ? ' · no primary' : ''}${settings.headshotOnly ? ' · headshots only' : ''} · ${settings.order === 'sequence' ? 'arenas in order' : 'random arenas'}${settings.repeat ? settings.repeat < 0 ? ' · repeat forever' : ` · repeat ×${settings.repeat}` : ''} · ${blitzMaps[settings.map].title}`;
}
