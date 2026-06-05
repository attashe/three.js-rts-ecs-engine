import {
    isRenderableVoxel,
    liquidBlockKind,
    occludesFaces,
    paletteTileIndex,
    voxelEmissive,
    voxelHeightForBlock,
    voxelOpacity,
    type Palette,
    type PaletteEntry,
} from './palette'

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
    /** Linear-space emissive RGB per vertex (intensity already folded in).
     *  All zeros for non-glowing blocks; summed by the chunk shader. */
    emissive: Float32Array
    /**
     * Per-vertex UV in [0, W] × [0, H] for a W×H merged quad. The shader
     * applies `fract` to get the per-voxel local UV (0..1) and offsets
     * into the atlas using `tileIndices`. UVs run along the mesher's
     * `u` and `v` axes for the current sweep direction, so the same
     * tile orientation appears on every face of a block regardless of
     * which axis was being swept.
     */
    uvs: Float32Array
    /**
     * Atlas tile slot index per vertex (all 4 corners of a quad share
     * the same value). The chunk shader uses
     * `mod(tileIndex, TILES_PER_ROW)` + `floor(tileIndex /
     * TILES_PER_ROW)` to derive the tile's atlas-space origin.
     */
    tileIndices: Float32Array
    /** Triangle indices. Two triangles per quad: (0,1,2) and (0,2,3) for +face, mirrored for -face. */
    indices: Uint32Array
    /** Convenience counts. */
    vertexCount: number
    triangleCount: number
}

export interface GreedyMeshOptions {
    /** Render palette entries marked `debugVisible`, even when their normal
     *  opacity is zero. Used for invisible border/debug-only authoring blocks. */
    debugVisibleBlocks?: boolean
    /** When a separate animated liquid surface is rendered, skip the base
     *  cube's exposed +Y liquid face to avoid overdraw/z-order artefacts. */
    skipLiquidTopFaces?: boolean
    /** Bake per-vertex ambient occlusion into the full-height face colours:
     *  each face corner is darkened by how many of its three plane-neighbours
     *  on the empty side are solid. Off by default (it splits merged quads at
     *  AO discontinuities, changing vertex counts); the chunk renderer turns
     *  it on for the in-world look. */
    ambientOcclusion?: boolean
}

/** Luminance multiplier per AO level (0 = most occluded corner → 3 = open).
 *  Index by the corner's AO value. Kept gentle so crevices read as shaded
 *  without crushing the block's authored colour to black. */
const AO_LUMA = [0.62, 0.78, 0.9, 1.0] as const

/** Reused scratch coord for AO neighbour sampling (mesher is synchronous). */
const AO_SCRATCH: [number, number, number] = [0, 0, 0]

