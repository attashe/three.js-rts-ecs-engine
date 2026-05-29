// Voxel palette. Index 0 is reserved for "air" (empty / not solid). Indices
// 1..255 are block types — small enough to fit in a Uint8 if we ever want to
// shrink chunk storage, but we use Uint16 so the upper range stays open for
// future block-state-bit encoding.
//
// Adding a new block type: append to `entries`. Don't reorder — saved levels
// reference indices, so changing index 5 from "stone" to "water" silently
// breaks every existing level.

import { TILE_INDEX } from './atlas-manifest'

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
    /** Render this normally-invisible voxel when debug info is enabled. */
    debugVisible?: boolean
    /** Optional debug-only colour override. Defaults to `color`. */
    debugColor?: [number, number, number]
    /** Optional debug-only opacity. Defaults to 0.35. */
    debugOpacity?: number
    /** Movement effects applied while a character overlaps this voxel. */
    movement?: BlockMovementTraits
    /** Linear-space emissive RGB self-glow (added on top of lit colour by
     *  the chunk material). [0,0,0] / undefined => no glow. */
    emissive?: [number, number, number]
    /** Multiplier applied to `emissive` before the shader adds it. 0 disables. */
    emissiveIntensity?: number
    /** PointLight tint spawned at the voxel centre. Falls back to `emissive`
     *  if omitted but `lightIntensity > 0`. */
    lightColor?: [number, number, number]
    /** PointLight intensity. 0 / undefined => no light spawned for this block. */
    lightIntensity?: number
    /** PointLight range in world units. Defaults to 8. */
    lightDistance?: number
    /** Whether the block-emitted PointLight casts shadows. Default off — the
     *  block-light pool is a fill, not a shadow source; opt in per-block to
     *  diagnose the shadow pipeline. */
    lightCastsShadow?: boolean
    /** Optional non-cube prop renderer for authored special blocks. */
    renderAs?: 'torch' | 'torch-off'
    /** Optional animated liquid surface rendered on exposed top faces. */
    liquid?: 'water' | 'lava'
    /**
     * Atlas tile name driving the chunk-mesh surface detail. When
     * omitted the block renders as a flat colour (the historical
     * behaviour) — internally it maps to tile slot 0 (the `blank`
     * tile), which is a uniform 1.0 multiplier in the shader, so a
     * missing texture key is indistinguishable from "no texture".
     *
     * Add a key here and a matching painter in `atlas-builder.ts` to
     * texture a block. Tile names are validated against
     * `atlas-manifest.TILE_NAMES` via `paletteTileIndex`.
     */
    textureKey?: string
}

export interface BlockMovementTraits {
    /** Horizontal movement speed multiplier while overlapping the block. */
    speedMultiplier?: number
    /** Whether normal/high jumps are disabled while overlapping the block. */
    disableJump?: boolean
    /** Immediate contact hazard applied while overlapping the block. */
    contactHazard?: BlockContactHazard
}

export type BlockContactHazard = 'lava'

export interface ResolvedBlockMovementTraits {
    speedMultiplier: number
    disableJump: boolean
    contactHazard: BlockContactHazard | null
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
    torch: 14,
    unlitLantern: 15,
    lava: 16,
    woodDark: 17,
    bark: 18,
    barkDark: 19,
    barkLight: 20,
    leafDark: 21,
    leafLight: 22,
    deepLeaf: 23,
    fruit: 24,
    flower: 25,
    mushroom: 26,
    wall: 27,
    plaster: 28,
    roof: 29,
    roofDark: 30,
    thatch: 31,
    trim: 32,
    glass: 33,
    darkStone: 34,
    stone2: 35,
    metal: 36,
    banner: 37,
    moss: 38,
    smoke: 39,
    fire: 40,
} as const

/**
 * Default palette for the demo level. First entry MUST be air. Keep this
 * stable — changing indices breaks saved levels.
 */
