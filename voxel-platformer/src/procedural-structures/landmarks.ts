import { BLOCK } from '../engine/voxel/palette'
import type { StructureGenerationOptions, StructureScale } from './types'
import { VoxelBuffer } from './buffer'
import type { Rng } from './math'
import { randInt } from './math'

interface LandmarkProfile {
    scale: StructureScale
    market: { width: number; depth: number; postHeight: number }
    stable: { width: number; depth: number; wallHeight: number; paddockDepth: number }
    church: { width: number; depth: number; wallHeight: number; towerHeight: number }
}

const LANDMARK_PROFILES: Record<StructureScale, LandmarkProfile> = {
    troll: {
        scale: 'troll',
        market: { width: 26, depth: 18, postHeight: 6 },
        stable: { width: 28, depth: 15, wallHeight: 7, paddockDepth: 13 },
        church: { width: 18, depth: 30, wallHeight: 9, towerHeight: 18 },
    },
    folk: {
        scale: 'folk',
        market: { width: 15, depth: 11, postHeight: 4 },
        stable: { width: 17, depth: 10, wallHeight: 5, paddockDepth: 8 },
        church: { width: 11, depth: 18, wallHeight: 6, towerHeight: 11 },
    },
}

export function composeMarket(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const p = profile(opts)
    const { width: w, depth: d, postHeight } = p.market
    const x1 = ox - Math.floor(w / 2)
    const x2 = ox + Math.ceil(w / 2) - 1
    const z1 = oz - Math.floor(d / 2)
    const z2 = oz + Math.ceil(d / 2) - 1
    const cx = Math.round((x1 + x2) / 2)
    const roofY = oy + postHeight + 1

    buf.fillBox(x1 - 1, oy, z1 - 1, x2 + 1, oy, z2 + 1, BLOCK.sand, 'market-plaza')
    buf.fillBox(x1 + 1, oy + 1, z1 + 1, x2 - 1, oy + 1, z2 - 1, BLOCK.plank, 'market-deck')

    for (const x of postPositions(x1, x2, p.scale)) {
        for (const z of [z1, z2]) buf.fillBox(x, oy + 1, z, x, oy + postHeight, z, BLOCK.woodDark, 'market-post')
    }
    for (const z of postPositions(z1, z2, p.scale)) {
        for (const x of [x1, x2]) buf.fillBox(x, oy + 1, z, x, oy + postHeight, z, BLOCK.woodDark, 'market-post')
    }

    stripedCanopy(buf, x1 - 1, x2 + 1, z1 - 1, z2 + 1, roofY, p.scale)
    buf.fillBox(x1, roofY, z1, x2, roofY, z1, BLOCK.woodDark, 'market-roof-frame')
    buf.fillBox(x1, roofY, z2, x2, roofY, z2, BLOCK.woodDark, 'market-roof-frame')
    buf.fillBox(x1, roofY, z1, x1, roofY, z2, BLOCK.woodDark, 'market-roof-frame')
    buf.fillBox(x2, roofY, z1, x2, roofY, z2, BLOCK.woodDark, 'market-roof-frame')

    const stallZs = p.scale === 'folk'
        ? [z1 + 2, z2 - 2]
        : [z1 + 3, z1 + 6, z2 - 6, z2 - 3]
    for (const z of stallZs) {
        marketStall(buf, cx - Math.floor(w * 0.30), oy, z, p.scale, rng)
        marketStall(buf, cx + Math.floor(w * 0.30), oy, z, p.scale, rng)
    }

    if (opts.detail > 0.45) {
        buf.fillBox(cx - 1, oy + 2, z1 - 1, cx + 1, oy + 3, z1 - 1, BLOCK.banner, 'market-sign')
        scatterCrates(buf, x1 + 2, x2 - 2, oy + 2, z1 + 2, z2 - 2, rng, Math.round(4 + opts.detail * 8))
    }
}

