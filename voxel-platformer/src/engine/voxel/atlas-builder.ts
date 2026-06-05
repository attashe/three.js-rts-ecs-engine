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
    chest: paintChest,
    chest_open: paintOpenChest,
    spider_web: paintSpiderWeb,
    shelf_goods: paintGoodsShelf,
    tool_panel: paintToolPanel,
    ore_shelf: paintOreShelf,
    record_shelf: paintRecordShelf,
    ore_iron: paintOreIron,
    ore_copper: paintOreCopper,
    ore_crystal: paintOreCrystal,
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

/** Closed chest — a banded wooden coffer: vertical plank slats, an iron
 *  rim, a lid seam across the upper third, and a centred lock plate with a
 *  keyhole. The strong silhouette reads as a chest at iso/32px sizes. */
function paintChest(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(7301)
    // Plank body: vertical planks with grooved seams + faint grain.
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            let lum = 0.93 + (rng() - 0.5) * 0.05
            if (x % 8 === 0 || x % 8 === 7) lum *= 0.9 // plank seam grooves
            setLum(rgba, originX + x, originY + y, lum)
        }
    }
    // Lid seam: the lid is the top ~10 rows, split from the body by a groove.
    for (let x = 0; x < TILE_SIZE; x++) {
        setLum(rgba, originX + x, originY + 10, 0.5)
        setLum(rgba, originX + x, originY + 11, 0.62)
    }
    // Two horizontal iron straps with bright rivets — the classic chest banding.
    for (const sy of [4, 22]) {
        for (let x = 0; x < TILE_SIZE; x++) {
            setLum(rgba, originX + x, originY + sy, 0.6)
            setLum(rgba, originX + x, originY + sy + 1, 0.54)
        }
        for (const rx of [3, 15, 28]) {
            setLum(rgba, originX + rx, originY + sy, 0.86)
            setLum(rgba, originX + rx, originY + sy + 1, 0.8)
        }
    }
    // Short iron corner brackets.
    for (const [cx, cy, dx, dy] of [[1, 1, 1, 1], [30, 1, -1, 1], [1, 30, 1, -1], [30, 30, -1, -1]] as const) {
        for (let k = 0; k < 5; k++) {
            mulLum(rgba, originX + cx + dx * k, originY + cy, 0.66)
            mulLum(rgba, originX + cx, originY + cy + dy * k, 0.66)
        }
    }
    // Central lock plate where the lid meets the body, with a dark keyhole.
    drawSoftRect(rgba, originX + 13, originY + 8, 6, 7, 0.87)
    for (let y = 8; y <= 14; y++) {
        mulLum(rgba, originX + 13, originY + y, 0.62)
        mulLum(rgba, originX + 18, originY + y, 0.62)
    }
    setLum(rgba, originX + 15, originY + 11, 0.34)
    setLum(rgba, originX + 16, originY + 11, 0.34)
    setLum(rgba, originX + 15, originY + 12, 0.42)
    setLum(rgba, originX + 16, originY + 12, 0.42)
}

/** Open chest — the lid is up (seam pushed to the top), revealing a dark
 *  interior cavity with a faint contents glint, keeping the iron rim. */
function paintOpenChest(rgba: Uint8Array, originX: number, originY: number): void {
    paintChest(rgba, originX, originY)
    // Carve a contained open interior over the lid/lock region. Kept moderate
    // (not pitch black) so the tile still averages bright enough.
    for (let y = 8; y <= 15; y++) {
        for (let x = 7; x < TILE_SIZE - 7; x++) setLum(rgba, originX + x, originY + y, 0.66)
    }
    // Bright lifted lid above the opening + lip lines top and bottom.
    for (let x = 7; x < TILE_SIZE - 7; x++) {
        for (let y = 3; y <= 6; y++) setLum(rgba, originX + x, originY + y, 0.97)
        setLum(rgba, originX + x, originY + 7, 0.82)
        setLum(rgba, originX + x, originY + 16, 0.76)
    }
    // Faint glint of contents inside.
    for (const [gx, gy] of [[11, 13], [18, 10], [21, 14], [14, 12]] as const) {
        setLum(rgba, originX + gx, originY + gy, 0.9)
    }
}

/** Spider web — corner-anchored strands with sagging cross-threads and
 *  denser knots. The asymmetry reads as tangled webbing instead of the
 *  old target-like radial pattern. */
