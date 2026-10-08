import {UNIT, type Vec} from '../actor-physics';
import {weaponIds} from '../config';
import type {Equipment} from '../equipment';
import {sanitizeDuelConfig, type DuelConfig} from './config';
import {canFitInArena, traceSolid, type Arena, type Solid, type WorkshopMap, type WorkshopSpawn} from './geometry';
import {randomStream} from './rng';

/**
 * Aim Botz: an open yard of passive bots that respawn after each kill, after
 * the aim_botz workshop map. Bots never fire; the player practises flicks,
 * first-bullet accuracy and headshots at chosen distances.
 */
export type BotzDistance = 'near' | 'mixed' | 'far';
/** 'close': strafe A-D mostly sideways while edging toward you, as in Fast Aim / Reflex. */
export type BotzMovement = 'static' | 'strafe' | 'close';
/** 'some' bots crouch and stay down; 'spam': about half the bots crouch spam. On the island, 'some' is crouch spam. */
export type BotzCrouch = 'never' | 'some' | 'always' | 'spam';
/** sv_infinite_ammo: 'reserve' = 2 (reload, never run dry), 'magazine' = 1 (never reload). */
export type BotzAmmo = 'off' | 'reserve' | 'magazine';
/** 'yard' is Aim Botz; 'island' is Fast Aim / Reflex (reflex.ts), where bots rush you; 'redline' is Aim Botz on the
 * imported aim_redline map (workshop.ts). */
export type BotzMap = 'yard' | 'island' | 'redline';
/** Reflex: which gaps bots come through, all eight or the three in front of you. */
export type BotzApproach = 'around' | 'front';
export type BotzConfig = {
  map: BotzMap;
  botCount: number;
  distance: BotzDistance;
  movement: BotzMovement;
  crouch: BotzCrouch;
  elevated: boolean;
  weapon: Equipment;
  health: number;
  armor: boolean;
  helmet: boolean;
  headshotOnly: boolean;
  respawnSeconds: number;
  /** 0 runs until you start a new session. */
  sessionSeconds: number;
  infiniteAmmo: BotzAmmo;
  shortcutProtection: boolean;
  approach: BotzApproach;
};

export const botzDefaults: BotzConfig = {
  map: 'yard', botCount: 10, distance: 'mixed', movement: 'static', crouch: 'never', elevated: true, weapon: 'ak47',
  health: 100, armor: true, helmet: true, headshotOnly: false, respawnSeconds: 1, sessionSeconds: 0,
  infiniteAmmo: 'reserve', shortcutProtection: true, approach: 'around',
};
/** Fast Aim / Reflex, as on the workshop map: knife bots run at you, and you never reload. */
export const reflexDefaults: BotzConfig = {
  ...botzDefaults, map: 'island', botCount: 5, movement: 'strafe', crouch: 'some', elevated: false, weapon: 'knife',
  respawnSeconds: .5, infiniteAmmo: 'magazine',
};
export const BOTZ_MAX_BOTS = 16;
export const botzSessionLengths = [0, 30, 60, 120, 300] as const;
export const botzDistanceBands: Record<BotzDistance, readonly [number, number]> = {near: [5, 14], mixed: [6, 42], far: [20, 44]};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.find(option => option === value) ?? fallback;

/** Aim Botz on aim_redline: bots stand around the warehouse floor, on crates and on the catwalk. */
export const redlineDefaults: BotzConfig = {...botzDefaults, map: 'redline'};