const EMPTY: MeshData = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    emissive: new Float32Array(0),
    uvs: new Float32Array(0),
    tileIndices: new Float32Array(0),
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
    opts: GreedyMeshOptions = {},
): MeshData {
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const emissive: number[] = []
    const uvs: number[] = []
    const tileIndices: number[] = []
    const indices: number[] = []
    let vertexBase = 0

    vertexBase = appendPartialHeightVoxels(sample, dim, palette, opts, {
        positions,
        normals,
        colors,
        emissive,
        uvs,
        tileIndices,
        indices,
        vertexBase,
    })

    const x: [number, number, number] = [0, 0, 0]
    const mask = new Int32Array(dim * dim)
    const ao = opts.ambientOcclusion === true
    // Packed 4-corner AO per mask cell, parallel to `mask`. Cells only merge
    // when both their block id AND their AO pattern match, so AO never bleeds
    // across a merged quad.
    const aoMask = ao ? new Int32Array(dim * dim) : null

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

                    const negRenderable = isRenderable(palette, cellNeg, opts) && isFullHeightVoxel(palette, cellNeg)
                    const posRenderable = isRenderable(palette, cellPos, opts) && isFullHeightVoxel(palette, cellPos)
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
                    if (
                        opts.skipLiquidTopFaces === true
                        && d === 1
                        && m > 0
                        && liquidBlockKind(palette, m)
                    ) {
                        m = 0
                    }
                    mask[i + j * dim] = m
                    if (aoMask) {
                        aoMask[i + j * dim] = m === 0 ? 0 : packFaceAo(sample, palette, d, u, v, m > 0 ? s : s - 1, i, j)
                    }
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
                    const aoPacked = aoMask ? aoMask[i + j * dim]! : 0

                    // Width: extend along u as long as the block id (and AO
                    // pattern, when enabled) matches.
                    let w = 1
                    while (
                        i + w < dim
                        && mask[i + w + j * dim] === m
                        && (!aoMask || aoMask[i + w + j * dim] === aoPacked)
                    ) w++

                    // Height: extend along v as long as the entire `w`-wide row matches.
                    let h = 1
                    extend: while (j + h < dim) {
                        for (let k = 0; k < w; k++) {
                            const cell = i + k + (j + h) * dim
                            if (mask[cell] !== m || (aoMask && aoMask[cell] !== aoPacked)) break extend
                        }
                        h++
                    }

                    // Emit one quad.
                    const isPositive = m > 0
                    const paletteIdx = Math.abs(m)
                    const entry = palette.entries[paletteIdx]
                    const [r, g, b] = faceColor(entry, opts)
                    const a = faceOpacity(entry, palette, paletteIdx, opts)
                    const [er, eg, eb] = voxelEmissive(palette, paletteIdx)

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

                    // Per-corner UVs span [0, w] × [0, h] so the shader's
                    // fract(uv) cycles a full 0..1 tile across every voxel
                    // of the merged rectangle. Corner-order mirrors the
                    // position push order below.
                    //   c0 → (0, 0)
                    //   c1 → (w, 0)
                    //   c2 → (w, h)
                    //   c3 → (0, h)
                    if (isPositive) {
                        positions.push(c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z, c3x, c3y, c3z)
                        uvs.push(0, 0, w, 0, w, h, 0, h)
                    } else {
                        // Reverse winding for -d faces so the cross-product points -d.
                        positions.push(c0x, c0y, c0z, c3x, c3y, c3z, c2x, c2y, c2z, c1x, c1y, c1z)
                        uvs.push(0, 0, 0, h, w, h, w, 0)
                    }

                    const nx = d === 0 ? (isPositive ? 1 : -1) : 0
                    const ny = d === 1 ? (isPositive ? 1 : -1) : 0
                    const nz = d === 2 ? (isPositive ? 1 : -1) : 0
                    const tileIndex = paletteTileIndex(palette, paletteIdx)
                    for (let k = 0; k < 4; k++) normals.push(nx, ny, nz)
                    if (aoMask) {
                        // Per-corner AO darkening. c0..c3 = (0,0),(1,0),(1,1),(0,1);
                        // -d faces emit in c0,c3,c2,c1 order (reversed winding).
                        const ao0 = AO_LUMA[aoPacked & 3]!
                        const ao1 = AO_LUMA[(aoPacked >> 2) & 3]!
                        const ao2 = AO_LUMA[(aoPacked >> 4) & 3]!
                        const ao3 = AO_LUMA[(aoPacked >> 6) & 3]!
                        const order = isPositive ? [ao0, ao1, ao2, ao3] : [ao0, ao3, ao2, ao1]
                        for (const f of order) colors.push(r * f, g * f, b * f, a)
                    } else {
                        for (let k = 0; k < 4; k++) colors.push(r, g, b, a)
                    }
                    for (let k = 0; k < 4; k++) emissive.push(er, eg, eb)
                    for (let k = 0; k < 4; k++) tileIndices.push(tileIndex)

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
        emissive: new Float32Array(emissive),
        uvs: new Float32Array(uvs),
        tileIndices: new Float32Array(tileIndices),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
    }
}

function isRenderable(palette: Palette, index: number, opts: GreedyMeshOptions): boolean {
    if (isRenderableVoxel(palette, index)) return true
    return opts.debugVisibleBlocks === true && palette.entries[index]?.debugVisible === true
}

