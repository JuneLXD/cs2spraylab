import {fitsTerrain, moveOnTerrain, clipContactVelocity, verticalContact} from './actor-collision';
import {actorContactSolids, actorHull, supportDisplacement, resizeSupportedStack, type ContactActor} from './actor-contact';
import {TERRAIN_RULES, CONTACT_EPSILON, ladderAt, waterLevel, normalize, dot, add, scale, subtract,
  type ContactId, type TerrainSolid, type TerrainWorld} from './terrain';
import {acceptedJumpPress, isBhopPress, jumpLandingFactor, groundLandingFactor, ballisticContactTime, type JumpRules} from './actor-jump';
import {groundFrictionAt, groundFrictionFraction, nextGroundFrictionBoundary, finishActorFriction,
  selectGroundFriction, groundFrictionStep, accelerateGroundMotion, capGroundMotion, prepareGroundMotion,
  type ActorFriction} from './ground-friction';

export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const STEP = 1 / 128;
/** CS2's server tick. A held trigger's shots are processed on tick boundaries while their schedule stays exact. */
export const SERVER_TICK = 1 / 64;
/** The first server tick boundary at or after `time`. */
export const tickAligned = (time: number) => Math.ceil(time / SERVER_TICK - 1e-7) * SERVER_TICK;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
// Native modern standing launches subtract half one 128 Hz interval of gravity.
// A crouched/ducking launch uses the full impulse (native_reaudit_airduck_003).
export const jumpLaunchSpeed = (ducking: boolean) => JUMP_SPEED - (ducking ? 0 : GRAVITY / 256);
export const DUCK_SECONDS = 1 / 6.4;
export const UNDUCK_SECONDS = 1 / 8;

export type Vec = { x: number; y: number; z: number };
export type MoveInput = { forward: number; side: number; walk: boolean; crouch: boolean; jump: boolean;
  /** Scoped at the second zoom level with a walking speed under 110 u/s: the server keeps the weapon's scale on the walking acceleration speed. */
  scopedSlow?: boolean;
  jumpPressed?: boolean; jumpPressOffset?: number };
export type ActorKinematics = {
  position: Vec;
  velocity: { x: number; z: number };
  yaw: number;
  feet: number;
  verticalVelocity: number;
  eyeHeight: number;
  duckAmount?: number;
  /** Native FL_DUCKING: set on completed crouch, retained until successful unduck reaches <= .75. */
  duckFlag?: boolean;
  /** Native camera offsets in metres; root compensates an airborne hull-origin change. */
  duckViewOffset?: number;
  duckRootOffset?: number;
  duckSpeed?: number;
  crouchHeld?: boolean;
  duckCooldown?: number;
  duckRecoveryOrigin?: {x: number; z: number};
  jumpHeld: boolean;
  grounded?: boolean;
  velocityModifier?: number;
  movementTime?: number;
  friction?: ActorFriction;
  lastJumpPressTime?: number;
  pendingJumpPressTime?: number;
  landedAt?: number;
  landingVelocity?: number;
  landingVelocityXY?: {x: number; z: number};
  supportId?: ContactId;
  moveMode?: 'ground' | 'air' | 'ladder' | 'water';
  waterLevel?: 0 | 1 | 2 | 3;
  ladderDetached?: boolean;
};
export type ActorEnvironment = TerrainWorld & {actors?: readonly ContactActor[]; selfId?: ContactId;
  time?: number; pitch?: number; jumpRules?: JumpRules};
export type ResolveMove = (from: Vec, desired: Vec, feet: number, height: number) => Vec;
export type CanOccupy = (position: Vec, feet: number, height: number) => boolean;
export type ResolveVertical = (position: Vec, from: number, to: number, height: number) =>
  {feet: number; grounded: boolean; ceiling: boolean; normal?: Vec; support?: TerrainSolid};

