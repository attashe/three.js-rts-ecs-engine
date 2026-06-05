import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildVoxelAtlas } from '../src/engine/voxel/atlas-builder'
import {
    ATLAS_SIZE,
    TILE_INDEX,
    TILE_NAMES,
    TILE_SIZE,
    TILE_SLOT_COUNT,
    TILES_PER_ROW,
} from '../src/engine/voxel/atlas-manifest'

test('atlas manifest constants are internally consistent', () => {
    assert.equal(ATLAS_SIZE, TILE_SIZE * TILES_PER_ROW)
    assert.equal(TILE_SLOT_COUNT, TILES_PER_ROW * TILES_PER_ROW)
    assert.equal(TILE_INDEX.blank, 0,
        'tile 0 must be blank — palette entries without textureKey fall through to slot 0')
    for (const [i, name] of TILE_NAMES.entries()) {
        assert.equal(TILE_INDEX[name], i, `${name} should map to slot ${i}`)
    }
})

test('buildVoxelAtlas yields the expected RGBA buffer size + alpha=255 throughout', () => {
    const result = buildVoxelAtlas()
    assert.equal(result.width, ATLAS_SIZE)
    assert.equal(result.height, ATLAS_SIZE)
    assert.equal(result.rgba.length, ATLAS_SIZE * ATLAS_SIZE * 4)
    // Spot-check alpha — every pixel must be fully opaque, otherwise
    // the chunk material would render the texture as transparent on
    // top of the lit colour.
    for (let i = 3; i < result.rgba.length; i += 4) {
        if (result.rgba[i] !== 255) {
            assert.fail(`pixel index ${i / 4} has alpha ${result.rgba[i]}, expected 255`)
        }
    }
})

test('buildVoxelAtlas is deterministic across runs (LCG-seeded painters)', () => {
    const a = buildVoxelAtlas()
    const b = buildVoxelAtlas()
    const hashA = createHash('sha256').update(a.rgba).digest('hex')
    const hashB = createHash('sha256').update(b.rgba).digest('hex')
    assert.equal(hashA, hashB,
        'two builds of the atlas must produce byte-identical pixels — ' +
        'tile painters must use only the seeded LCG, not Math.random()')
})

test('blank tile is uniform 1.0 — used as the fallback for plain-colour blocks', () => {
    const result = buildVoxelAtlas()
    const slot = TILE_INDEX.blank
    const col = slot % TILES_PER_ROW
    const row = Math.floor(slot / TILES_PER_ROW)
    const originX = col * TILE_SIZE
    const originY = row * TILE_SIZE
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const idx = ((originY + y) * ATLAS_SIZE + (originX + x)) * 4
            assert.equal(result.rgba[idx], 255, `blank tile pixel (${x},${y}) red must be 255`)
            assert.equal(result.rgba[idx + 1], 255, 'green must be 255')
            assert.equal(result.rgba[idx + 2], 255, 'blue must be 255')
        }
    }
    assert.equal(result.tileAverages[slot], 1, 'blank average must be 1.0')
})

test('grass and stone tiles stay flat to avoid noisy camera-scale patterns', () => {
    const result = buildVoxelAtlas()
    for (const [name, slot] of [['grass', TILE_INDEX.grass], ['stone', TILE_INDEX.stone]] as const) {
        const lums = tileLums(result.rgba, slot)
        assert.equal(countPixels(lums, (lum) => lum !== 1), 0, `${name} should not author texture variation`)
        assert.equal(result.tileAverages[slot], 1, `${name} average should remain neutral`)
    }
})

test('authored tile averages preserve base tone around high-contrast linework', () => {
    const result = buildVoxelAtlas()
    const minAverageByTile = new Map<string, number>([
        ['brick', 0.60],
        ['roof', 0.60],
        ['chest', 0.40],
        ['chest_open', 0.36],
        ['shelf_goods', 0.50],
        ['tool_panel', 0.54],
        ['ore_shelf', 0.42],
        ['record_shelf', 0.46],
        ['metal', 0.72],
        ['plank', 0.74],
        ['ore_copper', 0.70],
        ['ore_crystal', 0.72],
    ])
    for (const [i, name] of TILE_NAMES.entries()) {
        const avg = result.tileAverages[i]!
        const minAverage = minAverageByTile.get(name) ?? 0.80
        assert.ok(avg >= minAverage, `tile "${name}" average ${avg.toFixed(3)} is too dark`)
        assert.ok(avg <= 1.00, `tile "${name}" average ${avg.toFixed(3)} > 1`)
    }
})

