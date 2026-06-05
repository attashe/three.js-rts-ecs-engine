import { BLOCK } from '../engine/voxel/palette'
import type { HouseStyle, StructureGenerationOptions, StructureScale } from './types'
import { VoxelBuffer } from './buffer'
import type { Rng } from './math'
import { choose, lerp, randInt } from './math'

interface HouseMats {
    wall: number
    wall2: number
    trim: number
    roof: number
    roof2: number
    foundation: number
}

const HOUSE_STYLE_MATERIALS: Record<Exclude<HouseStyle, 'mixed'>, HouseMats> = {
    cottage: { wall: BLOCK.wall, wall2: BLOCK.plaster, trim: BLOCK.woodDark, roof: BLOCK.thatch, roof2: BLOCK.wood, foundation: BLOCK.stone },
    timber: { wall: BLOCK.plaster, wall2: BLOCK.wall, trim: BLOCK.woodDark, roof: BLOCK.roof, roof2: BLOCK.roofDark, foundation: BLOCK.stone },
    stone: { wall: BLOCK.stone, wall2: BLOCK.stone2, trim: BLOCK.trim, roof: BLOCK.roofDark, roof2: BLOCK.roof, foundation: BLOCK.darkStone },
    workshop: { wall: BLOCK.wood, wall2: BLOCK.wall, trim: BLOCK.metal, roof: BLOCK.roofDark, roof2: BLOCK.roof, foundation: BLOCK.stone },
}

interface HouseProfile {
    scale: StructureScale
    minWidth: number
    minDepth: number
    doorWidth: number
    doorHeight: number
    windowWidth: number
    windowHeightMin: number
    foundationMargin: number
    plinth: boolean
    porchEnabled: boolean
    porchDeckHalfWidth: number
    porchDeckDepth: number
    porchPostTop: number
    porchAwningY: number
    pathLength: number
    pathHalfWidth: number
    gardenWidth: number
    gardenDepth: number
    chimneyHeight: number
    smokeCount: number
}

const HOUSE_PROFILES: Record<StructureScale, HouseProfile> = {
    troll: {
        scale: 'troll',
        minWidth: 10,
        minDepth: 10,
        doorWidth: 3,
        doorHeight: 4,
        windowWidth: 2,
        windowHeightMin: 2,
        foundationMargin: 1,
        plinth: true,
        porchEnabled: true,
        porchDeckHalfWidth: 3,
        porchDeckDepth: 3,
        porchPostTop: 4,
        porchAwningY: 5,
        pathLength: 20,
        pathHalfWidth: 1,
        gardenWidth: 6,
        gardenDepth: 8,
        chimneyHeight: 5,
        smokeCount: 4,
    },
    folk: {
        scale: 'folk',
        minWidth: 6,
        minDepth: 6,
        doorWidth: 2,
        doorHeight: 3,
        windowWidth: 2,
        windowHeightMin: 2,
        foundationMargin: 0,
        plinth: false,
        porchEnabled: false,
        porchDeckHalfWidth: 2,
        porchDeckDepth: 2,
        porchPostTop: 3,
        porchAwningY: 4,
        pathLength: 9,
        pathHalfWidth: 0,
        gardenWidth: 4,
        gardenDepth: 5,
        chimneyHeight: 3,
        smokeCount: 2,
    },
}

export function composeHouse(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const p = opts.house
    const profile = houseProfile(p.scale)
    const style = choose(p.style, ['cottage', 'timber', 'stone', 'workshop'], rng)
    const mats = houseMaterials(style)
    const w = Math.max(profile.minWidth, p.width + Math.round(randInt(rng, -2, 2) * opts.variation))
    const d = Math.max(profile.minDepth, p.depth + Math.round(randInt(rng, -2, 2) * opts.variation))
    const floors = p.floors | 0
    const floorH = p.floorHeight
    houseFoundation(buf, ox, oy, oz, w, d, mats, profile)
    const box = houseWallShell(buf, ox, oy, oz, w, d, floors, floorH, mats, style)
    const door = houseDoor(buf, box, oy, mats, profile)
    houseWindows(buf, box, oy, floors, floorH, mats, rng, opts, profile)
    houseRoof(buf, box, mats, opts, rng)
    housePorchGardenPath(buf, door, box, oy, mats, rng, opts, profile)
    houseSideWing(buf, ox, oy, oz, w, d, floors, floorH, mats, style, rng, opts, profile)
    houseChimneySmoke(buf, box, mats, rng, opts, profile)
    houseWallProps(buf, box, oy, mats, style, opts)
}

