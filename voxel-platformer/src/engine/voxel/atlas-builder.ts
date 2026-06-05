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
 * Most atlas tiles are grayscale multipliers encoded into all three RGB
 * channels. Gameplay-readable shop/storage tiles may author real RGB
 * colors; the chunk material samples the full RGB value.
 *
 * Tile authoring guidance: keep the *mean* of every tile bright enough
 * that the block's authored hue still dominates. Terrain tiles should
 * stay subtle, but gameplay-readable blocks (chests, ore, shelves) may
 * use larger high-contrast shapes because the isometric camera collapses
 * fine texture detail quickly.
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

const STRONG_LINE_LUM = 0.02
const WOOD_LINE_LUM = 0.14

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
            const idx = row + (originX + x) * 4
            const r = rgba[idx]! / 255
            const g = rgba[idx + 1]! / 255
            const b = rgba[idx + 2]! / 255
            sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
    }
    return sum / (TILE_SIZE * TILE_SIZE)
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

function setRgb(rgba: Uint8Array, x: number, y: number, rgb: readonly [number, number, number]): void {
    const idx = (y * ATLAS_SIZE + x) * 4
    rgba[idx] = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)))
    rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)))
    rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)))
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

function fillTileRgb(rgba: Uint8Array, originX: number, originY: number, rgb: readonly [number, number, number]): void {
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            setRgb(rgba, originX + x, originY + y, rgb)
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

/** Grass — intentionally flat. The gameplay camera makes small grass
 *  striations read as noise rather than useful detail. */
function paintGrass(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 1.0)
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

/** Stone — intentionally flat. Ore and authored props can carry strong
 *  markings; ordinary stone should stay quiet. */
function paintStone(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 1.0)
}

/** Brick — horizontal joint lines every 8 px, vertical staggered joints. */
function paintBrick(rgba: Uint8Array, originX: number, originY: number): void {
    fillTile(rgba, originX, originY, 0.99)
    const rowHeight = 8
    const brickWidth = 16
    for (let y = 0; y < TILE_SIZE; y++) {
        const rowIdx = Math.floor(y / rowHeight)
        const rowY = y % rowHeight
        const onHorizJoint = rowY < 2
        const offsetX = (rowIdx % 2) * (brickWidth / 2)
        for (let x = 0; x < TILE_SIZE; x++) {
            const localX = (x + offsetX) % brickWidth
            const onVertJoint = localX < 2
            if (onHorizJoint || onVertJoint) setLum(rgba, originX + x, originY + y, STRONG_LINE_LUM)
            else if (rowY === 2 || localX === 2) setLum(rgba, originX + x, originY + y, 0.78)
        }
    }
}

/** Wood — vertical grain. A few full-height darker stripes plus per-pixel jitter. */
function paintWood(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(4004)
    const cols: number[] = []
    for (let x = 0; x < TILE_SIZE; x++) {
        cols.push(0.96 + Math.sin(x * 0.45) * 0.025 + rng() * 0.02)
    }
    const grainLines = [7 + Math.floor(rng() * 3), 21 + Math.floor(rng() * 3)]
    for (const col of grainLines) {
        cols[col] = WOOD_LINE_LUM
        cols[Math.min(TILE_SIZE - 1, col + 1)] = WOOD_LINE_LUM
    }
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const jitter = rng() * 0.03 - 0.015
            setLum(rgba, originX + x, originY + y, cols[x]! + jitter)
        }
    }
}

/** Closed chest — simplified to a few oversized landmarks: thick rim,
 *  heavy bands, a hard lid seam, and one large central lock. */
function paintChest(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(7301)
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            let lum = 0.98 + (rng() - 0.5) * 0.035
            if (x === 10 || x === 21) lum *= 0.86
            setLum(rgba, originX + x, originY + y, lum)
        }
    }

    drawTileBorder(rgba, originX, originY, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 2, originY + 6, TILE_SIZE - 4, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 2, originY + 22, TILE_SIZE - 4, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 2, originY + 12, TILE_SIZE - 4, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 7, originY + 2, 2, TILE_SIZE - 4, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 23, originY + 2, 2, TILE_SIZE - 4, STRONG_LINE_LUM)

    drawSoftRect(rgba, originX + 11, originY + 9, 10, 12, 0.9)
    drawRectFrame(rgba, originX + 10, originY + 8, 12, 14, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 14, originY + 13, 4, 5, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 15, originY + 18, 2, 3, STRONG_LINE_LUM)
    for (const [rx, ry] of [[5, 5], [26, 5], [5, 23], [26, 23]] as const) drawSoftRect(rgba, originX + rx, originY + ry, 2, 2, 0.9)
}

/** Open chest — same bold silhouette, with a single readable black mouth
 *  and bright lip instead of many small contents pixels. */
