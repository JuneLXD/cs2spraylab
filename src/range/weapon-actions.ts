import {gameData} from './config';
import {equipmentStats, weaponModeStats, SILENT_RELOAD_MULTIPLIER, SHELL_RELOAD_START, SHELL_RELOAD_FINISH, type Equipment} from './equipment';
import {ScopeTransition, scopeSensitivity} from './scope-transition';
import {ReloadClock, reloadClip, reloadSilentWindows} from './reload-clock';

// Native postponed-fire initialization adds thirteen 64 Hz ticks to the
// command's tick/ratio pair, preserving its fraction (build 2000930).
// tools/verify-native-fire-readiness.py retains the bounded arithmetic fixture.
export const REVOLVER_WINDUP = 13 / 64;

// Mode-specific values are exported from weapons.vdata, never inferred from class.
export class WeaponActions {
  zoom = 0;
  burst = false;
  alternateFire = false;
  readyAt = 0;
  secondaryReadyAt = 0;
  private readonly scopeTransition: ScopeTransition;
  private resumeZoom = 0;
  private resumeAt = 0;
  private chargedAt?: number;
  readonly base;
  readonly alternate;
  private readonly idleRevolver;
  constructor(readonly id: Equipment) {
    this.scopeTransition = new ScopeTransition(id === 'aug' || id === 'sg553');
    this.base = equipmentStats(id); this.alternate = weaponModeStats(id, true);
    this.idleRevolver = {...this.base, speed:this.alternate.speed};
  }
  get stats() {return this.zoom > 0 || this.burst || this.alternateFire ? this.alternate : this.isRevolver && !this.charging ? this.idleRevolver : this.base;}
  get charging() {return this.chargedAt !== undefined && !this.alternateFire;}
  get chargeReadyAt() {return this.chargedAt ?? 0;}
  get horizontalFov() {return this.zoom && this.id !== 'knife' ? gameData.weapons[this.id].zoomFov[this.zoom - 1] : 90;}
  fovAt(time: number) {return this.scopeTransition.at(time);}
  /** The client scales mouse input by the larger of the current and the target FOV over the default: zooming in
   * follows the transition, zooming out snaps back to full sensitivity the moment it starts (libclient, build 2000930). */
  sensitivityAt(time: number, zoomRatio = 1) {
    return scopeSensitivity(Math.max(this.fovAt(time), this.horizontalFov), zoomRatio);
  }
  get hidesViewmodel() {return this.zoom > 0 && this.id !== 'knife' && gameData.weapons[this.id].hideWhenZoomed;}
  get burstCycle() {return this.id === 'knife' ? 0 : gameData.weapons[this.id].burstCycle;}
  get burstInterval() {return this.id === 'knife' ? 0 : gameData.weapons[this.id].burstInterval;}
  get isRevolver() {return this.id !== 'knife' && gameData.weapons[this.id].isRevolver;}
  get pendingZoom() {return this.resumeZoom > 0;}
  get nextEventAt() {return this.resumeZoom ? this.resumeAt : Infinity;}
  chargeTrigger(time: number, held: boolean) {
    if (!this.isRevolver || this.alternateFire) {this.chargedAt = undefined; return time;}
    if (!held) {this.chargedAt = undefined; return Infinity;}
    return this.chargedAt ??= time + REVOLVER_WINDUP;
  }
  advance(time: number, primaryReadyAt = this.resumeAt, ammo = 1) {
    // AWP postframe checks the current primary deadline before dispatching input.
    // The camera transition starts at that call, even when readiness passed earlier.
    const readyAt = this.id === 'awp' ? primaryReadyAt : this.resumeAt;
    if (this.resumeZoom && time + 1e-9 >= readyAt) {
      if (this.id !== 'awp' || ammo > 0) this.setZoom(this.resumeZoom, this.id === 'awp' ? time : this.resumeAt, .1);
      this.resumeZoom = 0;
    }
  }
  afterShot(time: number, scheduledAt = time, burstShotsLeft = 0) {
    if (this.isRevolver) this.chargedAt = undefined;
    // Glock's native firing helper advances both attack clocks. The final
    // burst round leaves the rest of the burst cycle after two short intervals.
    // Its mode switch changes only the secondary clock (LinkedCooldowns=false).
    if (this.id === 'glock') {
      const cycle = burstShotsLeft > 1 ? this.burstInterval : burstShotsLeft === 1
        ? Math.max(1 / 64, this.burstCycle - 2 * this.burstInterval) : this.stats.cycle;
      this.secondaryReadyAt = Math.max(scheduledAt, this.secondaryReadyAt) + cycle;
    }
    // Native firing advances both attack clocks by the firing cycle. A recent
    // zoom can leave the secondary clock ahead of the primary one.
    if (this.id !== 'knife' && gameData.weapons[this.id].zoomLevels) {
      // The AWP callers already select now for fresh/stale shots and the retained
      // schedule for queued shots. This integrates their existing scheduler;
      // it does not emulate the native command-history context selector.
      const clock = this.id === 'awp' ? scheduledAt : time;
      this.secondaryReadyAt = Math.max(clock, this.secondaryReadyAt) + this.stats.cycle;
    }
    if (this.zoom && this.id !== 'knife' && gameData.weapons[this.id].unzoomsAfterShot) {
      this.resumeZoom = this.zoom; this.resumeAt = (this.id === 'awp' ? scheduledAt : time) + this.stats.cycle;
      this.setZoom(0, time, gameData.weapons[this.id].zoomTime[0]);
    }
  }
  secondary(time: number) {
    if (this.id === 'knife' || time + 1e-9 < Math.max(this.readyAt, this.secondaryReadyAt)) return false;
    const data = gameData.weapons[this.id];
    this.resumeZoom = 0;
    if (data.zoomLevels) {
      const zoom = (this.zoom + 1) % (data.zoomLevels + 1);
      // AUG/SG use the reciprocal of their native iron-sight pull-up/down
      // speeds (10/8), confirmed by the live CameraServices FOV-rate fields.
      const duration = this.id === 'aug' || this.id === 'sg553' ? zoom ? .1 : .125 : data.zoomTime[zoom];
      this.setZoom(zoom, time, duration, zoom === 0 && data.zoomLevels > 1);
      this.secondaryReadyAt = time + .3;
      return true;
    }
    if (data.hasBurst) {
      this.burst = !this.burst;
      if (this.id === 'glock') this.secondaryReadyAt = time + .3;
      else this.readyAt = time + .3;
      return true;
    }
    return false;
  }
  private setZoom(zoom: number, time: number, duration: number, manualSniperUnzoom = false) {
    this.zoom = zoom; this.scopeTransition.to(this.horizontalFov, time, duration, manualSniperUnzoom);
  }
  holster() {
    this.zoom = 0; this.resumeZoom = 0; this.alternateFire = false;
    this.readyAt = this.secondaryReadyAt = 0; this.chargedAt = undefined; this.scopeTransition.reset();
  }
}

