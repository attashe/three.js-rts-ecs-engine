import { BLOCK } from '../engine/voxel/palette'
import type { StructureGenerationOptions, TowerStyle } from './types'
import { VoxelBuffer } from './buffer'
import type { Rng } from './math'
import { choose, clamp, randFloat, randInt } from './math'

const TOWER_FLOOR_INTERVAL = 6

export function composeTower(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const p = opts.tower
    const style = choose(p.style, ['round', 'square', 'lighthouse', 'ruined'], rng)
    const r = Math.max(5, p.radius + Math.round(randInt(rng, -1, 1) * opts.variation))
    const h = Math.max(18, p.height + Math.round(randInt(rng, -2, 2) * opts.variation))
    const thick = Math.max(1, p.wallThickness)
    towerShell(buf, ox, oy, oz, r, h, thick, style, opts)
    towerDoorArch(buf, ox, oy, oz, r, thick)
    towerWindowsAndSlits(buf, ox, oy, oz, r, h, thick, p.windowEvery, style, opts)
    towerInteriorFloors(buf, ox, oy, oz, r, h, thick, style, opts)
    towerControlledRuin(buf, ox, oy, oz, r, h, style, rng, opts)
    towerButtresses(buf, ox, oy, oz, r, h, style, opts)
    towerExteriorStairs(buf, ox, oy, oz, r, h, thick, style, opts)
    const crownR = towerOuterRadiusAt(oy, r, h, oy + h - 1, opts)
    towerCrown(buf, ox, oy, oz, crownR, h, style, opts.tower.spire)
    towerRoof(buf, ox, oy, oz, crownR, h, style, rng, opts)
    towerInteriorStairs(buf, ox, oy, oz, r, h, thick, style, opts)
    towerBannersMossTorches(buf, ox, oy, oz, r, h, style, rng, opts)
}

function towerShell(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    const square = style === 'square'
    for (let y = 0; y < h; y++) {
        const ro = towerOuterRadiusAt(oy, r, h, oy + y, opts)
        const ri = Math.max(0, ro - thick)
        const block = y % 6 === 0 && opts.detail > 0.55 ? BLOCK.stone2 : BLOCK.stone
        if (square) buf.hollowBox(ox - ro, oy + y, oz - ro, ox + ro, oy + y, oz + ro, thick, block, 'tower-wall-square')
        else buf.shellCylinder(ox, oy + y, oz, ro, ri, oy + y, block, 'tower-wall-round')
    }
}

function towerOuterRadiusAt(oy: number, r: number, h: number, y: number, opts: StructureGenerationOptions): number {
    const t = clamp((y - oy) / Math.max(1, h - 1), 0, 1)
    return Math.max(5, Math.round(r * (1 - opts.tower.taper * t)))
}

function towerDoorArch(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, thick: number): void {
    const outerZ = oz - r
    const outsideZ = outerZ - 1
    const insideZ = outerZ + Math.max(1, thick) + 1
    const w = 3
    const h = 5
    const left = ox - Math.floor(w / 2)
    const right = left + w - 1
    for (let z = outsideZ; z <= insideZ; z++) {
        for (let x = left; x <= right; x++) {
            for (let y = oy + 1; y <= oy + h; y++) buf.del(x, y, z)
        }
    }
    buf.fillBox(left - 1, oy + 1, outerZ, left - 1, oy + h, outerZ, BLOCK.darkStone, 'tower-door-jamb')
    buf.fillBox(right + 1, oy + 1, outerZ, right + 1, oy + h, outerZ, BLOCK.darkStone, 'tower-door-jamb')
    buf.fillBox(left - 1, oy + h + 1, outerZ, right + 1, oy + h + 1, outerZ, BLOCK.darkStone, 'tower-door-arch')
    buf.fillBox(left - 1, oy + h + 1, insideZ, right + 1, oy + h + 1, insideZ, BLOCK.stone2, 'tower-door-inner-arch')
    buf.fillBox(left - 1, oy, outsideZ, right + 1, oy, insideZ, BLOCK.stone2, 'tower-entry-threshold')
    towerEntryApproach(buf, ox, oy, outsideZ)
}

