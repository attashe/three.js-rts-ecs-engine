import {
    ATLAS_SIZE,
    TILE_INDEX,
    TILE_NAMES,
    TILE_SIZE,
    TILES_PER_ROW,
    type TileName,
} from './atlas-manifest'

/**
 * Procedurally builds the voxel surface atlas as a single RGBA pixel
 * buffer + a per-slot average-luminance lookup. Output is fully
 * deterministic — the per-tile painters use a seeded LCG so two runs
 * produce byte-identical pixels and the audio-asset-style hash tests
 * stay stable.
 *
 * The atlas image is grayscale-encoded into all three RGB channels
 * (A=255). The chunk material only samples `.r`; encoding into RGB
 * just keeps the format compatible with three's defaults so no special
 * texture format setup is needed.
 *
 * Tile authoring guidance: keep the *mean* of every tile close to 1.0
 * so toggling textures off (multiplier collapses to 1.0) looks
 * identical to the textured pass. Small accents below the mean (down
 * to ~0.55) read as "subtle surface detail" without changing the
 * block's perceived hue.
 */

export interface AtlasBuildResult {
    /** RGBA pixel buffer, length = ATLAS_SIZE * ATLAS_SIZE * 4. */
    readonly rgba: Uint8Array
    /** Linear width in pixels. */
    readonly width: number
    /** Linear height in pixels. */
    readonly height: number
    /** Length = TILE_SLOT_COUNT. Mean luminance (0..1) per slot. Empty
     *  slots default to 1.0 so they read as "no effect" if accidentally
     *  referenced. */
    readonly tileAverages: Float32Array
}

interface TilePainter {
    (rgba: Uint8Array, originX: number, originY: number): void
}

const PAINTERS: Record<TileName, TilePainter> = {
    blank: paintBlank,
    grass: paintGrass,
    dirt: paintDirt,
    stone: paintStone,
    brick: paintBrick,
    wood: paintWood,
    sand: paintSand,
    leaf: paintLeaf,
    plank: paintPlank,
    cloud: paintCloud,
    roof: paintRoof,
    thatch: paintThatch,
    plaster: paintPlaster,
    glass: paintGlass,
    metal: paintMetal,
}

export function buildVoxelAtlas(): AtlasBuildResult {
    const rgba = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4)
    // Default every pixel to 1.0 (white) so any unused slot reads as
    // "no detail" if it ever gets sampled.
    rgba.fill(255)

    const tileAverages = new Float32Array(TILES_PER_ROW * TILES_PER_ROW)
    tileAverages.fill(1.0)

    for (const name of TILE_NAMES) {
        const index = TILE_INDEX[name]
        const col = index % TILES_PER_ROW
        const row = Math.floor(index / TILES_PER_ROW)
        const originX = col * TILE_SIZE
        const originY = row * TILE_SIZE
        const painter = PAINTERS[name]
        painter(rgba, originX, originY)
        tileAverages[index] = computeTileAverage(rgba, originX, originY)
    }

    return { rgba, width: ATLAS_SIZE, height: ATLAS_SIZE, tileAverages }
}

function computeTileAverage(rgba: Uint8Array, originX: number, originY: number): number {
    let sum = 0
    for (let y = 0; y < TILE_SIZE; y++) {
        const row = (originY + y) * ATLAS_SIZE * 4
        for (let x = 0; x < TILE_SIZE; x++) {
            sum += rgba[row + (originX + x) * 4]!
        }
    }
    return sum / (TILE_SIZE * TILE_SIZE) / 255
}

// ────────────────────────────────────────────────────────────────────
// Pixel helpers
// ────────────────────────────────────────────────────────────────────

/** Write a grayscale luminance value (0..1) into all three RGB
 *  channels of (x, y). Clamps + rounds to a byte. */
function setLum(rgba: Uint8Array, x: number, y: number, lum: number): void {
    const v = Math.max(0, Math.min(255, Math.round(lum * 255)))
    const idx = (y * ATLAS_SIZE + x) * 4
    rgba[idx] = v
    rgba[idx + 1] = v
    rgba[idx + 2] = v
    rgba[idx + 3] = 255
}

function getLum(rgba: Uint8Array, x: number, y: number): number {
    return rgba[(y * ATLAS_SIZE + x) * 4]! / 255
}

/** Multiply the luminance at (x, y) by `factor`, clamping to [0, 1].
 *  Used to apply darker accents on top of a base pass. */
function mulLum(rgba: Uint8Array, x: number, y: number, factor: number): void {
    setLum(rgba, x, y, getLum(rgba, x, y) * factor)
}

/** Seeded LCG. Same shape as the audio synth's RNG so the determinism
 *  story is consistent across both procedural assets. */
function makeRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 0xffffffff
    }
}