export const idleInput = (): MoveInput => ({ forward: 0, side: 0, walk: false, crouch: false, jump: false });
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const stanceCurve = (amount: number) => amount * amount * (3 - 2 * amount);

type GroundStance = {weaponSpeed: number; ducking: boolean; walking: boolean; scopedSlow?: boolean};

// Standalone acceleration adapter retained for historical native fixtures.
// Actual ground movement also passes friction's work and unused drop.
export function accelerateGround(
  vx: number, vz: number, x: number, z: number, wishSpeed: number, dt: number,
  {weaponSpeed, ducking, walking, scopedSlow = false}: GroundStance = {weaponSpeed: wishSpeed, ducking: false, walking: false},
) {
  const next = accelerateGroundMotion({x: Math.fround(vx / UNIT), z: Math.fround(vz / UNIT)}, {x: 0, z: 0},
    {x: Math.fround(x * wishSpeed / UNIT), z: Math.fround(z * wishSpeed / UNIT)}, wishSpeed / UNIT, dt, 0,
    {weaponSpeed: weaponSpeed / UNIT, ducking, walking, scopedSlow});
  return {x: next.velocity.x * UNIT, z: next.velocity.z * UNIT};
}

export function groundVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number, stance?: GroundStance) {
  const v = Math.hypot(vx, vz);
  if (v > 0) {
    const retained = Math.max(0, v - Math.max(v, 80 * UNIT) * 5.2 * dt) / v;
    vx *= retained; vz *= retained;
  }
  return accelerateGround(vx, vz, x, z, speed, dt, stance);
}

// Native modern jump (build 2000927): unless sv_enablebunnyhopping is set, a jump
// cannot start faster than 1.1x the weapon's max speed (PreventBunnyJumping).
export function clampJumpSpeed(velocity: {x: number; z: number}, weaponSpeed: number, rules?: {enableBunnyhopping?: boolean}) {
  if (rules?.enableBunnyhopping) return velocity;
  const limit = weaponSpeed * 1.1, length = Math.hypot(velocity.x, velocity.z);
  if (limit <= 0 || length <= limit) return velocity;
  return {x: velocity.x * limit / length, z: velocity.z * limit / length};
}

// Native AirAccelerate applies at most half of the uncapped acceleration
// budget before the collision move; AirMove adds the remainder afterward.
// Close to the wish cap the entire remaining gain can fit in the first half.
export function airAcceleration(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const length = Math.hypot(x, z);
  if (!length) return {movement: {x: vx, z: vz}, deferred: {x: 0, z: 0}};
  x /= length; z /= length;
  const budget = 12 * speed * dt;
  const add = Math.min(Math.max(0, Math.min(speed, 30 * UNIT) - vx * x - vz * z), budget);
  const before = Math.min(add, budget / 2), after = add - before;
  return {movement: {x: vx + x * before, z: vz + z * before}, deferred: {x: x * after, z: z * after}};
}

export function airVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const {movement, deferred} = airAcceleration(vx, vz, x, z, speed, dt);
  return {x: movement.x + deferred.x, z: movement.z + deferred.z};
}

function nextSegmentEnvironment(actor: ActorKinematics, next: ActorKinematics,
  environment: ActorEnvironment | undefined, time: number): ActorEnvironment | undefined {
  if (!environment) return undefined;
  let actors = environment.actors;
  if (actors && environment.selfId !== undefined && next.duckAmount !== actor.duckAmount) {
    // The first segment already admitted this stance change. Carry its virtual
    // rider poses into the next clearance check without mutating real actors.
    const resized = resizeSupportedStack({...actor, id: environment.selfId}, next, actors, environment);
    if (resized) {
      const poses = new Map(resized.map(body => [body.id, body]));
      actors = actors.map(body => poses.get(body.id) ?? body);
    }
  }
  return {...environment, time, actors: actors?.map(body => ({...body, previous: undefined}))};
}