export function sanitizeBotzConfig(raw: unknown): BotzConfig {
  const input = record(raw);
  const defaults = input.map === 'island' ? reflexDefaults : input.map === 'redline' ? redlineDefaults : botzDefaults;
  const weapon = input.weapon === 'knife' || weaponIds.some(id => id === input.weapon) ? input.weapon as Equipment : defaults.weapon;
  const session = typeof input.sessionSeconds === 'number' && botzSessionLengths.some(length => length === input.sessionSeconds)
    ? input.sessionSeconds : defaults.sessionSeconds;
  return {
    map: defaults.map,
    botCount: Math.round(finite(input.botCount, defaults.botCount, 1, BOTZ_MAX_BOTS)),
    distance: pick(input.distance, ['near', 'mixed', 'far'], defaults.distance),
    // The island has its own rush: closing in is its strafing, and its 'some' is already crouch spam.
    movement: defaults.map === 'island' && input.movement === 'close' ? 'strafe' : pick(input.movement, ['static', 'strafe', 'close'], defaults.movement),
    crouch: defaults.map === 'island' && input.crouch === 'spam' ? 'some' : pick(input.crouch, ['never', 'some', 'always', 'spam'], defaults.crouch),
    elevated: typeof input.elevated === 'boolean' ? input.elevated : defaults.elevated, weapon,
    health: Math.round(finite(input.health, defaults.health, 1, 500)),
    armor: input.armor !== false, helmet: input.helmet !== false, headshotOnly: input.headshotOnly === true,
    respawnSeconds: finite(input.respawnSeconds, defaults.respawnSeconds, 0, 3),
    sessionSeconds: session,
    infiniteAmmo: pick(input.infiniteAmmo, ['off', 'reserve', 'magazine'], defaults.infiniteAmmo),
    shortcutProtection: input.shortcutProtection !== false,
    approach: pick(input.approach, ['around', 'front'], defaults.approach),
  };
}

/** The Duel settings Aim Botz shares with the duel engine. */
export function botzDuelConfig(config: BotzConfig): DuelConfig {
  return sanitizeDuelConfig({botCount: 1, weapons: [config.weapon], health: config.health, armor: config.armor,
    helmet: config.helmet, playerHealth: 100, playerArmor: true, playerHelmet: true, radarEnabled: false,
    arenaScale: BOTZ_SCALE, mapDesign: 'random', shortcutProtection: config.shortcutProtection});
}

/** The yard is the duel hall at its largest size: 36 x 48 m. */
export const BOTZ_SCALE = 1.5;
/** Where you stand: near the back wall, looking down the yard (-z). */
export const BOTZ_PLAYER_SPAWN: Readonly<Vec> = {x: 0, y: 64 * UNIT, z: 15.5};

// Fixed platforms, like the map's ledges: bots stand on top for higher angles.
const platforms: readonly (Pick<Solid, 'kind' | 'material'> & {x: number; z: number; width: number; depth: number; height: number})[] = [
  {x: 7, z: -2, width: 2.4, depth: 2.4, height: .9, kind: 'crate', material: 'wood'},
  {x: -12, z: -8, width: 4, depth: 4, height: 1.1, kind: 'concrete', material: 'concrete'},
  {x: 12.5, z: -14, width: 4, depth: 3, height: 1.6, kind: 'concrete', material: 'concrete'},
  {x: -6, z: -18, width: 2.5, depth: 2.5, height: 1.3, kind: 'crate', material: 'wood'},
  {x: 0, z: -25.5, width: 10, depth: 3, height: 2.2, kind: 'concrete', material: 'concrete'},
];

export function botzArena(): Arena {
  return {minX: -12 * BOTZ_SCALE, maxX: 12 * BOTZ_SCALE, minZ: -20 * BOTZ_SCALE, maxZ: 12 * BOTZ_SCALE, design: 'Aim Botz yard',
    solids: platforms.map((platform, index) => ({id: `botz-platform-${index}`, kind: platform.kind, material: platform.material,
      center: {x: platform.x, y: platform.height / 2, z: platform.z}, size: {x: platform.width, y: platform.height, z: platform.depth}}))};
}

export type BotzSpawn = {x: number; z: number; feet: number; elevated: boolean};
const EYE = 64 * UNIT, HULL = 72 * UNIT;
const SPACING = 2.2;

/** Picks spawn points in a forward fan, at the chosen distances, visible from where you stand. */
export class BotzSpawner {
  private readonly random: () => number;
  constructor(private readonly config: BotzConfig, private readonly arena: Arena, seed: number,
    private readonly origin: Readonly<Vec> = BOTZ_PLAYER_SPAWN) {
    this.random = randomStream(seed, 'botz:spawn');
  }