/** Fill the tile region with a flat luminance. */
function fillTile(rgba: Uint8Array, originX: number, originY: number, lum: number): void {
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            setLum(rgba, originX + x, originY + y, lum)
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Tile painters — each writes a 32×32 region. Patterns are deliberately
// subtle (mostly within [0.85, 1.0]) so the block's authored colour
// stays dominant.
// ────────────────────────────────────────────────────────────────────

function paintBlank(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 1.0)
}

/** Grass — faint horizontal striations evoking blades pressed flat.
 *  Mostly 0.96–1.0 with one or two darker stripes per tile. */
function paintGrass(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(1001)
    fillTile(rgba, originX, originY, 1.0)
    for (let y = 0; y < TILE_SIZE; y++) {
        // 1px stripes — pick a row brightness, then dither slightly.
        const base = 0.94 + rng() * 0.05
        for (let x = 0; x < TILE_SIZE; x++) {
            const jitter = rng() * 0.04 - 0.02
            setLum(rgba, originX + x, originY + y, base + jitter)
        }
    }
    // Two darker accent stripes at random rows for blade hints.
    for (let i = 0; i < 2; i++) {
        const ay = Math.floor(rng() * TILE_SIZE)
        for (let x = 0; x < TILE_SIZE; x++) {
            mulLum(rgba, originX + x, originY + ay, 0.78)
        }
    }
}

/** Dirt — low-density speckles, looks "grainy". */
function paintDirt(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(2002)
    fillTile(rgba, originX, originY, 0.97)
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            if (rng() < 0.12) {
                const v = 0.62 + rng() * 0.22
                setLum(rgba, originX + x, originY + y, v)
            }
        }
    }
}

/** Stone — large soft cracks at low density. */
function paintStone(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(3003)
    fillTile(rgba, originX, originY, 0.96)
    // 3-5 random short cracks.
    const cracks = 4
    for (let c = 0; c < cracks; c++) {
        let x = Math.floor(rng() * TILE_SIZE)
        let y = Math.floor(rng() * TILE_SIZE)
        const length = 4 + Math.floor(rng() * 8)
        const dir = rng() < 0.5 ? 0 : 1 // 0 = horizontal, 1 = vertical
        const darkness = 0.62 + rng() * 0.18
        for (let i = 0; i < length; i++) {
            if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) {
                mulLum(rgba, originX + x, originY + y, darkness)
            }
            if (dir === 0) x += rng() < 0.85 ? 1 : 0
            else y += rng() < 0.85 ? 1 : 0
            // Small chance to drift perpendicular for a less mechanical look.
            if (rng() < 0.18) {
                if (dir === 0) y += rng() < 0.5 ? -1 : 1
                else x += rng() < 0.5 ? -1 : 1
            }
        }
    }
}

/** Brick — horizontal joint lines every 8 px, vertical staggered joints. */
function paintBrick(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.97)
    const rowHeight = 8
    const brickWidth = 16
    for (let y = 0; y < TILE_SIZE; y++) {
        const rowIdx = Math.floor(y / rowHeight)
        const onHorizJoint = y % rowHeight === 0
        const offsetX = (rowIdx % 2) * (brickWidth / 2)
        for (let x = 0; x < TILE_SIZE; x++) {
            const localX = (x + offsetX) % brickWidth
            const onVertJoint = localX === 0
            if (onHorizJoint || onVertJoint) {
                setLum(rgba, originX + x, originY + y, 0.66)
            }
        }
    }
}

/** Wood — vertical grain. A few full-height darker stripes plus per-pixel jitter. */
function paintWood(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(4004)
    // Base column brightness — varies smoothly across the tile.
    const cols: number[] = []
    for (let x = 0; x < TILE_SIZE; x++) {
        cols.push(0.92 + Math.sin(x * 0.45) * 0.04 + rng() * 0.03)
    }
    // Punch in 3 darker grain lines.
    const grainLines = 3
    for (let g = 0; g < grainLines; g++) {
        const col = Math.floor(rng() * TILE_SIZE)
        cols[col] = 0.72 + rng() * 0.06
    }
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const jitter = rng() * 0.03 - 0.015
            setLum(rgba, originX + x, originY + y, cols[x]! + jitter)
        }
    }
}

/** Sand — fine high-density speckle. */
function paintSand(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(5005)
    fillTile(rgba, originX, originY, 0.98)
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const r = rng()
            if (r < 0.35) {
                setLum(rgba, originX + x, originY + y, 0.86 + rng() * 0.10)
            } else if (r < 0.40) {
                setLum(rgba, originX + x, originY + y, 0.72 + rng() * 0.10)
            }
        }
    }
}