test('pure wood keeps dark grain without true black cracks', () => {
    const result = buildVoxelAtlas()
    const lums = tileLums(result.rgba, TILE_INDEX.wood)

    assert.equal(countPixels(lums, (lum) => lum <= 0.05), 0, 'pure wood grain should not be black')
    assert.ok(countPixels(lums, (lum) => lum <= 0.18) >= 100, 'pure wood should still have readable dark grain')
    assert.ok(largestComponent(lums, (lum) => lum <= 0.18) >= 64, 'pure wood grain should stay connected at camera scale')
})

test('structural and shelf tiles use thick black readable linework', () => {
    const result = buildVoxelAtlas()
    for (const [name, slot, minBlackPixels, minConnectedStroke] of [
        ['brick', TILE_INDEX.brick, 180, 80],
        ['plank', TILE_INDEX.plank, 80, 80],
        ['roof', TILE_INDEX.roof, 180, 80],
        ['glass', TILE_INDEX.glass, 100, 64],
        ['metal', TILE_INDEX.metal, 150, 48],
        ['chest', TILE_INDEX.chest, 300, 120],
        ['chest_open', TILE_INDEX.chest_open, 300, 120],
        ['shelf_goods', TILE_INDEX.shelf_goods, 220, 100],
        ['tool_panel', TILE_INDEX.tool_panel, 180, 80],
        ['ore_shelf', TILE_INDEX.ore_shelf, 200, 100],
        ['record_shelf', TILE_INDEX.record_shelf, 220, 100],
    ] as const) {
        const lums = tileLums(result.rgba, slot)
        const blackPixels = countPixels(lums, (lum) => lum <= 0.05)
        const connectedStroke = largestComponent(lums, (lum) => lum <= 0.05)
        assert.ok(blackPixels >= minBlackPixels, `${name} should have visible black linework, got ${blackPixels}`)
        assert.ok(connectedStroke >= minConnectedStroke, `${name} should have a thick connected black stroke, got ${connectedStroke}`)
    }
})

test('shelf tiles use simple saturated color blocks', () => {
    const result = buildVoxelAtlas()
    for (const [name, slot] of [
        ['goods shelf', TILE_INDEX.shelf_goods],
        ['tool panel', TILE_INDEX.tool_panel],
        ['ore shelf', TILE_INDEX.ore_shelf],
        ['record shelf', TILE_INDEX.record_shelf],
    ] as const) {
        const pixels = tilePixels(result.rgba, slot)
        const chromaPixels = countColorPixels(pixels, (p) => maxChannelDelta(p) > 0.12)
        assert.ok(chromaPixels >= 120, `${name} should use real color patches, got ${chromaPixels}`)
    }

    const goods = tilePixels(result.rgba, TILE_INDEX.shelf_goods)
    assert.ok(countColorPixels(goods, (p) => p.r > 0.85 && p.g < 0.16 && p.b < 0.12) >= 45, 'goods shelf should have a large red item block')
    assert.ok(countColorPixels(goods, (p) => p.r > 0.9 && p.g > 0.65 && p.b < 0.18) >= 35, 'goods shelf should have a large yellow item block')
    assert.ok(countColorPixels(goods, (p) => p.g > 0.6 && p.r < 0.16 && p.b < 0.18) >= 45, 'goods shelf should have a large green item block')
    assert.ok(countColorPixels(goods, (p) => p.b > 0.85 && p.r < 0.16 && p.g < 0.45) >= 35, 'goods shelf should have a large blue item block')
})

