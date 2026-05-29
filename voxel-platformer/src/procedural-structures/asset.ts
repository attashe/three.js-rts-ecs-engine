import type { Palette } from '../engine/voxel/palette'
import { BLOCK } from '../engine/voxel/palette'
import type { ChunkManager, VoxelEdit } from '../engine/voxel/chunk-manager'
import type {
    PartialStructureGenerationOptions,
    StructureBounds,
    StructureKind,
    StructureVoxel,
} from './types'
import { boundsOf, VoxelBuffer } from './buffer'
import { generateStructureScene } from './generator'
import { getPrefab } from './prefabs'
import { hash2 } from './math'
import type { EditorProp, EditorPropKind } from '../game/props/prop-types'

/**
 * Structure assets — a thin, engine-facing layer over the raw voxel
 * generators. An *asset* is a self-contained, origin-normalised block of
 * voxels with a known size; a *transform* says where and how to drop it
 * into a level. Everything an editor or level script needs to preview,
 * measure, and stamp a structure with a predictable footprint lives here.
 *
 *   generateStructureAsset(source)        → cached, measurable asset
 *   measureStructurePlacement(asset, xf)  → world AABB + footprint, no writes
 *   structurePlacementEdits(asset, xf)    → VoxelEdit[] ready for applyBulk
 *   placeStructureAsset(chunks, asset, xf)→ stamp + return undo edits
 *
 * Two source kinds are supported, behind one uniform API:
 *   - `procedural` — a seeded tree / house / tower / mixed generator.
 *   - `prefab`     — a hand-authored set-piece (portal gate, well, ...).
 */

export type StructureRotation = 0 | 90 | 180 | 270

/** Where a `StructureTransform.origin` sits relative to the asset's local box. */
export type StructureAnchor = 'bottom-center' | 'min-corner' | 'center'

export type StructureSourceKind = 'procedural' | 'prefab'

export type StructureSource =
    | { kind: 'procedural'; options: PartialStructureGenerationOptions }
    | { kind: 'prefab'; id: string }

export interface StructureSize {
    width: number
    height: number
    depth: number
}

export interface Footprint {
    width: number
    depth: number
}

/** Decorative voxels filtered out when `structuralOnly` is requested. The
 *  ground plantings among them (flowers / mushrooms) are re-emitted as proper
 *  prop meshes via `decorationProps`; the rest (tree fruit, chimney smoke)
 *  simply drop. */
const DECORATIVE_BLOCKS = new Set<number>([
    BLOCK.flower,
    BLOCK.mushroom,
    BLOCK.fruit,
    BLOCK.smoke,
])

/** Generator tags whose decorative voxels become real prop instances rather
 *  than flat cubes — the ground plantings the structures scatter. */
const PLANTING_TAGS = new Set<string>(['ground-detail', 'garden-plant'])

const FLOWER_PROP_KINDS = ['flower', 'flower-2', 'flower-3'] as const
const MUSHROOM_PROP_KINDS = ['mushroom', 'mushroom-2', 'mushroom-3'] as const

/** A planting recovered from a structure's decorative voxels, in the asset's
 *  origin-normalised local frame (same space as `voxels`). */
export interface LocalPropPlacement {
    kind: EditorPropKind
    x: number
    y: number
    z: number
    yaw: number
    scale: number
}

export interface StructureAssetOptions {
    /** Drop purely decorative voxels (flowers / mushrooms / fruit / smoke)
     *  so the stamped footprint is predictable structural geometry. */
    structuralOnly?: boolean
    /** Palette used to resolve human-readable material names in `stats`. */
    palette?: Palette
}

export interface StructureAsset {
    source: StructureSource
    label: string
    /** Local voxels, min corner normalised to (0, 0, 0). */
    voxels: StructureVoxel[]
    /** Local bounds — always anchored at min (0, 0, 0). */
    bounds: StructureBounds
    /** Ground plantings recovered as prop instances when `structuralOnly` was
     *  requested (empty otherwise). Local frame matches `voxels`. */
    decorationProps: LocalPropPlacement[]
    size: StructureSize
    footprint: Footprint
    stats: {
        voxelCount: number
        materialCounts: Record<number, number>
        materialNames: Record<number, string>
    }
}