function houseMaterials(style: Exclude<HouseStyle, 'mixed'>): HouseMats {
    return HOUSE_STYLE_MATERIALS[style]
}

function houseProfile(scale: StructureScale): HouseProfile {
    return HOUSE_PROFILES[scale]
}

interface HouseBox {
    x1: number
    x2: number
    z1: number
    z2: number
    wallH: number
    topY: number
}

function houseFoundation(buf: VoxelBuffer, cx: number, cy: number, cz: number, w: number, d: number, mats: HouseMats, profile: HouseProfile): void {
    const margin = profile.foundationMargin
    const x1 = cx - Math.floor(w / 2) - margin
    const x2 = cx + Math.ceil(w / 2) - 1 + margin
    const z1 = cz - Math.floor(d / 2) - margin
    const z2 = cz + Math.ceil(d / 2) - 1 + margin
    buf.fillBox(x1, cy, z1, x2, cy, z2, mats.foundation, 'house-foundation')
    if (!profile.plinth) return
    buf.fillBox(x1, cy + 1, z1, x2, cy + 1, z1, mats.foundation, 'house-plinth')
    buf.fillBox(x1, cy + 1, z2, x2, cy + 1, z2, mats.foundation, 'house-plinth')
    buf.fillBox(x1, cy + 1, z1, x1, cy + 1, z2, mats.foundation, 'house-plinth')
    buf.fillBox(x2, cy + 1, z1, x2, cy + 1, z2, mats.foundation, 'house-plinth')
}

function houseWallShell(buf: VoxelBuffer, cx: number, cy: number, cz: number, w: number, d: number, floors: number, floorH: number, mats: HouseMats, style: Exclude<HouseStyle, 'mixed'>): HouseBox {
    const wallH = floors * floorH
    const x1 = cx - Math.floor(w / 2)
    const x2 = cx + Math.ceil(w / 2) - 1
    const z1 = cz - Math.floor(d / 2)
    const z2 = cz + Math.ceil(d / 2) - 1
    buf.hollowBox(x1, cy + 1, z1, x2, cy + wallH, z2, 1, mats.wall, 'house-wall-shell')
    for (const [x, z] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) buf.fillBox(x, cy + 1, z, x, cy + wallH, z, mats.trim, 'house-corner-post')
    for (let f = 1; f < floors; f++) {
        const y = cy + f * floorH
        buf.fillBox(x1, y, z1, x2, y, z1, mats.trim, 'house-floor-band')
        buf.fillBox(x1, y, z2, x2, y, z2, mats.trim, 'house-floor-band')
        buf.fillBox(x1, y, z1, x1, y, z2, mats.trim, 'house-floor-band')
        buf.fillBox(x2, y, z1, x2, y, z2, mats.trim, 'house-floor-band')
    }
    if (style === 'timber') {
        const midX = Math.round((x1 + x2) / 2)
        const midZ = Math.round((z1 + z2) / 2)
        buf.fillBox(midX, cy + 1, z1, midX, cy + wallH, z1, mats.trim, 'timber-beam')
        buf.fillBox(midX, cy + 1, z2, midX, cy + wallH, z2, mats.trim, 'timber-beam')
        buf.fillBox(x1, cy + 1, midZ, x1, cy + wallH, midZ, mats.trim, 'timber-beam')
        buf.fillBox(x2, cy + 1, midZ, x2, cy + wallH, midZ, mats.trim, 'timber-beam')
    }
    return { x1, x2, z1, z2, wallH, topY: cy + wallH }
}

