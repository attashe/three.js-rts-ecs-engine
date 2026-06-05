import type { ChunkManager, VoxelEdit } from '../engine/voxel/chunk-manager'
import { AIR, BLOCK, isPathSurface, type Palette } from '../engine/voxel/palette'

export type TerrainTool = 'sculpt' | 'flatten' | 'smooth' | 'ramp' | 'paint-surface'
export type TerrainBrushShape = 'circle' | 'square'
export type TerrainFalloff = 'hard' | 'linear' | 'smooth'

export interface TerrainBrushSettings {
    shape: TerrainBrushShape
    radius: number
    falloff: TerrainFalloff
}

export interface TerrainColumn {
    x: number
    z: number
    weight: number
    distance: number
}

export interface TerrainEditSettings {
    minY: number
    maxY: number
    fillBlock: number
    topBlock?: number
}

export interface TerrainStrokeSettings extends TerrainBrushSettings, TerrainEditSettings {
    strength: number
    targetHeight: number
    repaintTop: boolean
    activeBlock: number
}

export interface RampSettings extends TerrainEditSettings {
    width: number
    repaintTop: boolean
    activeBlock: number
}

export interface TerrainSurfaceSample {
    y: number
    block: number
}

const EPSILON = 1e-6

export function terrainBrushColumns(center: { x: number; z: number }, settings: TerrainBrushSettings): TerrainColumn[] {
    const radius = Math.max(0, Math.floor(settings.radius))
    const columns: TerrainColumn[] = []
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const distance = settings.shape === 'square'
                ? Math.max(Math.abs(dx), Math.abs(dz))
                : Math.hypot(dx, dz)
            if (distance > radius + EPSILON) continue
            const weight = falloffWeight(distance, radius, settings.falloff)
            columns.push({ x: center.x + dx, z: center.z + dz, weight, distance })
        }
    }
    return columns
}

export function falloffWeight(distance: number, radius: number, falloff: TerrainFalloff): number {
    if (falloff === 'hard' || radius <= 0) return 1
    const t = clamp01(1 - distance / (radius + 0.5))
    if (falloff === 'linear') return t
    return t * t * (3 - 2 * t)
}

export function findTerrainSurface(
    chunks: ChunkManager,
    palette: Palette,
    x: number,
    z: number,
    minY: number,
    maxY: number,
): TerrainSurfaceSample | null {
    const lo = Math.floor(Math.min(minY, maxY))
    const hi = Math.floor(Math.max(minY, maxY))
    for (let y = hi; y >= lo; y--) {
        const block = chunks.getVoxel(x, y, z)
        if (block !== AIR && isPathSurface(palette, block)) return { y, block }
    }
    return null
}

export function buildTerrainStrokeEdits(
    chunks: ChunkManager,
    palette: Palette,
    tool: TerrainTool,
    center: { x: number; y: number; z: number },
    settings: TerrainStrokeSettings,
    direction: 1 | -1 = 1,
): VoxelEdit[] {
    if (tool === 'ramp') return []
    const columns = terrainBrushColumns(center, settings)
    const edits: VoxelEdit[] = []
    const surfaces = new Map<string, TerrainSurfaceSample | null>()

    for (const column of columns) {
        const surface = findOrSampleSurface(chunks, palette, surfaces, column.x, column.z, settings.minY, settings.maxY)
        const currentY = surface?.y ?? Math.floor(center.y)
        if (tool === 'paint-surface') {
            if (!surface) continue
            pushUnique(edits, { x: column.x, y: surface.y, z: column.z, value: settings.activeBlock })
            continue
        }

        let targetY = currentY
        if (tool === 'sculpt') {
            const amount = signedVoxelDelta(settings.strength, column.weight, direction)
            if (amount === 0) continue
            targetY = currentY + amount
        } else if (tool === 'flatten') {
            const step = signedStepToward(currentY, settings.targetHeight, settings.strength, column.weight)
            if (step === 0) continue
            targetY = currentY + step
        } else if (tool === 'smooth') {
            const average = neighboringAverage(chunks, palette, column.x, column.z, settings.minY, settings.maxY)
            if (average === null) continue
            const blend = clamp01(settings.strength * column.weight)
            targetY = Math.round(lerp(currentY, average, blend))
            if (targetY === currentY) continue
        }

        appendSetColumnHeightEdits(edits, chunks, column.x, column.z, surface, targetY, {
            minY: settings.minY,
            maxY: settings.maxY,
            fillBlock: settings.fillBlock,
            topBlock: settings.repaintTop ? settings.activeBlock : undefined,
        })
    }

    return compactEdits(edits, chunks)
}