  next(occupied: readonly Vec[], previous?: Vec, viewer: Vec = this.origin): BotzSpawn {
    const [near, far] = botzDistanceBands[this.config.distance];
    const free = (x: number, z: number, spacing: number) => occupied.every(other => Math.hypot(other.x - x, other.z - z) >= spacing) &&
      (!previous || Math.hypot(previous.x - x, previous.z - z) >= 3);
    const ledges = this.config.elevated ? this.arena.solids.filter(solid => {
      const distance = Math.hypot(solid.center.x - this.origin.x, solid.center.z - this.origin.z);
      return solid.id?.startsWith('botz-platform') && distance >= near && distance <= far;
    }) : [];
    for (let attempt = 0; attempt < 80; attempt++) {
      const relaxed = attempt >= 60;
      if (ledges.length && this.random() < .3) {
        const ledge = ledges[Math.floor(this.random() * ledges.length)];
        const x = ledge.center.x + (this.random() - .5) * Math.max(0, ledge.size.x - 1);
        const z = ledge.center.z + (this.random() - .5) * Math.max(0, ledge.size.z - 1);
        const feet = ledge.center.y + ledge.size.y / 2;
        if ((relaxed || free(x, z, 1.2)) && this.visible(viewer, {x, y: feet + EYE, z})) return {x, z, feet, elevated: true};
        continue;
      }
      const distance = near + this.random() * (far - near), angle = (this.random() * 2 - 1) * 65 * Math.PI / 180;
      const x = this.origin.x + Math.sin(angle) * distance, z = this.origin.z - Math.cos(angle) * distance;
      if (x < this.arena.minX + 1 || x > this.arena.maxX - 1 || z < this.arena.minZ + 1 || z > this.arena.maxZ - 1) continue;
      if (!canFitInArena({x, y: EYE, z}, 0, HULL, this.arena)) continue;
      if (!relaxed && (!free(x, z, SPACING) || !this.visible(viewer, {x, y: EYE, z}))) continue;
      return {x, z, feet: 0, elevated: false};
    }
    return {x: this.origin.x + (this.random() - .5) * 8, z: this.origin.z - near, feet: 0, elevated: false};
  }

  private visible(from: Vec, head: Vec) {
    const dx = head.x - from.x, dy = head.y - from.y, dz = head.z - from.z, distance = Math.hypot(dx, dy, dz);
    return distance > .01 && !Number.isFinite(traceSolid(from, {x: dx / distance, y: dy / distance, z: dz / distance}, this.arena, distance - .05).distance);
  }
}

/** Aim Botz on an imported map: bots stand on the map's spots in front of the spawn, at the chosen distances and in
 * view. Spots on crates and catwalks count as ledges. */
export class WorkshopSpawner {
  private readonly random: () => number;
  private readonly spots: readonly (readonly [number, number, number])[];
  /** Fences, glass and player clips let bullets through but still hide a bot: a spot needs a clear line of sight. */
  private readonly sight: Arena;
  constructor(private readonly config: BotzConfig, arena: Arena, seed: number, private readonly spawn: WorkshopSpawn) {
    this.random = randomStream(seed, 'botz:workshop');
    this.sight = {...arena, solids: arena.solids.map(solid => solid.shotBlocking === false ? {...solid, shotBlocking: true} : solid)};
    const [near, far] = botzDistanceBands[config.distance];
    this.spots = (arena.workshop?.spots ?? []).filter(([x, feet, z]) => {
      const dx = x - spawn.x, dz = z - spawn.z, distance = Math.hypot(dx, dz);
      // Within 70 degrees either side of the way the spawn faces (-sin yaw, -cos yaw).
      return distance >= near && distance <= far && (config.elevated || feet - spawn.y < .4) &&
        (-Math.sin(spawn.yaw) * dx - Math.cos(spawn.yaw) * dz) / distance >= Math.cos(70 * Math.PI / 180);
    });
  }

  next(occupied: readonly Vec[], previous?: Vec, viewer?: Vec): BotzSpawn {
    if (!this.spots.length) throw new Error('No bot spots on this map in that distance band');
    const eye = viewer ?? {x: this.spawn.x, y: this.spawn.y + EYE, z: this.spawn.z};
    // Spacing gives way before sight does.
    for (let attempt = 0; attempt < 200; attempt++) {
      const [x, feet, z] = this.spots[Math.floor(this.random() * this.spots.length)], elevated = feet - this.spawn.y >= .4;
      if (attempt < 100 && (occupied.some(other => Math.hypot(other.x - x, other.z - z) < (elevated ? 1.2 : SPACING)) ||
        previous && Math.hypot(previous.x - x, previous.z - z) < 3) || !this.visible(eye, {x, y: feet + EYE, z})) continue;
      return {x, z, feet, elevated};
    }
    const [x, feet, z] = this.spots[Math.floor(this.random() * this.spots.length)];
    return {x, z, feet, elevated: feet - this.spawn.y >= .4};
  }