function houseDoor(buf: VoxelBuffer, box: HouseBox, cy: number, mats: HouseMats, profile: HouseProfile): { x: number; y: number; z: number } {
    const doorW = profile.doorWidth
    const doorH = profile.doorHeight
    const cx = Math.round((box.x1 + box.x2) / 2)
    const z = box.z1
    const left = cx - Math.floor(doorW / 2)
    const right = left + doorW - 1
    for (let x = left; x <= right; x++) {
        for (let y = cy + 1; y <= cy + doorH; y++) buf.set(x, y, z, BLOCK.door, 'house-door')
    }
    buf.fillBox(left - 1, cy, z, right + 1, cy, z, mats.trim, 'door-threshold')
    buf.fillBox(left - 1, cy + doorH + 1, z, right + 1, cy + doorH + 1, z, mats.trim, 'door-arch')
    buf.fillBox(left - 1, cy + 1, z, left - 1, cy + doorH, z, mats.trim, 'door-side-trim')
    buf.fillBox(right + 1, cy + 1, z, right + 1, cy + doorH, z, mats.trim, 'door-side-trim')
    return { x: cx, y: cy + 1, z }
}

function houseWindows(buf: VoxelBuffer, box: HouseBox, cy: number, floors: number, floorH: number, mats: HouseMats, rng: Rng, opts: StructureGenerationOptions, profile: HouseProfile): void {
    const winW = profile.windowWidth
    const winH = Math.max(profile.windowHeightMin, Math.round(floorH * 0.34))
    const frontSlots = houseWallSlots(box.x1, box.x2, profile)
    const backSlots = houseWallSlots(box.x1, box.x2, profile)
    const doorAvoidance = Math.ceil(profile.doorWidth / 2) + (profile.scale === 'folk' ? 1 : 2)
    for (let f = 0; f < floors; f++) {
        const base = cy + f * floorH + Math.max(2, Math.round(floorH * 0.42))
        for (const x of frontSlots) if (Math.abs(x - Math.round((box.x1 + box.x2) / 2)) > doorAvoidance || f > 0) addRectWindow(buf, x, base, box.z1, [0, -1], winW, winH)
        for (const x of backSlots) addRectWindow(buf, x, base, box.z2, [0, 1], winW, winH)
        const zSlots = houseWallSlots(box.z1, box.z2, profile)
        for (const z of zSlots) {
            if (rng() < 0.65 + opts.detail * 0.25) addRectWindow(buf, box.x1, base, z, [-1, 0], winW, winH)
            if (rng() < 0.65 + opts.detail * 0.25) addRectWindow(buf, box.x2, base, z, [1, 0], winW, winH)
        }
    }
    if (opts.detail > 0.55 && profile.scale === 'troll') {
        for (const x of frontSlots) {
            const y = cy + Math.max(2, Math.round(floorH * 0.42))
            if (Math.abs(x - Math.round((box.x1 + box.x2) / 2)) > doorAvoidance) {
                buf.fillBox(x - winW - 2, y, box.z1, x - winW - 2, y + winH - 1, box.z1, mats.trim, 'shutter')
                buf.fillBox(x + winW + 1, y, box.z1, x + winW + 1, y + winH - 1, box.z1, mats.trim, 'shutter')
            }
        }
    }
}

function houseWallSlots(min: number, max: number, profile: HouseProfile): number[] {
    const span = max - min + 1
    if (span <= 7) return [Math.round((min + max) / 2)]
    if (span <= 11) return uniqueSorted([min + 1, max - 1])
    return [
        Math.round(lerp(min + 2, max - 2, profile.scale === 'folk' ? 0.28 : 0.25)),
        Math.round(lerp(min + 2, max - 2, profile.scale === 'folk' ? 0.72 : 0.75)),
    ]
}

function uniqueSorted(values: number[]): number[] {
    return [...new Set(values)].sort((a, b) => a - b)
}

