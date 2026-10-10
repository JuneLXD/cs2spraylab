import {advanceActor, type ActorEnvironment, type ActorKinematics, type MoveInput,
  type ResolveMove, type CanOccupy, type ResolveVertical} from './actor-physics';
import {groundFrictionAt, nextGroundFrictionBoundary} from './ground-friction';
import {TERRAIN_RULES} from './terrain';

type Pose = Omit<ActorKinematics, 'groundCommand'>;
export type GroundCommand = {
  origin: Pose;
  input: MoveInput;
  speed: number;
  start: number;
  end: number;
  published: Pose;
  contacts: string;
};
const EPSILON = 1e-10;
const keys = ['position', 'velocity', 'yaw', 'feet', 'verticalVelocity', 'eyeHeight', 'duckAmount', 'duckFlag',
  'duckViewOffset', 'duckRootOffset', 'duckSpeed', 'crouchHeld', 'duckCooldown', 'duckRecoveryOrigin',
  'jumpHeld', 'grounded', 'velocityModifier', 'movementTime', 'friction', 'lastJumpPressTime',
  'pendingJumpPressTime', 'landedAt', 'landingVelocity', 'landingVelocityXY', 'supportId', 'moveMode',
  'waterLevel', 'ladderDetached'] as const satisfies readonly (keyof Pose)[];

/** Copy only kinematics, never a Simulation, weapon, or another checkpoint. */
function snapshot(actor: ActorKinematics): Pose {
  const pose = Object.fromEntries(keys.map(key => [key, actor[key]])) as Pose;
  pose.position = {...actor.position}; pose.velocity = {...actor.velocity};
  return pose;
}

function unchanged(actor: ActorKinematics, published: Pose) {
  return actor.position.x === published.position.x && actor.position.y === published.position.y &&
    actor.position.z === published.position.z && actor.velocity.x === published.velocity.x &&
    actor.velocity.z === published.velocity.z && actor.feet === published.feet &&
    actor.verticalVelocity === published.verticalVelocity && actor.grounded === published.grounded &&
    actor.duckAmount === published.duckAmount && actor.duckFlag === published.duckFlag &&
    actor.velocityModifier === published.velocityModifier && actor.supportId === published.supportId &&
    actor.moveMode === published.moveMode && actor.waterLevel === published.waterLevel &&
    actor.landedAt === published.landedAt && actor.landingVelocity === published.landingVelocity &&
    actor.friction === published.friction;
}

function sameInput(actor: ActorKinematics, input: MoveInput, segment: GroundCommand) {
  return actor.yaw === segment.origin.yaw && input.forward === segment.input.forward &&
    input.side === segment.input.side && input.walk === segment.input.walk &&
    input.crouch === segment.input.crouch && input.jump === segment.input.jump && !input.jumpPressed;
}

function ordinary(actor: ActorKinematics, input: MoveInput) {
  const duck = actor.duckAmount ?? 0;
  return actor.grounded !== false && actor.verticalVelocity === 0 && actor.supportId === undefined &&
    (!actor.moveMode || actor.moveMode === 'ground') && !actor.waterLevel &&
    !input.jump && !input.jumpPressed && (duck === 0 || duck === 1) &&
    input.crouch === (duck === 1);
}

// Save values, not live bodies (which also own weapons and simulation state).
// Only geometry reachable within this command can invalidate its prediction.
function contacts(environment: ActorEnvironment | undefined, origin: Pose, speed: number) {
  if (!environment) return '';
  const reach = TERRAIN_RULES.hullRadius + Math.max(speed, Math.hypot(origin.velocity.x, origin.velocity.z)) / 64;
  const {x, z} = origin.position;
  const bounds = environment.bounds;
  return JSON.stringify([environment.floor, bounds && [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ],
    environment.solids.filter(s => Math.abs(s.center.x - x) <= s.size.x / 2 + reach &&
      Math.abs(s.center.z - z) <= s.size.z / 2 + reach)
      .map(s => [s.id, s.center.x, s.center.y, s.center.z, s.size.x, s.size.y, s.size.z, s.traversal]),
    environment.actors?.filter(a => a.id !== environment.selfId && a.alive !== false &&
      Math.abs(a.position.x - x) <= TERRAIN_RULES.hullRadius + reach &&
      Math.abs(a.position.z - z) <= TERRAIN_RULES.hullRadius + reach)
      .map(a => [a.id, a.position.x, a.position.z, a.feet, a.duckAmount, a.height, a.grounded])]);
}

/** Keep native ground segments independent of frame/weapon update frequency.
 * Partial outputs are immutable predictions from one bounded checkpoint.
 * Real input edges close a segment; cap changes are sampled at its next start.
 * Air, stance transitions and moving supports retain their existing solver.
 * Collision callbacks must be pure: predictions can evaluate them repeatedly. */
export function advanceActorCommand(actor: ActorKinematics, input: MoveInput, speed: number, dt: number,
  resolve?: ResolveMove, canOccupy?: CanOccupy, vertical?: ResolveVertical,
  environment?: ActorEnvironment): ActorKinematics {
  if (dt <= 0 || !Number.isFinite(dt)) return {...snapshot(actor), groundCommand: actor.groundCommand};
  let time = environment?.time ?? actor.movementTime ?? 0;
  const until = time + dt;
  let current = actor;
  let segment = actor.groundCommand;
  if (segment && (Math.abs((segment.published.movementTime ?? time) - time) > EPSILON ||
      !unchanged(actor, segment.published) || contacts(environment, segment.origin, segment.speed) !== segment.contacts)) segment = undefined;
  const advance = (pose: Pose, command: MoveInput, cap: number, duration: number, start: number, preview = false) =>
    advanceActor({...pose, movementTime: start}, command, cap, duration, resolve, canOccupy, vertical,
      environment && {...environment, time: start}, !preview);

  // A real input edge finalizes the elapsed old-input interval, not its preview.
  if (segment && !sameInput(actor, input, segment)) {
    current = advance(segment.origin, segment.input, segment.speed, time - segment.start, segment.start);
    current.yaw = actor.yaw;
    segment = undefined;
  }
  while (time < until - EPSILON) {
    if (!ordinary(current, input)) {
      const next = advance(snapshot(current), input, speed, until - time, time);
      return {...next, groundCommand: undefined};
    }
    if (!segment) {
      const origin = snapshot(current);
      origin.movementTime = time;
      const clock = groundFrictionAt(origin.friction, time);
      segment = {origin, input: {...input}, speed, start: time,
        end: nextGroundFrictionBoundary(clock, time), published: origin, contacts: contacts(environment, origin, speed)};
    }
    const end = Math.min(until, segment.end);
    const complete = end >= segment.end - EPSILON;
    const next = advance(segment.origin, segment.input, segment.speed, end - segment.start, segment.start, !complete);
    time = end;
    if (complete || !ordinary(next, input)) {
      current = {...next, groundCommand: undefined};
      segment = undefined;
    } else {
      // The native gate belongs to the completed segment. A preview must not
      // reinterpret its shorter duration as another native stop decision.
      const endpoint = advance(segment.origin, segment.input, segment.speed,
        segment.end - segment.start, segment.start);
      if (endpoint.velocity.x === 0 && endpoint.velocity.z === 0 &&
          endpoint.position.x === segment.origin.position.x && endpoint.position.z === segment.origin.position.z) {
        next.velocity = {...endpoint.velocity};
        next.position = {...next.position, x: endpoint.position.x, z: endpoint.position.z};
      }
      current = {...next, groundCommand: {...segment, published: snapshot(next)}};
      segment = current.groundCommand;
    }
  }
  return current;
}
