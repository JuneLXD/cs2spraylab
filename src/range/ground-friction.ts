/** Current Linux movement primitives, in native units (u/s), for ordinary ground.
 * Command/segment scheduling and processed wish-vector construction belong to
 * the caller. See docs/reaudit-ground-friction.md for the supplied-state proof. */
const f32 = Math.fround;

export type HorizontalVelocity = {x: number; z: number};
export type GroundFriction = {
  active: boolean;
  savedFraction: number;
  storedSpeed: number;
  commandMarked: boolean;
  previousWish: HorizontalVelocity;
};

export const initialGroundFriction = (): GroundFriction => ({
  active: false, savedFraction: 0, storedSpeed: 0, commandMarked: false,
  previousWish: {x: 0, z: 0},
});

/** Native 20-bit speed quantizer, including the separately encoded exact zero.
 * Ordinary finite movement speeds fit within the native [-16384, 16384] grid. */
export function quantizedGroundSpeed(speed: number) {
  speed = f32(speed);
  if (speed === 0) return 0;
  const encoded = Math.trunc(f32(speed + 16384) * (1048575 / 32768) + .5);
  return Math.min(16384, f32(-16384 + encoded * (1 / 1048575) * 32768));
}

export function horizontalSpeed(velocity: HorizontalVelocity) {
  const x = f32(velocity.x), z = f32(velocity.z);
  return f32(Math.sqrt(f32(f32(x * x) + f32(z * z))));
}

/** Select the friction control speed before the native Friction call.
 * The old active flag must survive the clear at the saved fraction. */
export function selectGroundFriction(
  previous: GroundFriction, velocity: HorizontalVelocity,
  wish: HorizontalVelocity, startFraction: number,
): {state: GroundFriction; controlSpeed: number} {
  const state = {...previous};
  const wasActive = state.active;
  startFraction = f32(startFraction);
  if (!wasActive || state.savedFraction === startFraction) {
    state.active = false;
    const quantized = quantizedGroundSpeed(horizontalSpeed(velocity));
    if (state.previousWish.x !== f32(wish.x) || state.previousWish.z !== f32(wish.z) ||
        wasActive && quantized !== state.storedSpeed) {
      state.active = true;
      state.savedFraction = startFraction;
      state.storedSpeed = quantized;
      state.commandMarked = true;
    }
  }
  return {state, controlSpeed: state.active ? state.storedSpeed : quantizedGroundSpeed(horizontalSpeed(velocity))};
}

/** Dry stationary ground, owner/surface factors 1, sv_friction 5.2 and stopspeed 80.
 * This is the endpoint velocity; movement's pre/post helpers handle midpoint
 * displacement separately. It does not include acceleration or collision. */
export function groundFrictionVelocity(velocity: HorizontalVelocity, controlSpeed: number, dt: number): HorizontalVelocity {
  return groundFrictionStep(velocity, controlSpeed, dt).velocity;
}

/** Friction also accumulates acceleration work independently of its rounded
 * endpoint. Recovering this work by subtracting endpoints loses native bits. */
export function groundFrictionStep(velocity: HorizontalVelocity, controlSpeed: number, dt: number) {
  const x = f32(velocity.x), z = f32(velocity.z);
  const magnitude = horizontalSpeed({x, z});
  if (controlSpeed < f32(.1) || dt <= 0) {
    return {velocity: {x, z}, acceleration: {x: 0, z: 0}, overshoot: 0};
  }
  dt = f32(dt);
  const rate = f32(Math.max(controlSpeed, 80) * f32(5.2));
  const drop = f32(rate * dt);
  // A live cache can still request braking after the velocity reached zero.
  // Native Friction passes that entire unused drop to Accelerate.
  if (magnitude <= 0) return {velocity: {x, z}, acceleration: {x: 0, z: 0}, overshoot: drop};
  const workRate = drop > magnitude ? f32(magnitude / dt) : rate;
  const reciprocal = magnitude > f32(1e-17) ? f32(1 / magnitude) : 0;
  const acceleration = {x: f32(0 - f32(workRate * f32(x * reciprocal))),
    z: f32(0 - f32(workRate * f32(z * reciprocal)))};
  const retained = f32(Math.max(0, f32(magnitude - drop)) / magnitude);
  return {velocity: {x: f32(x * retained), z: f32(z * retained)}, acceleration,
    overshoot: Math.max(0, f32(drop - magnitude))};
}

type MotionVector = {x: number; y: number; z: number};

export type GroundStance = {weaponSpeed: number; ducking: boolean; walking: boolean; scopedSlow?: boolean};

/** Native horizontal Accelerate arithmetic, using processed wish components
 * and speeds in u/s. Stance selection remains the caller's responsibility. */