export function composeStable(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const p = profile(opts)
    const { width: w, depth: d, wallHeight, paddockDepth } = p.stable
    const x1 = ox - Math.floor(w / 2)
    const x2 = ox + Math.ceil(w / 2) - 1
    const z1 = oz - Math.floor(d / 2)
    const z2 = oz + Math.ceil(d / 2) - 1
    const doorWidth = p.scale === 'folk' ? 3 : 5
    const doorLeft = ox - Math.floor(doorWidth / 2)
    const doorRight = doorLeft + doorWidth - 1

    buf.fillBox(x1 - 1, oy, z1 - 1, x2 + 1, oy, z2 + paddockDepth + 1, BLOCK.dirt, 'stable-yard-floor')
    buf.hollowBox(x1, oy + 1, z1, x2, oy + wallHeight, z2, 1, BLOCK.wood, 'stable-wall-shell')
    buf.fillBox(x1, oy + 1, z1, x1, oy + wallHeight, z2, BLOCK.woodDark, 'stable-corner-post')
    buf.fillBox(x2, oy + 1, z1, x2, oy + wallHeight, z2, BLOCK.woodDark, 'stable-corner-post')
    buf.fillBox(x1, oy + 1, z1, x2, oy + wallHeight, z1, BLOCK.plank, 'stable-front-wall')

    for (let x = doorLeft; x <= doorRight; x++) {
        for (let y = oy + 1; y <= oy + Math.min(wallHeight - 1, p.scale === 'folk' ? 3 : 5); y++) buf.del(x, y, z1)
    }
    buf.fillBox(doorLeft - 1, oy + 1, z1, doorLeft - 1, oy + wallHeight, z1, BLOCK.woodDark, 'stable-door-frame')
    buf.fillBox(doorRight + 1, oy + 1, z1, doorRight + 1, oy + wallHeight, z1, BLOCK.woodDark, 'stable-door-frame')
    buf.fillBox(doorLeft - 1, oy + wallHeight, z1, doorRight + 1, oy + wallHeight, z1, BLOCK.woodDark, 'stable-door-frame')

    const stallCount = p.scale === 'folk' ? 3 : 5
    const stallStep = Math.max(3, Math.floor((w - 4) / stallCount))
    for (let i = 1; i < stallCount; i++) {
        const x = x1 + 2 + i * stallStep
        buf.fillBox(x, oy + 1, z1 + 1, x, oy + Math.max(2, wallHeight - 2), z2 - 1, BLOCK.woodDark, 'stable-stall-divider')
    }
    for (let i = 0; i < stallCount; i++) {
        const x = x1 + 2 + i * stallStep
        buf.fillBox(x, oy + 1, z2, Math.min(x + 1, x2 - 1), oy + 2, z2, BLOCK.door, 'stable-stall-gate')
    }

    gableRoof(buf, x1 - 1, x2 + 1, z1 - 1, z2 + 1, oy + wallHeight + 1, 'x', BLOCK.thatch, 'stable-thatch-roof')
    if (opts.detail > 0.55) {
        hayStack(buf, x2 - 4, oy + 1, z2 - 3, p.scale)
        hayStack(buf, x1 + 3, oy + 1, z2 - 2, p.scale)
        trough(buf, x1 + 3, oy + 1, z1 + 2, p.scale)
    }
    fencePaddock(buf, x1 - 2, x2 + 2, oy + 1, z2 + 2, z2 + paddockDepth, p.scale)
    if (rng() > 0.45) buf.fillBox(x2 + 2, oy + 1, z2 + 4, x2 + 3, oy + 2, z2 + 5, BLOCK.thatch, 'stable-yard-hay')
}

