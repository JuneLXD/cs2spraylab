import {SERVER_TICK, UNIT, type ActorKinematics, type MoveInput} from './actor-physics';

type StepSample = {speed: number; grounded: boolean; walking: boolean; ducked: boolean};

/** Current native normal-movement footstep countdown (milliseconds).
 * See docs/reaudit-footsteps.md and the machine-code oracle fixture.
 * Material routing, ladders, water and separate jump/landing sounds are external.
 */
export class FootstepCadence {
  remainingMs = 300;
  private segment?: {start: number; key: string; sample: StepSample};

  reset() { this.remainingMs = 300; this.segment = undefined; }

  /** Native movement commands contain one 64 Hz interval plus input-edge splits.
   * Its footstep hook samples velocity/stance before the command moves the pawn.
   * Keep the trainer's 128 Hz physics subdivisions out of the sound clock.
   */
  update(time: number, dt: number, actor: ActorKinematics, input: MoveInput) {
    const start = time - dt, epsilon = 1e-9;
    const key = `${input.forward}/${input.side}/${input.walk}/${input.crouch}/${input.jump}/${actor.yaw}`;
    const sample: StepSample = {speed: Math.hypot(actor.velocity.x, actor.velocity.z, actor.verticalVelocity) / UNIT,
      grounded: actor.grounded ?? actor.feet === 0, walking: input.walk, ducked: (actor.duckAmount ?? 0) === 1};
    const process = (until: number) => {
      const segment = this.segment!;
      const s = segment.sample;
      return this.advance(Math.max(0, until - segment.start), s.speed, s.grounded, s.walking, s.ducked);
    };
    let emitted = false;
    if (this.segment && this.segment.key !== key) {
      if (start > this.segment.start + epsilon) emitted = process(start);
      this.segment = undefined;
    }
    this.segment ??= {start, key, sample};
    for (let boundary = (Math.floor((start + epsilon) / SERVER_TICK) + 1) * SERVER_TICK;
      boundary <= time + epsilon; boundary += SERVER_TICK) {
      const fired = process(boundary); emitted = fired || emitted;
      this.segment = {start: boundary, key, sample};
    }
    if (Math.abs(this.segment.start - time) < epsilon) this.segment = undefined;
    return emitted;
  }

  advance(dt: number, speedUnits: number, grounded: boolean, walking: boolean, ducked: boolean) {
    if (walking || speedUnits < 135.2) {
      // Slow movement preserves the clock; coming to rest restarts it.
      if (speedUnits * speedUnits < 10) this.remainingMs = 300 + (ducked ? 100 : 0);
      return false;
    }
    // Native frame time, millisecond multiplication and countdown storage are floats.
    const elapsedMs = Math.fround(Math.fround(dt) * 1000);
    this.remainingMs = Math.max(0, Math.fround(Math.fround(this.remainingMs) - elapsedMs));
    if (this.remainingMs > 0 || !grounded) return false;
    this.remainingMs = (speedUnits < 220 ? 400 : 300) + (ducked ? 100 : 0);
    return true;
  }
}