export interface StructureTransform {
    /** World voxel cell the anchor lands on. */
    origin: { x: number; y: number; z: number }
    rotation: StructureRotation
    anchor: StructureAnchor
}

export interface StructurePlacement {
    /** World-space bounds the stamp will occupy. */
    bounds: StructureBounds
    footprint: Footprint
    /** Cells the stamp will write (block values), in world voxel coords. */
    edits: VoxelEdit[]
}

export const DEFAULT_TRANSFORM: StructureTransform = {
    origin: { x: 0, y: 0, z: 0 },
    rotation: 0,
    anchor: 'bottom-center',
}

/**
 * Sensible per-kind defaults for a *single* placeable procedural
 * structure. The standalone demo grid-scatters several variants over a
 * terrain plate; for editor placement we want exactly one structure,
 * ground-anchored, with no terrain — so the footprint is the structure's
 * own footprint and nothing else.
 */
export function proceduralSource(
    kind: StructureKind,
    seed: number,
    overrides: PartialStructureGenerationOptions = {},
): StructureSource {
    return {
        kind: 'procedural',
        options: {
            kind,
            seed,
            variants: 1,
            showTerrain: false,
            cleanLoose: true,
            ...overrides,
        },
    }
}

export function prefabSource(id: string): StructureSource {
    return { kind: 'prefab', id }
}

/**
 * Build (or rebuild) a structure asset from its source. Pure and
 * deterministic: identical sources yield byte-identical voxels, so
 * callers can cache on a source fingerprint and only regenerate when the
 * user changes seed / kind / params.
 */
export function generateStructureAsset(
    source: StructureSource,
    options: StructureAssetOptions = {},
): StructureAsset {
    const raw = rawVoxels(source, options.palette)
    const filtered = options.structuralOnly
        ? raw.voxels.filter((v) => !DECORATIVE_BLOCKS.has(v.block))
        : raw.voxels
    const offset = originOffset(filtered)
    const voxels = filtered.map((v) => ({ x: v.x - offset.x, y: v.y - offset.y, z: v.z - offset.z, block: v.block, tag: v.tag }))
    const bounds = boundsOf(voxels)
    // Only recover plantings as props when their flat voxels were dropped;
    // otherwise they're still rendered as cubes and a prop would double them.
    const decorationProps = options.structuralOnly ? plantingProps(raw.voxels, offset) : []

    const materialCounts: Record<number, number> = {}
    for (const v of voxels) materialCounts[v.block] = (materialCounts[v.block] ?? 0) + 1
    const materialNames: Record<number, string> = {}
    for (const key of Object.keys(materialCounts)) {
        const block = Number(key)
        materialNames[block] = options.palette?.entries[block]?.name ?? raw.names[block] ?? 'block ' + block
    }

    return {
        source,
        label: raw.label,
        voxels,
        bounds,
        decorationProps,
        size: { width: bounds.width, height: bounds.height, depth: bounds.depth },
        footprint: { width: bounds.width, depth: bounds.depth },
        stats: { voxelCount: voxels.length, materialCounts, materialNames },
    }
}

/** Min corner of a voxel set — the offset that normalises it to origin. */
function originOffset(voxels: readonly StructureVoxel[]): { x: number; y: number; z: number } {
    if (voxels.length === 0) return { x: 0, y: 0, z: 0 }
    let x = Infinity
    let y = Infinity
    let z = Infinity
    for (const v of voxels) {
        if (v.x < x) x = v.x
        if (v.y < y) y = v.y
        if (v.z < z) z = v.z
    }
    return { x, y, z }
}

/**
 * Turn the structure's ground plantings (tagged `ground-detail` /
 * `garden-plant`) into local prop placements. A planting's voxel becomes one
 * flower or mushroom prop, sitting on the cell's floor; its variant, yaw, and
 * scale are hashed from the cell so the choice is stable and deterministic.
 * The matching cap voxel (e.g. a mushroom's `fruit` top) is ignored — one prop
 * per stem.
 */