function isFullHeightVoxel(palette: Palette, index: number): boolean {
    return voxelHeightForBlock(palette, index) >= 1
}

/** 1 if the voxel at (d=dCoord, u=uCoord, v=vCoord) is a full-height
 *  face-occluding solid (an AO caster), else 0. */
function aoOccluder(
    sample: VoxelSampler,
    palette: Palette,
    d: number, u: number, v: number,
    dCoord: number, uCoord: number, vCoord: number,
): number {
    AO_SCRATCH[d] = dCoord
    AO_SCRATCH[u] = uCoord
    AO_SCRATCH[v] = vCoord
    const b = sample(AO_SCRATCH[0], AO_SCRATCH[1], AO_SCRATCH[2])
    return occludesFaces(palette, b) && voxelHeightForBlock(palette, b) >= 1 ? 1 : 0
}

/**
 * Pack the four corner AO levels (each 0..3, 2 bits) of a face cell into a
 * byte. `emptyLayer` is the d-coordinate of the open side the face looks
 * onto; occluders are sampled there. Corner order matches the emitted quad
 * corners c0..c3 = (0,0),(1,0),(1,1),(0,1) in (u,v).
 */
function packFaceAo(
    sample: VoxelSampler,
    palette: Palette,
    d: number, u: number, v: number,
    emptyLayer: number, i: number, j: number,
): number {
    let packed = 0
    for (let c = 0; c < 4; c++) {
        const cu = c === 1 || c === 2 ? 1 : 0
        const cv = c === 2 || c === 3 ? 1 : 0
        const su = cu === 0 ? -1 : 1
        const sv = cv === 0 ? -1 : 1
        const s1 = aoOccluder(sample, palette, d, u, v, emptyLayer, i + su, j)
        const s2 = aoOccluder(sample, palette, d, u, v, emptyLayer, i, j + sv)
        const cor = s1 && s2 ? 1 : aoOccluder(sample, palette, d, u, v, emptyLayer, i + su, j + sv)
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cor)
        packed |= ao << (c * 2)
    }
    return packed
}

interface PartialMeshBuffers {
    positions: number[]
    normals: number[]
    colors: number[]
    emissive: number[]
    uvs: number[]
    tileIndices: number[]
    indices: number[]
    vertexBase: number
}

function appendPartialHeightVoxels(
    sample: VoxelSampler,
    dim: number,
    palette: Palette,
    opts: GreedyMeshOptions,
    buffers: PartialMeshBuffers,
): number {
    for (let y = 0; y < dim; y++) {
        for (let z = 0; z < dim; z++) {
            for (let x = 0; x < dim; x++) {
                const block = sample(x, y, z)
                const height = voxelHeightForBlock(palette, block)
                if (height <= 0 || height >= 1 || !isRenderable(palette, block, opts)) continue
                buffers.vertexBase = appendPartialHeightVoxel(sample, palette, opts, buffers, x, y, z, block, height)
            }
        }
    }
    return buffers.vertexBase
}