export function composeChurch(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, _rng: Rng): void {
    const p = profile(opts)
    const { width: w, depth: d, wallHeight, towerHeight } = p.church
    const naveX1 = ox - Math.floor(w / 2)
    const naveX2 = ox + Math.ceil(w / 2) - 1
    const naveZ1 = oz - Math.floor(d / 2) + Math.ceil(w * 0.30)
    const naveZ2 = oz + Math.ceil(d / 2) - 1
    const towerW = p.scale === 'folk' ? 7 : 9
    const towerX1 = ox - Math.floor(towerW / 2)
    const towerX2 = towerX1 + towerW - 1
    const towerZ1 = naveZ1 - towerW + 1
    const towerZ2 = naveZ1

    buf.fillBox(naveX1 - 1, oy, towerZ1 - 1, naveX2 + 1, oy, naveZ2 + 1, BLOCK.darkStone, 'church-foundation')
    buf.hollowBox(naveX1, oy + 1, naveZ1, naveX2, oy + wallHeight, naveZ2, 1, BLOCK.stone, 'church-nave-wall')
    buf.hollowBox(towerX1, oy + 1, towerZ1, towerX2, oy + towerHeight, towerZ2, 1, BLOCK.stone2, 'church-tower-wall')
    gableRoof(buf, naveX1 - 1, naveX2 + 1, naveZ1 - 1, naveZ2 + 1, oy + wallHeight + 1, 'z', BLOCK.roofDark, 'church-nave-roof')
    churchTowerRoof(buf, ox, oy + towerHeight + 1, Math.round((towerZ1 + towerZ2) / 2), towerW, p.scale)

    const doorWidth = p.scale === 'folk' ? 3 : 5
    const doorLeft = ox - Math.floor(doorWidth / 2)
    const doorRight = doorLeft + doorWidth - 1
    const doorHeight = p.scale === 'folk' ? 4 : 6
    for (let x = doorLeft; x <= doorRight; x++) for (let y = oy + 1; y <= oy + doorHeight; y++) buf.set(x, y, towerZ1, BLOCK.door, 'church-main-door')
    buf.fillBox(doorLeft - 1, oy + 1, towerZ1, doorLeft - 1, oy + doorHeight, towerZ1, BLOCK.darkStone, 'church-door-trim')
    buf.fillBox(doorRight + 1, oy + 1, towerZ1, doorRight + 1, oy + doorHeight, towerZ1, BLOCK.darkStone, 'church-door-trim')
    buf.fillBox(doorLeft - 1, oy + doorHeight + 1, towerZ1, doorRight + 1, oy + doorHeight + 1, towerZ1, BLOCK.darkStone, 'church-door-arch')

    const windowEvery = p.scale === 'folk' ? 5 : 7
    for (let z = naveZ1 + windowEvery; z <= naveZ2 - 3; z += windowEvery) {
        archedWindow(buf, naveX1, oy + Math.max(2, Math.floor(wallHeight * 0.38)), z, 'x-', p.scale)
        archedWindow(buf, naveX2, oy + Math.max(2, Math.floor(wallHeight * 0.38)), z, 'x+', p.scale)
    }
    archedWindow(buf, ox, oy + Math.max(3, Math.floor(towerHeight * 0.50)), towerZ1, 'z-', p.scale)
    buttresses(buf, naveX1, naveX2, oy, naveZ1 + 2, naveZ2 - 2, p.scale)
    apse(buf, ox, oy, naveZ2 + 1, Math.max(3, Math.floor(w * 0.35)), wallHeight, p.scale)
    cross(buf, ox, oy + towerHeight + (p.scale === 'folk' ? 4 : 6), Math.round((towerZ1 + towerZ2) / 2), p.scale)
    if (opts.detail > 0.6) buf.fillBox(ox, oy + towerHeight - 2, towerZ1, ox, oy + towerHeight - 1, towerZ1, BLOCK.glow, 'church-bell-light')
}