function towerWindowsAndSlits(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, interval: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    const directions: Array<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]]
    for (let y = oy + 8; y < oy + h - 4; y += Math.max(5, interval)) {
        const t = clamp((y - oy) / Math.max(1, h - 1), 0, 1)
        const surfaceR = Math.max(5, Math.round(r * (1 - opts.tower.taper * t)))
        for (const [dx, dz] of directions) {
            if (dx === 0 && dz === -1 && y <= oy + 8) continue
            const x = ox + dx * surfaceR
            const z = oz + dz * surfaceR
            towerWindowHole(buf, x, y, z, [dx, dz], thick, style === 'lighthouse' ? 2 : 1, style === 'lighthouse' ? 3 : 3)
        }
    }
}

function towerWindowHole(buf: VoxelBuffer, x: number, y: number, z: number, normal: readonly [number, number], thick: number, w: number, h: number): void {
    const [nx, nz] = normal
    const tx = -nz
    const tz = nx
    const left = -Math.floor((w - 1) / 2)
    const right = left + w - 1
    for (let ix = left; ix <= right; ix++) {
        for (let yy = 0; yy < h; yy++) {
            for (let d = -1; d <= thick + 1; d++) {
                const px = x + tx * ix - nx * d
                const pz = z + tz * ix - nz * d
                buf.del(px, y + yy, pz)
            }
        }
    }
    for (let ix = left - 1; ix <= right + 1; ix++) {
        const px = x + tx * ix
        const pz = z + tz * ix
        buf.set(px, y - 1, pz, BLOCK.trim, 'tower-window-trim')
        buf.set(px, y + h, pz, BLOCK.trim, 'tower-window-trim')
    }
    for (let yy = 0; yy < h; yy++) {
        for (const ix of [left - 1, right + 1]) {
            const px = x + tx * ix
            const pz = z + tz * ix
            buf.set(px, y + yy, pz, BLOCK.darkStone, 'tower-window-jamb')
        }
    }
}

function towerEntryApproach(buf: VoxelBuffer, ox: number, oy: number, outsideZ: number): void {
    const groundY = Math.max(0, oy - 1)
    buf.fillBox(ox - 2, groundY, outsideZ - 6, ox + 2, groundY, outsideZ - 3, BLOCK.sand, 'tower-entry-path')
    if (groundY < oy) {
        buf.fillBox(ox - 2, groundY, outsideZ - 2, ox + 2, groundY, outsideZ - 2, BLOCK.stone2, 'tower-entry-lower-step')
        buf.fillBox(ox - 2, oy, outsideZ - 1, ox + 2, oy, outsideZ - 1, BLOCK.stone, 'tower-entry-upper-step')
        return
    }
    buf.fillBox(ox - 2, oy, outsideZ - 2, ox + 2, oy, outsideZ - 1, BLOCK.stone2, 'tower-entry-landing')
}

function towerInteriorFloors(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    for (let y = oy + TOWER_FLOOR_INTERVAL; y <= oy + h - 4; y += TOWER_FLOOR_INTERVAL) {
        const { inner } = towerInteriorSlice(oy, r, h, thick, y, opts)
        for (let x = -inner; x <= inner; x++) {
            for (let z = -inner; z <= inner; z++) {
                if (!towerInteriorContains(style, x, z, inner)) continue
                const border = style === 'square'
                    ? Math.max(Math.abs(x), Math.abs(z)) === inner
                    : x * x + z * z >= (inner - 1) * (inner - 1)
                const block = border
                    ? BLOCK.woodDark
                    : ((x + z + y) % 4 === 0 ? BLOCK.plank : BLOCK.wood)
                buf.set(ox + x, y, oz + z, block, border ? 'tower-floor-rim' : 'tower-floor-deck')
            }
        }
    }
}

interface TowerInteriorSlice {
    inner: number
}

function towerInteriorSlice(oy: number, r: number, h: number, thick: number, y: number, opts: StructureGenerationOptions): TowerInteriorSlice {
    const t = clamp((y - oy) / Math.max(1, h - 1), 0, 1)
    const outer = Math.max(5, Math.round(r * (1 - opts.tower.taper * t)))
    const inner = Math.max(2, outer - Math.max(1, thick))
    return { inner }
}

function towerInteriorContains(style: Exclude<TowerStyle, 'mixed'>, x: number, z: number, inner: number): boolean {
    return style === 'square'
        ? Math.max(Math.abs(x), Math.abs(z)) <= inner
        : x * x + z * z < inner * inner
}

