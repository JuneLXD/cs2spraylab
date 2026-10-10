import {equipmentStats, isPumpShotgun, knifeModel, ZEUS_RECHARGE_SECONDS, type Equipment} from '../equipment';
import {DEG, UNIT, type Vec, SERVER_TICK, tickAligned} from '../actor-physics';
import type {DamagePunch} from '../aim-punch';
import {WeaponRecovery} from '../ballistics';
import type {RecoilAngle} from '../recoil';
import {direction as aimDirection, shotDirections} from '../shot-model';
import type {ActorCommand} from './types';
import {NativeReloadState, WeaponActions, type ReloadActionEvent} from '../weapon-actions';
import {reloadInputAllows, usesNativeReloadInput} from '../reload-input';

export type FiredRound = {
  origin: Vec; direction: Vec; weapon: Equipment; ordinal: number;
  kind: 'bullet' | 'pellets' | 'melee' | 'zeus'; attack: 'primary' | 'secondary';
  maxDistance: number; pelletDirections?: Vec[]; firstSlash?: boolean;
  viewPunch?: RecoilAngle;
};
export type WeaponActionEvent = ReloadActionEvent | {kind: 'zeus-discharge' | 'zeus-ready'; at: number};
export type WeaponCommand = ActorCommand & {reloadHeld?: boolean; reloadAutomatic?: boolean};
export type WeaponStateOptions = {spread?: boolean; silentReloadMultiplier?: number};

export class DuelWeaponState {
  readonly recovery: WeaponRecovery;
  readonly reload: NativeReloadState;
  get ammo() {return this.reload.ammo;}
  set ammo(value: number) {this.reload.ammo = value;}
  get reserve() {return this.reload.reserve;}
  set reserve(value: number) {this.reload.reserve = value;}
  nextShotAt = 0;
  get reloadUntil() {return this.reload.until;}
  get reloadEmpty() {return this.reload.empty;}
  get reloadPhase() {return this.reload.phase;}
  get reloadSilent() {return this.reload.active && this.reload.silent;}
  rechargeUntil = 0;
  pumpUntil = 0;
  pendingPress = false;
  ordinal = 0;
  readonly actions: WeaponActions;
  private burstLeft = 0;
  private burstEnd = 0;
  private actionEvents: WeaponActionEvent[] = [];
  private firstSlashAfter = -Infinity;
  private lastMelee?: {ordinal: number; at: number; secondary: boolean};

  constructor(public readonly id: Equipment, private readonly random: () => number, private readonly options: WeaponStateOptions = {}) {
    this.reload = new NativeReloadState(id, options.silentReloadMultiplier);
    this.recovery = new WeaponRecovery(equipmentStats(id));
    this.actions = new WeaponActions(id);
  }

  holster() {
    this.reload.cancel(); this.pendingPress = false;
    this.burstLeft = 0; this.actions.holster();
  }

  drainActionEvents(): WeaponActionEvent[] {
    const events = [...this.actionEvents, ...this.reload.drainActionEvents()];
    this.actionEvents = []; return events;
  }

  /** An already requested shot must sample movement/recovery at its deadline,
   * even when the weapon cycle does not divide the 128 Hz movement grid. */
  nextAttackTime(command: WeaponCommand) {
    const reloadEvent = this.reload.active ? this.reload.nextEventAt : Infinity;
    if (this.reload.active && this.reload.empty) return reloadEvent;
    const alternate = this.id === 'revolver' && !!(command.secondaryHeld || command.secondaryPressed);
    if (!this.pendingPress && !this.burstLeft && !command.firePressed &&
      !(command.fireHeld && (this.actions.stats.fullAuto || this.id === 'knife')) && !alternate &&
      !(this.id === 'knife' && command.secondaryHeld)) return reloadEvent;
    if (this.ammo <= 0 && this.id !== 'knife' || this.reload.active && !this.reload.stats.reloadsSingleShells) return reloadEvent;
    // A press that finds the weapon ready fires at its own time; anything else waits for the next server tick.
    const due = Math.max(this.nextShotAt, this.actions.readyAt, this.actions.chargeReadyAt, this.reload.attackReadyAt);
    return Math.min(reloadEvent, command.firePressed ? due : tickAligned(due));
  }

  advancePassive(time: number, dt: number, crouch = false, airborne = false, deferAccuracy = false) {
    if (this.id === 'zeus') {
      const stats = equipmentStats(this.id);
      this.recovery.penalty = airborne ? stats.stand + stats.jump : crouch ? stats.crouch : stats.stand;
      if (this.rechargeUntil && time + 1e-9 >= this.rechargeUntil) {
        this.ammo = 1; this.rechargeUntil = 0; this.actionEvents.push({kind: 'zeus-ready', at: time});
      }
    } else this.recovery.advance(dt, crouch, airborne, deferAccuracy, time);
  }