export function composeTemple(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const w = 35
    const d = 47
    const columnH = 10
    const x1 = ox - Math.floor(w / 2)
    const x2 = ox + Math.floor(w / 2)
    const z1 = oz - Math.floor(d / 2)
    const z2 = oz + Math.floor(d / 2)
    const floorY = oy + 3
    const colY1 = floorY + 1
    const colY2 = floorY + columnH
    const entY = colY2 + 1

    templeStylobate(buf, x1, x2, oy, z1, z2)

    for (const x of templeAxisPositions(x1 + 4, x2 - 4, 6)) {
        templeColumn(buf, x, colY1, z1 + 3, colY2)
        templeColumn(buf, x, colY1, z2 - 3, colY2)
    }
    for (const z of templeAxisPositions(z1 + 9, z2 - 9, 5)) {
        templeColumn(buf, x1 + 3, colY1, z, colY2)
        templeColumn(buf, x2 - 3, colY1, z, colY2)
    }

    const cellaX1 = x1 + 9
    const cellaX2 = x2 - 9
    const cellaZ1 = z1 + 11
    const cellaZ2 = z2 - 8
    const cellaTop = floorY + 8
    buf.hollowBox(cellaX1, floorY + 1, cellaZ1, cellaX2, cellaTop, cellaZ2, 1, BLOCK.plaster, 'temple-cella-wall')
    templeDoorOpening(buf, ox, floorY + 1, cellaZ1, 7, 5)
    templeCellaPaint(buf, cellaX1, cellaX2, cellaZ1, cellaZ2, cellaTop)

    templePerimeterRing(buf, x1 - 2, x2 + 2, z1 - 2, z2 + 2, entY, 2, BLOCK.plaster, 'temple-entablature-marble')
    templePerimeterRing(buf, x1 - 2, x2 + 2, z1 - 2, z2 + 2, entY + 2, 1, BLOCK.banner, 'temple-frieze-painted')
    templePaintedMetopeBand(buf, x1 - 2, x2 + 2, z1 - 2, z2 + 2, entY + 3)
    templePerimeterRing(buf, x1 - 3, x2 + 3, z1 - 3, z2 + 3, entY + 4, 1, BLOCK.trim, 'temple-cornice-marble')

    templeLowGableRoof(buf, x1 - 4, x2 + 4, z1 - 4, z2 + 4, entY + 5)
    templePediment(buf, x1 - 3, x2 + 3, entY + 4, z1 - 4)
    templePediment(buf, x1 - 3, x2 + 3, entY + 4, z2 + 4)

    templeAltar(buf, ox, floorY + 1, z1 - 6)
    templeStatue(buf, ox, floorY + 1, cellaZ2 - 5, opts.detail, rng)
    if (opts.detail > 0.5) {
        templeOfferingBowls(buf, x1 + 7, x2 - 7, floorY + 1, z1 - 5)
        buf.fillBox(x1 - 1, entY + 2, z1 - 5, x1 + 1, entY + 5, z1 - 5, BLOCK.banner, 'temple-painted-banner')
        buf.fillBox(x2 - 1, entY + 2, z1 - 5, x2 + 1, entY + 5, z1 - 5, BLOCK.banner, 'temple-painted-banner')
    }
}

function profile(opts: StructureGenerationOptions): LandmarkProfile {
    return LANDMARK_PROFILES[opts.landmark.scale]
}

function postPositions(min: number, max: number, scale: StructureScale): number[] {
    if (scale === 'folk') return [min, max]
    return [min, Math.round((min + max) / 2), max]
}

function stripedCanopy(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number, scale: StructureScale): void {
    const half = Math.max(2, Math.ceil((z2 - z1 + 1) / 2))
    for (let i = 0; i < half; i++) {
        const za = z1 + i
        const zb = z2 - i
        const block = i % 3 === 0 ? BLOCK.banner : i % 3 === 1 ? BLOCK.thatch : BLOCK.roof
        buf.fillBox(x1, y + i, za, x2, y + i, za, block, 'market-striped-canopy')
        buf.fillBox(x1, y + i, zb, x2, y + i, zb, block, 'market-striped-canopy')
        if (scale === 'troll' && i === half - 1) buf.fillBox(x1, y + i + 1, za, x2, y + i + 1, za, BLOCK.woodDark, 'market-canopy-ridge')
    }
}

