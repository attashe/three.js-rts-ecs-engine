// SoA component storage. Each "component" is just an object of typed arrays
// indexed by entity id. bitecs treats the object reference as the component
// identity (no defineComponent in 0.4.x).

export const MAX_ENTITIES = 65_536

const vec3 = () => ({
    x: new Float32Array(MAX_ENTITIES),
    y: new Float32Array(MAX_ENTITIES),
    z: new Float32Array(MAX_ENTITIES),
})

export const Position = vec3()
export const Rotation = vec3()
export const Velocity = vec3()
export const AngularVelocity = vec3()
/** Half-extents (x, y, z) of the entity's AABB collider. Centred on Position
 *  for X and Z; for Y the AABB spans [Position.y, Position.y + 2*y] — i.e.
 *  Position.y is the *foot* of the entity, matching how player meshes are
 *  authored (Group origin at the feet). */
export const BoxCollider = vec3()

export const Health = {
    current: new Float32Array(MAX_ENTITIES),
    max: new Float32Array(MAX_ENTITIES),
}

export const Faction = {
    /** 1 = player/allies, 2 = neutral, 3 = hostile/demo targets. */
    id: new Uint8Array(MAX_ENTITIES),
}

export const InteractionRange = {
    value: new Float32Array(MAX_ENTITIES),
}

export const PickupValue = {
    /** Game-specific pickup kind id. 1 = gold, 2 = health. */
    kind: new Uint8Array(MAX_ENTITIES),
    amount: new Uint16Array(MAX_ENTITIES),
}

export const PlayerResources = {
    mana: new Float32Array(MAX_ENTITIES),
    maxMana: new Float32Array(MAX_ENTITIES),
    stamina: new Float32Array(MAX_ENTITIES),
    maxStamina: new Float32Array(MAX_ENTITIES),
}

export const MovementState = {
    /** 0 idle, 1 moving, 2 jumping/falling, 3 blocked, 4 repathing. */
    value: new Uint8Array(MAX_ENTITIES),
}

export const Behaviour = {
    /** BehaviourProfileId. Profile data lives outside ECS arrays. */
    profileId: new Uint16Array(MAX_ENTITIES),
    /** BehaviourStateId. High-level AI intent, separate from MovementState. */
    state: new Uint8Array(MAX_ENTITIES),
    previousState: new Uint8Array(MAX_ENTITIES),
    /** Target eid + 1; 0 means no target. */
    target: new Uint32Array(MAX_ENTITIES),
    stateTime: new Float32Array(MAX_ENTITIES),
    nextThinkAt: new Float32Array(MAX_ENTITIES),
    nextRepathAt: new Float32Array(MAX_ENTITIES),
    blockedTime: new Float32Array(MAX_ENTITIES),
}

export const MovingObject = {
    /** 1 = arrow, 2 = stone. */
    kind: new Uint8Array(MAX_ENTITIES),
    /** Seconds since spawn. */
    age: new Float32Array(MAX_ENTITIES),
}

export const Shield = {
    /** 1 while actively raised by input/AI. */
    raised: new Uint8Array(MAX_ENTITIES),
    /** Minimum dot between actor forward and incoming projectile source direction. */
    blockArcCos: new Float32Array(MAX_ENTITIES),
    /** Shield coverage in target-local Y, relative to Position.y. */
    minY: new Float32Array(MAX_ENTITIES),
    maxY: new Float32Array(MAX_ENTITIES),
}

/**
 * Material parameters for a dynamic body. Read by physics-system every step
 * for entities that also have Position + Velocity + BoxCollider.
 *
 * Defaults (when a field is 0 and would be invalid, e.g. mass) are applied by
 * the spawn helpers in game/moving-objects.ts; physics treats explicit zero
 * for damping/restitution/impactDamageScale as "off".
 */
export const RigidBody = {
    /** Inertial mass for pairwise impulse weighting. >0; falls back to 1 if 0. */
    mass: new Float32Array(MAX_ENTITIES),
    /** Bounce coefficient on Y-block, 0..1. 0 = no bounce. */
    restitution: new Float32Array(MAX_ENTITIES),
    /** Per-second damping rate applied to horizontal velocity while grounded.
     *  Effective: v *= exp(-rate*dt). 0 = no damping. */
    linearDamping: new Float32Array(MAX_ENTITIES),
    /** Multiplier on the engine's gravity. 0 fallback => 1.0. */
    gravityScale: new Float32Array(MAX_ENTITIES),
    /** Per-body terminal-fall override; 0 = use engine default. */
    maxFallSpeed: new Float32Array(MAX_ENTITIES),
    /** Squared total speed below which the sleep timer ticks. 0 fallback => 0.04. */
    sleepThresholdSq: new Float32Array(MAX_ENTITIES),
    /** Seconds the body has been below sleepThresholdSq while grounded. */
    sleepTimer: new Float32Array(MAX_ENTITIES),
    /** Seconds of below-threshold grounded time required to sleep. 0 fallback => 0.6. */
    sleepDelay: new Float32Array(MAX_ENTITIES),
    /** damage = mass * inboundSpeed * impactDamageScale. 0 = no damage on hit. */
    impactDamageScale: new Float32Array(MAX_ENTITIES),
    /** 1 = visually tumble around X/Z when rolling on the ground. */
    rollOnGround: new Uint8Array(MAX_ENTITIES),
    /** 1 = collider AABB is centred on Position.y (sphere-ish bodies whose
     *  visual Group origin is at the sphere center). 0 = foot-anchored, AABB Y
     *  spans [Position.y, Position.y + 2*half.y]. The two anchors look the
     *  same when sitting still but matter the moment the body rotates: a
     *  foot-anchored Group rotates around its foot, swinging an offset sphere
     *  visual into the ground. Round dynamics (stones) use centre. */
    centerAnchored: new Uint8Array(MAX_ENTITIES),
}

// Tag components — empty objects, used purely as identity in queries.
export const Renderable = {}
export const MoveAlongPath = {}
export const CameraTarget = {}
export const PlayerControlled = {}
export const Grounded = {}
export const HorizontalBlocked = {}
export const Interactable = {}
export const Pickup = {}
export const Attackable = {}
/** Path-following actor body. Historical name; covers any AI-driven actor that
 *  shares `MoveAlongPath` / dynamic-collision semantics — wanderers, hostiles,
 *  later patrols. Used as a "this is an actor body" marker by physics, voxel
 *  mechanism, and dynamic-collision systems. */
export const Wanderer = {}
/** Settled rigid body. Skipped by physics; registered in the obstacle registry
 *  so character/projectile sweeps treat it as solid like a voxel. */
export const Sleeping = {}
