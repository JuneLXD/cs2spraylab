import {DEG, UNIT, type Vec} from '../actor-physics';
import type {BotBehavior} from './config';
import {currentVisible, type BotObservation} from './perception';
import {SightingMemory} from './awareness';
import type {BotTraits} from './skill';
import type {ActorCommand} from './types';
import {equipmentStats,knifeModel} from '../equipment';
import {aimStep, type AimMotor} from './motor';

const difference = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());

/** Pathing on maps without authored cover lanes (deathmatch on an imported map): a route around the collision
 * boxes, and somewhere to roam when nothing has been seen or heard. */
export type BotNavigator = {
  route: (from: Vec, to: Vec) => Vec[];
  roam: (from: Vec, random: () => number) => Vec | undefined;
};

export class BotBrain {
  private firstSeen = -1;
  private readyAt = Infinity;
  private nextShotAt = 0;
  private readonly memory = new SightingMemory(5);
  private aimYawError = 0;
  private aimPitchError = 0;
  private willStop = true;
  private observation: BotObservation | null = null;
  private readonly motor: AimMotor = {yawRate: 0, pitchRate: 0};
  private heard?: {point: Vec; time: number};
  /** How often each enemy has been sighted afresh: a repeek can use its own recognition time. */
  private readonly sightings = new Map<number, number>();
  private roamGoal?: {point: Vec; since: number};
  private path: {goal: Vec; waypoints: Vec[]; at: number} | null = null;

  constructor(private readonly traits: BotTraits, private readonly behavior: BotBehavior,
    private readonly accuracy: number, private readonly random: () => number,
    private readonly navigator?: BotNavigator) {}

  /** A gunshot or footstep of the player within earshot: head there until something is seen. */
  hear(point: Vec, time: number) {
    this.heard = {point: {...point}, time};
  }

  /** Where to walk: the known target, else the last sound, else a roaming goal; then the next bend of a route to it. */
  private approach(self: BotObservation['self'], target: Vec | null, time: number): Vec {
    if (!this.navigator) return target ?? {x: 0, y: self.position.y, z: 5};
    let goal = target;
    if (!goal && this.heard && time - this.heard.time < 8) goal = this.heard.point;
    if (!goal) {
      const reached = this.roamGoal && Math.hypot(this.roamGoal.point.x - self.position.x, this.roamGoal.point.z - self.position.z) < 1.2;
      if (!this.roamGoal || reached || time - this.roamGoal.since > 14) {
        const point = this.navigator.roam(self.position, this.random);
        this.roamGoal = point ? {point, since: time} : undefined;
      }
      goal = this.roamGoal?.point ?? null;
    }
    if (!goal) return {...self.position};
    const moved = !this.path || Math.hypot(this.path.goal.x - goal.x, this.path.goal.z - goal.z) > 1.5;
    if (moved || time - this.path!.at > .75) {
      const waypoints = this.navigator.route({...self.position, y: self.feet}, {...goal, y: self.feet});
      this.path = {goal: {...goal}, waypoints, at: time};
    }
    while (this.path!.waypoints.length > 1 &&
      Math.hypot(this.path!.waypoints[0].x - self.position.x, this.path!.waypoints[0].z - self.position.z) < .6) this.path!.waypoints.shift();
    return this.path!.waypoints[0] ?? goal;
  }

  perceive(observation: BotObservation) {
    if (observation.time < (this.observation?.time ?? -Infinity)) return;
    const previousEnemy = this.memory.seen?.id;
    this.memory.observe(observation);
    this.observation = {...observation, visible: observation.visible ? this.memory.seen : null};
    if (!observation.visible) {
      if (observation.time - this.memory.seenAt > .35) this.firstSeen = -1;
      return;
    }
    if (this.firstSeen < 0 || previousEnemy !== observation.visible.id) {
      this.firstSeen = observation.time;
      const seen = this.sightings.get(observation.visible.id) ?? 0;
      this.sightings.set(observation.visible.id, seen + 1);
      const median = seen > 0 && this.traits.repeekRecognitionMs !== undefined ? this.traits.repeekRecognitionMs : this.traits.recognitionMedianMs;
      this.readyAt = observation.time + median / 1000 * Math.exp(.2 * normal(this.random));
      this.aimYawError = normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG;
      this.aimPitchError = normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG;
      this.willStop = this.random() < this.traits.stopTendency;
    }
  }