function paintSpiderWeb(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(8053)
    fillTile(rgba, originX, originY, 1.0)

    // A neglected cobweb strung corner-to-corner: a sagging hammock along the
    // top-left → bottom-right diagonal, anchor fans clustered in those two
    // corners, and a few drooping capture threads bridging them. Asymmetric on
    // purpose (a tangled web, not a tidy radial target), but covering both
    // sides of the face. Threads are thin dark lines on the pale web block.
    const STRAND = 0.6
    // Draw a strand from (x0,y0) to (x1,y1), bowed downward by `sag` at mid-span.
    const strand = (x0: number, y0: number, x1: number, y1: number, sag: number): void => {
        const steps = Math.max(8, Math.round(Math.hypot(x1 - x0, y1 - y0) * 1.7))
        for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const bow = Math.sin(t * Math.PI) * sag
            const x = Math.round(x0 + (x1 - x0) * t)
            const y = Math.round(y0 + (y1 - y0) * t + bow)
            if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) setLum(rgba, originX + x, originY + y, STRAND)
        }
    }

    // Suspension hammock (TL ↔ BR) — several near-parallel strands, each with a
    // different downward droop, so the descending diagonal dominates.
    strand(0, 0, 31, 31, 2)
    strand(0, 3, 29, 31, 5)
    strand(3, 0, 31, 29, 1)
    strand(0, 6, 26, 31, 8)
    strand(0, 1, 31, 27, 4)
    // Anchor fans clustered in the TL and BR corners.
    for (const [tx, ty] of [[13, 1], [1, 13], [17, 5], [5, 17], [22, 2]] as const) strand(0, 0, tx, ty, 1)
    for (const [tx, ty] of [[18, 30], [30, 18], [14, 26], [26, 14], [9, 29]] as const) strand(31, 31, tx, ty, 1)
    // Drooping capture threads bridging the hammock, biased to the diagonal.
    strand(4, 9, 15, 7, 3)
    strand(10, 17, 23, 15, 4)
    strand(17, 23, 28, 21, 3)

    // Sparse dew/dust glints away from the strands.
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(rng() * TILE_SIZE)
        const y = Math.floor(rng() * TILE_SIZE)
        if (getLum(rgba, originX + x, originY + y) > 0.9) setLum(rgba, originX + x, originY + y, 0.9)
    }
}

/** Goods shelf — shelves with tiny jars and bundles drawn into the face. */
function paintGoodsShelf(rgba: Uint8Array, originX: number, originY: number): void {
    paintPlank(rgba, originX, originY)
    for (const y of [8, 17, 26]) {
        for (let x = 3; x < TILE_SIZE - 3; x += 1) setLum(rgba, originX + x, originY + y, 0.66)
    }
    for (const x of [5, 15, 25]) {
        for (let y = 5; y < TILE_SIZE - 4; y += 1) if (y % 9 !== 8) setLum(rgba, originX + x, originY + y, 0.76)
    }
    drawSoftRect(rgba, originX + 8, originY + 11, 4, 5, 0.74)
    drawSoftRect(rgba, originX + 18, originY + 11, 5, 5, 0.82)
    drawSoftRect(rgba, originX + 9, originY + 20, 5, 4, 0.78)
    drawSoftRect(rgba, originX + 20, originY + 20, 4, 4, 0.72)
}

/** Tool panel — a cheap wall block with silhouettes of picks and hammers. */
function paintToolPanel(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.96)
    for (const y of [5, 26]) for (let x = 3; x < TILE_SIZE - 3; x += 1) setLum(rgba, originX + x, originY + y, 0.70)
    for (const x of [5, 26]) for (let y = 5; y <= 26; y += 1) setLum(rgba, originX + x, originY + y, 0.74)
    drawHangingTool(rgba, originX + 10, originY + 8, 1)
    drawHangingTool(rgba, originX + 19, originY + 8, -1)
    for (let y = 11; y <= 23; y += 1) setLum(rgba, originX + 15, originY + y, 0.64)
    for (let x = 12; x <= 18; x += 1) setLum(rgba, originX + x, originY + 11, 0.66)
}

/** Ore shelf — stacked bins and bright ore chunks for storage rooms. */
function paintOreShelf(rgba: Uint8Array, originX: number, originY: number): void {
    paintStone(rgba, originX, originY)
    for (const y of [9, 18, 27]) {
        for (let x = 3; x < TILE_SIZE - 3; x += 1) setLum(rgba, originX + x, originY + y, 0.67)
    }
    for (const x of [6, 16, 25]) {
        for (let y = 6; y < TILE_SIZE - 4; y += 1) setLum(rgba, originX + x, originY + y, 0.73)
    }
    for (const [x, y, lum] of [
        [10, 13, 0.58], [12, 14, 0.88], [21, 13, 0.62],
        [9, 22, 0.72], [19, 22, 0.56], [23, 23, 0.90],
    ] as const) {
        drawSoftRect(rgba, originX + x, originY + y, 3, 3, lum)
    }
}