test('spider web tile uses asymmetric tangled strands instead of a radial target', () => {
    const result = buildVoxelAtlas()
    const slot = TILE_INDEX.spider_web
    const originX = (slot % TILES_PER_ROW) * TILE_SIZE
    const originY = Math.floor(slot / TILES_PER_ROW) * TILE_SIZE
    let darkPixels = 0
    let leftHalfDark = 0
    let rightHalfDark = 0
    let centerDark = 0
    let cornerDark = 0
    let descendingDiagDark = 0
    let risingDiagDark = 0

    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const lum = result.rgba[((originY + y) * ATLAS_SIZE + (originX + x)) * 4]! / 255
            if (lum >= 0.72) continue
            darkPixels++
            if (x < TILE_SIZE / 2) leftHalfDark++
            else rightHalfDark++
            if (Math.abs(x - TILE_SIZE / 2) <= 3 && Math.abs(y - TILE_SIZE / 2) <= 3) centerDark++
            if ((x <= 8 && y <= 8) || (x >= TILE_SIZE - 9 && y >= TILE_SIZE - 9)) cornerDark++
            if (Math.abs(y - x) < 3) descendingDiagDark++
            if (Math.abs((TILE_SIZE - 1 - y) - x) < 3) risingDiagDark++
        }
    }

    assert.ok(darkPixels > 120, `spider web should have enough visible strand pixels, got ${darkPixels}`)
    assert.ok(Math.abs(descendingDiagDark - risingDiagDark) > 16, 'spider web should favor one sagging diagonal, not a mirrored target')
    assert.ok(Math.abs(leftHalfDark - rightHalfDark) < darkPixels * 0.12, 'web should still cover both sides of the block face')
    assert.ok(cornerDark > centerDark, 'web anchors should read at the corners more than the center')
})

test('chest tiles use bold silhouettes readable from the isometric camera', () => {
    const result = buildVoxelAtlas()
    const closed = tileLums(result.rgba, TILE_INDEX.chest)
    const open = tileLums(result.rgba, TILE_INDEX.chest_open)

    assert.ok(countPixels(closed, (lum) => lum <= 0.55) > 220, 'closed chest should have thick dark bands and rim pixels')
    assert.ok(countPixelsInRect(closed, 11, 9, 10, 12, (lum) => lum <= 0.55) >= 34, 'closed chest should have a large central lock shape')
    assert.ok(countPixelsInRect(open, 6, 12, 20, 8, (lum) => lum <= 0.42) >= 120, 'open chest should have a large readable dark mouth')
    assert.ok(countPixelsInRect(open, 7, 8, 18, 2, (lum) => lum >= 0.9) >= 30, 'open chest should keep a bright lifted lid/lip')
})

test('ore tiles use large colored deposits without black crack lines', () => {
    const result = buildVoxelAtlas()
    for (const [name, slot, predicate] of [
        ['iron ore', TILE_INDEX.ore_iron, (p: RgbPixel) => p.b - p.r > 0.03 && p.lum < 0.86],
        ['copper ore', TILE_INDEX.ore_copper, (p: RgbPixel) => p.r > 0.72 && p.g > 0.16 && p.g < 0.66 && p.b < 0.32],
        ['crystal ore', TILE_INDEX.ore_crystal, (p: RgbPixel) => p.b > 0.74 && p.g > 0.52 && p.r < 0.32],
    ] as const) {
        const lums = tileLums(result.rgba, slot)
        const pixels = tilePixels(result.rgba, slot)
        const depositPixels = countColorPixels(pixels, predicate)
        const largestDeposit = largestColorComponent(pixels, predicate)
        assert.equal(countPixels(lums, (lum) => lum <= 0.05), 0, `${name} should not use black crack pixels`)
        assert.ok(depositPixels >= 80, `${name} should expose enough colored ore pixels, got ${depositPixels}`)
        assert.ok(largestDeposit >= 24, `${name} should contain a large connected ore deposit, got ${largestDeposit}`)
    }
})

interface RgbPixel {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly lum: number
}