function paintOpenChest(rgba: Uint8Array, originX: number, originY: number): void {
    paintChest(rgba, originX, originY)
    drawSoftRect(rgba, originX + 6, originY + 7, 20, 4, 0.98)
    drawRectFrame(rgba, originX + 5, originY + 6, 22, 6, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 5, originY + 12, 22, 9, 0.08)
    drawRectFrame(rgba, originX + 5, originY + 12, 22, 9, 2, STRONG_LINE_LUM)
    for (let x = 6; x <= 25; x += 1) setLum(rgba, originX + x, originY + 20, 0.78)
    drawSoftRect(rgba, originX + 13, originY + 14, 6, 3, 0.92)
    setLum(rgba, originX + 18, originY + 13, 1.0)
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
    fillTileRgb(rgba, originX, originY, [1.0, 0.72, 0.34])
    drawShelfGrid(rgba, originX, originY)
    drawRgbRect(rgba, originX + 7, originY + 9, 9, 7, [0.98, 0.04, 0.02])
    drawRgbRect(rgba, originX + 20, originY + 9, 7, 7, [1.0, 0.78, 0.08])
    drawRgbRect(rgba, originX + 7, originY + 21, 9, 6, [0.08, 0.74, 0.12])
    drawRgbRect(rgba, originX + 21, originY + 20, 6, 8, [0.08, 0.34, 1.0])
}

/** Tool panel — a cheap wall block with silhouettes of picks and hammers. */
function paintToolPanel(rgba: Uint8Array, originX: number, originY: number): void {
    fillTileRgb(rgba, originX, originY, [0.92, 0.68, 0.38])
    drawRectFrame(rgba, originX + 4, originY + 4, 24, 24, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 9, originY + 9, 3, 16, STRONG_LINE_LUM)
    drawRgbRect(rgba, originX + 6, originY + 9, 10, 4, [0.86, 0.88, 0.88])
    drawSoftRect(rgba, originX + 20, originY + 8, 3, 17, STRONG_LINE_LUM)
    drawRgbRect(rgba, originX + 17, originY + 9, 9, 4, [0.86, 0.88, 0.88])
    drawRgbRect(rgba, originX + 18, originY + 21, 7, 4, [0.86, 0.88, 0.88])
}

/** Ore shelf — stacked bins and bright ore chunks for storage rooms. */
function paintOreShelf(rgba: Uint8Array, originX: number, originY: number): void {
    fillTileRgb(rgba, originX, originY, [0.82, 0.76, 0.62])
    drawShelfGrid(rgba, originX, originY)
    drawOreBin(rgba, originX + 6, originY + 10, [0.82, 0.86, 0.88])
    drawOreBin(rgba, originX + 18, originY + 10, [0.98, 0.44, 0.08])
    drawOreBin(rgba, originX + 6, originY + 20, [0.08, 0.75, 1.0])
    drawOreBin(rgba, originX + 18, originY + 20, [0.92, 0.92, 0.78])
}

/** Record shelf — ledgers, scrolls, and marker lines for meeting/office rooms. */
function paintRecordShelf(rgba: Uint8Array, originX: number, originY: number): void {
    fillTileRgb(rgba, originX, originY, [1.0, 0.74, 0.40])
    drawShelfGrid(rgba, originX, originY)
    drawRgbRect(rgba, originX + 7, originY + 9, 8, 8, [0.82, 0.08, 0.08])
    drawRgbRect(rgba, originX + 18, originY + 9, 8, 8, [0.08, 0.25, 0.90])
    drawRgbRect(rgba, originX + 7, originY + 20, 8, 7, [0.12, 0.62, 0.18])
    drawRgbRect(rgba, originX + 19, originY + 20, 7, 7, [0.92, 0.84, 0.58])
    for (const [x, y, w, h] of [[7, 9, 8, 8], [18, 9, 8, 8], [7, 20, 8, 7], [19, 20, 7, 7]] as const) {
        drawRectOutline(rgba, originX + x, originY + y, w, h, STRONG_LINE_LUM)
    }
}

/** Iron ore — neutral stone with large silver deposits, no black cracks. */
function paintOreIron(rgba: Uint8Array, originX: number, originY: number): void {
    paintOreStoneBack(rgba, originX, originY)
    drawOreVeinRgb(rgba, originX + 5, originY + 9, 18, 1, [0.58, 0.64, 0.68])
    drawOrePatchRgb(rgba, originX + 10, originY + 12, 6, [0.52, 0.58, 0.62], [0.80, 0.86, 0.88], [1.0, 1.0, 0.94])
    drawOrePatchRgb(rgba, originX + 23, originY + 20, 6, [0.50, 0.56, 0.60], [0.78, 0.84, 0.86], [0.98, 1.0, 0.96])
    drawOrePatchRgb(rgba, originX + 14, originY + 25, 4, [0.54, 0.60, 0.64], [0.78, 0.84, 0.86], [0.96, 0.98, 0.92])
}

