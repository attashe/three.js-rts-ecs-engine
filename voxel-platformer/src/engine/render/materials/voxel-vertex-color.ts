import {
    attribute,
    float,
    mix,
    positionWorld,
    select,
    texture as tslTexture,
    uniform,
    vec2,
    vertexColor,
} from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
    DataTexture,
    NearestFilter,
    RGBAFormat,
    RedFormat,
    RepeatWrapping,
    UnsignedByteType,
    Vector2,
    type Texture,
} from 'three'
import { TILES_PER_ROW, TILE_UV_SIZE } from '../../voxel/atlas-manifest'

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
    /**
     * Surface atlas to sample for per-block texture detail. Build with
     * `buildVoxelAtlas()` and wrap with `createAtlasTexture()`. When
     * absent the material runs in flat-only mode — the atlas branch in
     * the shader collapses to a 1.0 multiplier, so blocks render
     * exactly like the pre-texture build.
     */
    atlas?: Texture | null
    /** Initial toggle state for the texture pass. Default `true`. */
    texturesEnabled?: boolean
    /** Lower bound of the tile-luminance tint range when textures are
     *  on. Default 0.80 — a fully-dark tile texel darkens the block
     *  to 80% of its vertex colour.
     *
     *  IMPORTANT: keep `tintHigh` at 1.0. The `blank` tile is uniform
     *  1.0 and is the fallback used by every palette entry without
     *  `textureKey`. If `tintHigh` ever exceeds 1.0, plain-colour
     *  blocks render *brighter* than they did before this texture
     *  pass existed — which is exactly the regression the optional
     *  `textureKey` was designed to avoid. */
    tintLow?: number
    /** Upper bound. Default 1.0. See `tintLow` for why this should
     *  stay at 1.0 unless you also want to disable the "plain blocks
     *  look the same" guarantee. */
    tintHigh?: number
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
    /** Localised cutaway: hide voxels above `y` within `radius` of `center`
     *  (world XZ). Shader-only — no remesh — so it can follow a moving target
     *  every frame. Pass `null` to clear. */
    setLocalCut(params: { center: { x: number; z: number }; radius: number; y: number } | null): void
    /** Toggle the atlas-sampling pass at runtime. When `false` every
     *  block — textured or not — renders as pure vertex colour. */
    setTexturesEnabled(enabled: boolean): void
}

const NO_CUT_Y = 1e6
const DEFAULT_MASK_SIZE = 256

/**
 * PBR-lit voxel material with optional working-plane indicators.
 *
 * Two visual layers compose into the final colour:
 *
 *  1. **Per-vertex colour** — the palette entry's authored RGB, the
 *     same value the old flat-only material rendered.
 *  2. **Atlas surface tile** — a 32×32 grayscale tile from the
 *     procedural voxel atlas, sampled per-fragment using the
 *     `voxelUV` and `voxelTileIndex` mesh attributes. The tile value
 *     drives a tight tint range (default ±10%) multiplied into the
 *     base colour, so the block keeps its hue and the texture only
 *     adds small surface detail.
 *
 * The atlas pass is gated by a uniform so the host can flip it on/off
 * at runtime. Off-state multiplier is exactly 1.0, which makes the
 * material visually identical to the pre-texture build.
 *
 * Cut-plane behaviour (working-plane fade + cover mask) is unchanged
 * from the previous revision — those nodes layer on top of the
 * tinted base colour.
 */
