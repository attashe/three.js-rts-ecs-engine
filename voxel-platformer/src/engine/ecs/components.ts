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

export const MovementState = {
    /** 0 idle, 1 moving, 2 jumping/falling, 3 blocked. */
    value: new Uint8Array(MAX_ENTITIES),
}

/** Tag for "collectable on contact" entities. Picked up by pickup-system
 *  when the player gets within its radius. */
export const Pickup = {}

/** Categorises a pickup. `kind` is one of the PickupKind values in
 *  pickup-system.ts (1 = gold, 2 = arrow); `amount` is added to the
 *  matching slot on world.inventory at collection time. */
export const PickupValue = {
    kind: new Uint8Array(MAX_ENTITIES),
    amount: new Uint16Array(MAX_ENTITIES),
}

export const MovingObject = {
    /** 1 = arrow, 2 = stone. */
    kind: new Uint8Array(MAX_ENTITIES),
    /** Seconds since spawn. */
    age: new Float32Array(MAX_ENTITIES),
}

/**
 * Material parameters for a dynamic body. Read by physics-system every step
 * for entities that also have Position + Velocity + BoxCollider.
 *
 * Defaults (when a field is 0 and would be invalid, e.g. mass) are applied by
 * the spawn helpers in game/moving-objects.ts; physics treats explicit zero
 * for damping/restitution as "off".
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
    /** 1 = visually tumble around X/Z when rolling on the ground. */
    rollOnGround: new Uint8Array(MAX_ENTITIES),
    /** 1 = collider AABB is centred on Position.y (sphere-ish bodies whose
     *  visual Group origin is at the sphere center). 0 = foot-anchored, AABB Y
     *  spans [Position.y, Position.y + 2*half.y]. Round dynamics (stones) use
     *  centre. */
    centerAnchored: new Uint8Array(MAX_ENTITIES),
}

// Tag components — empty objects, used purely as identity in queries.
export const Renderable = {}
/** Renderable that doesn't move once placed. RenderSync syncs its transform
 *  once on spawn and stops touching it after that. */
export const StaticRenderable = {}
export const CameraTarget = {}
export const PlayerControlled = {}
export const Grounded = {}
export const HorizontalBlocked = {}
/** Settled rigid body. Skipped by physics; registered in the obstacle registry
 *  so character/projectile sweeps treat it as solid like a voxel. */
export const Sleeping = {}