  // Main calls this after resolving the knife trace, including misses. It must
  // not let a delayed trace overwrite a newer attack's cooldown.
  resolveMeleeHit(ordinal: number, hit: boolean) {
    const attack = this.lastMelee;
    if (!attack || attack.ordinal !== ordinal) return;
    const cycle = attack.secondary ? (hit ? knifeModel.secondaryHitCycle : knifeModel.secondaryMissCycle)
      : (hit ? knifeModel.primaryHitCycle : knifeModel.primaryMissCycle);
    this.nextShotAt = attack.at + cycle;
    this.firstSlashAfter = this.nextShotAt + knifeModel.firstSlashGrace;
  }

  advance(time: number, dt: number, command: WeaponCommand, actor: {
    position: Vec; yaw: number; pitch: number; velocity: {x: number; z: number};
    feet: number; verticalVelocity: number; duckAmount?: number; duckFlag?: boolean; grounded?: boolean;
    punch?: DamagePunch;
  }): FiredRound | undefined {
    this.actions.advance(time);
    // Capture input priority before a secondary action changes its own deadline.
    const nativeReloadInput = usesNativeReloadInput(this.id);
    const reloadAllowed = !nativeReloadInput || reloadInputAllows(time, this.nextShotAt,
      command.fireHeld || command.firePressed, !!(command.secondaryHeld || command.secondaryPressed),
      this.actions.secondaryReadyAt, this.burstLeft > 0);
    // Shell attacks have a reload-start lock independent of insertion/outro.
    // Magazine completion retains its existing deadline.
    const reloading = this.reload.active;
    const reloadEnd = this.reload.phase === 'finish' || this.reload.phase === 'magazine' ? this.reload.until : time;
    this.reload.advance(time, command.reloadHeld);
    if (reloading && !this.reload.active) this.nextShotAt = Math.max(this.nextShotAt, reloadEnd);
    // Native pending Glock rounds run before secondary input; an eligible
    // primary input also consumes the update before the mode-switch branch.
    const glockPrimaryPriority = this.id === 'glock' && time + 1e-9 >= this.nextShotAt &&
      (command.fireHeld || command.firePressed || this.burstLeft > 0 && this.ammo > 0);
    if ((command.secondaryPressed || this.id === 'glock' && command.secondaryHeld) &&
      !this.reloadUntil && !glockPrimaryPriority) this.actions.secondary(time);
    this.actions.alternateFire = this.id === 'revolver' && !!(command.secondaryHeld || command.secondaryPressed);
    const stats = this.actions.stats;
    this.recovery.setParameters(stats);
    const airborne = !(actor.grounded ?? actor.feet === 0);
    this.advancePassive(time, dt, actor.duckFlag ?? (actor.duckAmount ?? Number(command.crouch)) === 1, airborne, true);
    if (reloading && !this.reload.active && !stats.reloadsSingleShells) this.recovery.reloadFinished();
    try {
    const punch = actor.punch?.shotFor(this.recovery.angle);
    if (this.id === 'knife') {
      const secondary = !!(command.secondaryHeld || command.secondaryPressed);
      if (!(command.fireHeld || command.firePressed || secondary) || time + 1e-9 < this.nextShotAt) return;
      const firstSlash = !secondary && time + 1e-9 >= this.firstSlashAfter;
      this.nextShotAt = time + (secondary ? knifeModel.secondaryMissCycle : knifeModel.primaryMissCycle);
      this.firstSlashAfter = this.nextShotAt + knifeModel.firstSlashGrace;
      this.lastMelee = {ordinal: this.ordinal, at: time, secondary};
      return {origin: {...actor.position}, direction: aimDirection(actor.yaw - (punch?.yaw ?? 0) * DEG,
        actor.pitch + (punch?.pitch ?? 0) * DEG), weapon: this.id, ordinal: this.ordinal++,
        kind: 'melee', attack: secondary ? 'secondary' : 'primary', firstSlash,
        maxDistance: (secondary ? knifeModel.secondaryRangeUnits : knifeModel.primaryRangeUnits) * UNIT};
    }
    if ((command.reloadPressed || nativeReloadInput && command.reloadHeld) &&
      (command.reloadAutomatic || reloadAllowed) && this.reload.start(time, !!command.reloadHeld)) {
      if (!stats.reloadsSingleShells) this.recovery.reloadStarted(!!command.reloadAutomatic);
      this.pendingPress = false;
      this.actions.holster(); this.burstLeft = 0;
      return;
    }
    // Source fires a requested shot only while the trigger is still held when the
    // weapon becomes ready; a tap released during the cycle is dropped, as in the range.
    const triggerHeld = command.fireHeld || this.actions.alternateFire && !!command.secondaryHeld;
    if (command.firePressed || this.actions.alternateFire && command.secondaryPressed) this.pendingPress = true;
    else if (!triggerHeld) {
      this.pendingPress = false;
      this.actions.chargeTrigger(time, false); // an R8 windup released early is cancelled
    }
    if (!this.pendingPress && !this.burstLeft && !(command.fireHeld && stats.fullAuto) && !this.actions.alternateFire) return;
    if (this.reload.active && this.reload.empty) {this.reload.interrupt(); return;}
    if (this.reload.active && (!stats.reloadsSingleShells || this.ammo === 0)) return;
    if (this.ammo === 0) {
      if (this.reload.start(time, !!command.reloadHeld) && !stats.reloadsSingleShells) this.recovery.reloadStarted(true);
      this.pendingPress = false;
      this.actions.holster(); this.burstLeft = 0;
      return;
    }
    const chargedAt = this.actions.chargeTrigger(time, command.fireHeld);
    if (!Number.isFinite(chargedAt)) {this.pendingPress = false; return;}
    // The weapon is due at the latest of its schedule, its deploy and (R8) its windup. A press that finds it ready
    // fires at its own subtick time; a held or queued trigger is processed on the next server tick, and that shot
    // keeps its exact schedule unless it is more than a tick late, like the game's stale next-attack time.
    const due = Math.max(this.nextShotAt, this.actions.readyAt, this.reload.attackReadyAt,
      this.actions.isRevolver && !this.actions.alternateFire ? chargedAt : -Infinity);
    if (time + 1e-9 < (command.firePressed ? due : tickAligned(due))) {
      if (!triggerHeld) this.pendingPress = false;
      return;
    }
    if (this.reload.active && !this.reload.interrupt(time)) return;
    const scheduled = command.firePressed || time - due > SERVER_TICK + 1e-9 ? time : due;
    if (this.actions.burst && !this.burstLeft) {
      this.burstLeft = 3;
      this.burstEnd = scheduled + this.actions.burstCycle;
    }
    const speedRatio = Math.hypot(actor.velocity.x, actor.velocity.z) / (stats.speed * UNIT);
    const processingDelay = Math.max(0, time - scheduled);
    this.recovery.beforeShot(processingDelay);
    const directions = shotDirections({
      yaw: actor.yaw, pitch: actor.pitch, recoil: this.recovery.recoilBefore(processingDelay), punch, weapon: stats,
      recovery: this.recovery, speedRatio, walking: command.walk, airborne,
      verticalSpeedUnits: actor.verticalVelocity / UNIT, spread: this.options.spread !== false,
      weaponId: this.id, alternateFire: this.actions.alternateFire,
      recoilIndex: this.recovery.index, seed: this.ordinal + 1,
    }, stats.pellets, this.random);
    const direction = directions[0];
    if (this.id !== 'zeus') this.recovery.fire(processingDelay);
    this.actions.afterShot(time, scheduled, this.burstLeft);
    this.recovery.setParameters(this.actions.stats);
    this.ammo--;
    if (isPumpShotgun(this.id)) this.pumpUntil = scheduled + stats.cycle;
    if (this.id === 'zeus') {
      this.rechargeUntil = time + ZEUS_RECHARGE_SECONDS;
      this.actionEvents.push({kind: 'zeus-discharge', at: time});
    }
    // The schedule accumulates exactly while the trigger is held; the shot itself lands on the server tick
    // after it (build 2000930 demos: AK sprays alternate 6 and 7 ticks with the last shot time advancing by 0.1 s).
    this.nextShotAt = scheduled + stats.cycle;
    if (this.burstLeft > 0) {
      this.burstLeft--;
      this.nextShotAt = this.burstLeft ? scheduled + this.actions.burstInterval : this.burstEnd;
    }
    this.pendingPress = false;
    return {origin: {...actor.position}, direction, weapon: this.id, ordinal: this.ordinal++,
      ...(this.id !== 'zeus' ? {viewPunch: this.recovery.lastViewPunch} : {}),
      kind: this.id === 'zeus' ? 'zeus' : directions.length > 1 ? 'pellets' : 'bullet',
      attack: this.actions.alternateFire ? 'secondary' : 'primary', maxDistance: stats.range * UNIT,
      ...(directions.length > 1 ? {pelletDirections: directions} : {})};
    } finally {
      this.recovery.setParameters(this.actions.stats);
      this.recovery.finishAccuracy();
    }
  }
}