/** Copper ore — neutral stone with broad orange mineral pockets. */
function paintOreCopper(rgba: Uint8Array, originX: number, originY: number): void {
    paintOreStoneBack(rgba, originX, originY)
    drawOreVeinRgb(rgba, originX + 4, originY + 18, 21, -1, [0.78, 0.26, 0.05])
    drawOrePatchRgb(rgba, originX + 9, originY + 12, 7, [0.62, 0.18, 0.04], [0.98, 0.44, 0.08], [1.0, 0.78, 0.18])
    drawOrePatchRgb(rgba, originX + 22, originY + 22, 7, [0.64, 0.20, 0.04], [0.96, 0.40, 0.08], [1.0, 0.74, 0.16])
    drawOrePatchRgb(rgba, originX + 20, originY + 8, 4, [0.72, 0.24, 0.05], [1.0, 0.50, 0.10], [1.0, 0.84, 0.26])
}

/** Crystal ore — neutral stone with cyan crystal clusters. */
function paintOreCrystal(rgba: Uint8Array, originX: number, originY: number): void {
    paintOreStoneBack(rgba, originX, originY)
    drawOreVeinRgb(rgba, originX + 4, originY + 24, 19, -1, [0.06, 0.58, 0.82])
    drawOrePatchRgb(rgba, originX + 11, originY + 13, 8, [0.04, 0.36, 0.78], [0.08, 0.78, 1.0], [0.70, 1.0, 1.0])
    drawOrePatchRgb(rgba, originX + 23, originY + 23, 6, [0.04, 0.42, 0.82], [0.12, 0.82, 1.0], [0.74, 1.0, 1.0])
    drawOrePatchRgb(rgba, originX + 22, originY + 9, 5, [0.05, 0.46, 0.84], [0.16, 0.86, 1.0], [0.80, 1.0, 1.0])
}

function drawSoftRect(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, lum: number): void {
    for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) setLum(rgba, x, y, lum)
    }
}

function drawRgbRect(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, rgb: readonly [number, number, number]): void {
    for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) setRgb(rgba, x, y, rgb)
    }
}

function drawShelfGrid(rgba: Uint8Array, originX: number, originY: number): void {
    drawRectFrame(rgba, originX + 3, originY + 4, TILE_SIZE - 6, TILE_SIZE - 7, 2, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX + 4, originY + 17, TILE_SIZE - 8, 2, STRONG_LINE_LUM)
}

function drawOreBin(rgba: Uint8Array, x0: number, y0: number, rgb: readonly [number, number, number]): void {
    drawRgbRect(rgba, x0, y0, 8, 7, rgb)
    drawRectFrame(rgba, x0 - 1, y0 - 1, 10, 9, 2, STRONG_LINE_LUM)
    drawRgbRect(rgba, x0 + 2, y0 + 1, 4, 2, [1, 1, 1])
}

function paintOreStoneBack(rgba: Uint8Array, originX: number, originY: number): void {
    fillTileRgb(rgba, originX, originY, [0.88, 0.88, 0.90])
    drawRgbRect(rgba, originX + 2, originY + 5, 5, 2, [0.78, 0.78, 0.80])
    drawRgbRect(rgba, originX + 25, originY + 13, 4, 2, [0.80, 0.80, 0.82])
    drawRgbRect(rgba, originX + 4, originY + 27, 6, 2, [0.76, 0.76, 0.78])
}

function drawOrePatchRgb(
    rgba: Uint8Array,
    cx: number,
    cy: number,
    radius: number,
    edge: readonly [number, number, number],
    core: readonly [number, number, number],
    highlight: readonly [number, number, number],
): void {
    for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            const d = Math.abs(dx) + Math.abs(dy)
            if (d > radius) continue
            const x = cx + dx
            const y = cy + dy
            if (x < 0 || x >= ATLAS_SIZE || y < 0 || y >= ATLAS_SIZE) continue
            if (d >= radius - 1) setRgb(rgba, x, y, edge)
            else if (dy > 1 || dx < -radius / 2) setRgb(rgba, x, y, mixRgb(edge, core, 0.58))
            else setRgb(rgba, x, y, core)
        }
    }
    const hiY = cy - Math.floor(radius / 3)
    for (let i = 0; i < Math.max(3, radius - 2); i += 1) {
        setRgb(rgba, cx - 1 + i, hiY, highlight)
        setRgb(rgba, cx + i, hiY + 1, mixRgb(core, highlight, 0.48))
    }
}

