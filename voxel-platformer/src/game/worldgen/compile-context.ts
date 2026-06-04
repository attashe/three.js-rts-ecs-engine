import { ChunkManager } from '../../engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../../engine/voxel/palette'
import type {
    NormalizedWorldSpec,
    Vec2Tuple,
    VoxelCoord,
    WorldgenDiagnostic,
    WorldgenReport,
} from './spec-types'
import { resolveMaterial } from './material-map'
import { hash32, rand01, randInt } from './rng'
import { addWorldgenError, addWorldgenWarning } from './report'

export interface WorldgenBounds {
    sizeX: number
    sizeY: number
    sizeZ: number
}

export class WorldgenCompileContext {
    readonly chunks: ChunkManager
    readonly sizeX: number
    readonly sizeY: number
    readonly sizeZ: number
    readonly seed: string
    readonly roadCells = new Set<string>()
    readonly reserved = new Map<string, string>()
    writtenVoxels = 0

    constructor(
        readonly spec: NormalizedWorldSpec,
        readonly report: WorldgenReport,
        chunks?: ChunkManager,
    ) {
        this.chunks = chunks ?? new ChunkManager(DEFAULT_PALETTE)
        this.sizeX = spec.world.size[0]
        this.sizeY = spec.world.size[1]
        this.sizeZ = spec.world.size[2]
        this.seed = spec.world.seed
    }

    bounds(): WorldgenBounds {
        return { sizeX: this.sizeX, sizeY: this.sizeY, sizeZ: this.sizeZ }
    }

    error(diagnostic: WorldgenDiagnostic): void {
        addWorldgenError(this.report, diagnostic)
    }

    warning(diagnostic: WorldgenDiagnostic): void {
        addWorldgenWarning(this.report, diagnostic)
    }

    material(name: unknown, fallback: keyof typeof BLOCK, path: string): number {
        if (typeof name !== 'string' || name.trim().length === 0) return BLOCK[fallback]
        const resolved = resolveMaterial(name, this.spec.materials)
        if (resolved.ok) return resolved.block
        this.error({
            code: 'invalid_material',
            message: `Unknown or invalid material "${name}".`,
            path,
            details: resolved,
        })
        return BLOCK[fallback]
    }

    number(value: unknown, fallback: number, path: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            if (value !== undefined) {
                this.error({
                    code: 'invalid_feature',
                    message: `${path} must be a finite number.`,
                    path,
                    details: { value },
                })
            }
            return fallback
        }
        let out = opts.integer ? Math.round(value) : value
        if (opts.min !== undefined && out < opts.min) out = opts.min
        if (opts.max !== undefined && out > opts.max) out = opts.max
        return out
    }

    vec2(value: unknown, path: string): Vec2Tuple | null {
        if (
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((part) => typeof part === 'number' && Number.isFinite(part))
        ) {
            return [value[0] as number, value[1] as number]
        }
        this.error({
            code: 'invalid_feature',
            message: `${path} must be a [x, z] tuple.`,
            path,
            details: { value },
        })
        return null
    }

    string(value: unknown, fallback: string, path: string): string {
        if (typeof value === 'string' && value.trim().length > 0) return value.trim()
        if (value !== undefined) {
            this.error({
                code: 'invalid_feature',
                message: `${path} must be a non-empty string.`,
                path,
                details: { value },
            })
        }
        return fallback
    }

    inXZ(x: number, z: number): boolean {
        return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < this.sizeX && z < this.sizeZ
    }

    clampSurfaceY(y: number): number {
        const minY = Math.min(3, Math.max(0, this.sizeY - 3))
        const maxY = Math.max(minY, this.sizeY - 8)
        return clamp(Math.round(y), minY, maxY)
    }

    setVoxel(x: number, y: number, z: number, block: number): void {
        if (this.chunks.setVoxel(x, y, z, block)) this.writtenVoxels += 1
    }

    key(...parts: readonly unknown[]): number {
        return hash32(this.seed, ...parts)
    }

    rand01(...parts: readonly unknown[]): number {
        return rand01(this.seed, ...parts)
    }

    randInt(lo: number, hi: number, ...parts: readonly unknown[]): number {
        return randInt(lo, hi, this.seed, ...parts)
    }

    reservationKey(x: number, z: number): string {
        return `${x},${z}`
    }

    isFootprintFree(cx: number, cz: number, width: number, depth: number, allowOwner?: string | null): boolean {
        const { minX, maxX, minZ, maxZ } = footprintBounds(cx, cz, width, depth)
        for (let z = minZ; z <= maxZ; z += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                if (!this.inXZ(x, z)) return false
                const owner = this.reserved.get(this.reservationKey(x, z))
                if (owner !== undefined && owner !== allowOwner) return false
            }
        }
        return true
    }

    reserveFootprint(id: string, cx: number, cz: number, width: number, depth: number, allowOwner?: string | null): boolean {
        if (!this.isFootprintFree(cx, cz, width, depth, allowOwner)) return false
        const { minX, maxX, minZ, maxZ } = footprintBounds(cx, cz, width, depth)
        for (let z = minZ; z <= maxZ; z += 1) {
            for (let x = minX; x <= maxX; x += 1) this.reserved.set(this.reservationKey(x, z), id)
        }
        return true
    }

    resolveAnchor(id: string, coord: VoxelCoord): void {
        this.report.resolvedAnchors[id] = coord
    }

    resolveObject(id: string, coord: VoxelCoord): void {
        this.report.resolvedObjects[id] = coord
    }
}

export function footprintBounds(cx: number, cz: number, width: number, depth: number): {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
} {
    const w = Math.max(1, Math.floor(width))
    const d = Math.max(1, Math.floor(depth))
    const minX = Math.floor(cx) - Math.floor(w / 2)
    const minZ = Math.floor(cz) - Math.floor(d / 2)
    return { minX, maxX: minX + w - 1, minZ, maxZ: minZ + d - 1 }
}

export function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value))
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

export function smoothstep(t: number): number {
    const x = clamp(t, 0, 1)
    return x * x * (3 - 2 * x)
}
