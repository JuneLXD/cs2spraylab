import timing from './native-reload-timing.json';
import presentation from './native-reload-presentation.json';

type Window = {start: number; end: number};
type Clip = {duration: number; insert?: number; silent: Window[]};
const weapons = timing.weapons as Record<string, {normal: Clip; empty?: Clip}>;
const EPS = 1e-9;
export const reloadGate = timing.gate;
export function reloadClip(id: string, empty: boolean) {
  const clips = weapons[id];
  return empty ? clips?.empty ?? clips?.normal : clips?.normal;
}

export function reloadSilentWindows(id: string, empty: boolean, phase: string, duration: number): Window[] {
  const clip = reloadClip(id, empty);
  if (!clip) return [];
  if (phase === 'magazine') return clip.silent;
  // Shell gameplay phase durations remain estimates. Map the authored section
  // into those phases, as the first-person animation already does.
  const segments = presentation.weapons as Record<string, Record<string, {start: number; duration: number}>>;
  const segment = segments[id]?.[phase === 'start' ? 'intro' : phase === 'shell' ? 'loop' : 'outro'];
  if (!segment) return [];
  return clip.silent.map(window => ({start: Math.max(0, (window.start - segment.start) / segment.duration * duration),
    end: (window.end - segment.start) / segment.duration * duration}))
    .filter(window => window.end > window.start);
}

/** Native hold gate; position is animation work, now is simulation time. */
export class ReloadClock {
  now = 0;
  position = 0;
  rate = 1;
  silent = false;
  private eligible = false;
  private holdStart?: number;
  private windows: Window[] = [];
  constructor(private slowRate: number) {}
  reset(now: number, held: boolean, windows: Window[]) {
    this.now = now; this.rate = 1; this.silent = false;
    this.eligible = held; this.holdStart = undefined; this.phase(windows);
  }
  phase(windows: Window[]) {this.position = 0; this.windows = windows; this.refresh();}
  setHeld(held: boolean) {
    // A release disqualifies this reload, including later presses of R.
    if (!held) this.eligible = false;
    this.refresh();
  }
  private refresh() {
    const inside = this.eligible && this.windows.some(w => this.position + EPS >= w.start && this.position < w.end - EPS);
    if (inside) {
      this.holdStart ??= this.now;
      if (this.now + EPS >= this.holdStart + reloadGate.holdDelay) {this.silent = true; this.rate = this.slowRate;}
    } else {
      this.holdStart = undefined;
      if (this.silent) this.rate = reloadGate.releasedRate;
      this.silent = false;
    }
  }
  get nextBoundary() {
    if (!this.eligible) return Infinity;
    let next = this.holdStart !== undefined && !this.silent ? this.holdStart + reloadGate.holdDelay : Infinity;
    for (const window of this.windows) {
      if (window.start > this.position + EPS) next = Math.min(next, this.now + (window.start - this.position) / this.rate);
      if (window.end > this.position + EPS) next = Math.min(next, this.now + (window.end - this.position) / this.rate);
    }
    return next;
  }
  /** Caller splits at nextBoundary so changes cannot affect preceding work. */
  advance(time: number) {
    this.position += Math.max(0, time - this.now) * this.rate;
    this.now = Math.max(this.now, time); this.refresh();
  }
  /** Future deadline if the current held input persists; does not mutate state. */
  at(target: number) {
    let position = this.position, now = this.now, rate = this.rate;
    if (target <= position) return now;
    if (this.eligible) for (const window of this.windows) {
      if (window.end <= position + EPS || window.start >= target) continue;
      if (position < window.start) {now += (window.start - position) / rate; position = window.start;}
      const end = Math.min(target, window.end);
      const alreadySilent = this.silent && position === this.position;
      const waited = this.holdStart !== undefined && position === this.position ? this.now - this.holdStart : 0;
      const normalWork = alreadySilent ? 0 : Math.min(end - position, Math.max(0, reloadGate.holdDelay - waited) * rate);
      position += normalWork; now += normalWork / rate;
      const slowed = alreadySilent || position < end - EPS;
      if (position < end - EPS) {rate = this.slowRate; now += (end - position) / rate; position = end;}
      if (position >= window.end - EPS && slowed) rate = reloadGate.releasedRate;
      if (position >= target - EPS) return now;
    }
    return now + (target - position) / rate;
  }
}