function addRectWindow(buf: VoxelBuffer, x: number, y: number, z: number, normal: readonly [number, number], w: number, h: number): void {
    const [nx, nz] = normal
    const tx = -nz
    const tz = nx
    for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < h; iy++) {
            const px = x + Math.round((ix - (w - 1) / 2) * tx)
            const pz = z + Math.round((ix - (w - 1) / 2) * tz)
            buf.set(px, y + iy, pz, BLOCK.glass, 'window-glass')
        }
    }
    for (let ix = -1; ix <= w; ix++) {
        const px = x + Math.round((ix - (w - 1) / 2) * tx)
        const pz = z + Math.round((ix - (w - 1) / 2) * tz)
        buf.set(px, y - 1, pz, BLOCK.trim, 'window-frame')
        buf.set(px, y + h, pz, BLOCK.trim, 'window-frame')
    }
    for (let iy = -1; iy <= h; iy++) {
        for (const side of [-1, w]) {
            const px = x + Math.round((side - (w - 1) / 2) * tx)
            const pz = z + Math.round((side - (w - 1) / 2) * tz)
            buf.set(px, y + iy, pz, BLOCK.trim, 'window-frame')
        }
    }
    if (w >= 3) for (let iy = 0; iy < h; iy++) buf.set(x, y + iy, z, BLOCK.trim, 'window-mullion')
}

function houseRoof(buf: VoxelBuffer, box: HouseBox, mats: HouseMats, opts: StructureGenerationOptions, rng: Rng): void {
    const roof = choose(opts.house.roofStyle, ['gable', 'hip', 'flat', 'shed'], rng)
    if (roof === 'flat') roofFlatParapet(buf, box, mats)
    else if (roof === 'hip') roofHip(buf, box, mats)
    else if (roof === 'shed') roofShed(buf, box, mats)
    else roofGable(buf, box, mats, (box.x2 - box.x1) >= (box.z2 - box.z1) ? 'x' : 'z')
}

function roofGable(buf: VoxelBuffer, box: HouseBox, mats: HouseMats, axis: 'x' | 'z'): void {
    const y0 = box.topY + 1
    const over = 1
    if (axis === 'x') {
        const x1 = box.x1 - over
        const x2 = box.x2 + over
        const maxLayers = Math.ceil((box.z2 - box.z1 + 1 + over * 2) / 2)
        for (let l = 0; l <= maxLayers; l++) {
            const zNear = box.z1 - over + l
            const zFar = box.z2 + over - l
            const y = y0 + l
            if (zNear > zFar) break
            if (zNear === zFar || zFar - zNear <= 1) {
                buf.fillBox(x1, y, Math.round((zNear + zFar) / 2), x2, y, Math.round((zNear + zFar) / 2), mats.trim, 'roof-ridge')
                break
            }
            buf.fillBox(x1, y, zNear, x2, y, zNear, mats.roof, 'gable-roof-slope')
            buf.fillBox(x1, y, zFar, x2, y, zFar, mats.roof, 'gable-roof-slope')
            if (zFar - zNear > 1) {
                buf.fillBox(box.x1, y, zNear + 1, box.x1, y, zFar - 1, mats.wall2, 'gable-end-panel')
                buf.fillBox(box.x2, y, zNear + 1, box.x2, y, zFar - 1, mats.wall2, 'gable-end-panel')
            }
            if (l === 0) {
                buf.fillBox(x1, y - 1, zNear, x2, y - 1, zNear, mats.roof2, 'roof-eave-shadow')
                buf.fillBox(x1, y - 1, zFar, x2, y - 1, zFar, mats.roof2, 'roof-eave-shadow')
            }
            buf.set(x1, y, zNear, mats.roof2, 'gable-end-cap')
            buf.set(x1, y, zFar, mats.roof2, 'gable-end-cap')
            buf.set(x2, y, zNear, mats.roof2, 'gable-end-cap')
            buf.set(x2, y, zFar, mats.roof2, 'gable-end-cap')
        }
        return
    }

    const z1 = box.z1 - over
    const z2 = box.z2 + over
    const maxLayers = Math.ceil((box.x2 - box.x1 + 1 + over * 2) / 2)
    for (let l = 0; l <= maxLayers; l++) {
        const xNear = box.x1 - over + l
        const xFar = box.x2 + over - l
        const y = y0 + l
        if (xNear > xFar) break
        if (xNear === xFar || xFar - xNear <= 1) {
            buf.fillBox(Math.round((xNear + xFar) / 2), y, z1, Math.round((xNear + xFar) / 2), y, z2, mats.trim, 'roof-ridge')
            break
        }
        buf.fillBox(xNear, y, z1, xNear, y, z2, mats.roof, 'gable-roof-slope')
        buf.fillBox(xFar, y, z1, xFar, y, z2, mats.roof, 'gable-roof-slope')
        if (xFar - xNear > 1) {
            buf.fillBox(xNear + 1, y, box.z1, xFar - 1, y, box.z1, mats.wall2, 'gable-end-panel')
            buf.fillBox(xNear + 1, y, box.z2, xFar - 1, y, box.z2, mats.wall2, 'gable-end-panel')
        }
        if (l === 0) {
            buf.fillBox(xNear, y - 1, z1, xNear, y - 1, z2, mats.roof2, 'roof-eave-shadow')
            buf.fillBox(xFar, y - 1, z1, xFar, y - 1, z2, mats.roof2, 'roof-eave-shadow')
        }
        buf.set(xNear, y, z1, mats.roof2, 'gable-end-cap')
        buf.set(xFar, y, z1, mats.roof2, 'gable-end-cap')
        buf.set(xNear, y, z2, mats.roof2, 'gable-end-cap')
        buf.set(xFar, y, z2, mats.roof2, 'gable-end-cap')
    }
}

