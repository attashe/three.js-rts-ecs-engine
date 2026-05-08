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

export const MovementState = {
    /** 0 idle, 1 moving, 2 jumping/falling, 3 blocked, 4 repathing. */
    value: new Uint8Array(MAX_ENTITIES),
}

export const WanderHome = vec3()
export const WanderRadius = {
    value: new Float32Array(MAX_ENTITIES),
}
export const WanderTimer = {
    value: new Float32Array(MAX_ENTITIES),
}

export const MovingObject = {
    /** 1 = arrow, 2 = stone. */
    kind: new Uint8Array(MAX_ENTITIES),
    /** Seconds since spawn. */
    age: new Float32Array(MAX_ENTITIES),
    /** Seconds spent grounded/slow enough to settle. */
    restTime: new Float32Array(MAX_ENTITIES),
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
export const Wanderer = {}
export const PhysicalObstacle = {}
