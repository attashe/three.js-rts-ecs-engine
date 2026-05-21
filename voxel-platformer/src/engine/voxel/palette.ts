// Voxel palette. Index 0 is reserved for "air" (empty / not solid). Indices
// 1..255 are block types — small enough to fit in a Uint8 if we ever want to
// shrink chunk storage, but we use Uint16 so the upper range stays open for
// future block-state-bit encoding.
//
// Adding a new block type: append to `entries`. Don't reorder — saved levels
// reference indices, so changing index 5 from "stone" to "water" silently
// breaks every existing level.

export interface PaletteEntry {
    /** Display name. */
    name: string
    /** Linear-space RGB in [0, 1]. */
    color: [number, number, number]
    /** Backward-compatible default for the more specific traits below. */
    solid: boolean
    /** Whether this block collides with AABBs. Defaults to `solid`. */
    collidable?: boolean
    /** Whether this block hides neighboring voxel faces. Defaults to `solid`. */
    occludesFaces?: boolean
    /** Whether voxel raycasts can hit this block. Defaults to `collidable`. */
    raycastTarget?: boolean
    /** Whether agents may stand on this block. Defaults to `collidable`. */
    pathSurface?: boolean
    /** Render opacity for visible voxels. Defaults to 1. */
    opacity?: number
    /** Movement effects applied while a character overlaps this voxel. */
    movement?: BlockMovementTraits
}

export interface BlockMovementTraits {
    /** Horizontal movement speed multiplier while overlapping the block. */
    speedMultiplier?: number
    /** Whether normal/high jumps are disabled while overlapping the block. */
    disableJump?: boolean
}

export interface Palette {
    entries: PaletteEntry[]
}

export const AIR = 0

export const BLOCK = {
    air: 0,
    grass: 1,
    dirt: 2,
    stone: 3,
    sand: 4,
    wood: 5,
    leaf: 6,
    plank: 7,
    brick: 8,
    glow: 9,
    noWalk: 10,
    door: 11,
    water: 12,
    cloud: 13,
} as const

/**
 * Default palette for the demo level. First entry MUST be air. Keep this
 * stable — changing indices breaks saved levels.
 */
export const DEFAULT_PALETTE: Palette = {
    entries: [
        { name: 'air',   color: [0, 0, 0],          solid: false },
        { name: 'grass', color: [0.36, 0.65, 0.30], solid: true },
        { name: 'dirt',  color: [0.45, 0.30, 0.20], solid: true },
        { name: 'stone', color: [0.55, 0.55, 0.58], solid: true },
        { name: 'sand',  color: [0.93, 0.85, 0.62], solid: true },
        { name: 'wood',  color: [0.42, 0.27, 0.16], solid: true },
        { name: 'leaf',  color: [0.20, 0.45, 0.18], solid: true },
        { name: 'plank', color: [0.78, 0.62, 0.40], solid: true },
        { name: 'brick', color: [0.66, 0.30, 0.25], solid: true },
        { name: 'glow',  color: [1.00, 0.78, 0.40], solid: true },
        { name: 'no-walk ward', color: [0.58, 0.18, 0.70], solid: true, pathSurface: false },
        { name: 'door',  color: [0.50, 0.30, 0.16], solid: true },
        {
            name: 'water',
            color: [0.20, 0.52, 0.92],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            opacity: 0.48,
            movement: { speedMultiplier: 0.45, disableJump: true },
        },
        {
            name: 'cloud',
            color: [0.86, 0.91, 1.00],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            opacity: 0.42,
        },
    ],
}

/** Look up a palette entry by index. Returns AIR's entry on out-of-range. */
export function paletteEntry(palette: Palette, index: number): PaletteEntry {
    return palette.entries[index] ?? palette.entries[AIR]!
}

/** Convenience: legacy combined solidity query. Prefer a narrower trait in new code. */
export function isSolid(palette: Palette, index: number): boolean {
    return paletteEntry(palette, index).solid
}

export function isCollidable(palette: Palette, index: number): boolean {
    const entry = paletteEntry(palette, index)
    return entry.collidable ?? entry.solid
}

export function occludesFaces(palette: Palette, index: number): boolean {
    const entry = paletteEntry(palette, index)
    return entry.occludesFaces ?? entry.solid
}

export function isRaycastTarget(palette: Palette, index: number): boolean {
    const entry = paletteEntry(palette, index)
    return entry.raycastTarget ?? isCollidable(palette, index)
}

export function isPathSurface(palette: Palette, index: number): boolean {
    const entry = paletteEntry(palette, index)
    return entry.pathSurface ?? isCollidable(palette, index)
}

export function voxelOpacity(palette: Palette, index: number): number {
    if (index === AIR) return 0
    return paletteEntry(palette, index).opacity ?? 1
}

export function isRenderableVoxel(palette: Palette, index: number): boolean {
    return voxelOpacity(palette, index) > 0
}

export function blockMovementTraits(palette: Palette, index: number): Required<BlockMovementTraits> {
    const traits = paletteEntry(palette, index).movement
    return {
        speedMultiplier: traits?.speedMultiplier ?? 1,
        disableJump: traits?.disableJump ?? false,
    }
}