export const DEFAULT_PALETTE: Palette = {
    entries: [
        { name: 'air',   color: [0, 0, 0],          solid: false },
        { name: 'grass', color: [0.36, 0.65, 0.30], solid: true, textureKey: 'grass' },
        { name: 'dirt',  color: [0.45, 0.30, 0.20], solid: true, textureKey: 'dirt' },
        { name: 'stone', color: [0.55, 0.55, 0.58], solid: true, textureKey: 'stone' },
        { name: 'sand',  color: [0.93, 0.85, 0.62], solid: true, textureKey: 'sand' },
        { name: 'wood',  color: [0.42, 0.27, 0.16], solid: true, textureKey: 'wood' },
        { name: 'leaf',  color: [0.20, 0.45, 0.18], solid: true, textureKey: 'leaf' },
        { name: 'plank', color: [0.78, 0.62, 0.40], solid: true, textureKey: 'plank' },
        { name: 'brick', color: [0.66, 0.30, 0.25], solid: true, textureKey: 'brick' },
        // `glow` stays flat — the emissive PointLight + bright authored
        // colour are the whole visual; a tile here would just muddy it.
        {
            name: 'glow',
            color: [1.00, 0.78, 0.40],
            solid: true,
            emissive: [1.00, 0.78, 0.40],
            emissiveIntensity: 0.85,
            lightColor: [1.00, 0.78, 0.40],
            lightIntensity: 6.0,
            lightDistance: 10,
        },
        {
            name: 'invisible border',
            color: [0.58, 0.18, 0.70],
            solid: true,
            occludesFaces: false,
            pathSurface: false,
            opacity: 0,
            debugVisible: true,
            debugColor: [0.85, 0.18, 0.95],
            debugOpacity: 0.42,
        },
        // `door` is a hand-authored prop colour; left flat for now.
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
            liquid: 'water',
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
            textureKey: 'cloud',
        },
        {
            name: 'torch',
            color: [1.00, 0.58, 0.16],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            opacity: 0,
            renderAs: 'torch',
        },
        {
            name: 'unlit lantern',
            color: [0.18, 0.13, 0.08],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            opacity: 0,
            renderAs: 'torch-off',
        },
        {
            name: 'lava',
            color: [1.00, 0.28, 0.08],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            opacity: 0.68,
            emissive: [1.00, 0.20, 0.04],
            emissiveIntensity: 0.9,
            movement: { contactHazard: 'lava' },
            liquid: 'lava',
        },
        { name: 'dark wood', color: [0.34, 0.21, 0.11], solid: true, textureKey: 'wood' },
        { name: 'bark', color: [0.44, 0.27, 0.14], solid: true, textureKey: 'wood' },
        { name: 'dark bark', color: [0.24, 0.15, 0.09], solid: true, textureKey: 'wood' },
        { name: 'light bark', color: [0.72, 0.69, 0.63], solid: true, textureKey: 'wood' },
        { name: 'dark leaf', color: [0.11, 0.34, 0.17], solid: true, textureKey: 'leaf' },
        { name: 'light leaf', color: [0.44, 0.73, 0.33], solid: true, textureKey: 'leaf' },
        { name: 'deep leaf', color: [0.08, 0.28, 0.15], solid: true, textureKey: 'leaf' },
        {
            name: 'fruit',
            color: [0.84, 0.35, 0.30],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
        },
        {
            name: 'flower',
            color: [0.95, 0.84, 0.42],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
        },
        {
            name: 'mushroom',
            color: [0.90, 0.82, 0.65],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
        },
        { name: 'wall', color: [0.65, 0.56, 0.40], solid: true, textureKey: 'plaster' },
        { name: 'plaster', color: [0.85, 0.81, 0.69], solid: true, textureKey: 'plaster' },
        { name: 'roof', color: [0.55, 0.18, 0.14], solid: true, textureKey: 'roof' },
        { name: 'dark roof', color: [0.34, 0.11, 0.09], solid: true, textureKey: 'roof' },
        { name: 'thatch', color: [0.72, 0.58, 0.31], solid: true, textureKey: 'thatch' },
        { name: 'trim', color: [0.94, 0.91, 0.78], solid: true, textureKey: 'plank' },
        {
            name: 'glass',
            color: [0.57, 0.84, 0.93],
            solid: true,
            occludesFaces: false,
            opacity: 0.72,
            textureKey: 'glass',
        },
        { name: 'dark stone', color: [0.27, 0.32, 0.36], solid: true, textureKey: 'stone' },
        { name: 'stone 2', color: [0.48, 0.54, 0.57], solid: true, textureKey: 'stone' },
        { name: 'metal', color: [0.47, 0.51, 0.54], solid: true, textureKey: 'metal' },
        { name: 'banner', color: [0.72, 0.20, 0.23], solid: true, textureKey: 'plaster' },
        {
            name: 'moss',
            color: [0.30, 0.55, 0.30],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: true,
            pathSurface: false,
            textureKey: 'leaf',
        },
        {
            name: 'smoke',
            color: [0.59, 0.63, 0.66],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: false,
            pathSurface: false,
            opacity: 0.38,
        },
        {
            name: 'fire',
            color: [1.00, 0.63, 0.26],
            solid: false,
            collidable: false,
            occludesFaces: false,
            raycastTarget: false,
            pathSurface: false,
            opacity: 0.82,
            emissive: [1.00, 0.42, 0.08],
            emissiveIntensity: 1.35,
            lightColor: [1.00, 0.45, 0.12],
            lightIntensity: 4.0,
            lightDistance: 7,
        },
    ],
}