  command(self: BotObservation['self'], time: number): Partial<ActorCommand> {
    const melee=self.equipment==='knife';
    const visible = currentVisible(this.observation, time);
    const memoryAim = this.memory.focus(time);
    const remembered = memoryAim ? this.memory.seen : null;
    const identified = visible !== null && time >= this.readyAt;
    const target = visible ?? remembered;
    if (visible) this.heard = undefined;
    const approachPoint: Vec = this.approach(self, target?.position ?? null, time);
    const dx = approachPoint.x - self.position.x, dz = approachPoint.z - self.position.z;
    // Engagement distance is measured to the target itself, not to the next bend of the route.
    const distance = target ? Math.hypot(target.position.x - self.position.x, target.position.z - self.position.z) : Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const aimPoint = (melee?visible?.bodyPoint:visible?.aimPoint)??visible?.aimPoint ?? memoryAim;
    const yawGoal = aimPoint ? Math.atan2(-(aimPoint.x - self.position.x), -(aimPoint.z - self.position.z)) + (visible ? this.aimYawError : 0) : targetYaw;
    const pitchGoal = aimPoint ? Math.atan2(aimPoint.y - self.position.y,
      Math.hypot(aimPoint.x - self.position.x, aimPoint.z - self.position.z)) + (visible ? this.aimPitchError : 0) : 0;
    const viewYaw = self.yaw - (self.aimPunch?.yaw ?? 0) * DEG, viewPitch = self.pitch + (self.aimPunch?.pitch ?? 0) * DEG;
    const {yawDelta, pitchDelta} = aimStep(this.motor, difference(yawGoal, viewYaw), pitchGoal - viewPitch,
      this.traits.motorSettlingMs);
    const stats = equipmentStats(self.equipment);
    const closeWeapon = melee||self.equipment === 'zeus' || stats.pellets > 1;
    const range=melee?knifeModel.primaryRangeUnits*UNIT:stats.range*UNIT;
    // Two standing hulls cannot approach closer than 32 units; stop within
    // knife reach rather than waiting for an impossible sub-hull distance.
    const engageDistance = melee?range*.8:self.equipment === 'zeus' ? stats.range * UNIT * .85 : closeWeapon ? 8
      : this.behavior === 'aggressive' ? 5 : this.behavior === 'holder' ? 18 : 9;
    const closing = closeWeapon && identified && distance > engageDistance;
    // Without a target the bot is travelling to a sound or a roaming goal: engagement range does not apply.
    const advancing = target ? distance > engageDistance && (this.behavior !== 'holder' || !visible || closing) : distance > .6;
    const headingError = difference(targetYaw, self.yaw);
    const stop = identified && !closing && this.willStop && time >= this.readyAt + this.traits.brakeErrorMs / 1000;
    const moving = advancing && !stop;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    const brake = stop && speed > .25;
    const aimError = Math.hypot(difference(yawGoal, viewYaw), pitchGoal - viewPitch);
    const fire = identified && !closing && distance <= range && (melee||self.ammo > 0) && !self.reloading && aimError < (this.traits.endpointErrorDegrees + 1.5) * DEG &&
      time >= this.readyAt + this.traits.motorSettlingMs / 1000 &&
      (!this.willStop || speed <= stats.speed * UNIT * .18);
    const press = fire && time >= this.nextShotAt;
    if (press) this.nextShotAt = time + stats.cycle;
    return {
      forward: brake ? (self.velocity.x * Math.sin(self.yaw) + self.velocity.z * Math.cos(self.yaw)) / speed
        : moving ? Math.cos(headingError) : 0,
      side: brake ? (-self.velocity.x * Math.cos(self.yaw) + self.velocity.z * Math.sin(self.yaw)) / speed
        : moving ? -Math.sin(headingError) : 0,
      walk: this.behavior === 'patient' && !identified,
      crouch: false, jump: false, yawDelta, pitchDelta,
      fireHeld: fire, firePressed: press, reloadPressed: self.equipment !== 'zeus' && self.reserve !== 0 && self.ammo === 0,
    };
  }
}