function marketStall(buf: VoxelBuffer, x: number, y: number, z: number, scale: StructureScale, rng: Rng): void {
    const half = scale === 'folk' ? 1 : 2
    buf.fillBox(x - half, y + 2, z, x + half, y + 2, z, BLOCK.plank, 'market-counter')
    buf.fillBox(x - half, y + 1, z, x - half, y + 1, z, BLOCK.woodDark, 'market-counter-leg')
    buf.fillBox(x + half, y + 1, z, x + half, y + 1, z, BLOCK.woodDark, 'market-counter-leg')
    const goods = [BLOCK.fruit, BLOCK.flower, BLOCK.mushroom, BLOCK.glow]
    for (let dx = -half; dx <= half; dx++) if (rng() > 0.25) buf.set(x + dx, y + 3, z, goods[randInt(rng, 0, goods.length - 1)]!, 'market-goods')
    buf.fillBox(x - half - 1, y + 4, z - 1, x + half + 1, y + 4, z + 1, BLOCK.banner, 'market-stall-awning')
}

function scatterCrates(buf: VoxelBuffer, x1: number, x2: number, y: number, z1: number, z2: number, rng: Rng, count: number): void {
    for (let i = 0; i < count; i++) {
        const x = randInt(rng, x1, x2)
        const z = randInt(rng, z1, z2)
        const block = rng() > 0.5 ? BLOCK.wood : BLOCK.plank
        buf.fillBox(x, y, z, x + (rng() > 0.7 ? 1 : 0), y + (rng() > 0.75 ? 1 : 0), z, block, 'market-crate')
    }
}

function gableRoof(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number, axis: 'x' | 'z', block: number, tag: string): void {
    const span = axis === 'x' ? z2 - z1 + 1 : x2 - x1 + 1
    const half = Math.ceil(span / 2)
    for (let i = 0; i < half; i++) {
        if (axis === 'x') {
            buf.fillBox(x1, y + i, z1 + i, x2, y + i, z2 - i, block, tag)
        } else {
            buf.fillBox(x1 + i, y + i, z1, x2 - i, y + i, z2, block, tag)
        }
    }
}

function hayStack(buf: VoxelBuffer, x: number, y: number, z: number, scale: StructureScale): void {
    const w = scale === 'folk' ? 2 : 3
    buf.fillBox(x, y, z, x + w, y + 1, z + 1, BLOCK.thatch, 'stable-hay-bale')
    if (scale === 'troll') buf.fillBox(x + 1, y + 2, z, x + w - 1, y + 2, z + 1, BLOCK.thatch, 'stable-hay-bale')
}

function trough(buf: VoxelBuffer, x: number, y: number, z: number, scale: StructureScale): void {
    const len = scale === 'folk' ? 3 : 5
    buf.fillBox(x, y, z, x + len, y, z, BLOCK.woodDark, 'stable-trough-rim')
    buf.fillBox(x + 1, y + 1, z, x + len - 1, y + 1, z, BLOCK.water, 'stable-trough-water')
}

function fencePaddock(buf: VoxelBuffer, x1: number, x2: number, y: number, z1: number, z2: number, scale: StructureScale): void {
    const step = scale === 'folk' ? 3 : 4
    for (let x = x1; x <= x2; x += step) {
        fencePost(buf, x, y, z1)
        fencePost(buf, x, y, z2)
    }
    for (let z = z1; z <= z2; z += step) {
        fencePost(buf, x1, y, z)
        fencePost(buf, x2, y, z)
    }
    buf.fillBox(x1, y + 1, z1, x2, y + 1, z1, BLOCK.wood, 'stable-fence-rail')
    buf.fillBox(x1, y + 2, z1, x2, y + 2, z1, BLOCK.wood, 'stable-fence-rail')
    buf.fillBox(x1, y + 1, z2, x2, y + 1, z2, BLOCK.wood, 'stable-fence-rail')
    buf.fillBox(x1, y + 2, z2, x2, y + 2, z2, BLOCK.wood, 'stable-fence-rail')
    buf.fillBox(x1, y + 1, z1, x1, y + 1, z2, BLOCK.wood, 'stable-fence-rail')
    buf.fillBox(x2, y + 1, z1, x2, y + 1, z2, BLOCK.wood, 'stable-fence-rail')
}