function appendPartialHeightVoxel(
    sample: VoxelSampler,
    palette: Palette,
    opts: GreedyMeshOptions,
    buffers: PartialMeshBuffers,
    x: number,
    y: number,
    z: number,
    block: number,
    height: number,
): number {
    const entry = palette.entries[block]
    const [r, g, b] = faceColor(entry, opts)
    const a = faceOpacity(entry, palette, block, opts)
    const [er, eg, eb] = voxelEmissive(palette, block)
    const tileIndex = paletteTileIndex(palette, block)
    const yTop = y + height

    appendFace(buffers, [0, 1, 0], [
        x, yTop, z,
        x, yTop, z + 1,
        x + 1, yTop, z + 1,
        x + 1, yTop, z,
    ], [r, g, b, a], [er, eg, eb], tileIndex, 1, 1)

    if (!coversBottomFace(sample, palette, x, y, z)) {
        appendFace(buffers, [0, -1, 0], [
            x, y, z,
            x + 1, y, z,
            x + 1, y, z + 1,
            x, y, z + 1,
        ], [r, g, b, a], [er, eg, eb], tileIndex, 1, 1)
    }

    if (!coversSideFace(sample, palette, opts, x + 1, y, z, height)) {
        appendFace(buffers, [1, 0, 0], [
            x + 1, y, z,
            x + 1, yTop, z,
            x + 1, yTop, z + 1,
            x + 1, y, z + 1,
        ], [r, g, b, a], [er, eg, eb], tileIndex, 1, height)
    }
    if (!coversSideFace(sample, palette, opts, x - 1, y, z, height)) {
        appendFace(buffers, [-1, 0, 0], [
            x, y, z,
            x, y, z + 1,
            x, yTop, z + 1,
            x, yTop, z,
        ], [r, g, b, a], [er, eg, eb], tileIndex, 1, height)
    }
    if (!coversSideFace(sample, palette, opts, x, y, z + 1, height)) {
        appendFace(buffers, [0, 0, 1], [
            x, y, z + 1,
            x + 1, y, z + 1,
            x + 1, yTop, z + 1,
            x, yTop, z + 1,
        ], [r, g, b, a], [er, eg, eb], tileIndex, 1, height)
    }
    if (!coversSideFace(sample, palette, opts, x, y, z - 1, height)) {
        appendFace(buffers, [0, 0, -1], [
            x, y, z,
            x, yTop, z,
            x + 1, yTop, z,
            x + 1, y, z,
        ], [r, g, b, a], [er, eg, eb], tileIndex, 1, height)
    }
    return buffers.vertexBase
}

function coversBottomFace(sample: VoxelSampler, palette: Palette, x: number, y: number, z: number): boolean {
    const below = sample(x, y - 1, z)
    return occludesFaces(palette, below) && voxelHeightForBlock(palette, below) >= 1
}

function coversSideFace(
    sample: VoxelSampler,
    palette: Palette,
    opts: GreedyMeshOptions,
    x: number,
    y: number,
    z: number,
    height: number,
): boolean {
    const neighbor = sample(x, y, z)
    if (voxelHeightForBlock(palette, neighbor) < height) return false
    if (occludesFaces(palette, neighbor)) return true
    return voxelHeightForBlock(palette, neighbor) < 1 && isRenderable(palette, neighbor, opts)
}

function appendFace(
    buffers: PartialMeshBuffers,
    normal: [number, number, number],
    corners: readonly number[],
    color: [number, number, number, number],
    emissiveColor: [number, number, number],
    tileIndex: number,
    uSpan: number,
    vSpan: number,
): void {
    buffers.positions.push(...corners)
    buffers.uvs.push(0, 0, uSpan, 0, uSpan, vSpan, 0, vSpan)
    for (let k = 0; k < 4; k++) buffers.normals.push(normal[0], normal[1], normal[2])
    for (let k = 0; k < 4; k++) buffers.colors.push(color[0], color[1], color[2], color[3])
    for (let k = 0; k < 4; k++) buffers.emissive.push(emissiveColor[0], emissiveColor[1], emissiveColor[2])
    for (let k = 0; k < 4; k++) buffers.tileIndices.push(tileIndex)
    const base = buffers.vertexBase
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    buffers.vertexBase += 4
}

function faceColor(entry: PaletteEntry | undefined, opts: GreedyMeshOptions): [number, number, number] {
    if (!entry) return [1, 0, 1]
    if (opts.debugVisibleBlocks === true && entry.debugVisible === true && entry.debugColor) {
        return entry.debugColor
    }
    return entry.color
}

function faceOpacity(
    entry: PaletteEntry | undefined,
    palette: Palette,
    index: number,
    opts: GreedyMeshOptions,
): number {
    if (entry && opts.debugVisibleBlocks === true && entry.debugVisible === true && voxelOpacity(palette, index) <= 0) {
        const opacity = entry.debugOpacity ?? 0.35
        return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.35
    }
    return voxelOpacity(palette, index)
}