  private visible(from: Vec, head: Vec) {
    const dx = head.x - from.x, dy = head.y - from.y, dz = head.z - from.z, distance = Math.hypot(dx, dy, dz);
    return distance > .01 && !Number.isFinite(traceSolid(from, {x: dx / distance, y: dy / distance, z: dz / distance}, this.sight, distance - .05).distance);
  }
}

/** Where Aim Botz starts you on an imported map: its Aim Botz spot (the nearest floor spot to it), or else the floor
 * spawn in the middle of a team's row, facing the other side. */
export function workshopPlayerSpawn(map: Pick<WorkshopMap, 'spawns' | 'spots' | 'aimBotz'>, team: WorkshopSpawn['team'] = 't'): WorkshopSpawn {
  if (map.aimBotz) {
    const {x: ax, z: az, yaw} = map.aimBotz;
    const [x, y, z] = [...map.spots].filter(spot => spot[1] < .05).sort((a, b) => Math.hypot(a[0] - ax, a[2] - az) - Math.hypot(b[0] - ax, b[2] - az))[0];
    return {team, x, y, z, yaw};
  }
  const spawns = map.spawns, row = spawns.filter(spawn => spawn.team === team && spawn.y < .5);
  const pool = row.length ? row : spawns;
  const centre = {x: pool.reduce((sum, spawn) => sum + spawn.x, 0) / pool.length, z: pool.reduce((sum, spawn) => sum + spawn.z, 0) / pool.length};
  return [...pool].sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))[0];
}

/** ADAD strafing: run one way, sometimes stop, then reverse. */
export class BotzStrafe {
  private direction: -1 | 0 | 1 = 0;
  private until = 0;
  constructor(private readonly random: () => number) {}
  side(time: number) {
    if (time < this.until) return this.direction;
    if (this.direction !== 0 && this.random() < .3) {this.direction = 0; this.until = time + .15 + this.random() * .45;}
    else {this.direction = this.direction === 0 ? (this.random() < .5 ? -1 : 1) : this.direction === 1 ? -1 : 1; this.until = time + .3 + this.random() * .7;}
    return this.direction;
  }
}

/** `leaks`: Reflex bots that reached the island before you killed them. */
export type BotzStats = {shots: number; hits: number; headHits: number; kills: number; headshots: number; damage: number;
  headshotStreak: number; bestHeadshotStreak: number; leaks: number};
export const emptyBotzStats = (): BotzStats => ({shots: 0, hits: 0, headHits: 0, kills: 0, headshots: 0, damage: 0, headshotStreak: 0,
  bestHeadshotStreak: 0, leaks: 0});

export type BotzSummary = BotzStats & {seconds: number; sessionSeconds: number; accuracy: number; headshotRate: number;
  killsPerMinute: number; secondsPerKill: number | null};

export function botzSummary(stats: BotzStats, seconds: number, sessionSeconds: number): BotzSummary {
  return {...stats, seconds, sessionSeconds,
    accuracy: stats.shots ? stats.hits / stats.shots * 100 : 0,
    headshotRate: stats.kills ? stats.headshots / stats.kills * 100 : 0,
    killsPerMinute: seconds >= 1 ? stats.kills / seconds * 60 : 0,
    secondsPerKill: stats.kills ? seconds / stats.kills : null};
}

export type BotzHistory = {date: string; weapon: Equipment; distance: BotzDistance; movement: BotzMovement; headshotOnly: boolean;
  seconds: number; kills: number; headshotRate: number; accuracy: number; killsPerMinute: number; leaks?: number};
const historyKeys: Record<BotzMap, string> = {yard: 'spraylab.botz.history.v1', island: 'spraylab.reflex.history.v1',
  redline: 'spraylab.redline.history.v1'};

export function loadBotzHistory(map: BotzMap = 'yard'): BotzHistory[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKeys[map]) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is BotzHistory => !!entry && typeof entry === 'object' &&
      typeof entry.date === 'string' && ['seconds', 'kills', 'headshotRate', 'accuracy', 'killsPerMinute'].every(key => Number.isFinite(entry[key]))).slice(0, 50) : [];
  } catch {return [];}
}

export function saveBotzHistory(history: BotzHistory[], map: BotzMap = 'yard') {
  try {localStorage.setItem(historyKeys[map], JSON.stringify(history.slice(0, 50)));} catch { /* Session-only history. */ }
}