export function createVoxelVertexColor(opts: VoxelVertexColorOpts = {}): VoxelMaterial {
    const darken = opts.coveredCellDarken ?? 0.65
    const aboveOpacity = opts.aboveCutOpacity ?? 0.30
    const maskSize = opts.maskSize ?? DEFAULT_MASK_SIZE
    const tintLow = opts.tintLow ?? 0.80
    const tintHigh = opts.tintHigh ?? 1.0

    const cutActiveUniform = uniform(0)
    const cutYUniform = uniform(NO_CUT_Y)
    // Localised in-game cutaway (separate from the editor's global working-
    // plane cut above): hide voxels above `localCutY` within `localCutRadius`
    // of `localCutCenter` (world XZ), so the character is revealed under cover
    // without slicing the rest of the world.
    const localCutActiveUniform = uniform(0)
    const localCutYUniform = uniform(NO_CUT_Y)
    const localCutCenterUniform = uniform(new Vector2(0, 0))
    const localCutRadiusUniform = uniform(0)
    const useTexturesUniform = uniform(opts.texturesEnabled === false ? 0 : 1)
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

    // ── Atlas sampling ────────────────────────────────────────────────
    // The mesher emits `voxelUV` in [0, W] × [0, H] for a W×H merged
    // quad. `fract` collapses it to per-voxel 0..1; we then offset
    // into the tile's atlas-space origin. Nearest sampling (set on the
    // atlas DataTexture) keeps tile boundaries pixel-perfect — no
    // bilinear bleed across slots.
    const tileIndex = attribute<'float'>('voxelTileIndex', 'float')
    const tileX = tileIndex.mod(float(TILES_PER_ROW))
    const tileY = tileIndex.div(float(TILES_PER_ROW)).floor()
    const tileOriginU = tileX.mul(float(TILE_UV_SIZE))
    const tileOriginV = tileY.mul(float(TILE_UV_SIZE))
    const voxelUV = attribute<'vec2'>('voxelUV', 'vec2')
    const localUV = voxelUV.fract().mul(float(TILE_UV_SIZE))
    const atlasUV = vec2(tileOriginU.add(localUV.x), tileOriginV.add(localUV.y))
    // When no atlas is supplied we fall back to a flat 1.0 sample —
    // the shader path is identical, just yields 1.0 everywhere so the
    // tint range collapses to a no-op.
    const atlasSample = opts.atlas ? tslTexture(opts.atlas, atlasUV).r : float(1.0)
    const texturedFactor = mix(float(tintLow), float(tintHigh), atlasSample)
    const tileFactor = mix(float(1.0), texturedFactor, useTexturesUniform)

    // ── Cut-plane fade + cover mask (unchanged behaviour) ────────────
    const y = positionWorld.y
    const halfBelow = cutYUniform.add(0.5)
    const halfAbove = cutYUniform.add(1.5)
    const cutActive = cutActiveUniform.greaterThan(0.5)
    const isAbove = cutActive.and(y.greaterThanEqual(halfAbove))
    const isActiveLayer = y.greaterThanEqual(halfBelow).and(y.lessThan(halfAbove))

    const cellXZ = positionWorld.xz.floor()
    const maskUV = cellXZ.add(0.5).div(maskSize)
    const maskValue = tslTexture(maskTex, maskUV).r
    const isCovered = cutActive.and(isActiveLayer).and(maskValue.greaterThan(0.5))

    // ── Localised cutaway dome ────────────────────────────────────────
    // A fragment inside the dome (above the local cut Y and within the XZ
    // radius of the centre) is forced fully transparent; `alphaTest` then
    // discards it so it neither draws nor writes depth — the geometry stays
    // meshed but stops hiding the character. Everything outside the dome is
    // untouched, so distant terrain/buildings are never sliced.
    const inLocalDome = localCutActiveUniform.greaterThan(0.5)
        .and(y.greaterThan(localCutYUniform))
        .and(positionWorld.xz.sub(localCutCenterUniform).length().lessThan(localCutRadiusUniform))

    const base = vertexColor()
    const baseColor = base.rgb.mul(tileFactor)
    m.colorNode = select(isCovered, baseColor.mul(darken), baseColor)
    m.opacityNode = base.a
        .mul(select(isAbove, aboveOpacity, 1.0))
        .mul(select(inLocalDome, float(0.0), float(1.0)))
    // Discard the fully-transparent dome fragments (opacity 0) so they don't
    // depth-occlude the revealed character. The threshold sits below every
    // real block/glass alpha, so only the dome is culled.
    m.alphaTest = 0.01
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
        setLocalCut(params) {
            if (!params) {
                localCutActiveUniform.value = 0
                return
            }
            localCutActiveUniform.value = 1
            localCutYUniform.value = params.y
            localCutCenterUniform.value.set(params.center.x, params.center.z)
            localCutRadiusUniform.value = params.radius
        },
        setTexturesEnabled(enabled) {
            useTexturesUniform.value = enabled ? 1 : 0
        },
    }
}

/**
 * Wrap a `buildVoxelAtlas()` pixel buffer in a `DataTexture` configured
 * for pixel-perfect voxel sampling — nearest filtering, no mipmaps, no
 * wrapping. The caller owns the resulting texture and should `dispose`
 * it on teardown.
 */
export function createAtlasTexture(rgba: Uint8Array, width: number, height: number): DataTexture {
    const tex = new DataTexture(rgba, width, height, RGBAFormat, UnsignedByteType)
    tex.magFilter = NearestFilter
    tex.minFilter = NearestFilter
    // Default ClampToEdgeWrapping — the shader's per-voxel UV math
    // already keeps the sample inside the tile's region.
    tex.needsUpdate = true
    return tex
}
