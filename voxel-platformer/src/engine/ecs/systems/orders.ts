export const FixedOrder = {
    /** Mechanism updates (pistons / moving platforms) — runs first so their
     *  voxel writes are visible to physics in the same step. */
    mechanisms: 90,
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
    /** Drives per-entity AnimationMixers. Runs after renderSync has positioned
     *  the entity root, before worldRender draws it. */
    animation: 150,
    /** Per-block emissive PointLight pool. Runs just before worldRender so
     *  the fixed light pool is positioned before the chunk meshes render. */
    blockLights: 195,
    worldRender: 200,
    debug: 300,
    cameraControl: 400,
    cameraFollow: 500,
} as const