function fencePost(buf: VoxelBuffer, x: number, y: number, z: number): void {
    buf.fillBox(x, y, z, x, y + 3, z, BLOCK.woodDark, 'stable-fence-post')
}

function churchTowerRoof(buf: VoxelBuffer, cx: number, y: number, cz: number, width: number, scale: StructureScale): void {
    const half = Math.floor(width / 2)
    for (let i = 0; i <= half; i++) {
        const r = half - i
        buf.fillBox(cx - r, y + i, cz - r, cx + r, y + i, cz + r, BLOCK.roofDark, 'church-tower-spire')
    }
    if (scale === 'troll') buf.set(cx, y + half + 1, cz, BLOCK.metal, 'church-spire-cap')
}

function archedWindow(buf: VoxelBuffer, x: number, y: number, z: number, side: 'x-' | 'x+' | 'z-', scale: StructureScale): void {
    const h = scale === 'folk' ? 3 : 5
    const w = scale === 'folk' ? 1 : 2
    for (let i = -w; i <= w; i++) {
        for (let dy = 0; dy < h; dy++) {
            const edge = Math.abs(i) === w || dy === h - 1
            const block = edge ? BLOCK.darkStone : BLOCK.glass
            if (side === 'x-' || side === 'x+') buf.set(x, y + dy, z + i, block, edge ? 'church-window-frame' : 'church-window-glass')
            else buf.set(x + i, y + dy, z, block, edge ? 'church-window-frame' : 'church-window-glass')
        }
    }
}

function buttresses(buf: VoxelBuffer, x1: number, x2: number, y: number, z1: number, z2: number, scale: StructureScale): void {
    const step = scale === 'folk' ? 6 : 8
    for (let z = z1; z <= z2; z += step) {
        buf.fillBox(x1 - 2, y + 1, z, x1 - 1, y + (scale === 'folk' ? 4 : 6), z, BLOCK.darkStone, 'church-buttress')
        buf.fillBox(x2 + 1, y + 1, z, x2 + 2, y + (scale === 'folk' ? 4 : 6), z, BLOCK.darkStone, 'church-buttress')
    }
}

function apse(buf: VoxelBuffer, cx: number, y: number, z: number, r: number, h: number, scale: StructureScale): void {
    const depth = scale === 'folk' ? 2 : 3
    for (let dz = 0; dz <= depth; dz++) {
        const half = Math.max(1, r - dz)
        buf.fillBox(cx - half, y + 1, z + dz, cx + half, y + h - 2, z + dz, BLOCK.stone2, 'church-apse-wall')
    }
    gableRoof(buf, cx - r, cx + r, z, z + depth, y + h - 1, 'x', BLOCK.roofDark, 'church-apse-roof')
}

function cross(buf: VoxelBuffer, x: number, y: number, z: number, scale: StructureScale): void {
    const h = scale === 'folk' ? 4 : 6
    buf.fillBox(x, y, z, x, y + h, z, BLOCK.metal, 'church-cross')
    buf.fillBox(x - 2, y + h - 2, z, x + 2, y + h - 2, z, BLOCK.metal, 'church-cross')
}

function templeStylobate(buf: VoxelBuffer, x1: number, x2: number, y: number, z1: number, z2: number): void {
    buf.fillBox(x1 - 6, y, z1 - 10, x2 + 6, y, z2 + 6, BLOCK.darkStone, 'temple-stylobate')
    buf.fillBox(x1 - 5, y + 1, z1 - 8, x2 + 5, y + 1, z2 + 5, BLOCK.stone2, 'temple-stylobate')
    buf.fillBox(x1 - 4, y + 2, z1 - 6, x2 + 4, y + 2, z2 + 4, BLOCK.trim, 'temple-stylobate')
    buf.fillBox(x1 - 2, y + 3, z1 - 2, x2 + 2, y + 3, z2 + 2, BLOCK.plaster, 'temple-marble-floor')
    for (let i = 0; i < 4; i++) {
        const z = z1 - 14 + i * 2
        buf.fillBox(x1 - 7 + i, y + i, z, x2 + 7 - i, y + i, z + 1, i === 0 ? BLOCK.darkStone : BLOCK.stone2, 'temple-front-steps')
    }
}

