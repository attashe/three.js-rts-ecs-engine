import { attribute, positionWorld, select, texture as tslTexture, uniform, vertexColor } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { DataTexture, NearestFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three'

export interface VoxelVertexColorOpts {
    /** PBR roughness. 0 = mirror, 1 = chalky. Default 0.85. */
    roughness?: number
    /** PBR metalness. Default 0. Voxels are usually non-metallic. */
    metalness?: number
    /** Per-face shading (no smoothing across vertex normals). Default true — typical voxel look. */
    flatShading?: boolean
    /** Color multiplier applied to active-layer cells that have hidden
     *  geometry above them. Default 0.65 keeps the block type readable
     *  while still making the covered state obvious. */
    coveredCellDarken?: number
    /** Opacity applied to fragments above the working plane (top-down
     *  cut). Default 0.30. */
    aboveCutOpacity?: number
    /** Size of the working-plane mask texture (square, world-cell units).
     *  Default 256 — large enough for the editor's demo levels; far-away
     *  cells wrap modulo this size. */
    maskSize?: number
}

export interface VoxelMaterial {
    material: MeshStandardNodeMaterial
    /** Mark the working-plane row at world Y = `y`. With a cut active:
     *    - cells *at* WY render normally (their painted colour);
     *    - cells at WY whose XZ column has hidden geometry above it (the
     *      cover mask, see `setCoverMaskCells`) render faded;
     *    - *above-WY* fragments can fade, though top-down view also clips
     *      them at the camera so they cannot depth-occlude the active layer.
     *  Pass `null` to disable the cut (everything renders normally). */
    setCutY(y: number | null): void
    /** Replace the cover mask. Each `{x, z}` is a world-cell column that
     *  contains hidden geometry above the current working plane. */
    setCoverMaskCells(cells: Iterable<{ x: number; z: number }>): void
}

const NO_CUT_Y = 1e6
const DEFAULT_MASK_SIZE = 256

/**
 * PBR-lit voxel material with optional working-plane indicators.
 *
 * With a cut active, two effects layer onto the per-vertex colour:
 *   1. **Above the working plane** (`y ≥ cutY + 1.5`, half-cell centre) —
 *      translucent ghosts at `aboveCutOpacity` so upper geometry doesn't
 *      obscure the working layer in top-down view.
 *   2. **Active-layer cells with hidden geometry above them** — the
 *      painted colour is multiplied by `coveredCellDarken`, producing
 *      a faded-but-readable covered state.
 *
 * Cells *at* the working plane row render with their normal colour at
 * full opacity — they're what you're editing, so they should look like
 * themselves. The cover mask is a 2-D `DataTexture` sampled per-fragment
 * at the cell's XZ position; it wraps modulo `maskSize` so coordinates
 * far from the origin alias (fine for the demo editor's small worlds).
 */
export function createVoxelVertexColor(opts: VoxelVertexColorOpts = {}): VoxelMaterial {
    const darken = opts.coveredCellDarken ?? 0.65
    const aboveOpacity = opts.aboveCutOpacity ?? 0.30
    const maskSize = opts.maskSize ?? DEFAULT_MASK_SIZE

    const cutActiveUniform = uniform(0)
    const cutYUniform = uniform(NO_CUT_Y)
    const maskData = new Uint8Array(maskSize * maskSize)
    const maskTex = new DataTexture(maskData, maskSize, maskSize, RedFormat, UnsignedByteType)
    maskTex.magFilter = NearestFilter
    maskTex.minFilter = NearestFilter
    maskTex.wrapS = RepeatWrapping
    maskTex.wrapT = RepeatWrapping
    maskTex.needsUpdate = true

    const m = new MeshStandardNodeMaterial({
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.0,
        flatShading: opts.flatShading ?? true,
    })

    const y = positionWorld.y
    // Half-cell offsets — the cell at world Y = N occupies y in [N, N+1].
    // Comparing against `cutY + 0.5` and `cutY + 1.5` (cell centres)
    // keeps boundary faces classified by which cell they geometrically
    // belong to instead of flipping at integer Y boundaries.
    const halfBelow = cutYUniform.add(0.5)
    const halfAbove = cutYUniform.add(1.5)
    const cutActive = cutActiveUniform.greaterThan(0.5)
    const isAbove = cutActive.and(y.greaterThanEqual(halfAbove))
    const isActiveLayer = y.greaterThanEqual(halfBelow).and(y.lessThan(halfAbove))

    // Mask sample. Floor positionWorld.xz to an integer cell coordinate,
    // wrap modulo maskSize, and look up the red channel — non-zero means
    // "hidden non-air exists above this XZ column".
    const cellXZ = positionWorld.xz.floor()
    const uv = cellXZ.add(0.5).div(maskSize)
    const maskValue = tslTexture(maskTex, uv).r
    const isCovered = cutActive.and(isActiveLayer).and(maskValue.greaterThan(0.5))

    const base = vertexColor()
    const baseColor = base.rgb
    m.colorNode = select(isCovered, baseColor.mul(darken), baseColor)
    m.opacityNode = base.a.mul(select(isAbove, aboveOpacity, 1.0))
    // Per-vertex emissive RGB (intensity pre-multiplied by the mesher).
    // Glow blocks therefore add a self-illuminated colour on top of the lit
    // colour without consuming a real light slot — useful both as a cheap
    // ornament and as a visual marker for blocks that ALSO spawn a real
    // PointLight via the block-light system.
    m.emissiveNode = attribute('emissive')
    m.transparent = true
    // NOTE: leave depthWrite at its default (true). Disabling depth write
    // on the chunk mesh would stop terrain from occluding the player,
    // entities, debug overlays etc. — a much worse regression than the
    // "black block" artefact it would otherwise mitigate. Solving the
    // transparent-occludes-solid case properly needs a separate
    // transparent submesh, which is a future refactor.

    return {
        material: m,
        setCutY(y) {
            cutActiveUniform.value = y === null ? 0 : 1
            cutYUniform.value = y === null ? NO_CUT_Y : y
        },
        setCoverMaskCells(cells) {
            maskData.fill(0)
            for (const cell of cells) {
                // ((n % m) + m) % m — positive remainder for negative coords.
                const mx = ((cell.x % maskSize) + maskSize) % maskSize
                const mz = ((cell.z % maskSize) + maskSize) % maskSize
                maskData[mz * maskSize + mx] = 255
            }
            maskTex.needsUpdate = true
        },
    }
}
