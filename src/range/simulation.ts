import { Angle, clamp, gameData, loadoutWeapon, MeasuredProfile, recoilPattern, Settings } from './config';
import {ViewPunch} from './view-punch';
import {FootstepCadence} from './footsteps';
import {advanceActorCommand} from './actor-command';
import {equipmentForSlot, equipmentStats, isPumpShotgun, knifeModel, ZEUS_RECHARGE_SECONDS, type Equipment, type Slot} from './equipment';
import {createScenario, DrillCoach, isDrillMode, RANGE_WALLS, REPOSITION_SHOTS, type CoachSample, type DrillMetrics} from './drills';
import {WeaponRecovery} from './ballistics';
import type {RecoilSelection} from './recoil';
import {DEG, GRAVITY, JUMP_SPEED, SERVER_TICK, STEP, UNIT, airVelocity, groundVelocity, idleInput, tickAligned, type ActorEnvironment, type ActorKinematics, type MoveInput, type Vec} from './actor-physics';
import {direction, shotDirections} from './shot-model';
import {TERRAIN_RULES} from './terrain';
import {resolveDamage} from './duel/damage';
import {NativeReloadState, WeaponActions, type ReloadActionEvent} from './weapon-actions';
import {reloadInputAllows, usesNativeReloadInput} from './reload-input';
import {POP_SPAWN, PopField, popConfig} from './pop';

export {DEG, GRAVITY, JUMP_SPEED, STEP, UNIT, airVelocity, groundVelocity, idleInput, direction};
export const VERTICAL_FOV = 2 * Math.atan(.75) / DEG;
export const TARGET_Z = -100;
export const SPAWN_Z = TARGET_Z + 12;
export type {Vec};
export type Shot = {index: number; at: number; origin: Vec; direction: Vec; recoil: Angle; equipment?: Equipment; melee?: boolean;
  ordinal: number; kind: 'bullet' | 'pellets' | 'melee' | 'zeus'; attack: 'primary' | 'secondary';
  maxDistance: number; pelletDirections?: Vec[]; firstSlash?: boolean};
export type RangeWeaponActionEvent = (ReloadActionEvent | {kind: 'zeus-discharge' | 'zeus-ready'; at: number}) & {equipment: Equipment};
export type ImpactSample = { x: number; y: number; hit: boolean; head: boolean; bullet: number };
export type Result = { id: string; weapon: Equipment; mode: Settings['mode'] | 'tracking'; shots: number; hits: number; heads: number; seconds: number; tracking: number; date: string; samples: ImpactSample[]; drill?: DrillMetrics };
export type Input = MoveInput;