function towerInteriorStairs(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    const firstY = oy + 1
    const lastY = oy + h - 1
    const { inner } = towerInteriorSlice(oy, r, h, thick, lastY, opts)
    const radius = towerStairRadius(inner)
    const path = towerStairLoopPath(radius)
    towerStairwellOpenings(buf, ox, oy, oz, r, h, thick, radius, style, opts)
    for (let y = firstY; y <= lastY; y++) {
        const i = y - firstY
        const { inner } = towerInteriorSlice(oy, r, h, thick, y, opts)
        const [x, z] = towerClampedStairCell(path[i % path.length]!, inner)
        const [innerX, innerZ] = towerStairInnerCell(x, z)
        if (!towerInteriorContains(style, x, z, inner)) continue
        buf.set(ox, y, oz, BLOCK.darkStone, 'tower-spiral-pillar')
        if (isTowerFloorLevel(oy, y) || y === lastY) {
            towerStairLanding(buf, ox, y, oz, x, z, innerX, innerZ, inner, style, y === lastY ? 'tower-top-landing' : 'tower-stair-landing')
        }
        placeTowerStairTread(buf, ox, y, oz, x, z, innerX, innerZ, inner, style)
        if (opts.detail > 0.55 && i % 4 === 0) {
            const [railX, railZ] = towerStairOuterRailCell(x, z)
            const frontRail = z < 0 && railZ < z
            if (!frontRail && towerInteriorContains(style, railX, railZ, inner)) buf.set(ox + railX, y + 1, oz + railZ, BLOCK.woodDark, 'tower-spiral-rail')
        }
    }
}

function isTowerFloorLevel(oy: number, y: number): boolean {
    return y > oy && (y - oy) % TOWER_FLOOR_INTERVAL === 0
}

function towerStairRadius(inner: number): number {
    return Math.max(1, Math.min(Math.max(1, inner - 3), Math.floor(inner * 0.45), 3))
}

function towerStairwellOpenings(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, stairRadius: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    for (let y = oy + TOWER_FLOOR_INTERVAL; y <= oy + h - 4; y += TOWER_FLOOR_INTERVAL) {
        const { inner } = towerInteriorSlice(oy, r, h, thick, y, opts)
        const opening = Math.max(2, Math.min(inner - 2, stairRadius + 1))
        carveTowerStairwellOpening(buf, ox, y, oz, opening, inner, style)
        frameTowerStairwellOpening(buf, ox, y, oz, opening, inner, style)
    }
}

function carveTowerStairwellOpening(buf: VoxelBuffer, ox: number, y: number, oz: number, opening: number, inner: number, style: Exclude<TowerStyle, 'mixed'>): void {
    for (let x = -opening; x <= opening; x++) {
        for (let z = -opening; z <= opening; z++) {
            if (towerInteriorContains(style, x, z, inner) && towerStairwellContains(style, x, z, opening)) buf.del(ox + x, y, oz + z)
        }
    }
}

function frameTowerStairwellOpening(buf: VoxelBuffer, ox: number, y: number, oz: number, opening: number, inner: number, style: Exclude<TowerStyle, 'mixed'>): void {
    for (let x = -opening - 1; x <= opening + 1; x++) {
        for (let z = -opening - 1; z <= opening + 1; z++) {
            if (!towerInteriorContains(style, x, z, inner)) continue
            if (!towerStairwellRimContains(style, x, z, opening)) continue
            buf.set(ox + x, y, oz + z, BLOCK.woodDark, 'tower-stairwell-rim')
        }
    }
}

function towerStairwellContains(style: Exclude<TowerStyle, 'mixed'>, x: number, z: number, opening: number): boolean {
    return style === 'square'
        ? Math.max(Math.abs(x), Math.abs(z)) <= opening
        : x * x + z * z <= opening * opening
}

function towerStairwellRimContains(style: Exclude<TowerStyle, 'mixed'>, x: number, z: number, opening: number): boolean {
    if (style === 'square') return Math.max(Math.abs(x), Math.abs(z)) === opening + 1
    const d = x * x + z * z
    return d > opening * opening && d <= (opening + 1) * (opening + 1)
}

function towerClampedStairCell(cell: readonly [number, number], inner: number): readonly [number, number] {
    const limit = Math.max(1, inner - 2)
    return [clamp(cell[0], -limit, limit), clamp(cell[1], -limit, limit)]
}