function templeAxisPositions(min: number, max: number, count: number): number[] {
    if (count <= 1) return [Math.round((min + max) / 2)]
    const out: number[] = []
    const step = (max - min) / (count - 1)
    for (let i = 0; i < count; i++) out.push(Math.round(min + step * i))
    return out
}

function templeColumn(buf: VoxelBuffer, x: number, y1: number, z: number, y2: number): void {
    buf.fillBox(x - 1, y1 - 1, z - 1, x + 1, y1 - 1, z + 1, BLOCK.stone2, 'temple-column')
    buf.fillBox(x - 1, y1, z - 1, x + 1, y1, z + 1, BLOCK.trim, 'temple-column')
    buf.fillCylinder(x, y1 + 1, z, 1, y2 - 2, BLOCK.plaster, 'temple-column')
    for (let y = y1 + 2; y <= y2 - 3; y += 3) {
        buf.set(x - 1, y, z, BLOCK.trim, 'temple-column-flute')
        buf.set(x + 1, y, z, BLOCK.trim, 'temple-column-flute')
        buf.set(x, y, z - 1, BLOCK.trim, 'temple-column-flute')
        buf.set(x, y, z + 1, BLOCK.trim, 'temple-column-flute')
    }
    buf.fillBox(x - 1, y2 - 1, z - 1, x + 1, y2 - 1, z + 1, BLOCK.trim, 'temple-column')
    buf.fillBox(x - 2, y2, z - 2, x + 2, y2, z + 2, BLOCK.plaster, 'temple-column')
}

function templeDoorOpening(buf: VoxelBuffer, cx: number, y: number, z: number, width: number, height: number): void {
    const x1 = cx - Math.floor(width / 2)
    const x2 = cx + Math.floor(width / 2)
    for (let x = x1; x <= x2; x++) for (let yy = y; yy <= y + height; yy++) buf.del(x, yy, z)
    buf.fillBox(x1 - 1, y, z, x1 - 1, y + height + 1, z, BLOCK.banner, 'temple-painted-door-trim')
    buf.fillBox(x2 + 1, y, z, x2 + 1, y + height + 1, z, BLOCK.banner, 'temple-painted-door-trim')
    buf.fillBox(x1 - 1, y + height + 1, z, x2 + 1, y + height + 1, z, BLOCK.banner, 'temple-painted-door-trim')
}

function templeCellaPaint(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number): void {
    buf.fillBox(x1, y, z1, x2, y, z1, BLOCK.banner, 'temple-frieze-painted')
    buf.fillBox(x1, y, z2, x2, y, z2, BLOCK.banner, 'temple-frieze-painted')
    buf.fillBox(x1, y, z1, x1, y, z2, BLOCK.banner, 'temple-frieze-painted')
    buf.fillBox(x2, y, z1, x2, y, z2, BLOCK.banner, 'temple-frieze-painted')
}

function templePerimeterRing(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number, thickness: number, block: number, tag: string): void {
    buf.fillBox(x1, y, z1, x2, y, z1 + thickness - 1, block, tag)
    buf.fillBox(x1, y, z2 - thickness + 1, x2, y, z2, block, tag)
    buf.fillBox(x1, y, z1, x1 + thickness - 1, y, z2, block, tag)
    buf.fillBox(x2 - thickness + 1, y, z1, x2, y, z2, block, tag)
}