function plantingProps(raw: readonly StructureVoxel[], offset: { x: number; y: number; z: number }): LocalPropPlacement[] {
    const props: LocalPropPlacement[] = []
    for (const v of raw) {
        if (!PLANTING_TAGS.has(v.tag)) continue
        const kinds = v.block === BLOCK.flower ? FLOWER_PROP_KINDS
            : v.block === BLOCK.mushroom ? MUSHROOM_PROP_KINDS
                : null
        if (!kinds) continue
        const kind = kinds[Math.min(kinds.length - 1, Math.floor(hash2(v.x, v.z, 11) * kinds.length))]!
        props.push({
            kind,
            x: v.x - offset.x,
            y: v.y - offset.y,
            z: v.z - offset.z,
            yaw: hash2(v.x, v.z, 23) * Math.PI * 2,
            scale: 0.85 + hash2(v.x, v.z, 31) * 0.3,
        })
    }
    return props
}

interface RawVoxels {
    voxels: StructureVoxel[]
    label: string
    names: Record<number, string>
}

function rawVoxels(source: StructureSource, palette?: Palette): RawVoxels {
    if (source.kind === 'prefab') {
        const prefab = getPrefab(source.id)
        if (!prefab) throw new Error(`Unknown structure prefab: ${source.id}`)
        const buf = new VoxelBuffer()
        prefab.build(buf)
        return { voxels: buf.toArray(), label: prefab.label, names: {} }
    }
    const result = generateStructureScene(source.options, palette)
    const kind = source.options.kind ?? 'mixed'
    return {
        voxels: result.voxels,
        label: kind.charAt(0).toUpperCase() + kind.slice(1),
        names: result.materialNames,
    }
}

/** Local size of the asset after applying a rotation (W/D swap on 90/270). */
export function rotatedSize(asset: StructureAsset, rotation: StructureRotation): StructureSize {
    const swap = rotation === 90 || rotation === 270
    return {
        width: swap ? asset.size.depth : asset.size.width,
        height: asset.size.height,
        depth: swap ? asset.size.width : asset.size.depth,
    }
}

/** Rotate a single local cell about Y within an asset's XZ box. Result stays
 *  inside [0, dim-1] for the rotated dimensions, so no re-normalisation is
 *  needed. y is preserved. */
function rotateCell(
    x: number,
    z: number,
    width: number,
    depth: number,
    rotation: StructureRotation,
): { x: number; z: number } {
    switch (rotation) {
        case 90: return { x: depth - 1 - z, z: x }
        case 180: return { x: width - 1 - x, z: depth - 1 - z }
        case 270: return { x: z, z: width - 1 - x }
        default: return { x, z }
    }
}

/** Local cell that the transform's `origin` maps onto, for the rotated size. */
export function anchorOffset(size: StructureSize, anchor: StructureAnchor): { x: number; y: number; z: number } {
    switch (anchor) {
        case 'min-corner': return { x: 0, y: 0, z: 0 }
        case 'center': return { x: (size.width - 1) >> 1, y: (size.height - 1) >> 1, z: (size.depth - 1) >> 1 }
        case 'bottom-center':
        default: return { x: (size.width - 1) >> 1, y: 0, z: (size.depth - 1) >> 1 }
    }
}

/**
 * World-space AABB + footprint a placement will occupy — without touching
 * the level. Cheap (O(1) in voxel count); drives editor preview and lets
 * level scripts reason about clearance before committing.
 */
export function measureStructurePlacement(asset: StructureAsset, transform: StructureTransform): {
    bounds: StructureBounds
    footprint: Footprint
    size: StructureSize
} {
    const size = rotatedSize(asset, transform.rotation)
    const a = anchorOffset(size, transform.anchor)
    const minX = transform.origin.x - a.x
    const minY = transform.origin.y - a.y
    const minZ = transform.origin.z - a.z
    const maxX = minX + size.width - 1
    const maxY = minY + size.height - 1
    const maxZ = minZ + size.depth - 1
    return {
        bounds: { minX, minY, minZ, maxX, maxY, maxZ, width: size.width, height: size.height, depth: size.depth },
        footprint: { width: size.width, depth: size.depth },
        size,
    }
}

/**
 * Resolve the asset's voxels to world-space `VoxelEdit`s under a
 * transform. The block value is each voxel's block; AIR cells are never
 * emitted (the asset only stores set voxels), so the stamp is additive
 * unless the caller chooses to pre-clear the footprint.
 */