function drawOreVeinRgb(
    rgba: Uint8Array,
    x0: number,
    y0: number,
    length: number,
    slope: 1 | -1,
    rgb: readonly [number, number, number],
): void {
    for (let i = 0; i < length; i += 1) {
        const x = x0 + i
        const y = y0 + Math.floor(i / 3) * slope
        drawRgbRect(rgba, x, y, 2, 2, rgb)
    }
}

function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

function drawTileBorder(rgba: Uint8Array, originX: number, originY: number, width: number, lum: number): void {
    for (let i = 0; i < width; i += 1) {
        for (let x = i; x < TILE_SIZE - i; x += 1) {
            setLum(rgba, originX + x, originY + i, lum)
            setLum(rgba, originX + x, originY + TILE_SIZE - 1 - i, lum)
        }
        for (let y = i; y < TILE_SIZE - i; y += 1) {
            setLum(rgba, originX + i, originY + y, lum)
            setLum(rgba, originX + TILE_SIZE - 1 - i, originY + y, lum)
        }
    }
}

function drawRectOutline(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, lum: number): void {
    for (let x = x0; x < x0 + w; x += 1) {
        setLum(rgba, x, y0, lum)
        setLum(rgba, x, y0 + h - 1, lum)
    }
    for (let y = y0; y < y0 + h; y += 1) {
        setLum(rgba, x0, y, lum)
        setLum(rgba, x0 + w - 1, y, lum)
    }
}

function drawRectFrame(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, thickness: number, lum: number): void {
    for (let i = 0; i < thickness; i += 1) {
        for (let x = x0 + i; x < x0 + w - i; x += 1) {
            setLum(rgba, x, y0 + i, lum)
            setLum(rgba, x, y0 + h - 1 - i, lum)
        }
        for (let y = y0 + i; y < y0 + h - i; y += 1) {
            setLum(rgba, x0 + i, y, lum)
            setLum(rgba, x0 + w - 1 - i, y, lum)
        }
    }
}

function drawHangingTool(rgba: Uint8Array, x0: number, y0: number, dir: 1 | -1): void {
    drawSoftRect(rgba, x0, y0, 2, 15, STRONG_LINE_LUM)
    for (let x = 0; x <= 5; x += 1) drawSoftRect(rgba, x0 + x * dir, y0 + 2 + Math.floor(x / 2), 2, 2, STRONG_LINE_LUM)
}

function drawBookSpine(rgba: Uint8Array, x: number, y: number, lum: number): void {
    drawSoftRect(rgba, x, y, 2, 7, lum)
    drawRectOutline(rgba, x, y, 2, 7, STRONG_LINE_LUM)
}

function drawScroll(rgba: Uint8Array, x: number, y: number): void {
    drawSoftRect(rgba, x, y, 4, 6, 0.84)
    drawRectOutline(rgba, x, y, 4, 6, STRONG_LINE_LUM)
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
    drawSoftRect(rgba, originX, originY + TILE_SIZE / 2 - 1, TILE_SIZE, 3, STRONG_LINE_LUM)
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
    fillTile(rgba, originX, originY, 0.99)
    const tileH = 10
    const tileW = 16
    for (let y = 0; y < TILE_SIZE; y++) {
        const row = Math.floor(y / tileH)
        const rowY = y % tileH
        const offset = (row % 2) * Math.floor(tileW / 2)
        for (let x = 0; x < TILE_SIZE; x++) {
            const localX = (x + offset) % tileW
            if (rowY < 2 || localX < 2) setLum(rgba, originX + x, originY + y, STRONG_LINE_LUM)
            else if (rowY === 2 || localX === 2) setLum(rgba, originX + x, originY + y, 0.78)
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
            }
        }
    }
    drawSoftRect(rgba, originX, originY, 2, TILE_SIZE, STRONG_LINE_LUM)
    drawSoftRect(rgba, originX, originY + TILE_SIZE - 3, TILE_SIZE, 3, STRONG_LINE_LUM)
}

/** Metal — broad bands and tiny rivet dots. */
function paintMetal(rgba: Uint8Array, originX: number, originY: number): void {
    const rng = makeRng(10010)
    fillTile(rgba, originX, originY, 0.96)
    for (let y = 0; y < TILE_SIZE; y++) {
        const band = Math.sin(y * 0.52) * 0.04
        for (let x = 0; x < TILE_SIZE; x++) setLum(rgba, originX + x, originY + y, 0.93 + band)
    }
    for (const y of [7, 15, 23]) drawSoftRect(rgba, originX, originY + y, TILE_SIZE, 2, STRONG_LINE_LUM)
    for (let i = 0; i < 8; i++) {
        const x = Math.floor(rng() * TILE_SIZE)
        const y = Math.floor(rng() * TILE_SIZE)
        drawSoftRect(rgba, originX + Math.min(TILE_SIZE - 2, x), originY + Math.min(TILE_SIZE - 2, y), 2, 2, STRONG_LINE_LUM)
    }
}
