import {UNIT, type Vec} from '../actor-physics';
import {traceSolid, type Arena, type WorkshopSpawn} from './geometry';
import {randomStream} from './rng';

const EYE = 64 * UNIT;
const SPACING = 1.2;

/** Deathmatch on an imported map: everyone respawns at one of their own team's floor spawn points, out of sight of
 * living enemies when possible and never on top of someone. */
export class TeamSpawner {
  private readonly random: () => number;
  private readonly floor: Record<WorkshopSpawn['team'], WorkshopSpawn[]>;
  /** Fences, glass and player clips let bullets through but still hide a spawn: a spot needs a clear line of sight. */
  private readonly sight: Arena;

  constructor(arena: Arena, seed: number) {
    if (!arena.workshop) throw new Error('Team spawns need an imported map');
    this.random = randomStream(seed, 'deathmatch:spawns');
    this.sight = {...arena, solids: arena.solids.map(solid => solid.shotBlocking === false ? {...solid, shotBlocking: true} : solid)};
    const spawns = arena.workshop.spawns;
    const floor = (team: WorkshopSpawn['team']) => {
      const own = spawns.filter(spawn => spawn.team === team), low = own.filter(spawn => spawn.y < .5);
      return low.length ? low : own;
    };
    this.floor = {t: floor('t'), ct: floor('ct')};
    if (!this.floor.t.length || !this.floor.ct.length) throw new Error('The map needs spawn points for both teams');
  }

  /** The spawn in the middle of a team's row: where a session starts. */
  first(team: WorkshopSpawn['team']): WorkshopSpawn {
    const pool = this.floor[team];
    const centre = {x: pool.reduce((sum, spawn) => sum + spawn.x, 0) / pool.length, z: pool.reduce((sum, spawn) => sum + spawn.z, 0) / pool.length};
    return [...pool].sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))[0];
  }

  /** A respawn: a free spawn of the team that no living enemy can see, else the one farthest from them. */
  next(team: WorkshopSpawn['team'], occupied: readonly Vec[], enemies: readonly Vec[]): WorkshopSpawn {
    const free = this.floor[team].filter(spawn => !occupied.some(other => Math.hypot(other.x - spawn.x, other.z - spawn.z) < SPACING));
    const pool = free.length ? free : this.floor[team];
    const hidden = pool.filter(spawn => !enemies.some(eye => this.visible(eye, {x: spawn.x, y: spawn.y + EYE, z: spawn.z})));
    if (hidden.length) return hidden[Math.floor(this.random() * hidden.length)];
    const distance = (spawn: WorkshopSpawn) => Math.min(Infinity, ...enemies.map(eye => Math.hypot(eye.x - spawn.x, eye.z - spawn.z)));
    return [...pool].sort((a, b) => distance(b) - distance(a))[0];
  }

  private visible(from: Vec, head: Vec) {
    const dx = head.x - from.x, dy = head.y - from.y, dz = head.z - from.z, distance = Math.hypot(dx, dy, dz);
    return distance > .01 && !Number.isFinite(traceSolid(from, {x: dx / distance, y: dy / distance, z: dz / distance}, this.sight, distance - .05).distance);
  }
}