function towerStairLoopPath(radius: number): Array<readonly [number, number]> {
    const path: Array<readonly [number, number]> = []
    for (let x = 0; x <= radius; x++) path.push([x, -radius])
    for (let z = -radius + 1; z <= radius; z++) path.push([radius, z])
    for (let x = radius - 1; x >= -radius; x--) path.push([x, radius])
    for (let z = radius - 1; z >= -radius; z--) path.push([-radius, z])
    for (let x = -radius + 1; x < 0; x++) path.push([x, -radius])
    return path
}

function towerStairInnerCell(x: number, z: number): readonly [number, number] {
    if (Math.abs(x) > Math.abs(z)) return [x + (x > 0 ? -1 : 1), z]
    if (z !== 0) return [x, z + (z > 0 ? -1 : 1)]
    if (x !== 0) return [x + (x > 0 ? -1 : 1), z]
    return [x, z]
}

function towerStairOuterRailCell(x: number, z: number): readonly [number, number] {
    if (Math.abs(x) > Math.abs(z)) return [x + Math.sign(x), z]
    if (z !== 0) return [x, z + Math.sign(z)]
    if (x !== 0) return [x + Math.sign(x), z]
    return [x, z]
}

function placeTowerStairTread(buf: VoxelBuffer, ox: number, y: number, oz: number, x: number, z: number, innerX: number, innerZ: number, inner: number, style: Exclude<TowerStyle, 'mixed'>): void {
    buf.set(ox + x, y, oz + z, BLOCK.stone2, 'tower-spiral-step')
    if ((innerX !== x || innerZ !== z) && towerInteriorContains(style, innerX, innerZ, inner)) {
        buf.set(ox + innerX, y, oz + innerZ, BLOCK.woodDark, 'tower-spiral-step')
    }
}

function towerStairLanding(buf: VoxelBuffer, ox: number, y: number, oz: number, x: number, z: number, innerX: number, innerZ: number, inner: number, style: Exclude<TowerStyle, 'mixed'>, tag: string): void {
    const x1 = Math.min(x, innerX) - 1
    const x2 = Math.max(x, innerX) + 1
    const z1 = Math.min(z, innerZ) - 1
    const z2 = Math.max(z, innerZ) + 1
    for (let px = x1; px <= x2; px++) {
        for (let pz = z1; pz <= z2; pz++) {
            if (towerInteriorContains(style, px, pz, inner)) buf.set(ox + px, y, oz + pz, BLOCK.woodDark, tag)
        }
    }
}

function towerExteriorStairs(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, thick: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    if (opts.detail < 0.45 || style === 'lighthouse') return
    const targetY = oy + TOWER_FLOOR_INTERVAL
    if (targetY >= oy + h - 5) return
    const side = 1
    const targetR = towerOuterRadiusAt(oy, r, h, targetY, opts)
    const wallX = ox + side * targetR
    const outsideX = wallX + side * 2
    const startZ = oz - Math.max(3, Math.round(targetR * 0.65))
    const landingZ = oz
    const stepCount = targetY - oy

    for (let i = 0; i <= stepCount; i++) {
        const y = oy + i
        const z = Math.round(startZ + (landingZ - startZ) * (i / Math.max(1, stepCount)))
        const x1 = Math.min(outsideX, outsideX + side)
        const x2 = Math.max(outsideX, outsideX + side)
        buf.fillBox(x1, y, z, x2, y, z, BLOCK.stone2, 'tower-outer-stair')
        if (y > oy) buf.fillBox(x1, oy, z, x2, y - 1, z, BLOCK.darkStone, 'tower-outer-stair-support')
        if (i % 2 === 0) buf.set(outsideX + side * 2, y + 1, z, BLOCK.woodDark, 'tower-outer-stair-rail')
    }

    const landingX1 = Math.min(wallX + side, outsideX + side)
    const landingX2 = Math.max(wallX + side, outsideX + side)
    buf.fillBox(landingX1, targetY, landingZ - 2, landingX2, targetY, landingZ + 2, BLOCK.stone2, 'tower-outer-landing')
    buf.fillBox(outsideX + side * 2, targetY + 1, landingZ - 2, outsideX + side * 2, targetY + 1, landingZ + 2, BLOCK.woodDark, 'tower-outer-landing-rail')
    towerClearOuterLandingHeadroom(buf, landingX1, landingX2, targetY, landingZ)
    towerSideDoor(buf, ox, targetY, oz, targetR, thick, side)
}

function towerClearOuterLandingHeadroom(buf: VoxelBuffer, x1: number, x2: number, floorY: number, z: number): void {
    for (let x = x1; x <= x2; x++) {
        for (let zz = z - 1; zz <= z + 1; zz++) {
            for (let y = floorY + 1; y <= floorY + 4; y++) buf.del(x, y, zz)
        }
    }
}