/** Record shelf — ledgers, scrolls, and marker lines for meeting/office rooms. */
function paintRecordShelf(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.98)
    for (const y of [7, 16, 25]) {
        for (let x = 4; x < TILE_SIZE - 4; x += 1) setLum(rgba, originX + x, originY + y, 0.68)
    }
    for (let x = 7; x <= 13; x += 2) drawBookSpine(rgba, originX + x, originY + 9, 0.68 + (x % 4) * 0.04)
    for (let x = 18; x <= 24; x += 3) drawScroll(rgba, originX + x, originY + 10)
    for (let x = 8; x <= 24; x += 2) drawBookSpine(rgba, originX + x, originY + 18, 0.72)
}

/** Iron ore — stone shot through with angular metallic nuggets: a dark
 *  rim around a bright core so each speck reads as a hard chunk of ore. */
function paintOreIron(rgba: Uint8Array, originX: number, originY: number): void {
    paintStone(rgba, originX, originY)
    scatterOre(rgba, originX, originY, 4801, 8, (x, y) => {
        drawSoftRect(rgba, x - 1, y - 1, 3, 3, 0.72) // dark socket
        setLum(rgba, x, y, 0.99)                      // metallic glint
        setLum(rgba, x + 1, y, 0.9)
        setLum(rgba, x, y + 1, 0.88)
    })
}

/** Copper ore — rounder, veinier blobs than iron, with a soft highlight
 *  so the deposits read as smoother metal pockets. */
function paintOreCopper(rgba: Uint8Array, originX: number, originY: number): void {
    paintStone(rgba, originX, originY)
    scatterOre(rgba, originX, originY, 4907, 7, (x, y) => {
        drawSoftRect(rgba, x - 1, y - 1, 4, 3, 0.78) // blob body
        setLum(rgba, x, y, 0.97)
        setLum(rgba, x + 1, y, 1.0)                   // highlight
        setLum(rgba, x + 2, y + 1, 0.86)
    })
}

/** Crystal ore — faceted gems embedded in stone: bright diamond cores
 *  with shaded facet edges so they catch the eye (matches the block's
 *  emissive glow). */
function paintOreCrystal(rgba: Uint8Array, originX: number, originY: number): void {
    paintStone(rgba, originX, originY)
    scatterOre(rgba, originX, originY, 5021, 6, (x, y) => {
        setLum(rgba, x, y - 2, 0.7)
        setLum(rgba, x - 1, y - 1, 0.82); setLum(rgba, x, y - 1, 1.0); setLum(rgba, x + 1, y - 1, 0.8)
        setLum(rgba, x - 1, y, 0.9); setLum(rgba, x, y, 1.0); setLum(rgba, x + 1, y, 0.88)
        setLum(rgba, x - 1, y + 1, 0.74); setLum(rgba, x, y + 1, 0.84); setLum(rgba, x + 1, y + 1, 0.72)
        setLum(rgba, x, y + 2, 0.68)
    })
}

/** Deterministic scatter of ore specks within the tile interior. */
function scatterOre(
    rgba: Uint8Array,
    originX: number,
    originY: number,
    seed: number,
    count: number,
    draw: (x: number, y: number) => void,
): void {
    const rng = makeRng(seed)
    for (let i = 0; i < count; i++) {
        const x = originX + 4 + Math.floor(rng() * (TILE_SIZE - 8))
        const y = originY + 4 + Math.floor(rng() * (TILE_SIZE - 8))
        draw(x, y)
    }
}

function drawSoftRect(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, lum: number): void {
    for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) setLum(rgba, x, y, lum)
    }
}

function drawHangingTool(rgba: Uint8Array, x0: number, y0: number, dir: 1 | -1): void {
    for (let y = 0; y < 15; y += 1) setLum(rgba, x0, y0 + y, 0.62)
    for (let x = 0; x <= 5; x += 1) setLum(rgba, x0 + x * dir, y0 + 2 + Math.floor(x / 2), 0.58)
}

function drawBookSpine(rgba: Uint8Array, x: number, y: number, lum: number): void {
    for (let yy = y; yy <= y + 6; yy += 1) setLum(rgba, x, yy, lum)
}

function drawScroll(rgba: Uint8Array, x: number, y: number): void {
    drawSoftRect(rgba, x, y, 4, 6, 0.84)
    setLum(rgba, x, y, 0.66)
    setLum(rgba, x + 3, y + 5, 0.66)
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