export function mouseAngle(count: number, sensitivity: number) { return count * .022 * sensitivity * DEG; }
/** CS2's zoom_sensitivity_ratio, applied to mouse input while scoped. */
export function targetSpeed(settings: Settings) {
  return (settings.targetSpeed === 'knife' ? 250 : settings.targetSpeed === 'smg' ? 240 : gameData.weapons[settings.weapon].speed) * UNIT;
}
export class Simulation {
  time = 0; accumulator = 0;
  position = { x: 0, y: 64 * UNIT, z: SPAWN_Z };
  velocity = { x: 0, z: 0 }; yaw = 0; pitch = 0;
  feet = 0; verticalVelocity = 0; eyeHeight = 64 * UNIT; duckAmount = 0; duckFlag = false; jumpHeld = false;
  duckSpeed = 8; crouchHeld = false; duckCooldown = 0; duckRecoveryOrigin?: {x: number; z: number};
  duckViewOffset = 0; duckRootOffset = 0;
  grounded = true;
  velocityModifier = 1; movementTime = 0;
  friction?: ActorKinematics['friction'];
  groundCommand?: ActorKinematics['groundCommand'];
  lastJumpPressTime?: number; pendingJumpPressTime?: number; landedAt?: number; landingVelocity?: number;
  landingVelocityXY?: {x: number; z: number}; supportId?: ActorKinematics['supportId'];
  moveMode: ActorKinematics['moveMode'] = 'ground'; waterLevel: ActorKinematics['waterLevel'] = 0; ladderDetached = false;
  renderPosition() {
    if (!this.active || this.accumulator <= 1e-10) return this.position;
    return advanceActorCommand(this, {...this.input, scopedSlow: this.actions.scopedSlowMovement}, this.stats.speed * UNIT, this.accumulator,
      undefined, undefined, undefined, this.environment).position;
  }
  targetX = 0; targetVelocity = 0; targetSign = 1;
  targetHealth = [100, 100];
  private readonly footsteps = new FootstepCadence();
  input = idleInput(); active = false; firing = false; automatic = false;
  readyAt = 0; nextShot = 0; startedAt = 0; shots = 0; hits = 0; heads = 0;
  recoil: Angle = { yaw: 0, pitch: 0 };
  readonly viewPunch = new ViewPunch();
  pattern: Angle[]; latest?: Result; measured?: MeasuredProfile;
  samples: ImpactSample[] = []; attempts = 0;
  lastShotAt = -Infinity;
  slot: Slot = 1; previousSlot: Slot = 2; equipReadyAt = 0;
  meleeAt = -Infinity; reloadHeld = false; secondaryHeld = false;
  recoveryStates = new Map<Equipment,WeaponRecovery>();
  actionStates = new Map<Equipment, WeaponActions>();
  ammoStates = new Map<Equipment, NativeReloadState>();
  private shotReady = new Map<Equipment, number>();
  private shotOrdinals = new Map<Equipment, number>();
  private rechargeTimes = new Map<Equipment, number>();
  private actionEvents: RangeWeaponActionEvent[] = [];
  private meleeSecondary = false;
  private firstSlashAfter = -Infinity;
  private lastMelee?: {ordinal: number; at: number; secondary: boolean};
  private burstLeft = 0;
  private burstEnd = 0;
  private releasedBurst = false;
  // Physical input outlives a practice attempt. Reload/deploy end that attempt,
  // but the native weapon post-frame still sees a button held through them.
  private triggerHeld = false;
  private triggerAlternate = false;
  private resumeHeldAt?: number;
  get actions() {
    let state = this.actionStates.get(this.equipped);
    if (!state) {state = new WeaponActions(this.equipped); this.actionStates.set(this.equipped, state);}
    return state;
  }
  /** Pop mode: the balls and the session tally; `popStartedAt` is the first shot of the session. */
  pop?: PopField; popStartedAt = 0; private popPublishedShots = 0; private popPlaced = false;
  drill?: DrillCoach; drillRound = 0; drillPassed = 0; drillCompleted = 0;
  drillResult?: DrillMetrics; nextDrillAt = 0; repositionFrom?: Vec; repositionYaw = 0; drillRevision = 0;
  get equipped() { return equipmentForSlot(this.slot, this.settings.weapon, this.settings.sidearm); }
  get stats() { return this.actions.stats; }
  get environment(): ActorEnvironment {
    const radius = TERRAIN_RULES.hullRadius;
    return {solids: this.drill?.scenario.covers ?? (this.pop?.wall ? [this.pop.wall, ...RANGE_WALLS] : RANGE_WALLS), floor: 0, time: this.time, pitch: this.pitch,
      bounds: {minX: -11.3 - radius, maxX: 11.3 + radius, minZ: TARGET_Z + 2.2 - radius, maxZ: 5 + radius}};
  }
  ammoFor(id: Equipment) {
    let state = this.ammoStates.get(id);
    if (!state) {state = new NativeReloadState(id); this.ammoStates.set(id, state);}
    return state;
  }
  get reloadState() {return this.ammoFor(this.equipped);}
  get loadedAmmo() {return this.reloadState.ammo;}
  get reserveAmmo() {return this.reloadState.reserve;}
  get reloadEmpty() {return this.reloadState.empty;}
  get reloadSilent() {return this.reloadState.active && this.reloadState.silent;}
  get reloadPhase() {return this.reloadState.phase;}
  get pistolAmmo() {return this.ammoFor(this.settings.sidearm).ammo;}
  set pistolAmmo(value: number) {this.ammoFor(this.settings.sidearm).ammo = value;}
  get pistolReloadAt() {return this.ammoFor(this.settings.sidearm).until;}
  get primaryReloadAt() {return this.ammoFor(this.settings.weapon).until;}
  get rechargeUntil() {return this.rechargeTimes.get(this.equipped) ?? 0;}
  get pumpUntil() {return isPumpShotgun(this.equipped) ? this.shotReady.get(this.equipped) ?? 0 : 0;}
  drainActionEvents() {
    const events = [...this.actionEvents]; this.actionEvents = [];
    for (const [equipment, state] of this.ammoStates)
      events.push(...state.drainActionEvents().map(event => ({...event, equipment})));
    return events.sort((a, b) => a.at - b.at);
  }
  get recovery() {
    let state=this.recoveryStates.get(this.equipped);
    if(!state){
      const base=equipmentStats(this.equipped),capture=this.slot===1?this.measured?.points:undefined;
      // Lazy creation must start from the same base state as an eagerly created
      // Duel weapon, even if its mode changed before the first recovery read.
      state=new WeaponRecovery(capture?this.stats:base,capture,base.cycle);
      if(!capture)state.setParameters(this.stats);
      this.recoveryStates.set(this.equipped,state);
    }
    return state;
  }
  resetRecovery(){this.recoveryStates.clear();this.recoil={yaw:0,pitch:0};this.viewPunch.reset();}
  predictedRecoil(next=false){
    if (this.equipped === 'knife' || this.equipped === 'zeus') return {yaw: 0, pitch: 0};
    const due=this.firing?this.nextShot:Math.max(this.time,this.shotReady.get(this.equipped) ?? 0,this.burstEnd);
    // Punch follows the exact scheduled command time even when a held shot is
    // processed on the following server tick.
    const delay=Math.max(0,due-this.time);
    const processingDelay=Math.max(0,this.time-due);
    if(!next)return processingDelay?this.recovery.recoilBefore(processingDelay):this.recovery.predict(delay);
    const state=Object.assign(Object.create(WeaponRecovery.prototype),this.recovery) as WeaponRecovery;
    state.advance(delay);
    const cadence = this.actions.burst && this.burstLeft !== 1 ? this.actions.burstInterval : this.stats.cycle;
    const following = this.actions.burst && this.burstLeft === 1 ? this.burstEnd : due + cadence;
    return state.predict(Math.max(0,following-this.time)-delay,true,processingDelay,
      this.recoilSelection?.(this.equipped,this.shotOrdinals.get(this.equipped) ?? 0));
  }
  get burstSize() {
    if (this.slot === 3 || this.settings.mode === 'precision') return 1;
    if (this.pop) return this.stats.magazine;
    if (this.settings.mode === 'burst') return REPOSITION_SHOTS;
    if (this.settings.mode === 'peek') return this.stats.magazine;
    return Math.min(this.settings.burst || this.stats.magazine, this.stats.magazine);
  }
  targetForShot(index = this.shots) {
    return this.settings.mode === 'transfer' && (this.settings.transferRule === 'kill' ? this.targetHealth[0] <= 0
      : index >= Math.min(this.settings.transferAfter, Math.max(1, this.burstSize - 1))) ? 1 : 0;
  }
  damageTarget(index: number, head: boolean, distance: number, healthDamageOverride?: number) {
    if (this.settings.mode !== 'transfer') return;
    const healthDamage = healthDamageOverride !== undefined && Number.isFinite(healthDamageOverride)
      ? Math.max(0, healthDamageOverride) : resolveDamage(this.equipped, head ? 'head' : 'chest', distance, 0, false).healthDamage;
    this.targetHealth[index] = Math.max(0, this.targetHealth[index] - healthDamage);
  }
  targetPosition(index: number): Vec {
    if (this.drill) return {...this.drill.scenario.target};
    const transfer = this.settings.mode === 'transfer';
    return { x: this.targetX + (transfer ? index === 0 ? -2 : 2 : 0), y: 0, z: TARGET_Z };
  }
  onShot: (shot: Shot) => void = () => {};
  onSound: (landing: boolean) => void = () => {};
  onResult: (result: Result) => void = () => {};
  // A supplied selector must be pure for each weapon/ordinal: guides may query
  // it before firing. It is separate from the mutable spread/random stream.
  constructor(public settings: Settings, private readonly random?: () => number,
    private readonly recoilSelection?: (weapon: Equipment, ordinal: number) => RecoilSelection | undefined) {
    this.slot = settings.primaryEnabled ? 1 : 2; this.pattern = recoilPattern(loadoutWeapon(settings)); this.configure(settings);
  }
  configure(s: Settings, measured?: MeasuredProfile) {
    const changedMode = s.mode !== this.settings.mode;
    // Raising or moving the peek wall puts you back behind it: you may be standing where it goes up.
    const changedWall = s.mode === 'pop' && s.popWall !== this.settings.popWall;
    const leavingPositionedDrill = isDrillMode(this.settings.mode) || this.settings.mode === 'pop';
    this.cancel(); this.settings = s; this.measured = measured;
    if (!s.primaryEnabled && this.slot === 1) this.slot = 2;
    this.actionStates.clear(); this.restock();
    this.resetRecovery();
    this.pattern = recoilPattern(this.equipped === 'knife' ? loadoutWeapon(s) : this.equipped, measured);
    this.targetX = this.targetVelocity = 0; this.targetSign = 1;
    this.readyAt = this.time;
    this.drillRound = this.drillPassed = this.drillCompleted = 0;
    this.drillResult = undefined; this.nextDrillAt = 0; this.repositionFrom = undefined;
    if (isDrillMode(s.mode)) this.newDrill(true);
    else { this.drill = undefined; this.drillRevision++; if (changedMode && leavingPositionedDrill) {
      this.position = {x:0,y:64*UNIT,z:SPAWN_Z}; this.yaw = this.pitch = this.feet = this.verticalVelocity = this.duckAmount = 0;
      this.duckFlag = false;
      this.eyeHeight = 64 * UNIT; this.duckSpeed = 8; this.crouchHeld = false; this.duckCooldown = 0; this.duckRecoveryOrigin = undefined;
      this.duckViewOffset = this.duckRootOffset = 0;
      this.grounded = true; this.jumpHeld = false; this.resetMovementHistory();
    } }
    if (s.mode === 'pop') {
      this.pop = new PopField(popConfig(s), POP_SPAWN, this.random ?? Math.random); this.popPublishedShots = 0;
      // A fresh simulation starts in Pop too (the constructor configures with the mode already set).
      if (changedMode || !this.popPlaced || changedWall) {
        this.popPlaced = true;
        this.position = {...POP_SPAWN}; this.yaw = this.pitch = this.feet = this.verticalVelocity = this.duckAmount = 0;
        this.duckFlag = false;
        this.velocity = {x: 0, z: 0}; this.eyeHeight = 64 * UNIT; this.duckSpeed = 8; this.crouchHeld = false; this.duckCooldown = 0;
        this.duckViewOffset = this.duckRootOffset = 0;
        this.duckRecoveryOrigin = undefined; this.grounded = true; this.jumpHeld = false; this.resetMovementHistory();
      }
    } else {this.pop = undefined; this.popPlaced = false;}
  }
  /** Pop's ammo mode as sv_infinite_ammo: 'reserve' (2) keeps the reserve full, 'magazine' (1) never empties the magazine. */
  private refillPopAmmo() {
    const mode = this.settings.popAmmo;
    if (mode === 'off' || this.equipped === 'knife' || this.equipped === 'zeus') return;
    this.reloadState.reserve = this.stats.reserve;
    if (mode === 'magazine') this.reloadState.ammo = this.stats.magazine;
  }
  /** Pop keeps one running tally per session; a pause records it once per new shots. */
  publishPopResult() {
    const pop = this.pop;
    if (!pop || !pop.shots || pop.shots === this.popPublishedShots) return;
    this.popPublishedShots = pop.shots;
    this.latest = {id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, weapon: this.equipped, mode: 'pop', shots: pop.shots, hits: pop.hits,
      heads: 0, seconds: this.time - this.popStartedAt, tracking: 0, date: new Date().toISOString(), samples: []};
    this.attempts++; this.onResult(this.latest);
  }
  equip(slot: Slot) {
    if (slot === 1 && !this.settings.primaryEnabled) return false;
    if (slot === this.slot) return false;
    this.burstLeft = 0; this.burstEnd = 0; this.finish(); this.actions.holster(); this.reloadState.cancel();
    this.previousSlot = this.slot; this.slot = slot;
    if (this.equipped !== 'knife') this.pattern = recoilPattern(this.equipped, this.slot === 1 ? this.measured : undefined);
    this.equipReadyAt = this.time + (this.active ? this.stats.deploy : 0);
    this.resumeHeldAt = this.triggerHeld ? this.equipReadyAt : undefined;
    return true;
  }
  reload(silent = this.reloadHeld, automatic = false) {
    if (!automatic && usesNativeReloadInput(this.equipped) && !reloadInputAllows(this.time,
      this.shotReady.get(this.equipped) ?? 0, this.triggerHeld, this.secondaryHeld,
      this.actions.secondaryReadyAt, this.burstLeft > 0)) return false;
    if (!this.reloadState.start(this.time, silent)) return false;
    if (!this.stats.reloadsSingleShells) this.recovery.reloadStarted(automatic);
    this.finish(); this.burstLeft = 0; this.actions.holster(); this.active = true; this.reloadHeld = silent;
    this.resumeHeldAt = this.triggerHeld ? this.time : undefined;
    return true;
  }
  private restock() {
    this.ammoStates.clear(); this.shotReady.clear(); this.shotOrdinals.clear(); this.rechargeTimes.clear(); this.actionEvents = [];
    this.lastShotAt = this.meleeAt = -Infinity; this.firstSlashAfter = -Infinity; this.lastMelee = undefined;
    this.burstLeft = 0; this.burstEnd = 0; this.reloadHeld = false;
  }
  private resetMovementHistory() {
    this.footsteps.reset();
    this.velocityModifier = 1; this.movementTime = this.time;
    this.friction = undefined; this.groundCommand = undefined;
    this.lastJumpPressTime = this.pendingJumpPressTime = this.landedAt = this.landingVelocity = undefined;
    this.landingVelocityXY = undefined; this.supportId = undefined;
    this.moveMode = this.grounded ? 'ground' : 'air'; this.waterLevel = 0; this.ladderDetached = false;
    this.input.jumpPressed = false; this.input.jumpPressOffset = 0;
  }
  resolveMeleeHit(ordinal: number, hit: boolean) {
    const attack = this.lastMelee;
    if (!attack || attack.ordinal !== ordinal) return;
    const cycle = attack.secondary ? (hit ? knifeModel.secondaryHitCycle : knifeModel.secondaryMissCycle)
      : (hit ? knifeModel.primaryHitCycle : knifeModel.primaryMissCycle);
    this.shotReady.set('knife', attack.at + cycle);
    this.firstSlashAfter = attack.at + cycle + knifeModel.firstSlashGrace;
    if (this.equipped === 'knife') this.nextShot = attack.at + cycle;
  }
  coachSample(): CoachSample {
    return {time:this.time,position:this.position,yaw:this.yaw,pitch:this.pitch,velocity:this.velocity,speedCap:this.stats.speed*UNIT,input:this.input,feet:this.feet,grounded:this.grounded};
  }
  newDrill(resetPosition = false) {
    if (!isDrillMode(this.settings.mode)) return;
    const scenario = createScenario(this.settings.mode, this.drillRound++, this.settings.peekScenario);
    if (resetPosition || this.settings.mode === 'peek') {
      this.position = {...scenario.spawn}; this.yaw = scenario.yaw; this.pitch = scenario.pitch;
      this.velocity = {x:0,z:0}; this.feet = this.verticalVelocity = this.duckAmount = 0; this.eyeHeight = 64*UNIT;
      this.duckFlag = false;
      this.grounded = true; this.jumpHeld = false;
      this.duckSpeed = 8; this.crouchHeld = false; this.duckCooldown = 0; this.duckRecoveryOrigin = undefined;
      this.duckViewOffset = this.duckRootOffset = 0;
      this.resetMovementHistory();
    } else scenario.spawn = {...this.position};
    this.drill = new DrillCoach(this.settings.mode, scenario, this.time);
    this.restock(); this.resetRecovery();
    this.drillRevision++; this.nextDrillAt = 0; this.repositionFrom = undefined;
    this.shots = this.hits = this.heads = 0; this.samples = [];
    this.drill.update(this.coachSample());
  }
  completeDrill(timeout = false) {
    if (!this.drill || this.drill.finished) return;
    this.drillResult = this.drill.result(timeout); this.drill.finished = true;
    this.drillCompleted++; this.drillPassed += +this.drillResult.passed;
    this.nextDrillAt = this.time+(this.settings.mode==='peek' ? 0 : 1.4);
    if (this.settings.mode === 'burst') { this.repositionFrom = {...this.position}; this.repositionYaw = this.yaw; }
    this.firing = this.automatic = false;
    this.publishResult(this.drillResult);
  }
  publishResult(drill?: DrillMetrics) {
    this.latest = {id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,weapon:this.equipped,mode:this.settings.mode,
      shots:drill?.shots ?? this.shots,hits:drill?.hits ?? this.hits,heads:drill?.heads ?? this.heads,
      seconds:this.time-(this.drill?.beganAt ?? this.startedAt),tracking:0,date:new Date().toISOString(),samples:[...this.samples],...(drill ? {drill} : {})};
    this.attempts++; this.onResult(this.latest);
  }
  aim(dx: number, dy: number, touch = false) {
    const scale = (touch ? .0025 : mouseAngle(1, this.settings.sensitivity)) *
      this.actions.sensitivityAt(this.time + this.accumulator, touch ? 1 : this.settings.keyboard.zoomSensitivity);
    this.drill?.mouse(Math.hypot(dx,dy)*scale/DEG);
    this.yaw -= dx * scale;
    this.pitch = clamp(this.pitch - dy * scale * (this.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
  }
  /** Mouse/key attack edge. Training's automatic start remains a separate action. */
  pressTrigger(alternate = false) {
    this.triggerHeld = true; this.triggerAlternate = alternate;
    const started = this.start(false, alternate);
    if (!started && !this.firing && !this.drill?.finished) this.resumeHeldAt = this.time;
    return started;
  }
  start(automatic = false, alternate = false, scheduledAt = this.time) {
    if (this.firing || this.time < Math.max(this.equipReadyAt, this.actions.readyAt) || this.drill?.finished) return false;
    if(this.equipped==='knife'&&this.time<(this.shotReady.get('knife')??0))return false;
    if (this.reloadState.active) {
      if (!this.reloadState.stats.reloadsSingleShells) return false;
      if (this.reloadState.empty) this.reloadState.interrupt();
    }
    if (!this.reloadState.active && this.equipped !== 'knife' && this.loadedAmmo === 0) { this.reload(this.reloadHeld, true); return false; }
    this.meleeSecondary = this.equipped === 'knife' && alternate;
    this.actions.alternateFire = this.actions.isRevolver && alternate;
    this.active = true; this.firing = true; this.automatic = automatic;
    this.resumeHeldAt = undefined;
    this.shots = this.hits = this.heads = 0;
    this.startedAt = this.time; this.nextShot = Math.max(scheduledAt, this.shotReady.get(this.equipped) ?? 0,
      this.equipReadyAt, this.actions.readyAt, this.burstEnd,
      this.reloadState.active ? this.stats.reloadsSingleShells && !this.reloadState.empty
        ? this.reloadState.attackReadyAt : this.reloadState.until : 0,
      this.actions.isRevolver ? this.actions.chargeTrigger(this.time, true) : 0);
    this.releasedBurst = false;
    this.targetHealth = [100, 100];
    this.latest = undefined;
    if (!this.drill) this.samples = [];
    if (this.time >= this.nextShot) this.fire();
    return true;
  }
  secondary() {
    if (this.firing || this.reloadState.active) return false;
    // The primary branch consumes held input when ready, even when the
    // semiautomatic weapon rejects another shot without a fresh press.
    if ((this.equipped === 'glock' || this.equipped === 'awp') && this.triggerHeld &&
      this.time + 1e-9 >= (this.shotReady.get(this.equipped) ?? 0)) return false;
    return this.actions.secondary(this.time);
  }
  release(pointerType: string) {
    if (pointerType !== 'touch') {this.triggerHeld = false; this.resumeHeldAt = undefined;}
    if (this.automatic || pointerType === 'touch') return;
    if (this.burstLeft) this.releasedBurst = true; else this.finish();
    if (this.equipped === 'glock' && this.secondaryHeld) this.secondary();
  }
  cancel() {
    this.triggerHeld = false; this.resumeHeldAt = undefined;
    this.burstLeft = 0;
    if (this.firing) this.finish();
    this.active = false; this.input = idleInput(); this.velocity = { x: 0, z: 0 };
    this.friction = undefined; this.groundCommand = undefined;
    this.footsteps.reset();
    this.reloadHeld = this.secondaryHeld = false;
    for (const state of this.ammoStates.values()) state.cancel();
    this.drill?.interruptMovement();
    this.accumulator = 0;
  }
  finish() {
    if (!this.firing) return;
    this.firing = false; this.automatic = false;
    this.actions.chargeTrigger(this.time, false);
    this.readyAt = this.time;
    if (this.shots && !this.drill && !this.pop) this.publishResult();
  }
  reset() {
    this.cancel(); this.readyAt = this.time; this.shots = this.hits = this.heads = 0;
    this.latest = undefined;
    this.restock(); this.resetRecovery(); this.actionStates.clear(); this.resetMovementHistory();
    this.pop?.reset(); this.popPublishedShots = 0;
    if (isDrillMode(this.settings.mode)) { this.drillResult = undefined; this.newDrill(true); }
  }
  advance(elapsed: number) {
    if (!this.active) return;
    this.accumulator += Math.min(Math.max(elapsed, 0), .25);
    let duration = this.untilEvent();
    while (this.accumulator + 1e-10 >= duration) {
      this.accumulator = Math.max(0, this.accumulator - duration); this.step(duration); duration = this.untilEvent();
    }
  }
  private untilTick() { return (Math.floor((this.time + 1e-10) / STEP) + 1) * STEP - this.time; }
  private untilEvent() {
    let duration = this.untilTick();
    const at = Math.min(this.actions.nextEventAt, this.reloadState.active ? this.reloadState.nextEventAt : Infinity,
      this.firing && (!this.reloadState.active || !this.reloadState.empty) ? tickAligned(this.nextShot) : Infinity);
    if (at > this.time + 1e-10) duration = Math.min(duration, at - this.time);
    return duration;
  }
  flushInput() {
    if (!this.active || this.accumulator <= 1e-10) return;
    const duration = this.accumulator; this.accumulator = 0; this.step(duration);
  }
  step(dt: number) {
    // Movement samples the weapon before remaining weapon events in this update.
    const movementSpeed = this.stats.speed * UNIT, movementScoped = this.actions.scopedSlowMovement;
    this.time += dt;
    this.actions.advance(this.time, this.shotReady.get(this.equipped) ?? 0, this.loadedAmmo);
    const weapon = this.stats;
    // Magazine completion and an uninterrupted shell outro retain their existing
    // deadlines. Loaded-shell attacks use the separate reload-start lock.
    const reloading = this.reloadState.active;
    const reloadEnd = this.reloadState.phase === 'finish' || this.reloadState.phase === 'magazine' ? this.reloadState.until : this.time;
    for (const [id, state] of this.ammoStates) state.advance(this.time, id === this.equipped ? this.reloadHeld : undefined);
    if (this.firing && reloading && !this.reloadState.active) this.nextShot = Math.max(this.nextShot, reloadEnd);
    if (this.resumeHeldAt !== undefined && reloading && !this.reloadState.active)
      this.resumeHeldAt = Math.max(this.resumeHeldAt, reloadEnd);
    // Pop's infinite modes top the reserve (and the magazine) back up every tick, as sv_infinite_ammo does.
    if (this.pop) {this.refillPopAmmo(); this.pop.advance(this.time);}
    if (this.firing && this.reloadState.active && this.reloadState.empty) this.reloadState.interrupt();
    for (const [id, until] of this.rechargeTimes) if (this.time + 1e-9 >= until) {
      this.ammoFor(id).ammo = 1; this.rechargeTimes.delete(id);
      this.actionEvents.push({kind: 'zeus-ready', at: this.time, equipment: id});
    }
    if (this.footsteps.update(this.time, dt, this, this.input)) this.onSound(false);
    const next = advanceActorCommand(this, {...this.input, scopedSlow: movementScoped}, movementSpeed, dt, undefined, undefined, undefined,
      {...this.environment, time: this.time - dt});
    this.input.jumpPressed = false; this.input.jumpPressOffset = 0;
    if (next.landedAt !== undefined && next.landedAt !== this.landedAt && next.landingVelocity !== undefined &&
      !next.waterLevel && next.supportId === undefined) {
      this.viewPunch.land(-next.landingVelocity / UNIT, next.landedAt);
      this.recovery.land(-next.landingVelocity / UNIT);
    }
    if (next.grounded && !this.grounded) this.onSound(true);
    this.velocity = next.velocity;
    this.position.x = next.position.x; this.position.y = next.position.y; this.position.z = next.position.z;
    this.feet = next.feet; this.verticalVelocity = next.verticalVelocity;
    this.eyeHeight = next.eyeHeight; this.duckAmount = next.duckAmount ?? 0; this.jumpHeld = next.jumpHeld;
    this.duckFlag = next.duckFlag ?? false;
    this.duckSpeed = next.duckSpeed ?? 8; this.crouchHeld = next.crouchHeld ?? false;
    this.duckViewOffset = next.duckViewOffset ?? 0; this.duckRootOffset = next.duckRootOffset ?? 0;
    this.duckCooldown = next.duckCooldown ?? 0; this.duckRecoveryOrigin = next.duckRecoveryOrigin;
    this.velocityModifier = next.velocityModifier ?? 1; this.movementTime = next.movementTime ?? this.time;
    this.friction = next.friction;
    this.groundCommand = next.groundCommand;
    this.lastJumpPressTime = next.lastJumpPressTime; this.pendingJumpPressTime = next.pendingJumpPressTime;
    this.landedAt = next.landedAt; this.landingVelocity = next.landingVelocity; this.landingVelocityXY = next.landingVelocityXY;
    this.supportId = next.supportId; this.moveMode = next.moveMode; this.waterLevel = next.waterLevel;
    this.ladderDetached = next.ladderDetached ?? false;
    this.grounded = !!next.grounded;
    const crouch = this.duckFlag;
    const recovery=this.recovery;
    if (!this.measured || this.slot !== 1) recovery.setParameters(weapon);
    for (const [id, state] of this.recoveryStates) {
      if (id === 'zeus') {
        const stats = equipmentStats(id);
        state.penalty = !this.grounded ? stats.stand + stats.jump : crouch ? stats.crouch : stats.stand;
      } else state.advance(dt,crouch,!this.grounded,id===this.equipped,this.time);
    }
    if (reloading && !this.reloadState.active && !weapon.reloadsSingleShells) recovery.reloadFinished();
    this.recoil=this.equipped==='knife' || this.equipped==='zeus'?{yaw:0,pitch:0}:recovery.recoil;
    if (this.settings.moving && !this.drill) {
      const extent = this.settings.mode === 'transfer' ? 1.25 : 3;
      this.targetVelocity = this.targetSign * targetSpeed(this.settings);
      this.targetX += this.targetVelocity * dt;
      if (Math.abs(this.targetX) > extent) {
        this.targetX = this.targetSign * (2 * extent - Math.abs(this.targetX));
        this.targetSign *= -1; this.targetVelocity *= -1;
      }
    }
    if (this.drill) {
      this.drill.update(this.coachSample());
      const repositioned = !this.repositionFrom || Math.abs((this.position.x-this.repositionFrom.x)*Math.cos(this.repositionYaw)-(this.position.z-this.repositionFrom.z)*Math.sin(this.repositionYaw))>=.9;
      if (this.drill.finished && this.time >= this.nextDrillAt && repositioned) this.newDrill();
      else if (!this.drill.finished && this.settings.mode==='peek') {
        if(this.drill.firstShotAt!==null && this.time-this.drill.firstShotAt >= this.settings.peekDuration) {
          this.completeDrill(); this.newDrill();
        }
      }
      else if (!this.drill.finished && this.drill.seenAt !== null && this.time-this.drill.seenAt > (this.settings.drillPace==='challenge' ? 1.5 : 8)) this.completeDrill(true);
    }
    if (this.triggerHeld && this.resumeHeldAt !== undefined && !this.firing && !this.reloadState.active &&
      (this.equipped === 'knife' || this.loadedAmmo > 0)) {
      const due = Math.max(this.resumeHeldAt, this.equipReadyAt, this.actions.readyAt, this.shotReady.get(this.equipped) ?? 0);
      if (this.time + 1e-9 >= tickAligned(due)) this.start(false, this.triggerAlternate, due);
    }
    if (this.firing && this.actions.isRevolver && !this.actions.alternateFire) this.nextShot = Math.max(this.nextShot, this.actions.chargeTrigger(this.time, true));
    // A shot the weapon becomes ready for while the trigger is held is processed on the next server tick; its
    // schedule (nextShot) keeps accumulating exactly, as the game's demos show (AK sprays alternate 6 and 7 ticks).
    if (this.firing && this.time + 1e-9 >= tickAligned(this.nextShot)) this.fire();
    // Pending Glock rounds update both clocks before the secondary branch.
    if (this.equipped === 'glock' && this.secondaryHeld) this.secondary();
    // Held R retries the same admission rule; an early released tap is not queued.
    if (this.reloadHeld && usesNativeReloadInput(this.equipped)) this.reload(true);
    // CS2 reloads an empty magazine by itself once the last shot's cycle ends. shotReady alone can
    // lag behind a shot queued through a long shell reload, so time the cycle from the shot itself.
    if (!this.firing && this.loadedAmmo === 0 && this.equipped !== 'knife' && !this.reloadState.active && this.time + 1e-9 >=
      Math.max(this.shotReady.get(this.equipped) ?? 0, this.lastShotAt + this.stats.cycle, this.equipReadyAt, this.actions.readyAt)) this.reload(this.reloadHeld, true);
    if (!this.measured || this.slot !== 1) recovery.setParameters(this.stats);
    recovery.finishAccuracy();
  }
  fire() {
    const weapon = this.stats;
    if (this.time + 1e-9 < (this.shotReady.get(this.equipped) ?? 0)) return;
    if (this.reloadState.active && (this.reloadState.empty || !this.reloadState.interrupt(this.time))) return;
    if (this.equipped === 'knife') {
      const secondary = this.meleeSecondary, ordinal = this.shotOrdinals.get('knife') ?? 0;
      const firstSlash = !secondary && this.time + 1e-9 >= this.firstSlashAfter;
      this.meleeAt = this.time; this.shotOrdinals.set('knife', ordinal + 1);
      this.nextShot = this.time + (secondary ? knifeModel.secondaryMissCycle : knifeModel.primaryMissCycle);
      this.shotReady.set('knife', this.nextShot); this.firstSlashAfter = this.nextShot + knifeModel.firstSlashGrace;
      this.lastMelee = {ordinal, at: this.time, secondary};
      this.recoil = {yaw: 0, pitch: 0};
      this.onShot({index: this.shots, ordinal, at: this.time, origin: {...this.position}, direction: direction(this.yaw, this.pitch),
        recoil: this.recoil, equipment: 'knife', melee: true, kind: 'melee', attack: secondary ? 'secondary' : 'primary', firstSlash,
        maxDistance: (secondary ? knifeModel.secondaryRangeUnits : knifeModel.primaryRangeUnits) * UNIT});
      this.finish(); return;
    }
    if (!this.measured || this.slot !== 1) this.recovery.setParameters(weapon);
    const endless = !!this.pop && this.settings.popAmmo === 'magazine' && this.equipped !== 'zeus';
    if (!endless && this.shots >= this.burstSize || this.loadedAmmo <= 0) {this.burstLeft = 0; this.finish(); return;}
    // A shot held past its schedule by more than a tick (a shell reload, a holster, the deploy delay) is scheduled from
    // now, like the game's stale next-attack time; one processed on the next tick keeps its exact schedule.
    if (this.time - this.nextShot > SERVER_TICK + 1e-9) this.nextShot = this.time;
    if (this.actions.burst && !this.burstLeft) {this.burstLeft = 3; this.burstEnd = this.nextShot + this.actions.burstCycle;}
    const processingDelay = Math.max(0, this.time - this.nextShot);
    this.recovery.beforeShot(processingDelay);
    this.recoil = this.equipped === 'zeus' ? {yaw: 0, pitch: 0} : this.recovery.recoilBefore(processingDelay);
    if (this.equipped === 'zeus') this.recovery.penalty = !this.grounded ? weapon.stand + weapon.jump : this.duckFlag ? weapon.crouch : weapon.stand;
    const ordinal = this.shotOrdinals.get(this.equipped) ?? 0;
    const directions = shotDirections({yaw:this.yaw,pitch:this.pitch,recoil:this.recoil,weapon,recovery:this.recovery,
      speedRatio:Math.hypot(this.velocity.x,this.velocity.z)/(weapon.speed*UNIT),walking:this.input.walk,
      airborne:!this.grounded,verticalSpeedUnits:this.verticalVelocity/UNIT,spread:this.settings.spread,
      weaponId:this.equipped,alternateFire:this.actions.alternateFire,recoilIndex:this.recovery.index,seed:ordinal+1}, weapon.pellets, this.random);
    const index = this.shots++;
    if (this.pop) {if (!this.pop.shots) this.popStartedAt = this.time; this.pop.shots++;}
    this.reloadState.ammo--;
    if (this.pop) this.refillPopAmmo(); this.shotOrdinals.set(this.equipped, ordinal + 1);
    if (this.equipped !== 'zeus') {
      this.recovery.fire(processingDelay,this.recoilSelection?.(this.equipped,ordinal)); this.viewPunch.add(this.recovery.lastViewPunch, this.time);
    }
    else {
      this.rechargeTimes.set('zeus', this.time + ZEUS_RECHARGE_SECONDS);
      this.actionEvents.push({kind: 'zeus-discharge', at: this.time, equipment: 'zeus'});
    }
    // The game records the scheduled time as the last shot time; a tick-aligned shot keeps its schedule.
    this.lastShotAt = this.nextShot;
    this.actions.afterShot(this.time, this.nextShot, this.burstLeft);
    if (!this.measured || this.slot !== 1) this.recovery.setParameters(this.actions.stats);
    this.recovery.finishAccuracy();
    this.onShot({index, ordinal, at:this.time, origin:{...this.position}, direction:directions[0], recoil:this.recoil, equipment:this.equipped,
      kind:this.equipped==='zeus'?'zeus':directions.length>1?'pellets':'bullet', attack:this.actions.alternateFire?'secondary':'primary',
      maxDistance:weapon.range*UNIT, ...(directions.length>1?{pelletDirections:directions}:{})});
    if (this.drill && !this.drill.finished) {
      const sample = this.samples[this.samples.length-1];
      this.drill.record(this.coachSample(),!!sample?.hit,!!sample?.head);
      if (this.settings.mode==='precision' || this.settings.mode==='burst' && this.drill.shots>=REPOSITION_SHOTS) this.completeDrill();
    }
    if (this.burstLeft) {this.burstLeft--; this.nextShot = this.burstLeft ? this.nextShot + this.actions.burstInterval : this.burstEnd;}
    else this.nextShot += weapon.cycle;
    this.shotReady.set(this.equipped, this.nextShot);
    if (!endless && this.shots >= this.burstSize || !this.loadedAmmo || !this.burstLeft && (!weapon.fullAuto || this.releasedBurst)) this.finish();
  }
}