function tileLums(rgba: Uint8Array, slot: number): number[] {
    const originX = (slot % TILES_PER_ROW) * TILE_SIZE
    const originY = Math.floor(slot / TILES_PER_ROW) * TILE_SIZE
    const lums: number[] = []
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const idx = ((originY + y) * ATLAS_SIZE + (originX + x)) * 4
            const r = rgba[idx]! / 255
            const g = rgba[idx + 1]! / 255
            const b = rgba[idx + 2]! / 255
            lums.push(0.2126 * r + 0.7152 * g + 0.0722 * b)
        }
    }
    return lums
}

function tilePixels(rgba: Uint8Array, slot: number): RgbPixel[] {
    const originX = (slot % TILES_PER_ROW) * TILE_SIZE
    const originY = Math.floor(slot / TILES_PER_ROW) * TILE_SIZE
    const pixels: RgbPixel[] = []
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const idx = ((originY + y) * ATLAS_SIZE + (originX + x)) * 4
            const r = rgba[idx]! / 255
            const g = rgba[idx + 1]! / 255
            const b = rgba[idx + 2]! / 255
            pixels.push({ r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b })
        }
    }
    return pixels
}

function countPixels(lums: readonly number[], predicate: (lum: number) => boolean): number {
    let count = 0
    for (const lum of lums) if (predicate(lum)) count += 1
    return count
}

function countColorPixels(pixels: readonly RgbPixel[], predicate: (pixel: RgbPixel) => boolean): number {
    let count = 0
    for (const pixel of pixels) if (predicate(pixel)) count += 1
    return count
}

function maxChannelDelta(pixel: RgbPixel): number {
    return Math.max(
        Math.abs(pixel.r - pixel.g),
        Math.abs(pixel.r - pixel.b),
        Math.abs(pixel.g - pixel.b),
    )
}

function countPixelsInRect(
    lums: readonly number[],
    x0: number,
    y0: number,
    w: number,
    h: number,
    predicate: (lum: number) => boolean,
): number {
    let count = 0
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (predicate(lums[y * TILE_SIZE + x]!)) count += 1
        }
    }
    return count
}

function largestComponent(lums: readonly number[], predicate: (lum: number) => boolean): number {
    const seen = new Set<number>()
    let best = 0
    for (let i = 0; i < lums.length; i += 1) {
        if (seen.has(i) || !predicate(lums[i]!)) continue
        const stack = [i]
        seen.add(i)
        let size = 0
        while (stack.length > 0) {
            const current = stack.pop()!
            size += 1
            const x = current % TILE_SIZE
            const y = Math.floor(current / TILE_SIZE)
            for (const next of [
                x > 0 ? current - 1 : -1,
                x < TILE_SIZE - 1 ? current + 1 : -1,
                y > 0 ? current - TILE_SIZE : -1,
                y < TILE_SIZE - 1 ? current + TILE_SIZE : -1,
            ]) {
                if (next < 0 || seen.has(next) || !predicate(lums[next]!)) continue
                seen.add(next)
                stack.push(next)
            }
        }
        best = Math.max(best, size)
    }
    return best
}

function largestColorComponent(pixels: readonly RgbPixel[], predicate: (pixel: RgbPixel) => boolean): number {
    const seen = new Set<number>()
    let best = 0
    for (let i = 0; i < pixels.length; i += 1) {
        if (seen.has(i) || !predicate(pixels[i]!)) continue
        const stack = [i]
        seen.add(i)
        let size = 0
        while (stack.length > 0) {
            const current = stack.pop()!
            size += 1
            const x = current % TILE_SIZE
            const y = Math.floor(current / TILE_SIZE)
            for (const next of [
                x > 0 ? current - 1 : -1,
                x < TILE_SIZE - 1 ? current + 1 : -1,
                y > 0 ? current - TILE_SIZE : -1,
                y < TILE_SIZE - 1 ? current + TILE_SIZE : -1,
            ]) {
                if (next < 0 || seen.has(next) || !predicate(pixels[next]!)) continue
                seen.add(next)
                stack.push(next)
            }
        }
        best = Math.max(best, size)
    }
    return best
}