export function buildRampEdits(
    chunks: ChunkManager,
    palette: Palette,
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    settings: RampSettings,
): VoxelEdit[] {
    const width = Math.max(1, Math.floor(settings.width))
    const half = Math.max(0, Math.floor((width - 1) / 2))
    const dx = to.x - from.x
    const dz = to.z - from.z
    const lenSq = dx * dx + dz * dz
    const edits: VoxelEdit[] = []
    const surfaces = new Map<string, TerrainSurfaceSample | null>()

    if (lenSq <= EPSILON) {
        const surface = findOrSampleSurface(chunks, palette, surfaces, from.x, from.z, settings.minY, settings.maxY)
        appendSetColumnHeightEdits(edits, chunks, from.x, from.z, surface, to.y, {
            minY: settings.minY,
            maxY: settings.maxY,
            fillBlock: settings.fillBlock,
            topBlock: settings.repaintTop ? settings.activeBlock : undefined,
        })
        return compactEdits(edits, chunks)
    }

    const len = Math.sqrt(lenSq)
    const minX = Math.floor(Math.min(from.x, to.x) - half - 1)
    const maxX = Math.ceil(Math.max(from.x, to.x) + half + 1)
    const minZ = Math.floor(Math.min(from.z, to.z) - half - 1)
    const maxZ = Math.ceil(Math.max(from.z, to.z) + half + 1)

    for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
            const px = x - from.x
            const pz = z - from.z
            const t = clamp01((px * dx + pz * dz) / lenSq)
            const closestX = from.x + dx * t
            const closestZ = from.z + dz * t
            if (Math.hypot(x - closestX, z - closestZ) > half + 0.5) continue
            const targetY = Math.round(lerp(from.y, to.y, t))
            const surface = findOrSampleSurface(chunks, palette, surfaces, x, z, settings.minY, settings.maxY)
            appendSetColumnHeightEdits(edits, chunks, x, z, surface, targetY, {
                minY: settings.minY,
                maxY: settings.maxY,
                fillBlock: settings.fillBlock,
                topBlock: settings.repaintTop ? settings.activeBlock : undefined,
            })
        }
    }

    return compactEdits(edits, chunks)
}

function appendSetColumnHeightEdits(
    edits: VoxelEdit[],
    chunks: ChunkManager,
    x: number,
    z: number,
    surface: TerrainSurfaceSample | null,
    targetYRaw: number,
    settings: TerrainEditSettings,
): void {
    const minY = Math.floor(Math.min(settings.minY, settings.maxY))
    const maxY = Math.floor(Math.max(settings.minY, settings.maxY))
    const targetY = clampInt(Math.round(targetYRaw), minY, maxY)
    const currentY = surface?.y
    const oldTop = surface?.block
    const topBlock = settings.topBlock ?? oldTop ?? settings.fillBlock

    if (currentY === undefined) {
        for (let y = minY; y < targetY; y++) pushUnique(edits, { x, y, z, value: settings.fillBlock })
        pushUnique(edits, { x, y: targetY, z, value: topBlock })
        return
    }

    if (targetY > currentY) {
        for (let y = currentY; y < targetY; y++) pushUnique(edits, { x, y, z, value: settings.fillBlock })
        pushUnique(edits, { x, y: targetY, z, value: topBlock })
        return
    }

    if (targetY < currentY) {
        for (let y = currentY; y > targetY; y--) pushUnique(edits, { x, y, z, value: AIR })
        if (settings.topBlock !== undefined || chunks.getVoxel(x, targetY, z) === AIR) {
            pushUnique(edits, { x, y: targetY, z, value: topBlock })
        }
        return
    }

    if (settings.topBlock !== undefined) pushUnique(edits, { x, y: targetY, z, value: settings.topBlock })
}

function neighboringAverage(
    chunks: ChunkManager,
    palette: Palette,
    x: number,
    z: number,
    minY: number,
    maxY: number,
): number | null {
    let sum = 0
    let count = 0
    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            const surface = findTerrainSurface(chunks, palette, x + dx, z + dz, minY, maxY)
            if (!surface) continue
            sum += surface.y
            count++
        }
    }
    return count === 0 ? null : sum / count
}

function findOrSampleSurface(
    chunks: ChunkManager,
    palette: Palette,
    cache: Map<string, TerrainSurfaceSample | null>,
    x: number,
    z: number,
    minY: number,
    maxY: number,
): TerrainSurfaceSample | null {
    const key = `${x},${z}`
    if (cache.has(key)) return cache.get(key) ?? null
    const surface = findTerrainSurface(chunks, palette, x, z, minY, maxY)
    cache.set(key, surface)
    return surface
}

function signedVoxelDelta(strength: number, weight: number, direction: 1 | -1): number {
    const amount = Math.round(Math.max(0, strength) * weight)
    return amount === 0 ? 0 : amount * direction
}

function signedStepToward(current: number, target: number, strength: number, weight: number): number {
    const diff = Math.round(target) - current
    if (diff === 0) return 0
    const amount = Math.round(Math.max(0, strength) * weight)
    if (amount === 0) return 0
    return Math.sign(diff) * Math.min(Math.abs(diff), amount)
}

function pushUnique(edits: VoxelEdit[], edit: VoxelEdit): void {
    edits.push(edit)
}

function compactEdits(edits: VoxelEdit[], chunks: ChunkManager): VoxelEdit[] {
    const byCell = new Map<string, VoxelEdit>()
    for (const edit of edits) byCell.set(`${edit.x},${edit.y},${edit.z}`, edit)
    return [...byCell.values()].filter((edit) => chunks.getVoxel(edit.x, edit.y, edit.z) !== edit.value)
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0
    return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampInt(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}
