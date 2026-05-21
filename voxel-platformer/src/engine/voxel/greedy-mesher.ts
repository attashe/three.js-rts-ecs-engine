import { isRenderableVoxel, occludesFaces, voxelOpacity, type Palette } from './palette'

/**
 * Sample function — returns the palette index at a voxel coord. The mesher
 * calls this with coords that may include the immediate boundary outside
 * `[0, dim)` along the meshed axis, so the call site is responsible for
 * forwarding boundary reads to neighbour chunks (or returning AIR=0 if no
 * neighbour exists).
 */
export type VoxelSampler = (x: number, y: number, z: number) => number

export interface MeshData {
    /** [x, y, z, x, y, z, ...] in chunk-local space. */
    positions: Float32Array
    /** Flat per-face normals (same value for all 4 corners of a quad). */
    normals: Float32Array
    /** Linear-space RGBA per vertex, sampled from `palette.entries[idx]`. */
    colors: Float32Array
    /** Triangle indices. Two triangles per quad: (0,1,2) and (0,2,3) for +face, mirrored for -face. */
    indices: Uint32Array
    /** Convenience counts. */
    vertexCount: number
    triangleCount: number
}

const EMPTY: MeshData = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    triangleCount: 0,
}

/**
 * Greedy-mesh a chunk via Mikola-Lysenko sweep. For each of the three axes
 * we walk perpendicular slices, build a 2D mask of visible faces, and merge
 * adjacent same-color cells into rectangles before emitting them as quads.
 *
 * The mesher is pure: state lives only in the locals. Threadable as-is —
 * `mesher.worker.ts` (when we move it off-thread) just imports this fn.
 *
 * Winding: front-faces are CCW. Three uses right-handed coords; the cross
 * product of (c1-c0) × (c3-c0) for a +d face equals (+d), and the negative-
 * face winding is the reverse so its cross is (-d). Both render correctly
 * with default `side: FrontSide`.
 */
export function greedyMesh(
    sample: VoxelSampler,
    dim: number,
    palette: Palette,
): MeshData {
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    let vertexBase = 0

    const x: [number, number, number] = [0, 0, 0]
    const mask = new Int32Array(dim * dim)

    for (let d = 0; d < 3; d++) {
        const u = (d + 1) % 3
        const v = (d + 2) % 3

        for (let s = 0; s <= dim; s++) {
            // Build the mask for this slice.
            for (let j = 0; j < dim; j++) {
                x[v] = j
                for (let i = 0; i < dim; i++) {
                    x[u] = i

                    x[d] = s - 1
                    const cellNeg = sample(x[0], x[1], x[2])
                    x[d] = s
                    const cellPos = sample(x[0], x[1], x[2])

                    const negRenderable = isRenderableVoxel(palette, cellNeg)
                    const posRenderable = isRenderableVoxel(palette, cellPos)
                    const negOccludes = occludesFaces(palette, cellNeg)
                    const posOccludes = occludesFaces(palette, cellPos)

                    let m = 0
                    if (s - 1 >= 0 && negRenderable && !posOccludes && cellNeg !== cellPos) {
                        // +d face — visible voxel sits behind, transparent/non-occluding space in front.
                        m = cellNeg
                    } else if (s < dim && !negOccludes && posRenderable && cellNeg !== cellPos) {
                        // -d face — visible voxel sits in front, transparent/non-occluding space behind.
                        m = -cellPos
                    }
                    mask[i + j * dim] = m
                }
            }

            // Greedy-merge same-value rectangles in the mask.
            for (let j = 0; j < dim; j++) {
                for (let i = 0; i < dim;) {
                    const m = mask[i + j * dim]
                    if (m === 0) {
                        i++
                        continue
                    }

                    // Width: extend along u as long as mask matches.
                    let w = 1
                    while (i + w < dim && mask[i + w + j * dim] === m) w++

                    // Height: extend along v as long as the entire `w`-wide row matches.
                    let h = 1
                    extend: while (j + h < dim) {
                        for (let k = 0; k < w; k++) {
                            if (mask[i + k + (j + h) * dim] !== m) break extend
                        }
                        h++
                    }

                    // Emit one quad.
                    const isPositive = m > 0
                    const paletteIdx = Math.abs(m)
                    const entry = palette.entries[paletteIdx]
                    const [r, g, b] = entry?.color ?? [1, 0, 1]
                    const a = voxelOpacity(palette, paletteIdx)

                    // Quad-local axes in world space.
                    const pos: [number, number, number] = [0, 0, 0]
                    pos[d] = s
                    pos[u] = i
                    pos[v] = j

                    const du: [number, number, number] = [0, 0, 0]
                    du[u] = w
                    const dv: [number, number, number] = [0, 0, 0]
                    dv[v] = h

                    const c0x = pos[0], c0y = pos[1], c0z = pos[2]
                    const c1x = c0x + du[0], c1y = c0y + du[1], c1z = c0z + du[2]
                    const c2x = c1x + dv[0], c2y = c1y + dv[1], c2z = c1z + dv[2]
                    const c3x = c0x + dv[0], c3y = c0y + dv[1], c3z = c0z + dv[2]

                    if (isPositive) {
                        positions.push(c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z, c3x, c3y, c3z)
                    } else {
                        // Reverse winding for -d faces so the cross-product points -d.
                        positions.push(c0x, c0y, c0z, c3x, c3y, c3z, c2x, c2y, c2z, c1x, c1y, c1z)
                    }

                    const nx = d === 0 ? (isPositive ? 1 : -1) : 0
                    const ny = d === 1 ? (isPositive ? 1 : -1) : 0
                    const nz = d === 2 ? (isPositive ? 1 : -1) : 0
                    for (let k = 0; k < 4; k++) normals.push(nx, ny, nz)
                    for (let k = 0; k < 4; k++) colors.push(r, g, b, a)

                    indices.push(
                        vertexBase, vertexBase + 1, vertexBase + 2,
                        vertexBase, vertexBase + 2, vertexBase + 3,
                    )
                    vertexBase += 4

                    // Zero out the consumed cells so the inner loop skips them.
                    for (let jj = 0; jj < h; jj++) {
                        for (let ii = 0; ii < w; ii++) {
                            mask[i + ii + (j + jj) * dim] = 0
                        }
                    }
                    i += w
                }
            }
        }
    }

    if (positions.length === 0) return EMPTY

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
    }
}
