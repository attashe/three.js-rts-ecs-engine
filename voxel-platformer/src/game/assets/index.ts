// Minimal asset re-exports for the platformer foundation. Adding a new mesh
// builder: drop a file in this directory, then re-export it here.

export {
    MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
    MAIN_CHARACTER_COLLIDER_HEIGHT,
    MAIN_CHARACTER_COLLIDER_RADIUS,
    createMainCharacter,
} from './main-character'
export type { MainCharacterOptions } from './main-character'

export { createArrow, createBow, createQuiver } from './weapons'
export type { BowOptions, QuiverOptions } from './weapons'

export { createStone } from './props'
export type { StoneVisualOptions } from './props'

export { mergeGroupByMaterial } from './merge-group'
export {
    SHARED_ASSET_RESOURCE,
    sharedBoxGeometry,
    sharedCapsuleGeometry,
    sharedConeGeometry,
    sharedCylinderGeometry,
    sharedMaterial,
    sharedSphereGeometry,
    sharedTorusGeometry,
} from './shared-primitives'