/** Leaf — clustered dark dots, like foliage shadow. */
function paintLeaf(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(6006)
    fillTile(rgba, originX, originY, 0.96)
    // 4 cluster centres of ~4 dots each.
    for (let c = 0; c < 4; c++) {
        const cx = Math.floor(rng() * TILE_SIZE)
        const cy = Math.floor(rng() * TILE_SIZE)
        const dots = 3 + Math.floor(rng() * 4)
        for (let d = 0; d < dots; d++) {
            const ox = cx + Math.floor(rng() * 5 - 2)
            const oy = cy + Math.floor(rng() * 5 - 2)
            if (ox >= 0 && ox < TILE_SIZE && oy >= 0 && oy < TILE_SIZE) {
                mulLum(rgba, originX + ox, originY + oy, 0.74)
            }
        }
    }
}

/** Plank — wood texture with a single horizontal seam at y=16. */
function paintPlank(rgba: Uint8Array, originX: number, originY: number): void {
    paintWood(rgba, originX, originY)
    const seamY = TILE_SIZE / 2
    for (let x = 0; x < TILE_SIZE; x++) {
        setLum(rgba, originX + x, originY + seamY, 0.62)
    }
}

/** Cloud — large soft puffs over a near-white base. Subtler than the rest. */
function paintCloud(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(7007)
    fillTile(rgba, originX, originY, 1.0)
    // 5 soft circles at low density darkening factor.
    for (let c = 0; c < 5; c++) {
        const cx = rng() * TILE_SIZE
        const cy = rng() * TILE_SIZE
        const r = 4 + rng() * 5
        const r2 = r * r
        const minLum = 0.92 + rng() * 0.04
        for (let y = 0; y < TILE_SIZE; y++) {
            for (let x = 0; x < TILE_SIZE; x++) {
                const dx = x - cx
                const dy = y - cy
                const d2 = dx * dx + dy * dy
                if (d2 < r2) {
                    const t = 1 - d2 / r2
                    const v = minLum + (1 - minLum) * (1 - t)
                    const prev = getLum(rgba, originX + x, originY + y)
                    if (v < prev) setLum(rgba, originX + x, originY + y, v)
                }
            }
        }
    }
}

/** Roof tile — staggered rows with shallow shadow joints. */
function paintRoof(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.97)
    const tileH = 6
    const tileW = 10
    for (let y = 0; y < TILE_SIZE; y++) {
        const row = Math.floor(y / tileH)
        const rowY = y % tileH
        const offset = (row % 2) * Math.floor(tileW / 2)
        for (let x = 0; x < TILE_SIZE; x++) {
            const localX = (x + offset) % tileW
            if (rowY === 0 || localX === 0) setLum(rgba, originX + x, originY + y, 0.70)
            else if (rowY === 1) setLum(rgba, originX + x, originY + y, 0.86)
        }
    }
}

/** Thatch — loose diagonal straw lines over a warm base. */
function paintThatch(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(8008)
    fillTile(rgba, originX, originY, 0.98)
    for (let i = 0; i < 34; i++) {
        let x = Math.floor(rng() * TILE_SIZE)
        let y = Math.floor(rng() * TILE_SIZE)
        const len = 3 + Math.floor(rng() * 8)
        const slope = rng() < 0.5 ? -1 : 1
        const lum = 0.72 + rng() * 0.16
        for (let s = 0; s < len; s++) {
            if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) setLum(rgba, originX + x, originY + y, lum)
            x += 1
            if (rng() < 0.55) y += slope
        }
    }
}

/** Plaster — mostly smooth with a few soft flecks. */
function paintPlaster(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(9009)
    fillTile(rgba, originX, originY, 0.98)
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            if (rng() < 0.075) setLum(rgba, originX + x, originY + y, 0.80 + rng() * 0.14)
        }
    }
}

/** Glass — clean diagonal highlights and a darker lower edge. */
function paintGlass(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.98)
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            if (Math.abs((x - y) - 4) <= 1 || Math.abs((x - y) - 16) <= 1) {
                setLum(rgba, originX + x, originY + y, 1.0)
            } else if (y > TILE_SIZE - 4 || x < 2) {
                setLum(rgba, originX + x, originY + y, 0.84)
            }
        }
    }
}

/** Metal — broad bands and tiny rivet dots. */
function paintMetal(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(10010)
    fillTile(rgba, originX, originY, 0.96)
    for (let y = 0; y < TILE_SIZE; y++) {
        const band = Math.sin(y * 0.52) * 0.04
        for (let x = 0; x < TILE_SIZE; x++) setLum(rgba, originX + x, originY + y, 0.93 + band)
    }
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(rng() * TILE_SIZE)
        const y = Math.floor(rng() * TILE_SIZE)
        setLum(rgba, originX + x, originY + y, 0.66)
    }
}