function roofHip(buf: VoxelBuffer, box: HouseBox, mats: HouseMats): void {
    let x1 = box.x1 - 1
    let x2 = box.x2 + 1
    let z1 = box.z1 - 1
    let z2 = box.z2 + 1
    let y = box.topY + 1
    while (x1 <= x2 && z1 <= z2) {
        buf.fillBox(x1, y, z1, x2, y, z1, mats.roof, 'hip-roof')
        buf.fillBox(x1, y, z2, x2, y, z2, mats.roof, 'hip-roof')
        buf.fillBox(x1, y, z1, x1, y, z2, mats.roof, 'hip-roof')
        buf.fillBox(x2, y, z1, x2, y, z2, mats.roof, 'hip-roof')
        x1++
        x2--
        z1++
        z2--
        y++
    }
    buf.set(Math.round((box.x1 + box.x2) / 2), y, Math.round((box.z1 + box.z2) / 2), mats.trim, 'hip-cap')
}

function roofFlatParapet(buf: VoxelBuffer, box: HouseBox, mats: HouseMats): void {
    const y = box.topY + 1
    buf.fillBox(box.x1 - 1, y, box.z1 - 1, box.x2 + 1, y, box.z2 + 1, mats.roof, 'flat-roof-deck')
    const p = y + 1
    buf.fillBox(box.x1 - 1, p, box.z1 - 1, box.x2 + 1, p, box.z1 - 1, mats.roof, 'parapet')
    buf.fillBox(box.x1 - 1, p, box.z2 + 1, box.x2 + 1, p, box.z2 + 1, mats.roof, 'parapet')
    buf.fillBox(box.x1 - 1, p, box.z1 - 1, box.x1 - 1, p, box.z2 + 1, mats.roof, 'parapet')
    buf.fillBox(box.x2 + 1, p, box.z1 - 1, box.x2 + 1, p, box.z2 + 1, mats.roof, 'parapet')
    for (let x = box.x1 + 1; x <= box.x2 - 1; x += 3) buf.fillBox(x, y + 1, box.z1 + 1, x, y + 1, box.z2 - 1, mats.roof2, 'flat-roof-seam')
}