export function accelerateGroundMotion(velocity: HorizontalVelocity, acceleration: HorizontalVelocity,
  wish: HorizontalVelocity, cap: number, dt: number, overshoot: number, stance: GroundStance) {
  const length = horizontalSpeed(wish);
  if (length === 0 || dt <= 0) return {velocity: {...velocity}, acceleration: {...acceleration}};
  const inverse = f32(1 / length);
  const direction = {x: f32(f32(wish.x) * inverse), z: f32(f32(wish.z) * inverse)};
  const current = f32(f32(f32(direction.z * velocity.z) + 0) + f32(direction.x * velocity.x));
  const wishSpeed = Math.min(f32(cap), length), remaining = f32(wishSpeed - current);
  if (remaining <= 0) return {velocity: {...velocity}, acceleration: {...acceleration}};
  const base = Math.max(250, wishSpeed), weaponScale = Math.min(1, f32(f32(stance.weaponSpeed) / 250));
  const scale = stance.ducking ? Math.min(.34, weaponScale)
    : stance.walking && !stance.scopedSlow ? .52 : weaponScale;
  const accelerationSpeed = f32(f32(scale) * base);
  let coefficient = f32(5.5);
  if (stance.walking && !stance.ducking) {
    const walkCap = f32(f32(weaponScale * base) * f32(.52)), lower = f32(walkCap - 5);
    if (Math.max(0, current) > lower) {
      const taper = f32(1 - f32(f32(Math.max(0, current) - lower) / f32(walkCap - lower)));
      coefficient = f32(Math.max(0, Math.min(1, taper)) * coefficient);
    }
  }
  dt = f32(dt);
  let rate = f32(f32(accelerationSpeed * coefficient) - f32(overshoot / dt));
  if (rate <= 0) return {velocity: {...velocity}, acceleration: {...acceleration}};
  let amount = f32(dt * rate);
  if (amount > remaining) {amount = remaining; rate = f32(remaining / dt);}
  return {velocity: {x: f32(velocity.x + f32(direction.x * amount)), z: f32(velocity.z + f32(direction.z * amount))},
    acceleration: {x: f32(acceleration.x + f32(direction.x * rate)), z: f32(acceleration.z + f32(direction.z * rate))}};
}

/** Native final ground cap also contributes to acceleration work. */
export function capGroundMotion(velocity: HorizontalVelocity, acceleration: HorizontalVelocity, cap: number, dt: number) {
  const magnitudeSquared = f32(f32(velocity.x * velocity.x) + f32(velocity.z * velocity.z));
  cap = f32(cap);
  if (magnitudeSquared <= f32(cap * cap)) return {velocity: {...velocity}, acceleration: {...acceleration}};
  const ratio = f32(cap / f32(Math.sqrt(magnitudeSquared)));
  const next = {x: f32(velocity.x * ratio), z: f32(velocity.z * ratio)};
  const inverse = dt > 0 ? f32(1 / f32(dt)) : 0;
  return {velocity: next, acceleration: {x: f32(acceleration.x + f32(f32(next.x - velocity.x) * inverse)),
    z: f32(acceleration.z + f32(f32(next.z - velocity.z) * inverse))}};
}

/** WalkMove's strict projected-speed gate, in native units. The trainer's z
 * is native horizontal y; trainer y is native vertical z. */
export function groundStopGate(midpoint: MotionVector, acceleration: MotionVector, dt: number) {
  const remaining = f32(1 / 64 - f32(.5 * f32(dt)));
  const x = f32(f32(f32(acceleration.x) * remaining) + f32(midpoint.x));
  const z = f32(f32(f32(acceleration.z) * remaining) + f32(midpoint.z));
  const y = f32(f32(f32(acceleration.y) * remaining) + f32(midpoint.y));
  return f32(Math.sqrt(f32(f32(f32(z * z) + f32(y * y)) + f32(x * x)))) < 1;
}

/** Native pre-move helper and stop gate, with zero external/base velocity.
 * The post-move helper adds deferred velocity after collision. */
export function prepareGroundMotion(endpoint: HorizontalVelocity, acceleration: HorizontalVelocity, dt: number, finalize = true) {
  const deferred = {x: f32(f32(acceleration.x * f32(dt)) * .5),
    z: f32(f32(acceleration.z * f32(dt)) * .5)};
  const movement = {x: f32(f32(endpoint.x) - deferred.x), z: f32(f32(endpoint.z) - deferred.z)};
  const stopped = finalize && groundStopGate({...movement, y: 0}, {...acceleration, y: 0}, dt);
  return stopped ? {movement: {x: 0, z: 0}, deferred: {x: 0, z: 0}, stopped}
    : {movement, deferred, stopped};
}

export const beginGroundFrictionCommand = (state: GroundFriction): GroundFriction => ({...state, commandMarked: false});
export const finishGroundFrictionSegment = (state: GroundFriction, wish: HorizontalVelocity): GroundFriction =>
  ({...state, previousWish: {x: f32(wish.x), z: f32(wish.z)}});
export const finishGroundFrictionCommand = (state: GroundFriction): GroundFriction => ({...state, active: state.commandMarked});

/** Adapter for the trainer's absolute movement clock. Native cache fractions
 * belong to a command, independently of the trainer's 128 Hz subdivisions. */
export type ActorFriction = {command: number; state: GroundFriction};
const COMMAND_SECONDS = 1 / 64;
const CLOCK_EPSILON = 1e-10;

export function groundFrictionAt(previous: ActorFriction | undefined, time: number): ActorFriction {
  const command = Math.floor((time + CLOCK_EPSILON) / COMMAND_SECONDS);
  if (previous?.command === command) return previous;
  const state = previous && previous.command < command
    ? finishGroundFrictionCommand(previous.state) : initialGroundFriction();
  return {command, state: beginGroundFrictionCommand(state)};
}

export function groundFrictionFraction(clock: ActorFriction, time: number) {
  return f32(Math.max(0, Math.min(1, time / COMMAND_SECONDS - clock.command)));
}

export function nextGroundFrictionBoundary(clock: ActorFriction, time: number) {
  const end = (clock.command + 1) * COMMAND_SECONDS;
  const fraction = clock.state.savedFraction;
  const saved = (clock.command + fraction) * COMMAND_SECONDS;
  return clock.state.active && fraction > 0 && fraction < 1 && saved > time + CLOCK_EPSILON ? saved : end;
}

export function finishActorFriction(clock: ActorFriction, wish: HorizontalVelocity, endTime: number): ActorFriction {
  let state = finishGroundFrictionSegment(clock.state, wish);
  if (endTime >= (clock.command + 1) * COMMAND_SECONDS - CLOCK_EPSILON) state = finishGroundFrictionCommand(state);
  return {command: clock.command, state};
}