/** Look up a palette entry by index. Returns AIR's entry on out-of-range. */
export function paletteEntry(palette: Palette, index: number): PaletteEntry {
    return palette.entries[index] ?? palette.entries[AIR]!
}

/** Atlas tile slot to use for this block. Returns 0 (the `blank`
 *  tile — uniform 1.0) when the entry has no `textureKey` or the key
 *  doesn't match a known tile, so plain-colour blocks fall through to
 *  the same shader path without a branch. */
export function paletteTileIndex(palette: Palette, index: number): number {
    const entry = paletteEntry(palette, index)
    if (!entry.textureKey) return 0
    const slot = (TILE_INDEX as Record<string, number | undefined>)[entry.textureKey]
    return slot ?? 0
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

export function isTorchBlock(palette: Palette, index: number): boolean {
    return torchBlockState(palette, index) !== null
}

export type TorchBlockState = 'lit' | 'unlit'

export function torchBlockState(palette: Palette, index: number): TorchBlockState | null {
    if (index === AIR) return null
    const renderAs = paletteEntry(palette, index).renderAs
    if (renderAs === 'torch') return 'lit'
    if (renderAs === 'torch-off') return 'unlit'
    return null
}

export type LiquidBlockKind = 'water' | 'lava'

export function liquidBlockKind(palette: Palette, index: number): LiquidBlockKind | null {
    if (index === AIR) return null
    return paletteEntry(palette, index).liquid ?? null
}

export function isPathSurface(palette: Palette, index: number): boolean {
    const entry = paletteEntry(palette, index)
    return entry.pathSurface ?? isCollidable(palette, index)
}

export function voxelOpacity(palette: Palette, index: number): number {
    if (index === AIR) return 0
    const opacity = paletteEntry(palette, index).opacity ?? 1
    return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1
}

/**
 * Pre-multiplied emissive (RGB) for a palette index. Returns the zero tuple
 * when the entry has no emissive or zero intensity, so the shader can sum
 * unconditionally without a per-vertex scalar attribute.
 */
export function voxelEmissive(palette: Palette, index: number): [number, number, number] {
    if (index === AIR) return [0, 0, 0]
    const entry = paletteEntry(palette, index)
    const intensity = entry.emissiveIntensity
    if (!entry.emissive || !Number.isFinite(intensity) || (intensity ?? 0) <= 0) return [0, 0, 0]
    const k = intensity!
    return [
        clamp01(entry.emissive[0]) * k,
        clamp01(entry.emissive[1]) * k,
        clamp01(entry.emissive[2]) * k,
    ]
}

export interface BlockLightSpec {
    color: [number, number, number]
    intensity: number
    distance: number
    castShadow: boolean
}

/**
 * Resolved point-light spec for a palette index, or `null` if the entry
 * doesn't spawn a light. Falls back to the emissive colour for tint when
 * `lightColor` is omitted so a "lamp" preset only has to set intensity.
 */
export function voxelLightSpec(palette: Palette, index: number): BlockLightSpec | null {
    if (index === AIR) return null
    const entry = paletteEntry(palette, index)
    const intensity = entry.lightIntensity
    if (!Number.isFinite(intensity) || (intensity ?? 0) <= 0) return null
    const tint = entry.lightColor ?? entry.emissive ?? entry.color
    return {
        color: [clamp01(tint[0]), clamp01(tint[1]), clamp01(tint[2])],
        intensity: intensity!,
        distance: Number.isFinite(entry.lightDistance) ? Math.max(0, entry.lightDistance!) : 8,
        castShadow: entry.lightCastsShadow === true,
    }
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0
    return v < 0 ? 0 : v > 1 ? 1 : v
}

export function isRenderableVoxel(palette: Palette, index: number): boolean {
    if (isTorchBlock(palette, index)) return false
    return voxelOpacity(palette, index) > 0
}

export function blockMovementTraits(palette: Palette, index: number): ResolvedBlockMovementTraits {
    const traits = paletteEntry(palette, index).movement
    return {
        speedMultiplier: traits?.speedMultiplier ?? 1,
        disableJump: traits?.disableJump ?? false,
        contactHazard: traits?.contactHazard ?? null,
    }
}

export function clonePalette(palette: Palette): Palette {
    return {
        entries: palette.entries.map((entry) => ({
            ...entry,
            color: [...entry.color] as [number, number, number],
            debugColor: entry.debugColor ? [...entry.debugColor] as [number, number, number] : undefined,
            movement: entry.movement ? { ...entry.movement } : undefined,
            emissive: entry.emissive ? [...entry.emissive] as [number, number, number] : undefined,
            lightColor: entry.lightColor ? [...entry.lightColor] as [number, number, number] : undefined,
        })),
    }
}

export function appendMissingDefaultPaletteEntries(palette: Palette): void {
    normalizeNoWalkBlock(palette)
    normalizeLiquidBlock(palette, 'water', BLOCK.water)
    normalizeLiquidBlock(palette, 'lava', BLOCK.lava)
    appendMissingSpecialBlock(palette, BLOCK.torch)
    appendMissingSpecialBlock(palette, BLOCK.unlitLantern)
    appendMissingLiquidBlock(palette, 'lava', BLOCK.lava)
    appendMissingStructureBlocks(palette)
}

function normalizeNoWalkBlock(palette: Palette): void {
    const entry = palette.entries[BLOCK.noWalk]
    const defaultEntry = DEFAULT_PALETTE.entries[BLOCK.noWalk]
    if (!entry || !defaultEntry) return

    const isLegacyNoWalkWard = entry.name === 'no-walk ward'
    const isIncompleteInvisibleBorder = entry.name === defaultEntry.name && entry.debugVisible !== true
    if (!isLegacyNoWalkWard && !isIncompleteInvisibleBorder) return

    palette.entries[BLOCK.noWalk] = clonePalette({ entries: [defaultEntry] }).entries[0]!
}

function appendMissingSpecialBlock(palette: Palette, defaultIndex: number): void {
    const defaultEntry = DEFAULT_PALETTE.entries[defaultIndex]
    if (!defaultEntry?.renderAs) return
    if (palette.entries.some((entry) => entry.renderAs === defaultEntry.renderAs)) return
    const entry = clonePalette({ entries: [defaultEntry] }).entries[0]!
    entry.name = uniquePaletteName(palette, entry.name)
    palette.entries.push(entry)
}

function normalizeLiquidBlock(palette: Palette, kind: LiquidBlockKind, defaultIndex: number): void {
    const entry = palette.entries[defaultIndex]
    const defaultEntry = DEFAULT_PALETTE.entries[defaultIndex]
    if (!entry || defaultEntry?.liquid !== kind || entry.liquid === kind) return
    if (entry.name !== defaultEntry.name) return
    entry.liquid = kind
}

function appendMissingLiquidBlock(palette: Palette, kind: LiquidBlockKind, defaultIndex: number): void {
    if (palette.entries.some((entry) => entry.liquid === kind)) return
    const defaultEntry = DEFAULT_PALETTE.entries[defaultIndex]
    if (defaultEntry?.liquid !== kind) return
    const entry = clonePalette({ entries: [defaultEntry] }).entries[0]!
    entry.name = uniquePaletteName(palette, entry.name)
    palette.entries.push(entry)
}

const DEFAULT_STRUCTURE_BLOCKS = [
    BLOCK.woodDark,
    BLOCK.bark,
    BLOCK.barkDark,
    BLOCK.barkLight,
    BLOCK.leafDark,
    BLOCK.leafLight,
    BLOCK.deepLeaf,
    BLOCK.fruit,
    BLOCK.flower,
    BLOCK.mushroom,
    BLOCK.wall,
    BLOCK.plaster,
    BLOCK.roof,
    BLOCK.roofDark,
    BLOCK.thatch,
    BLOCK.trim,
    BLOCK.glass,
    BLOCK.darkStone,
    BLOCK.stone2,
    BLOCK.metal,
    BLOCK.banner,
    BLOCK.moss,
    BLOCK.smoke,
    BLOCK.fire,
] as const

function appendMissingStructureBlocks(palette: Palette): void {
    for (const index of DEFAULT_STRUCTURE_BLOCKS) {
        appendMissingDefaultBlockByName(palette, index)
    }
}

function appendMissingDefaultBlockByName(palette: Palette, defaultIndex: number): void {
    const defaultEntry = DEFAULT_PALETTE.entries[defaultIndex]
    if (!defaultEntry) return
    if (palette.entries.some((entry) => entry.name === defaultEntry.name)) return

    const entry = clonePalette({ entries: [defaultEntry] }).entries[0]!
    if (palette.entries.length === defaultIndex) {
        palette.entries.push(entry)
        return
    }

    entry.name = uniquePaletteName(palette, entry.name)
    palette.entries.push(entry)
}

function uniquePaletteName(palette: Palette, wanted: string): string {
    const used = new Set(palette.entries.map((entry) => entry.name))
    if (!used.has(wanted)) return wanted
    for (let i = 2; i < 1000; i++) {
        const candidate = `${wanted} ${i}`
        if (!used.has(candidate)) return candidate
    }
    return `${wanted} ${Date.now()}`
}
