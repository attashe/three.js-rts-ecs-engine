export const FixedOrder = {
    mechanisms: 90,
    input: 100,
    ai: 200,
    movement: 300,
    physics: 400,
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
