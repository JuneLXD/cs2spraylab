/** Build 2000927 CameraServices FOV interpolation; verified against the
 * installed client's arithmetic and a native slow-motion capture. */
export function interpolateScopeFov(start: number, target: number, elapsed: number, duration: number) {
  if (duration <= 0) return target;
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return start + (target - start) * t * t * (3 - 2 * t);
}

export function scopeSensitivity(fov: number, zoomRatio = 1) {
  // Native player sensitivity uses max(trunc(current float FOV), 10), while
  // the rendered camera retains its fractional FOV throughout the transition.
  const degrees = Math.max(10, Math.trunc(Math.fround(fov)));
  return degrees === 90 ? 1 : degrees / 90 * zoomRatio;
}

/** Native iron sights advance a linear amount, then apply Bias(amount, .2).
 * The same amount runs backward on scope-out, so the two curves differ. */
export function ironSightFov(amount: number, scopedFov: number) {
  const t = Math.max(0, Math.min(1, amount));
  return 90 + (scopedFov - 90) * t / (4 - 3 * t);
}

export class ScopeTransition {
  private start = 90;
  private target = 90;
  private began = 0;
  private duration = 0;
  constructor(private readonly ironSight = false) {}
  at(time: number) {
    if (this.ironSight && this.duration > 0) {
      const t = Math.max(0, Math.min(1, (time - this.began) / this.duration));
      return this.target < 90 ? ironSightFov(t, this.target) : ironSightFov(1 - t, this.start);
    }
    return interpolateScopeFov(this.start, this.target, time - this.began, this.duration);
  }
  to(target: number, time: number, duration: number, manualSniperUnzoom = false) {
    // Native m_iFOVStart is an integer, including when a shot interrupts zoom.
    this.start = Math.trunc(Math.fround(this.at(time)));
    // The sniper's manual scope-out first advances 70% toward the default FOV.
    // Shot-triggered unzoom and rifle iron sights do not take this branch.
    if (manualSniperUnzoom) this.start += Math.trunc(Math.fround((target - this.start) * Math.fround(.7)));
    this.target = target; this.began = time; this.duration = duration;
  }
  reset() {this.start = this.target = 90; this.began = this.duration = 0;}
}
