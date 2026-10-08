/** One monotonic clock shared by DOM input and rendering. rAF timestamps can
 * precede input already delivered in the same frame; never count that time twice. */
export class InputClock {
  private last?: number;

  reset(now?: number) { this.last = now; }

  advance(timestamp: number, advance: (seconds: number) => void) {
    if (!Number.isFinite(timestamp)) return;
    if (this.last === undefined) { this.last = timestamp; return; }
    if (timestamp <= this.last) return;
    const seconds = Math.min((timestamp - this.last) / 1000, .25);
    this.last = timestamp;
    advance(seconds);
  }
}

/** Modern DOM events share performance.now()'s origin. Fall back for synthetic
 * events and legacy epoch timestamps, and reject future timestamps. */
export function inputTimestamp(timestamp: number, now = performance.now()) {
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now && now - timestamp < 1000 ? timestamp : now;
}
