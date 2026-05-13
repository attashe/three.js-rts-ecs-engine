export const FixedOrder = {
    input: 100,
    movement: 300,
    physics: 400,
    /** Awake rigid-body pair separation (e.g. stone-vs-stone in mid-air). */
    rigidbodyPairs: 450,
    /** Drains impact events emitted by physics into FX hooks. Runs before
     *  dynamicCollision so a stone landing on the player can still see the
     *  contact AABB overlap before the player is pushed sideways. */
    impacts: 480,
    dynamicCollision: 500,
    postPhysics: 600,
} as const

export const RenderOrder = {
    renderSync: 100,
    worldRender: 200,
    debug: 300,
    cameraControl: 400,
    cameraFollow: 500,
} as const