export function advanceActor(
  actor: ActorKinematics, input: MoveInput, runningSpeed: number, dt: number,
  resolve: ResolveMove = (_from, desired) => desired,
  canOccupy: CanOccupy = () => true,
  vertical: ResolveVertical = (_position, _from, to) => ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false}),
  environment?: ActorEnvironment,
): ActorKinematics {
  if (dt < 0 || !Number.isFinite(dt)) return {...actor, position: {...actor.position}, velocity: {...actor.velocity}};
  const time = environment?.time ?? actor.movementTime ?? 0;
  const pressOffset = clamp(input.jumpPressOffset ?? 0, 0, dt);
  if (pressOffset > 0 && (input.jumpPressed || input.jump && !actor.jumpHeld)) {
    const before = advanceActor(actor, {...input, jump: actor.jumpHeld, jumpPressed: false, jumpPressOffset: 0},
      runningSpeed, pressOffset, resolve, canOccupy, vertical, environment);
    return advanceActor(before, {...input, jumpPressed: true, jumpPressOffset: 0}, runningSpeed, dt - pressOffset,
      resolve, canOccupy, vertical, nextSegmentEnvironment(actor, before, environment, time + pressOffset));
  }
  let friction = dt > 0 ? groundFrictionAt(actor.friction, time) : actor.friction;
  if (friction && dt > 0) {
    const duration = nextGroundFrictionBoundary(friction, time) - time;
    if (duration > 1e-10 && duration < dt - 1e-10) {
      // Long action fast-forwards can span thousands of commands. Iterate
      // their segments so stack depth does not grow with elapsed time.
      let current = actor, command = input, segmentEnvironment = environment;
      let remaining = dt, segmentTime = time;
      while (remaining > 0) {
        const clock = groundFrictionAt(current.friction, segmentTime);
        const untilBoundary = nextGroundFrictionBoundary(clock, segmentTime) - segmentTime;
        const segment = untilBoundary > 1e-10 && untilBoundary < remaining - 1e-10 ? untilBoundary : remaining;
        const next = advanceActor(current, command, runningSpeed, segment, resolve, canOccupy, vertical, segmentEnvironment);
        segmentTime += segment; remaining -= segment;
        segmentEnvironment = nextSegmentEnvironment(current, next, segmentEnvironment, segmentTime);
        current = next;
        command = {...input, jumpPressed: false, jumpPressOffset: 0};
      }
      return current;
    }
  }
  const bodies = environment?.actors ?? [];
  const world = environment ? {...environment,
    solids: [...environment.solids, ...actorContactSolids(bodies, environment.selfId)]} : undefined;
  if (world) {
    const displacement = supportDisplacement(actor, bodies);
    if (Math.hypot(displacement.x, displacement.y, displacement.z) > CONTACT_EPSILON) {
      const from = {...actor.position, y: actor.feet};
      const carried = moveOnTerrain(from, add(from, displacement), (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * UNIT,
        {...world, solids: world.solids.filter(s => s.traversal?.kind !== 'actor' || s.traversal.actorId !== actor.supportId)});
      actor = {...actor, position: {...carried.position, y: carried.position.y + actor.eyeHeight}, feet: carried.position.y};
    }
    canOccupy = (p, feet, height) => fitsTerrain(p, feet, height, world) ||
      environment?.selfId !== undefined && resizeSupportedStack({...actor, id: environment.selfId},
        {position: p, feet, height}, bodies, environment) !== undefined;
    vertical = (p, from, to, height) => verticalContact(p, from, to, height, world.solids, world.floor === undefined ? 0 : world.floor);
  }
  const { forward, side, walk, crouch, jump } = input;
  const currentDuck = actor.duckAmount ?? 0;
  const currentDuckFlag = actor.duckFlag ?? currentDuck === 1;
  // Native CheckParameters consumes 2 on BOTH input edges; Duck recovers 3/s
  // to 8, with an extra 6/s after travelling 64 units outside a transition.
  let duckSpeed = Math.min(8, Math.max(0, (actor.duckSpeed ?? 8) - (crouch !== (actor.crouchHeld ?? false) ? 2 : 0)) + 3 * dt);
  let duckRecoveryOrigin = actor.duckRecoveryOrigin ?? {x: actor.position.x, z: actor.position.z};
  if (duckSpeed >= 8) duckRecoveryOrigin = {x: actor.position.x, z: actor.position.z};
  else if ((currentDuck === 0 || currentDuck === 1) &&
    Math.hypot(actor.position.x - duckRecoveryOrigin.x, actor.position.z - duckRecoveryOrigin.z) > 64 * UNIT) {
    duckSpeed = Math.min(8, duckSpeed + 6 * dt);
  }
  let duckCooldown = Math.max(0, (actor.duckCooldown ?? 0) - dt);
  const wantsDuck = crouch && duckSpeed >= 1.5 && (duckCooldown === 0 || currentDuckFlag);
  const previousCurve = stanceCurve(currentDuck);
  const support = vertical(actor.position, actor.feet, actor.feet - CONTACT_EPSILON, (72 - 18 * previousCurve) * UNIT);
  const baseId = support.support?.traversal?.kind === 'actor' ? support.support.traversal.actorId : undefined;
  const base = bodies.find(body => body.id === baseId);
  const supported = support.grounded && actor.verticalVelocity <= 0 && base?.grounded !== false;
  const rules = environment?.jumpRules;
  const pressed = input.jumpPressed || jump && !actor.jumpHeld;
  const validPress = !!pressed && acceptedJumpPress(time, actor.lastJumpPressTime, rules);
  let pendingJumpPressTime = validPress ? time : actor.pendingJumpPressTime;
  const wantsJump = validPress || !!rules?.autoBhop && jump;
  const bhop = isBhopPress(validPress ? time : undefined, actor.landedAt, rules);
  let verticalVelocity = actor.verticalVelocity;
  if (wantsJump && supported) {
    verticalVelocity = jumpLaunchSpeed(crouch || currentDuck > 0) * (actor.landedAt === undefined ? 1 :
      jumpLandingFactor(actor.landingVelocity ?? 0, time - actor.landedAt));
    pendingJumpPressTime = undefined;
  }
  const airborne = !supported || verticalVelocity > 0;
  let duckAmount = clamp(currentDuck + (wantsDuck ? .8 * duckSpeed : -Math.max(1.5, duckSpeed)) * dt, 0, 1);
  // Segment subdivision can leave a double a few ulps short of an exact
  // endpoint. Finish the stance and its flag on that segment, not one later.
  if (duckAmount < 4 * Number.EPSILON) duckAmount = 0;
  else if (1 - duckAmount < 4 * Number.EPSILON) duckAmount = 1;
  // FinishDuck/FinishUnDuck complete in air, preserving the hull centre:
  // the 72-to-54-unit height change moves its origin by nine units.
  if (airborne) duckAmount = wantsDuck ? 1 : 0;
  let duckCurve = stanceCurve(duckAmount);
  const floor = world?.floor === null ? -Infinity : world?.floor ?? 0;
  let feet = Math.max(floor, actor.feet + (airborne ? (duckCurve - previousCurve) * 9 * UNIT : 0));
  // Releasing crouch requires room for the full standing hull, not just the
  // next interpolation step. In air the hull expands downwards.
  const standingFeet = Math.max(floor, actor.feet - (airborne ? previousCurve * 9 * UNIT : 0));
  const blockedUnduck = duckAmount < currentDuck && !canOccupy(actor.position, standingFeet, 72 * UNIT);
  if (blockedUnduck) {
    duckAmount = currentDuck;
    duckCurve = previousCurve; feet = actor.feet;
  }
  // The pawn accuracy flag differs from both the amount and m_bDucked: the
  // latter clears at the start of unducking, while this flag stays latched.
  const duckFlag = blockedUnduck ? currentDuckFlag : duckAmount === 1 ? true
    : !wantsDuck && duckAmount <= .75 ? false : currentDuckFlag;
  const approach = (value: number, target: number, amount: number) => value + clamp(target - value, -amount, amount);
  const oldRootOffset = actor.duckRootOffset ?? 0;
  // Root compensation belongs to the stance change, never to a floor repair
  // or the terrain/support displacement performed elsewhere in this step.
  const duckOriginShift = airborne && duckAmount !== currentDuck ? feet - Math.max(floor, actor.feet) : 0;
  const duckRootOffset = approach(oldRootOffset - duckOriginShift, 0, 90 * UNIT * dt);
  const duckViewOffset = approach(actor.duckViewOffset ?? actor.eyeHeight - 64 * UNIT - oldRootOffset,
    -18 * UNIT * duckAmount, 90 * UNIT * dt);
  if (duckAmount === 1 && currentDuck < 1) duckCooldown = .4;
  const wishX = side * Math.cos(actor.yaw) - forward * Math.sin(actor.yaw);
  const wishZ = -side * Math.sin(actor.yaw) - forward * Math.cos(actor.yaw);
  const tag = clamp(actor.velocityModifier ?? 1, 0, 1);
  const ducking = crouch || duckAmount > 0;
  const speed = runningSpeed * (ducking ? 1 - .66 * duckAmount : walk ? .52 : 1) * tag;
  // Modern jump restores pre-landing momentum only above the weapon cap (or
  // under explicit auto-bhop rules), and does so before air acceleration.
  const restoreBhop = wantsJump && supported && (bhop || rules?.autoBhop) && actor.landingVelocityXY &&
    (rules?.autoBhop || Math.hypot(actor.landingVelocityXY.x, actor.landingVelocityXY.z) > runningSpeed);
  let initialVelocity = restoreBhop ? actor.landingVelocityXY! : actor.velocity;
  if (wantsJump && supported) initialVelocity = clampJumpSpeed(initialVelocity, runningSpeed, rules);
  const air = airborne ? airAcceleration(initialVelocity.x, initialVelocity.z, wishX, wishZ, runningSpeed, dt) : undefined;
  let deferredVelocity = air?.deferred;
  let groundWork: {x: number; z: number} | undefined;
  let velocity = air ? air.movement : {...initialVelocity};
  let moveMode: NonNullable<ActorKinematics['moveMode']> = airborne ? 'air' : 'ground';
  const hullHeight = (72 - 18 * duckCurve) * UNIT;
  if (world && environment?.selfId !== undefined && duckAmount !== currentDuck) {
    const resized = resizeSupportedStack({...actor, id: environment.selfId}, {position: actor.position, feet, height: hullHeight}, bodies, environment);
    if (resized && resized.length > 1) {
      const riders = new Map(resized.slice(1).map(body => [body.id, actorHull(body)]));
      world.solids = world.solids.map(solid => solid.traversal?.kind === 'actor' ?
        riders.get(solid.traversal.actorId) ?? solid : solid);
    }
  }
  const water = world ? waterLevel(actor.position, feet, hullHeight, world.solids) : 0;
  const ladder = world && ladderAt(actor.position, feet, hullHeight, world.solids);
  let ladderDetached = ladder ? actor.ladderDetached ?? false : false;
  let specialVelocity: Vec | undefined;
  if (ladder?.traversal?.kind === 'ladder' && !ladderDetached) {
    const normal = normalize({...ladder.traversal.normal, y: 0});
    if (wantsJump) {
      // Static server ladder-detach block acf5e8..acf613: normal * 270 u/s.
      velocity = {x: normal.x * TERRAIN_RULES.ladderDetachSpeed, z: normal.z * TERRAIN_RULES.ladderDetachSpeed};
      verticalVelocity = 0;
      moveMode = 'air';
      ladderDetached = true;
    } else {
      moveMode = 'ladder';
      const pitch = environment?.pitch ?? 0;
      const wish = {x: wishX * Math.cos(pitch), y: -forward * Math.sin(pitch), z: wishZ * Math.cos(pitch)};
      const inward = dot(wish, normal), tangent = subtract(wish, scale(normal, inward));
      const climb = -inward;
      const requested = add(tangent, {x: 0, y: climb, z: 0});
      const speedLimit = runningSpeed * TERRAIN_RULES.ladderSpeedScale * (ducking ? .34 : 1);
      specialVelocity = scale(normalize(requested), speedLimit * Math.min(1, Math.hypot(requested.x, requested.y, requested.z)));
      velocity = {x: specialVelocity.x, z: specialVelocity.z}; verticalVelocity = specialVelocity.y;
    }
  } else if (water >= 2) {
    moveMode = 'water';
    const volume = world?.solids.find(s => s.traversal?.kind === 'water' &&
      waterLevel(actor.position, feet, hullHeight, [s]) >= 2);
    const waterSettings = volume?.traversal?.kind === 'water' ? volume.traversal : undefined;
    const swimming = swimVelocity({x: actor.velocity.x, y: actor.verticalVelocity, z: actor.velocity.z},
      {x: wishX * Math.cos(environment?.pitch ?? 0), y: jump ? 1 : crouch ? -1 : -forward * Math.sin(environment?.pitch ?? 0),
        z: wishZ * Math.cos(environment?.pitch ?? 0)}, runningSpeed, dt, waterSettings);
    specialVelocity = add(swimming, waterSettings?.current ?? {x: 0, y: 0, z: 0});
    velocity = {x: specialVelocity.x, z: specialVelocity.z}; verticalVelocity = specialVelocity.y;
  }
  let completedWish = {x: 0, z: 0};
  if (!airborne && !specialVelocity && moveMode === 'ground') {
    // Native WalkMove compares the processed wish in speed units before
    // direction normalization. Empty segments never consume that history.
    completedWish = {x: Math.fround(wishX * speed / UNIT), z: Math.fround(wishZ * speed / UNIT)};
    if (friction && dt > 0) {
      const incoming = {x: initialVelocity.x / UNIT, z: initialVelocity.z / UNIT};
      const selected = selectGroundFriction(friction.state, incoming, completedWish, groundFrictionFraction(friction, time));
      friction = {...friction, state: selected.state};
      const retained = groundFrictionStep(incoming, selected.controlSpeed, dt);
      const accelerated = accelerateGroundMotion(retained.velocity, retained.acceleration, completedWish, speed / UNIT,
        dt, retained.overshoot, {weaponSpeed: runningSpeed / UNIT, ducking, walking: walk && !ducking, scopedSlow: input.scopedSlow});
      groundWork = accelerated.acceleration;
      velocity = {x: accelerated.velocity.x * UNIT, z: accelerated.velocity.z * UNIT};
    } else {
      velocity = groundVelocity(initialVelocity.x, initialVelocity.z, wishX, wishZ, speed, dt,
        {weaponSpeed: runningSpeed, ducking, walking: walk && !ducking, scopedSlow: input.scopedSlow});
    }
  }
  // WalkMove caps the final ground momentum, then defers half the entire
  // friction/acceleration/cap correction until after the collision move.
  if (!airborne && !specialVelocity) {
    const cap = speed * (actor.landedAt !== undefined && actor.landingVelocity !== undefined
      ? groundLandingFactor(actor.landingVelocity, time + dt - actor.landedAt) : 1);
    if (groundWork) {
      const capped = capGroundMotion({x: Math.fround(velocity.x / UNIT), z: Math.fround(velocity.z / UNIT)}, groundWork, cap / UNIT, dt);
      const prepared = prepareGroundMotion(capped.velocity, capped.acceleration, dt);
      deferredVelocity = {x: prepared.deferred.x * UNIT, z: prepared.deferred.z * UNIT};
      velocity = {x: prepared.movement.x * UNIT, z: prepared.movement.z * UNIT};
    } else {
      const actualSpeed = Math.hypot(velocity.x, velocity.z);
      if (actualSpeed > cap) {
        velocity.x *= cap / actualSpeed; velocity.z *= cap / actualSpeed;
      }
      deferredVelocity = {x: (velocity.x - initialVelocity.x) / 2, z: (velocity.z - initialVelocity.z) / 2};
      velocity = {x: velocity.x - deferredVelocity.x, z: velocity.z - deferredVelocity.z};
    }
  }
  const beforeVertical = feet, initialVerticalVelocity = verticalVelocity;
  if (specialVelocity) feet += specialVelocity.y * dt;
  else if (airborne || moveMode === 'air') {
    feet += verticalVelocity * dt - GRAVITY * dt * dt / 2;
    verticalVelocity -= GRAVITY * dt;
  }
  const desired = { ...actor.position, x: actor.position.x + velocity.x * dt, z: actor.position.z + velocity.z * dt };
  // Horizontal collision is evaluated at the pre-fall height so landing on an
  // edge does not get mistaken for walking into its side.
  const terrainMove = world && moveOnTerrain({...actor.position, y: beforeVertical}, {...desired, y: feet}, hullHeight,
    world, supported && !wantsJump && !specialVelocity);
  const resolved = terrainMove ? terrainMove.position : resolve(actor.position, desired, Math.max(beforeVertical, feet), hullHeight);
  const contact = terrainMove ? {feet: terrainMove.position.y, grounded: terrainMove.grounded,
    ceiling: terrainMove.ceiling, support: terrainMove.support} : vertical(resolved, beforeVertical, feet - (airborne ? 0 : CONTACT_EPSILON), hullHeight);
  if (dt === 0 && verticalVelocity > 0) contact.grounded = false;
  if (terrainMove) {
    let clipped = {x: velocity.x, y: verticalVelocity, z: velocity.z};
    for (const hit of terrainMove.contacts) {
      if (supported && !wantsJump && hit.normal.y >= TERRAIN_RULES.standableNormal) continue;
      clipped = clipContactVelocity(clipped, hit.normal);
    }
    velocity = {x: clipped.x, z: clipped.z}; verticalVelocity = clipped.y;
  }
  if (deferredVelocity && !specialVelocity) {
    velocity = groundWork ? {
      x: Math.fround(Math.fround(velocity.x / UNIT) + Math.fround(deferredVelocity.x / UNIT)) * UNIT,
      z: Math.fround(Math.fround(velocity.z / UNIT) + Math.fround(deferredVelocity.z / UNIT)) * UNIT,
    } : {x: velocity.x + deferredVelocity.x, z: velocity.z + deferredVelocity.z};
  }
  feet = contact.feet;
  if (contact.support?.traversal?.kind === 'actor' &&
    bodies.find(body => body.id === (contact.support?.traversal?.kind === 'actor' ? contact.support.traversal.actorId : undefined))?.grounded === false) {
    contact.grounded = false;
  }
  let landedAt = actor.landedAt, landingVelocity = actor.landingVelocity, landingVelocityXY = actor.landingVelocityXY;
  if (contact.grounded && airborne && !specialVelocity) {
    const initialV = initialVerticalVelocity;
    const landingOffset = ballisticContactTime(beforeVertical, feet, initialV, GRAVITY, dt);
    landedAt = time + landingOffset;
    landingVelocity = initialV - GRAVITY * landingOffset;
    landingVelocityXY = {...velocity};
    if (isBhopPress(pendingJumpPressTime, landedAt, rules) || rules?.autoBhop && jump) {
      const remainder = dt - landingOffset;
      velocity = clampJumpSpeed(velocity, runningSpeed, rules);
      verticalVelocity = jumpLaunchSpeed(crouch || duckAmount > 0) * jumpLandingFactor(landingVelocity, 0);
      pendingJumpPressTime = undefined;
      const bounceFeet = feet + verticalVelocity * remainder - GRAVITY * remainder * remainder / 2;
      const bounce = vertical(resolved, feet, bounceFeet, hullHeight);
      feet = bounce.feet; contact.grounded = false; contact.ceiling = bounce.ceiling;
      verticalVelocity -= GRAVITY * remainder;
    }
  }
  // Native WalkMove (build 2000927) clamps horizontal speed to the current max
  // speed on every ground tick after acceleration, so walking, crouching or
  // damage tagging cut speed at once; the landing factor only lowers that cap.
  if (contact.grounded && !groundWork) {
    const cap = speed * (landedAt !== undefined && landingVelocity !== undefined
      ? groundLandingFactor(landingVelocity, time + dt - landedAt) : 1);
    const length = Math.hypot(velocity.x, velocity.z);
    if (length > cap) velocity = length > 0 ? {x: velocity.x * cap / length, z: velocity.z * cap / length} : velocity;
  }
  if (contact.grounded || contact.ceiling) verticalVelocity = 0;
  if (dt > 0 && resolved.x === actor.position.x) velocity.x = 0;
  if (dt > 0 && resolved.z === actor.position.z) velocity.z = 0;
  velocity.x = clamp(velocity.x, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  velocity.z = clamp(velocity.z, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  verticalVelocity = clamp(verticalVelocity, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  const eyeHeight = 64 * UNIT + duckViewOffset + duckRootOffset;
  return {
    position: { x: resolved.x, y: feet + eyeHeight, z: resolved.z }, velocity,
    yaw: actor.yaw, feet, verticalVelocity, eyeHeight, duckAmount, duckFlag, jumpHeld: jump, grounded: contact.grounded,
    duckSpeed, duckViewOffset, duckRootOffset, crouchHeld: crouch, duckCooldown, duckRecoveryOrigin,
    velocityModifier: actor.velocityModifier,
    movementTime: time + dt, friction: friction && dt > 0 ? finishActorFriction(friction, completedWish, time + dt) : actor.friction,
    lastJumpPressTime: pressed ? time : actor.lastJumpPressTime, pendingJumpPressTime,
    landedAt, landingVelocity, landingVelocityXY,
    supportId: contact.grounded && contact.support?.traversal?.kind === 'actor' ? contact.support.traversal.actorId : undefined,
    moveMode: specialVelocity ? moveMode : contact.grounded ? 'ground' : 'air', waterLevel: water, ladderDetached,
  };
}

export function swimVelocity(velocity: Vec, wish: Vec, speed: number, dt: number,
  settings: {speedScale?: number; drag?: number} = {}): Vec {
  const length = Math.hypot(velocity.x, velocity.y, velocity.z);
  const retained = length ? Math.max(0, 1 - Math.max(0, settings.drag ?? TERRAIN_RULES.waterFriction) * dt) : 0;
  const v = scale(velocity, retained), direction = normalize(wish);
  const wishSpeed = speed * clamp(settings.speedScale ?? TERRAIN_RULES.waterSpeedScale, 0, 1) * Math.min(1, Math.hypot(wish.x, wish.y, wish.z));
  const amount = Math.min(Math.max(0, wishSpeed - dot(v, direction)), TERRAIN_RULES.waterAccelerate * wishSpeed * dt);
  return add(v, scale(direction, amount));
}

export function resetActorMovementHistory(actor: ActorKinematics): ActorKinematics {
  return {...actor, movementTime: undefined, friction: undefined, lastJumpPressTime: undefined, pendingJumpPressTime: undefined,
    landedAt: undefined, landingVelocity: undefined, landingVelocityXY: undefined, supportId: undefined,
    moveMode: actor.grounded ? 'ground' : 'air', waterLevel: 0, ladderDetached: false};
}