function roofShed(buf: VoxelBuffer, box: HouseBox, mats: HouseMats): void {
    const y0 = box.topY + 1
    for (let z = box.z1 - 2; z <= box.z2 + 2; z++) {
        const t = (z - (box.z1 - 2)) / Math.max(1, box.z2 - box.z1 + 4)
        const y = y0 + Math.round(t * 3)
        buf.fillBox(box.x1 - 2, y, z, box.x2 + 2, y, z, mats.roof, 'shed-roof')
        if (z >= box.z1 && z <= box.z2 && y > y0) {
            buf.fillBox(box.x1, y0, z, box.x1, y - 1, z, mats.wall2, 'shed-roof-side-panel')
            buf.fillBox(box.x2, y0, z, box.x2, y - 1, z, mats.wall2, 'shed-roof-side-panel')
        }
        if (z === box.z2 && y > y0) {
            buf.fillBox(box.x1 + 1, y0, z, box.x2 - 1, y - 1, z, mats.wall2, 'shed-roof-high-panel')
        }
    }
    buf.fillBox(box.x1 - 2, y0 + 4, box.z2 + 2, box.x2 + 2, y0 + 4, box.z2 + 2, mats.trim, 'shed-ridge')
}

function housePorchGardenPath(buf: VoxelBuffer, door: { x: number; z: number }, box: HouseBox, cy: number, mats: HouseMats, rng: Rng, opts: StructureGenerationOptions, profile: HouseProfile): void {
    if (!opts.house.porch || !profile.porchEnabled) return
    const cx = door.x
    const porch = housePorchLayout(cx, box.z1, profile)
    housePorchDeck(buf, porch, cy, mats, profile)
    housePorchSteps(buf, porch, cy)
    buf.fillBox(cx - profile.pathHalfWidth, cy, porch.pathStartZ, cx + profile.pathHalfWidth, cy, porch.pathEndZ, BLOCK.sand, 'door-path')
    if (opts.detail > 0.55) {
        for (let z = porch.pathEndZ; z >= porch.pathStartZ; z -= 3) {
            buf.set(cx - profile.pathHalfWidth - 1, cy, z, rng() < 0.5 ? BLOCK.stone2 : BLOCK.dirt, 'door-path-edge')
            if (z - 1 >= porch.pathStartZ) buf.set(cx + profile.pathHalfWidth + 1, cy, z - 1, rng() < 0.5 ? BLOCK.stone2 : BLOCK.dirt, 'door-path-edge')
        }
    }
    if (opts.detail <= 0.45) return
    const gx1 = box.x1 - profile.gardenWidth - 2
    const gx2 = box.x1 - 3
    const gz1 = box.z1 - profile.gardenDepth - 2
    const gz2 = box.z1 - 3
    buf.fillBox(gx1, cy, gz1, gx2, cy, gz2, BLOCK.dirt, 'garden-bed')
    for (let x = gx1; x <= gx2; x += 2) {
        for (let zz = gz1; zz <= gz2; zz += 2) buf.set(x, cy + 1, zz, rng() < 0.5 ? BLOCK.flower : BLOCK.leaf, 'garden-plant')
    }
    buf.fillBox(gx1, cy + 1, gz1, gx2, cy + 1, gz1, BLOCK.woodDark, 'garden-fence')
    buf.fillBox(gx1, cy + 1, gz2, gx2, cy + 1, gz2, BLOCK.woodDark, 'garden-fence')
    buf.fillBox(gx1, cy + 1, gz1, gx1, cy + 1, gz2, BLOCK.woodDark, 'garden-fence')
    buf.fillBox(gx2, cy + 1, gz1, gx2, cy + 1, gz2, BLOCK.woodDark, 'garden-fence')
}

interface HousePorchLayout {
    cx: number
    deckHalfWidth: number
    deckFrontZ: number
    deckBackZ: number
    lowerStepZ: number
    upperStepZ: number
    pathStartZ: number
    pathEndZ: number
}

