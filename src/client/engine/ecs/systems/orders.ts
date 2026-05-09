export const FixedOrder = {
    mechanisms: 90,
    input: 100,
    /** Reads world state into the AI blackboard. Runs before `ai` so the
     *  behaviour system sees up-to-date target/visibility facts. */
    perception: 180,
    ai: 200,
    movement: 300,
    physics: 400,
    /** Awake rigid-body pair separation (e.g. stone-vs-stone in mid-air). */
    rigidbodyPairs: 450,
    /** Drains impact events emitted by physics into damage / FX. Runs *before*
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