export function structurePlacementEdits(asset: StructureAsset, transform: StructureTransform): VoxelEdit[] {
    const localSize = asset.size
    const size = rotatedSize(asset, transform.rotation)
    const a = anchorOffset(size, transform.anchor)
    const baseX = transform.origin.x - a.x
    const baseY = transform.origin.y - a.y
    const baseZ = transform.origin.z - a.z
    const edits: VoxelEdit[] = []
    for (const v of asset.voxels) {
        const r = rotateCell(v.x, v.z, localSize.width, localSize.depth, transform.rotation)
        edits.push({ x: baseX + r.x, y: baseY + v.y, z: baseZ + r.z, value: v.block })
    }
    return edits
}

/**
 * Resolve the asset's recovered plantings to world-space props under a
 * transform — the prop-mesh counterpart to `structurePlacementEdits`. Positions
 * land on the centre of each planting cell, with the prop's foot on the cell
 * floor; ids are derived from `idPrefix` plus the local cell so they're stable
 * across regenerations. Returns `[]` for assets stamped with their decoration
 * still as voxels (nothing to recover).
 */
export function structurePropPlacements(asset: StructureAsset, transform: StructureTransform, idPrefix: string): EditorProp[] {
    if (asset.decorationProps.length === 0) return []
    const localSize = asset.size
    const size = rotatedSize(asset, transform.rotation)
    const a = anchorOffset(size, transform.anchor)
    const baseX = transform.origin.x - a.x
    const baseY = transform.origin.y - a.y
    const baseZ = transform.origin.z - a.z
    const spin = (transform.rotation * Math.PI) / 180
    return asset.decorationProps.map((p) => {
        const r = rotateCell(p.x, p.z, localSize.width, localSize.depth, transform.rotation)
        return {
            id: `${idPrefix}:${p.kind}:${p.x}-${p.z}`,
            kind: p.kind,
            position: { x: baseX + r.x + 0.5, y: baseY + p.y, z: baseZ + r.z + 0.5 },
            yaw: p.yaw + spin,
            scale: p.scale,
            gridAligned: false,
        }
    })
}

/** Full placement description: world bounds, footprint, and the edits. */
export function planStructurePlacement(asset: StructureAsset, transform: StructureTransform): StructurePlacement {
    const measure = measureStructurePlacement(asset, transform)
    return {
        bounds: measure.bounds,
        footprint: measure.footprint,
        edits: structurePlacementEdits(asset, transform),
    }
}

/** Read the current block at each edit cell so a caller can build an undo
 *  command (revert = apply these `before` edits). */
export function captureBeforeEdits(chunks: ChunkManager, edits: readonly VoxelEdit[]): VoxelEdit[] {
    return edits.map((e) => ({ x: e.x, y: e.y, z: e.z, value: chunks.getVoxel(e.x, e.y, e.z) }))
}

export interface PlaceResult {
    /** Cells written (after state) — replay to redo. */
    after: VoxelEdit[]
    /** Cells' prior values — replay to undo. */
    before: VoxelEdit[]
    bounds: StructureBounds
    footprint: Footprint
    changedVoxels: number
}

/**
 * Stamp a structure asset into the level and return both the applied
 * edits and the prior values, so the caller can push a single undoable
 * command. Uses `applyBulk` so the whole structure is one logical edit
 * and dirty-chunk tracking stays correct.
 */
export function placeStructureAsset(
    chunks: ChunkManager,
    asset: StructureAsset,
    transform: StructureTransform,
): PlaceResult {
    const plan = planStructurePlacement(asset, transform)
    const before = captureBeforeEdits(chunks, plan.edits)
    const { changedVoxels } = chunks.applyBulk(plan.edits)
    return {
        after: plan.edits,
        before,
        bounds: plan.bounds,
        footprint: plan.footprint,
        changedVoxels,
    }
}

/** Stable fingerprint of a source — cache key for "regenerate only on change". */
export function structureSourceKey(source: StructureSource, structuralOnly = false): string {
    const tail = structuralOnly ? '|so' : ''
    if (source.kind === 'prefab') return `prefab:${source.id}${tail}`
    return `proc:${JSON.stringify(source.options)}${tail}`
}