function housePorchLayout(cx: number, doorZ: number, profile: HouseProfile): HousePorchLayout {
    const deckBackZ = doorZ - 1
    const deckFrontZ = deckBackZ - profile.porchDeckDepth + 1
    return {
        cx,
        deckHalfWidth: profile.porchDeckHalfWidth,
        deckFrontZ,
        deckBackZ,
        lowerStepZ: deckFrontZ - 2,
        upperStepZ: deckFrontZ - 1,
        pathStartZ: doorZ - profile.pathLength,
        pathEndZ: deckFrontZ - 3,
    }
}

function housePorchDeck(buf: VoxelBuffer, porch: HousePorchLayout, cy: number, mats: HouseMats, profile: HouseProfile): void {
    const x1 = porch.cx - porch.deckHalfWidth
    const x2 = porch.cx + porch.deckHalfWidth
    buf.fillBox(x1, cy + 1, porch.deckFrontZ, x2, cy + 1, porch.deckBackZ, BLOCK.wood, 'porch-floor')
    for (const x of [x1, x2]) {
        buf.fillBox(x, cy + 2, porch.deckFrontZ, x, cy + profile.porchPostTop, porch.deckFrontZ, BLOCK.woodDark, 'porch-post')
        buf.fillBox(x, cy + 2, porch.deckBackZ, x, cy + profile.porchPostTop, porch.deckBackZ, BLOCK.woodDark, 'porch-post')
        buf.fillBox(x, cy + 2, porch.deckFrontZ + 1, x, cy + 2, porch.deckBackZ, BLOCK.woodDark, 'porch-rail')
    }
    buf.fillBox(x1, cy + 2, porch.deckFrontZ, porch.cx - 2, cy + 2, porch.deckFrontZ, BLOCK.woodDark, 'porch-front-rail')
    buf.fillBox(porch.cx + 2, cy + 2, porch.deckFrontZ, x2, cy + 2, porch.deckFrontZ, BLOCK.woodDark, 'porch-front-rail')
    buf.fillBox(x1 - 1, cy + profile.porchAwningY, porch.deckFrontZ, x2 + 1, cy + profile.porchAwningY, porch.deckBackZ, mats.roof, 'porch-awning')
    buf.fillBox(x1 - 1, cy + profile.porchAwningY - 1, porch.deckFrontZ, x2 + 1, cy + profile.porchAwningY - 1, porch.deckFrontZ, mats.trim, 'porch-awning-trim')
    buf.fillBox(x1 - 1, cy + profile.porchAwningY - 1, porch.deckBackZ, x2 + 1, cy + profile.porchAwningY - 1, porch.deckBackZ, mats.trim, 'porch-awning-trim')
}

function housePorchSteps(buf: VoxelBuffer, porch: HousePorchLayout, cy: number): void {
    const upperHalf = porch.deckHalfWidth
    const lowerHalf = Math.max(1, upperHalf - 1)
    buf.fillBox(porch.cx - lowerHalf, cy, porch.lowerStepZ, porch.cx + lowerHalf, cy, porch.lowerStepZ, BLOCK.stone2, 'porch-step-lower')
    buf.fillBox(porch.cx - upperHalf, cy, porch.upperStepZ, porch.cx + upperHalf, cy, porch.upperStepZ, BLOCK.darkStone, 'porch-step-support')
    buf.fillBox(porch.cx - upperHalf, cy + 1, porch.upperStepZ, porch.cx + upperHalf, cy + 1, porch.upperStepZ, BLOCK.stone, 'porch-step-upper')
    buf.set(porch.cx - upperHalf, cy, porch.lowerStepZ, BLOCK.darkStone, 'porch-step-side')
    buf.set(porch.cx + upperHalf, cy, porch.lowerStepZ, BLOCK.darkStone, 'porch-step-side')
}