function towerSideDoor(buf: VoxelBuffer, ox: number, floorY: number, oz: number, r: number, thick: number, side: -1 | 1): void {
    const wallX = ox + side * r
    const outsideX = wallX + side
    const insideX = wallX - side * Math.max(1, thick)
    const x1 = Math.min(outsideX, insideX)
    const x2 = Math.max(outsideX, insideX)
    for (let x = x1; x <= x2; x++) {
        for (let z = oz - 1; z <= oz + 1; z++) {
            for (let y = floorY + 1; y <= floorY + 4; y++) buf.del(x, y, z)
        }
    }
    buf.fillBox(wallX, floorY + 1, oz - 2, wallX, floorY + 4, oz - 2, BLOCK.darkStone, 'tower-outer-door-jamb')
    buf.fillBox(wallX, floorY + 1, oz + 2, wallX, floorY + 4, oz + 2, BLOCK.darkStone, 'tower-outer-door-jamb')
    buf.fillBox(wallX, floorY + 5, oz - 2, wallX, floorY + 5, oz + 2, BLOCK.darkStone, 'tower-outer-door-arch')
}

function towerButtresses(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, style: Exclude<TowerStyle, 'mixed'>, opts: StructureGenerationOptions): void {
    if (opts.detail < 0.35 || style === 'lighthouse') return
    const height = Math.min(h - 2, 10)
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (dx === 0 && dz === -1) continue
        const bx = ox + dx * (r + 1)
        const bz = oz + dz * (r + 1)
        for (let i = 0; i < 3; i++) buf.fillBox(bx + dx * i, oy + 1, bz + dz * i, bx + dx * i, oy + height - i, bz + dz * i, BLOCK.darkStone, 'tower-buttress')
    }
}