function templePaintedMetopeBand(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number): void {
    for (let x = x1 + 3; x <= x2 - 3; x += 6) {
        buf.fillBox(x, y, z1, x + 2, y, z1, BLOCK.metal, 'temple-frieze-painted')
        buf.fillBox(x, y, z2, x + 2, y, z2, BLOCK.metal, 'temple-frieze-painted')
    }
    for (let z = z1 + 4; z <= z2 - 4; z += 7) {
        buf.fillBox(x1, y, z, x1, y, z + 2, BLOCK.metal, 'temple-frieze-painted')
        buf.fillBox(x2, y, z, x2, y, z + 2, BLOCK.metal, 'temple-frieze-painted')
    }
}

function templeLowGableRoof(buf: VoxelBuffer, x1: number, x2: number, z1: number, z2: number, y: number): void {
    const half = Math.ceil((x2 - x1 + 1) / 2)
    for (let i = 0; i < half; i++) {
        const rise = Math.floor(i / 3)
        const block = rise % 2 === 0 ? BLOCK.roof : BLOCK.roofDark
        buf.fillBox(x1 + i, y + rise, z1, x2 - i, y + rise, z2, block, 'temple-painted-roof')
    }
    const ridgeY = y + Math.floor((half - 1) / 3) + 1
    buf.fillBox(Math.round((x1 + x2) / 2) - 1, ridgeY, z1, Math.round((x1 + x2) / 2) + 1, ridgeY, z2, BLOCK.trim, 'temple-roof-ridge')
}

function templePediment(buf: VoxelBuffer, x1: number, x2: number, y: number, z: number): void {
    const half = Math.floor((x2 - x1) / 2)
    for (let x = x1; x <= x2; x++) {
        const fromEdge = Math.min(x - x1, x2 - x)
        const height = Math.max(0, Math.floor(fromEdge / 3))
        for (let yy = y; yy <= y + height; yy++) {
            const painted = yy === y + Math.max(1, Math.floor(height * 0.55)) && height > 2
            buf.set(x, yy, z, painted ? BLOCK.banner : BLOCK.plaster, painted ? 'temple-pediment-painted' : 'temple-pediment-marble')
        }
    }
    const cx = Math.round((x1 + x2) / 2)
    buf.fillBox(cx - 2, y + Math.floor(half / 3) + 1, z, cx + 2, y + Math.floor(half / 3) + 1, z, BLOCK.metal, 'temple-pediment-painted')
}

function templeAltar(buf: VoxelBuffer, x: number, y: number, z: number): void {
    buf.fillBox(x - 3, y, z - 1, x + 3, y, z + 1, BLOCK.stone2, 'temple-altar')
    buf.fillBox(x - 2, y + 1, z - 1, x + 2, y + 1, z + 1, BLOCK.plaster, 'temple-altar')
    buf.fillBox(x - 1, y + 2, z, x + 1, y + 2, z, BLOCK.metal, 'temple-altar')
    buf.set(x, y + 3, z, BLOCK.glow, 'temple-altar-fire')
}

function templeStatue(buf: VoxelBuffer, x: number, y: number, z: number, detail: number, rng: Rng): void {
    const accent = rng() > 0.5 ? BLOCK.metal : BLOCK.banner
    buf.fillBox(x - 2, y, z - 2, x + 2, y, z + 2, BLOCK.stone2, 'temple-statue-plinth')
    buf.fillBox(x - 1, y + 1, z - 1, x + 1, y + 4, z + 1, BLOCK.trim, 'temple-statue')
    buf.fillBox(x, y + 5, z, x, y + 6, z, BLOCK.trim, 'temple-statue')
    buf.fillBox(x - 2, y + 3, z, x + 2, y + 3, z, accent, 'temple-statue-painted')
    if (detail > 0.7) buf.fillBox(x - 1, y + 7, z, x + 1, y + 7, z, BLOCK.metal, 'temple-statue-crown')
}

function templeOfferingBowls(buf: VoxelBuffer, x1: number, x2: number, y: number, z: number): void {
    for (const x of [x1, x2]) {
        buf.fillBox(x - 1, y, z - 1, x + 1, y, z + 1, BLOCK.metal, 'temple-offering-bowl')
        buf.set(x, y + 1, z, BLOCK.fire, 'temple-offering-fire')
    }
}