function houseSideWing(buf: VoxelBuffer, cx: number, cy: number, cz: number, mainW: number, mainD: number, floors: number, floorH: number, mats: HouseMats, style: Exclude<HouseStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions, profile: HouseProfile): void {
    if (!opts.house.sideWing || opts.detail < 0.35) return
    const wingW = Math.max(profile.scale === 'folk' ? 4 : 6, Math.round(mainW * 0.42))
    const wingD = Math.max(profile.scale === 'folk' ? 4 : 6, Math.round(mainD * 0.55))
    const side = rng() < 0.5 ? -1 : 1
    const wx = cx + side * (Math.floor(mainW / 2) + Math.floor(wingW / 2))
    const wz = cz + randInt(rng, -Math.floor(mainD * 0.12), Math.floor(mainD * 0.12))
    houseFoundation(buf, wx, cy, wz, wingW, wingD, mats, profile)
    const box = houseWallShell(buf, wx, cy, wz, wingW, wingD, Math.max(1, Math.min(floors, 1)), floorH, mats, style)
    houseWindows(buf, box, cy, 1, floorH, mats, rng, opts, profile)
    roofGable(buf, box, mats, 'z')
    const seamX = side < 0 ? Math.max(box.x2, cx - Math.floor(mainW / 2)) : Math.min(box.x1, cx + Math.ceil(mainW / 2) - 1)
    buf.fillBox(seamX, cy + 2, box.z1, seamX, cy + Math.round(floorH * 0.7), box.z2, mats.trim, 'wing-connection-seam')
}

function houseChimneySmoke(buf: VoxelBuffer, box: HouseBox, mats: HouseMats, rng: Rng, opts: StructureGenerationOptions, profile: HouseProfile): void {
    if (!opts.house.chimney) return
    const x = box.x2 - randInt(rng, 2, Math.max(3, Math.round((box.x2 - box.x1) * 0.3)))
    const z = box.z2 - randInt(rng, 2, Math.max(3, Math.round((box.z2 - box.z1) * 0.35)))
    const baseY = box.topY + 2
    if (profile.scale === 'folk') {
        buf.fillBox(x, baseY, z, x, baseY + profile.chimneyHeight, z, BLOCK.darkStone, 'chimney')
        buf.fillBox(x - 1, baseY + profile.chimneyHeight, z - 1, x + 1, baseY + profile.chimneyHeight, z + 1, mats.foundation, 'chimney-cap')
    } else {
        buf.fillBox(x, baseY, z, x + 1, baseY + profile.chimneyHeight, z + 1, BLOCK.darkStone, 'chimney')
        buf.fillBox(x - 1, baseY + profile.chimneyHeight, z - 1, x + 2, baseY + profile.chimneyHeight, z + 2, mats.foundation, 'chimney-cap')
    }
    if (opts.detail > 0.55) for (let i = 0; i < profile.smokeCount; i++) buf.set(x + randInt(rng, -1, 2), baseY + profile.chimneyHeight + 2 + i * 2, z + randInt(rng, -1, 2), BLOCK.smoke, 'smoke-attached-column')
}

function houseWallProps(buf: VoxelBuffer, box: HouseBox, cy: number, mats: HouseMats, style: Exclude<HouseStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    if (opts.detail < 0.6) return
    const sx = box.x2
    const z = Math.round((box.z1 + box.z2) / 2)
    const y = cy + 2
    if (style === 'workshop') {
        buf.set(sx, y, z, BLOCK.metal, 'wall-hook')
        buf.set(sx, y + 1, z, BLOCK.metal, 'wall-hook')
        buf.fillBox(sx, cy + 1, z + 2, sx, cy + 1, z + 5, BLOCK.woodDark, 'wood-pile')
    } else {
        buf.fillBox(box.x1 - 1, cy + 2, box.z1 + 2, box.x1 - 1, cy + 4, box.z1 + 5, BLOCK.banner, 'house-sign-banner')
        buf.set(box.x1 - 1, cy + 4, box.z1 + 1, BLOCK.metal, 'sign-bracket')
    }
    buf.fillBox(box.x1, box.topY + 1, box.z1 - 1, box.x2, box.topY + 1, box.z1 - 1, mats.trim, 'front-gutter')
    buf.fillBox(box.x2, cy + 1, box.z1 - 1, box.x2, box.topY, box.z1 - 1, mats.trim, 'drain-pipe')
}