export const scopeVerticalFov = (horizontalFov: number) => 2 * Math.atan(Math.tan(horizontalFov * Math.PI / 360) / (4 / 3)) * 180 / Math.PI;

export type ReloadPhase = 'idle' | 'magazine' | 'start' | 'shell' | 'finish';
export type ReloadActionEvent = {kind: 'reload-start' | 'reload-shell' | 'reload-end' | 'reload-cancel' | 'reload-mode';
  at: number; silent: boolean; phase: ReloadPhase; ammo: number; reserve: number};

/** Ammo changes only on completed insert phases; cancellation cannot mint ammo. */
export class NativeReloadState {
  ammo: number;
  reserve: number;
  phase: ReloadPhase = 'idle';
  empty = false;
  startedAt = 0;
  private readonly clock: ReloadClock;
  private magazineInserted = false;
  private events: ReloadActionEvent[] = [];
  readonly stats;
  constructor(readonly id: Equipment, readonly silentMultiplier = SILENT_RELOAD_MULTIPLIER) {
    if (!Number.isFinite(silentMultiplier) || silentMultiplier < 1) throw new Error('Invalid silent reload multiplier');
    this.clock = new ReloadClock(1 / silentMultiplier);
    this.stats = equipmentStats(id);
    this.ammo = this.stats.magazine; this.reserve = this.stats.reserve;
  }
  get active() {return this.phase !== 'idle';}
  /** stats.reload is exported m_flDisallowAttackAfterReloadStartDuration.
   * Native action start uses this absolute lock independently of phase playback;
   * it is not inferred from the trainer's estimated shell-insertion duration. */
  get attackReadyAt() {return this.active ? this.startedAt + this.stats.reload : 0;}
  get phaseDuration() {return this.phase === 'idle' ? 0 : this.phase === 'start' ? SHELL_RELOAD_START
    : this.phase === 'finish' ? SHELL_RELOAD_FINISH : this.stats.reload;}
  get silent() {return this.active && this.clock.silent;}
  get progress() {return this.phaseDuration ? Math.max(0, Math.min(1, this.clock.position / this.phaseDuration)) : 0;}
  get until() {return this.active ? this.clock.at(this.phaseDuration) : 0;}
  get nextEventAt() {
    if (!this.active) return 0;
    const work = this.phase === 'magazine' && !this.magazineInserted ? this.insertAt : this.phaseDuration;
    return Math.min(this.clock.nextBoundary, this.clock.at(work));
  }
  private get insertAt() {return Math.min(this.stats.reload, reloadClip(this.id, this.empty)?.insert ?? this.stats.reload);}
  private windows() {return reloadSilentWindows(this.id, this.empty, this.phase, this.phaseDuration);}
  start(time: number, held = false) {
    if (this.active || this.id === 'knife' || this.id === 'zeus' || this.ammo >= this.stats.magazine || this.reserve <= 0) return false;
    this.empty = this.ammo === 0; this.startedAt = time;
    this.phase = this.stats.reloadsSingleShells ? 'start' : 'magazine';
    this.clock.reset(time, held, this.windows()); this.magazineInserted = false;
    this.emit('reload-start', time);
    return true;
  }
  advance(time: number, reloadHeld?: boolean) {
    if (!Number.isFinite(time) || time < this.clock.now) return;
    while (this.active && this.clock.now < time - 1e-9) {
      const at = Math.min(time, this.nextEventAt), silent = this.silent;
      this.clock.advance(at);
      if (silent !== this.silent) this.emit('reload-mode', at);
      if (this.phase === 'magazine' && !this.magazineInserted && this.clock.position + 1e-9 >= this.insertAt) {
        if (this.id !== 'knife' && gameData.weapons[this.id].reserveAsClips) {
          // Native clip reserves discard the partial magazine. Internally the
          // trainer stores spare rounds, including partial saved reserves.
          this.ammo = Math.min(this.stats.magazine, this.reserve); this.reserve -= this.ammo;
        } else {
          const inserted = Math.min(this.stats.magazine - this.ammo, this.reserve);
          this.ammo += inserted; this.reserve -= inserted;
        }
        this.magazineInserted = true;
      }
      if (this.clock.position + 1e-9 >= this.phaseDuration) {
        if (this.phase === 'magazine' || this.phase === 'finish') {this.emit('reload-end', at); this.cancel(false);}
        else {
          if (this.phase === 'shell') {this.ammo++; this.reserve--; this.emit('reload-shell', at);}
          this.phase = this.ammo >= this.stats.magazine || this.reserve <= 0 ? 'finish' : 'shell';
          const wasSilent = this.silent;
          this.clock.phase(this.windows());
          if (wasSilent !== this.silent) this.emit('reload-mode', at);
        }
      }
    }
    // New input applies at its timestamp, after preceding work is integrated.
    if (reloadHeld !== undefined && this.active) {
      const silent = this.silent; this.clock.setHeld(reloadHeld);
      if (silent !== this.silent) this.emit('reload-mode', time);
    }
  }
  interrupt(time = this.clock.now) {
    if (!this.active || !this.stats.reloadsSingleShells || this.ammo <= 0) return false;
    if (this.empty) {
      // Preserve the existing empty-start approximation until insertion/event
      // ordering and the native empty-fire retry clock are measured together.
      if (this.phase !== 'finish') {
        this.phase = 'finish'; const silent = this.silent; this.clock.phase(this.windows());
        if (silent !== this.silent) this.emit('reload-mode', this.clock.now);
      }
    } else {
      if (time + 1e-9 < this.attackReadyAt) return false;
      this.cancel();
    }
    return true;
  }
  cancel(notify = true) {
    if (this.active && notify) this.emit('reload-cancel', this.clock.now);
    this.phase = 'idle';
  }
  drainActionEvents() {const events = this.events; this.events = []; return events;}
  private emit(kind: ReloadActionEvent['kind'], at: number) {
    this.events.push({kind, at, silent: this.silent, phase: this.phase, ammo: this.ammo, reserve: this.reserve});
  }
}