function towerCrown(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, style: Exclude<TowerStyle, 'mixed'>, hasSpire: boolean): void {
    const y = oy + h
    if (style === 'square') {
        towerSquareCrownCorbels(buf, ox, y - 1, oz, r)
        buf.fillBox(ox - r - 1, y, oz - r - 1, ox + r + 1, y, oz - r - 1, BLOCK.darkStone, 'tower-crown-ring')
        buf.fillBox(ox - r - 1, y, oz + r + 1, ox + r + 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-ring')
        buf.fillBox(ox - r - 1, y, oz - r - 1, ox - r - 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-ring')
        buf.fillBox(ox + r + 1, y, oz - r - 1, ox + r + 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-ring')
        if (hasSpire) buf.fillBox(ox - r, y + 1, oz - r, ox + r, y + 1, oz + r, BLOCK.darkStone, 'tower-crown-deck')
        for (let x = ox - r - 1; x <= ox + r + 1; x += 3) {
            buf.set(x, y + 1, oz - r - 1, BLOCK.stone, 'crenel')
            buf.set(x, y + 1, oz + r + 1, BLOCK.stone, 'crenel')
        }
        for (let z = oz - r - 1; z <= oz + r + 1; z += 3) {
            buf.set(ox - r - 1, y + 1, z, BLOCK.stone, 'crenel')
            buf.set(ox + r + 1, y + 1, z, BLOCK.stone, 'crenel')
        }
        return
    }

    towerRoundCrownCorbels(buf, ox, y - 1, oz, r)
    if (style !== 'lighthouse' && hasSpire) {
        for (let x = -r; x <= r; x++) {
            for (let z = -r; z <= r; z++) {
                if (x * x + z * z <= r * r) buf.set(ox + x, y + 1, oz + z, BLOCK.darkStone, 'tower-crown-deck')
            }
        }
    }
    for (let x = -r - 1; x <= r + 1; x++) {
        for (let z = -r - 1; z <= r + 1; z++) {
            const d = x * x + z * z
            if (d <= (r + 1) * (r + 1) && d >= r * r) {
                const a = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2)
                const cren = Math.floor(a * 24) % 2 === 0
                buf.set(ox + x, y, oz + z, BLOCK.darkStone, 'tower-crown-ring')
                if (cren && style !== 'lighthouse') buf.set(ox + x, y + 1, oz + z, BLOCK.stone, 'crenel')
            }
        }
    }
    if (style === 'lighthouse') {
        buf.shellCylinder(ox, y + 1, oz, Math.max(2, Math.round(r * 0.65)), Math.max(1, Math.round(r * 0.42)), y + 3, BLOCK.glass, 'lantern-glass')
        buf.set(ox, y + 2, oz, BLOCK.fire, 'lighthouse-fire')
    }
}

function towerSquareCrownCorbels(buf: VoxelBuffer, ox: number, y: number, oz: number, r: number): void {
    buf.fillBox(ox - r - 1, y, oz - r - 1, ox + r + 1, y, oz - r - 1, BLOCK.darkStone, 'tower-crown-corbel')
    buf.fillBox(ox - r - 1, y, oz + r + 1, ox + r + 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-corbel')
    buf.fillBox(ox - r - 1, y, oz - r - 1, ox - r - 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-corbel')
    buf.fillBox(ox + r + 1, y, oz - r - 1, ox + r + 1, y, oz + r + 1, BLOCK.darkStone, 'tower-crown-corbel')
}

function towerRoundCrownCorbels(buf: VoxelBuffer, ox: number, y: number, oz: number, r: number): void {
    for (let x = -r - 1; x <= r + 1; x++) {
        for (let z = -r - 1; z <= r + 1; z++) {
            const d = x * x + z * z
            if (d <= (r + 1) * (r + 1) && d >= r * r) buf.set(ox + x, y, oz + z, BLOCK.darkStone, 'tower-crown-corbel')
        }
    }
}

function towerRoof(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, style: Exclude<TowerStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    if (style === 'lighthouse') {
        towerLighthouseRoof(buf, ox, oy + h + 4, oz, r)
        return
    }
    if (!opts.tower.spire) return
    if (style === 'square') towerPyramidRoof(buf, ox, oy + h + 2, oz, r)
    else if (style === 'ruined') towerRuinedRoof(buf, ox, oy + h + 2, oz, r, rng, opts)
    else towerConicRoof(buf, ox, oy + h + 2, oz, r)
}

function towerLighthouseRoof(buf: VoxelBuffer, ox: number, baseY: number, oz: number, r: number): void {
    const startR = Math.max(3, Math.round(r * 0.72))
    const layers = Math.max(4, startR)
    for (let l = 0; l < layers; l++) {
        const rr = Math.max(0, startR - l)
        const y = baseY + l
        for (let x = -rr; x <= rr; x++) {
            for (let z = -rr; z <= rr; z++) {
                if (Math.abs(x) + Math.abs(z) <= rr + 1) buf.set(ox + x, y, oz + z, BLOCK.roofDark, 'tower-roof-lighthouse')
            }
        }
    }
    buf.set(ox, baseY + layers, oz, BLOCK.metal, 'tower-roof-tip')
}

function towerConicRoof(buf: VoxelBuffer, ox: number, baseY: number, oz: number, r: number): void {
    const startR = Math.max(4, r)
    const layers = Math.max(5, Math.round(r * 0.75))
    for (let l = 0; l < layers; l++) {
        const rr = Math.max(1, Math.round(startR * (1 - l / (layers + 1))))
        const y = baseY + l
        for (let x = -rr; x <= rr; x++) {
            for (let z = -rr; z <= rr; z++) {
                if (x * x + z * z <= rr * rr) {
                    const edge = x * x + z * z > (rr - 1) * (rr - 1)
                    buf.set(ox + x, y, oz + z, edge ? BLOCK.roofDark : BLOCK.roof, 'tower-roof-cone')
                }
            }
        }
    }
    buf.set(ox, baseY + layers, oz, BLOCK.metal, 'tower-roof-tip')
}

function towerPyramidRoof(buf: VoxelBuffer, ox: number, baseY: number, oz: number, r: number): void {
    const layers = Math.max(5, Math.ceil((r + 2) / 2))
    for (let l = 0; l < layers; l++) {
        const rr = Math.max(0, r - l * 2)
        const block = l % 2 === 0 ? BLOCK.roof : BLOCK.roofDark
        buf.fillBox(ox - rr, baseY + l, oz - rr, ox + rr, baseY + l, oz + rr, block, 'tower-roof-pyramid')
    }
    buf.set(ox, baseY + layers, oz, BLOCK.metal, 'tower-roof-tip')
}

function towerRuinedRoof(buf: VoxelBuffer, ox: number, baseY: number, oz: number, r: number, rng: Rng, opts: StructureGenerationOptions): void {
    const pieces = Math.max(5, Math.round(6 + opts.detail * 8))
    for (let i = 0; i < pieces; i++) {
        if (rng() < 0.28) continue
        const a = i / pieces * Math.PI * 2 + randFloat(rng, -0.16, 0.16)
        const span = randInt(rng, 1, 3)
        for (let s = 0; s < span; s++) {
            const aa = a + s * 0.12
            const rr = r + randInt(rng, -1, 2)
            const x = ox + Math.round(Math.cos(aa) * rr)
            const z = oz + Math.round(Math.sin(aa) * rr)
            const y = baseY + randInt(rng, 0, 2)
            buf.set(x, y, z, rng() < 0.5 ? BLOCK.roofDark : BLOCK.stone2, 'tower-roof-ruin')
            if (rng() < 0.45) buf.set(x, y - 1, z, BLOCK.darkStone, 'tower-roof-ruin-support')
        }
    }
}

function towerBannersMossTorches(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, style: Exclude<TowerStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    if (opts.detail < 0.55) return
    const y0 = oy + Math.round(h * 0.55)
    const faceX = ox + r
    const outX = ox + r + 1
    if (buf.has(faceX, y0, oz)) {
        for (let y = y0; y <= y0 + 4; y++) for (let z = oz - 1; z <= oz + 1; z++) buf.set(outX, y, z, BLOCK.banner, 'tower-banner')
        buf.set(outX, y0 + 5, oz, BLOCK.metal, 'banner-hook')
        buf.set(faceX, y0 + 5, oz, BLOCK.metal, 'banner-wall-pin')
    }
    for (const [dx, dz] of [[0, -1], [1, 0]]) {
        const wallX = ox + dx * r
        const wallZ = oz + dz * r
        const outX2 = ox + dx * (r + 1)
        const outZ2 = oz + dz * (r + 1)
        const ty = oy + 4
        if (buf.has(wallX, ty, wallZ)) {
            buf.set(outX2, ty, outZ2, BLOCK.metal, 'torch-bracket')
            buf.set(outX2, ty + 1, outZ2, BLOCK.fire, 'torch-fire')
            buf.set(wallX, ty, wallZ, BLOCK.metal, 'torch-wall-pin')
        }
    }
    for (let i = 0; i < Math.round(8 + opts.detail * 14); i++) {
        const a = randFloat(rng, 0, Math.PI * 2)
        const rr = r + 1
        const x = ox + Math.round(Math.cos(a) * rr)
        const z = oz + Math.round(Math.sin(a) * rr)
        const y = oy + randInt(rng, 1, Math.min(h - 2, 10))
        if (buf.has(x - Math.sign(x - ox), y, z) || buf.has(x, y, z - Math.sign(z - oz))) buf.set(x, y, z, BLOCK.moss, 'wall-moss-attached')
    }
}

function towerControlledRuin(buf: VoxelBuffer, ox: number, oy: number, oz: number, r: number, h: number, style: Exclude<TowerStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    if (style !== 'ruined' && opts.tower.ruinAmount < 0.12) return
    const amount = style === 'ruined' ? Math.max(0.2, opts.tower.ruinAmount) : opts.tower.ruinAmount
    const topStart = oy + Math.round(h * (0.68 - randFloat(rng, 0, 0.12)))
    for (const v of buf.toArray()) {
        const dx = v.x - ox
        const dz = v.z - oz
        const nearTower = Math.max(Math.abs(dx), Math.abs(dz)) <= r + 2 || dx * dx + dz * dz <= (r + 2) * (r + 2)
        if (!nearTower || v.y < topStart || v.tag.includes('door') || v.tag.includes('floor')) continue
        const edgeBias = (v.y - topStart) / Math.max(1, oy + h - topStart)
        if (rng() < amount * edgeBias * 0.55) buf.del(v.x, v.y, v.z)
    }
    for (let i = 0; i < Math.round(amount * 28); i++) {
        const a = randFloat(rng, 0, Math.PI * 2)
        const rr = randInt(rng, r + 1, r + 4)
        const x = ox + Math.round(Math.cos(a) * rr)
        const z = oz + Math.round(Math.sin(a) * rr)
        buf.set(x, oy, z, rng() < 0.45 ? BLOCK.darkStone : BLOCK.stone2, 'ruin-rubble-base')
        if (rng() < 0.3) buf.set(x, oy + 1, z, BLOCK.stone, 'ruin-rubble-base')
    }
}
