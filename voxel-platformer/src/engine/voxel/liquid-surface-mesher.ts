import {
    liquidBlockKind,
    occludesFaces,
    type LiquidBlockKind,
    type Palette,
} from './palette'
import type { VoxelSampler } from './greedy-mesher'

export interface LiquidSurfaceMeshData {
    positions: Float32Array
    normals: Float32Array
    uvs: Float32Array
    indices: Uint32Array
    vertexCount: number
    triangleCount: number
}

export interface LiquidSurfaceMeshOptions {
    /** World voxel origin of the meshed chunk. Positions are emitted in
     *  world space so shader noise stays continuous across chunk borders. */
    baseX?: number
    baseY?: number
    baseZ?: number
    /** Grid subdivisions per voxel cell. Higher values improve vertex
     *  displacement but increase geometry. Default 3. */
    subdivisionsPerCell?: number
    /** Small upward offset to prevent z-fighting with the translucent
     *  voxel top face. Default 0.018. */
    surfaceOffset?: number
}

const EMPTY: LiquidSurfaceMeshData = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    triangleCount: 0,
}

export function liquidTopSurfaceMesh(
    sample: VoxelSampler,
    dim: number,
    palette: Palette,
    kind: LiquidBlockKind,
    opts: LiquidSurfaceMeshOptions = {},
): LiquidSurfaceMeshData {
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const mask = new Uint8Array(dim * dim)
    const baseX = opts.baseX ?? 0
    const baseY = opts.baseY ?? 0
    const baseZ = opts.baseZ ?? 0
    const subdivisionsPerCell = Math.max(1, Math.min(8, Math.floor(opts.subdivisionsPerCell ?? 3)))
    const surfaceOffset = opts.surfaceOffset ?? 0.018
    let vertexBase = 0

    for (let y = 0; y < dim; y++) {
        mask.fill(0)
        for (let z = 0; z < dim; z++) {
            for (let x = 0; x < dim; x++) {
                const block = sample(x, y, z)
                if (liquidBlockKind(palette, block) !== kind) continue
                const above = sample(x, y + 1, z)
                if (liquidBlockKind(palette, above)) continue
                if (occludesFaces(palette, above)) continue
                mask[x + z * dim] = 1
            }
        }

        for (let z = 0; z < dim; z++) {
            for (let x = 0; x < dim;) {
                if (mask[x + z * dim] === 0) {
                    x++
                    continue
                }

                let w = 1
                while (x + w < dim && mask[x + w + z * dim] === 1) w++

                let h = 1
                extend: while (z + h < dim) {
                    for (let k = 0; k < w; k++) {
                        if (mask[x + k + (z + h) * dim] !== 1) break extend
                    }
                    h++
                }

                const added = appendSurfaceGrid({
                    positions,
                    normals,
                    uvs,
                    indices,
                    vertexBase,
                    x0: baseX + x,
                    x1: baseX + x + w,
                    y: baseY + y + 1 + surfaceOffset,
                    z0: baseZ + z,
                    z1: baseZ + z + h,
                    segX: w * subdivisionsPerCell,
                    segZ: h * subdivisionsPerCell,
                })
                vertexBase += added

                for (let dz = 0; dz < h; dz++) {
                    for (let dx = 0; dx < w; dx++) {
                        mask[x + dx + (z + dz) * dim] = 0
                    }
                }
                x += w
            }
        }
    }

    if (positions.length === 0) return EMPTY
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
    }
}

interface SurfaceGridSpec {
    positions: number[]
    normals: number[]
    uvs: number[]
    indices: number[]
    vertexBase: number
    x0: number
    x1: number
    y: number
    z0: number
    z1: number
    segX: number
    segZ: number
}

function appendSurfaceGrid(spec: SurfaceGridSpec): number {
    const width = spec.x1 - spec.x0
    const depth = spec.z1 - spec.z0
    for (let iz = 0; iz <= spec.segZ; iz++) {
        const tz = iz / spec.segZ
        for (let ix = 0; ix <= spec.segX; ix++) {
            const tx = ix / spec.segX
            spec.positions.push(
                spec.x0 + width * tx,
                spec.y,
                spec.z0 + depth * tz,
            )
            spec.normals.push(0, 1, 0)
            spec.uvs.push(width * tx, depth * tz)
        }
    }

    const row = spec.segX + 1
    for (let iz = 0; iz < spec.segZ; iz++) {
        for (let ix = 0; ix < spec.segX; ix++) {
            const a = spec.vertexBase + ix + iz * row
            const b = a + 1
            const c = a + row
            const d = c + 1
            spec.indices.push(a, c, b, b, c, d)
        }
    }
    return (spec.segX + 1) * (spec.segZ + 1)
}
