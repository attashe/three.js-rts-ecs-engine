import { BLOCK } from '../engine/voxel/palette'
import type { StructureGenerationOptions, TreeStyle } from './types'
import { VoxelBuffer } from './buffer'
import type { Rng } from './math'
import { choose, clamp, lerp, randFloat, randInt } from './math'
import { LEAF_BLOCKS } from './materials'

interface TreeMats {
    trunk: number
    bark: number
    leaf: number
    leaf2: number
    dark: number
}

const TREE_STYLE_MATERIALS: Record<Exclude<TreeStyle, 'mixed'>, TreeMats> = {
    oak: { trunk: BLOCK.bark, bark: BLOCK.barkDark, leaf: BLOCK.leaf, leaf2: BLOCK.leaf, dark: BLOCK.leafDark },
    pine: { trunk: BLOCK.bark, bark: BLOCK.barkDark, leaf: BLOCK.deepLeaf, leaf2: BLOCK.leafDark, dark: BLOCK.deepLeaf },
    birch: { trunk: BLOCK.barkLight, bark: BLOCK.barkDark, leaf: BLOCK.leafLight, leaf2: BLOCK.leaf, dark: BLOCK.leafDark },
    willow: { trunk: BLOCK.bark, bark: BLOCK.barkDark, leaf: BLOCK.leaf, leaf2: BLOCK.leaf, dark: BLOCK.leafDark },
    dead: { trunk: BLOCK.barkDark, bark: BLOCK.woodDark, leaf: BLOCK.bark, leaf2: BLOCK.barkDark, dark: BLOCK.barkDark },
}

export function composeTree(buf: VoxelBuffer, ox: number, oy: number, oz: number, opts: StructureGenerationOptions, rng: Rng): void {
    const p = opts.tree
    const style = choose(p.style, ['oak', 'pine', 'birch', 'willow', 'dead'], rng)
    const trunkH = Math.max(6, p.trunkHeight + randInt(rng, -2, 2))
    const trunkR = Math.max(1, p.trunkRadius + (rng() < opts.variation * 0.35 ? randInt(rng, -1, 1) : 0))
    const crownR = Math.max(3, p.crownRadius + randInt(rng, -2, 2))
    treeRoots(buf, ox, oy, oz, trunkR, style, rng, opts)
    treeTrunk(buf, ox, oy + 1, oz, trunkH, trunkR, style, rng, opts)
    const endpoints = treeBranches(buf, ox, oy + 1, oz, trunkH, crownR, style, rng, opts)
    if (style === 'pine') treeCrownPine(buf, ox, oy + 1, oz, trunkH, crownR, style, rng, opts)
    else if (style === 'willow') treeCrownWillow(buf, ox, oy + 1, oz, trunkH, crownR, rng, opts)
    else if (style === 'dead') treeDeadTips(buf, endpoints, rng, opts)
    else treeCrownOak(buf, ox, oy + 1, oz, trunkH, crownR, endpoints, style, rng, opts)
    treeFruitAndGroundDetails(buf, ox, oy, oz, crownR, style, rng, opts)
}

function treeStyleMats(style: Exclude<TreeStyle, 'mixed'>): TreeMats {
    return TREE_STYLE_MATERIALS[style]
}

function treeTrunk(buf: VoxelBuffer, ox: number, oy: number, oz: number, height: number, radius: number, style: Exclude<TreeStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    const mats = treeStyleMats(style)
    const taper = Math.max(0, radius - 1)
    for (let y = 0; y < height; y++) {
        const t = y / Math.max(1, height - 1)
        const r = Math.max(1, Math.round(radius - taper * t * 0.35))
        for (let x = -r; x <= r; x++) {
            for (let z = -r; z <= r; z++) if (x * x + z * z <= r * r) buf.set(ox + x, oy + y, oz + z, mats.trunk, 'tree-trunk')
        }
        if (opts.detail > 0.35 && y % 2 === 0) {
            const a = (y * 37 + randInt(rng, 0, 4)) * Math.PI / 4
            buf.set(ox + Math.round(Math.cos(a) * (r + 1)), oy + y, oz + Math.round(Math.sin(a) * (r + 1)), mats.bark, 'tree-bark-ridge')
        }
        if (style === 'birch' && y % 3 === 1) {
            const a = randInt(rng, 0, 7) * Math.PI / 4
            buf.set(ox + Math.round(Math.cos(a) * (r + 1)), oy + y, oz + Math.round(Math.sin(a) * (r + 1)), BLOCK.barkDark, 'birch-mark')
        }
    }
}

function treeRoots(buf: VoxelBuffer, ox: number, oy: number, oz: number, radius: number, style: Exclude<TreeStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    const mats = treeStyleMats(style)
    const rootCount = clamp(Math.round(5 + opts.detail * 5 + radius), 5, 12)
    for (let i = 0; i < rootCount; i++) {
        const a = (i / rootCount) * Math.PI * 2 + randFloat(rng, -0.25, 0.25) * opts.variation
        const len = randInt(rng, radius + 3, radius + 8)
        const ex = ox + Math.round(Math.cos(a) * len)
        const ez = oz + Math.round(Math.sin(a) * len)
        buf.line(ox + Math.round(Math.cos(a) * radius), oy, oz + Math.round(Math.sin(a) * radius), ex, oy, ez, mats.trunk, 0, 'tree-root')
        if (opts.detail > 0.65 && rng() < 0.45) buf.set(ex, oy + 1, ez, mats.bark, 'root-tip')
    }
}

function treeBranches(
    buf: VoxelBuffer,
    ox: number,
    oy: number,
    oz: number,
    trunkHeight: number,
    crownRadius: number,
    style: Exclude<TreeStyle, 'mixed'>,
    rng: Rng,
    opts: StructureGenerationOptions,
): Array<{ x: number; y: number; z: number }> {
    const mats = treeStyleMats(style)
    const endpoints: Array<{ x: number; y: number; z: number }> = []
    if (style === 'pine') {
        const levels = Math.max(4, Math.round(trunkHeight / 3))
        const start = oy + Math.round(trunkHeight * 0.52)
        const end = oy + Math.round(trunkHeight * 0.96)
        for (let l = 0; l < levels; l++) {
            const t = l / Math.max(1, levels - 1)
            const y = Math.round(lerp(start, end, t))
            const spread = Math.max(1, Math.round(crownRadius * (1 - t * 0.72) * 0.78))
            const count = 4 + Math.round(opts.tree.branchDensity * 6)
            for (let i = 0; i < count; i++) {
                const a = i / count * Math.PI * 2 + randFloat(rng, -0.16, 0.16)
                const ex = ox + Math.round(Math.cos(a) * spread)
                const ez = oz + Math.round(Math.sin(a) * spread)
                buf.line(ox, y, oz, ex, y - randInt(rng, 0, 1), ez, mats.trunk, 0, 'tree-branch')
                endpoints.push({ x: ex, y, z: ez })
            }
        }
        return endpoints
    }

    const count = Math.max(4, Math.round(5 + opts.tree.branchDensity * 10))
    for (let i = 0; i < count; i++) {
        const baseY = oy + Math.round(trunkHeight * (0.35 + 0.45 * rng()))
        const a = i / count * Math.PI * 2 + randFloat(rng, -0.35, 0.35)
        const len = randInt(rng, Math.max(2, Math.round(crownRadius * 0.45)), Math.max(3, Math.round(crownRadius * 0.95)))
        const lift = style === 'willow' ? randInt(rng, 1, 3) : randInt(rng, 1, 5)
        const ex = ox + Math.round(Math.cos(a) * len)
        const ez = oz + Math.round(Math.sin(a) * len)
        const ey = baseY + lift
        buf.line(ox, baseY, oz, ex, ey, ez, mats.trunk, style === 'dead' && opts.detail > 0.7 ? 1 : 0, 'tree-branch')
        endpoints.push({ x: ex, y: ey, z: ez })
    }
    return endpoints
}

function treeLeafBlob(buf: VoxelBuffer, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mats: ReturnType<typeof treeStyleMats>, rng: Rng, opts: StructureGenerationOptions, tag = 'leaf-blob'): void {
    const density = clamp(0.92 - opts.tree.leafNoise * 0.2, 0.68, 0.96)
    for (let x = -rx; x <= rx; x++) {
        for (let y = -ry; y <= ry; y++) {
            for (let z = -rz; z <= rz; z++) {
                const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz)
                if (d > 1) continue
                const edge = d > 0.72
                if (edge && rng() >= density) continue
                const block = edge && rng() < 0.35 ? mats.leaf2 : (y < 0 && rng() < 0.22 ? mats.dark : mats.leaf)
                buf.set(cx + x, cy + y, cz + z, block, tag)
            }
        }
    }
}

function treeCrownOak(buf: VoxelBuffer, ox: number, oy: number, oz: number, trunkHeight: number, crownRadius: number, endpoints: Array<{ x: number; y: number; z: number }>, style: Exclude<TreeStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    const mats = treeStyleMats(style)
    const centerY = oy + trunkHeight + Math.round(crownRadius * 0.35)
    treeLeafBlob(buf, ox, centerY, oz, crownRadius, Math.round(crownRadius * 0.75), crownRadius, mats, rng, opts, 'oak-crown-core')
    if (opts.detail <= 0.45) return
    for (const e of endpoints.slice(0, Math.round(4 + opts.detail * 8))) {
        const rr = randInt(rng, Math.max(2, Math.round(crownRadius * 0.35)), Math.max(3, Math.round(crownRadius * 0.55)))
        treeLeafBlob(buf, e.x, e.y + randInt(rng, 0, 3), e.z, rr, Math.round(rr * 0.8), rr, mats, rng, opts, 'oak-crown-lobe')
    }
}

function treeCrownPine(buf: VoxelBuffer, ox: number, oy: number, oz: number, trunkHeight: number, crownRadius: number, style: Exclude<TreeStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    const mats = treeStyleMats(style)
    const baseY = oy + Math.round(trunkHeight * 0.50)
    const topY = oy + trunkHeight + Math.round(crownRadius * 0.55)
    const layers = Math.max(6, Math.round((topY - baseY) / 2))
    for (let l = 0; l < layers; l++) {
        const t = l / Math.max(1, layers - 1)
        const y = Math.round(lerp(baseY, topY, t))
        const r = Math.max(1, Math.round(crownRadius * (1 - t * 0.86)))
        const h = 1 + Math.round(opts.detail * 1.5)
        for (let yy = 0; yy < h; yy++) {
            for (let x = -r; x <= r; x++) {
                for (let z = -r; z <= r; z++) {
                    const d = Math.abs(x) + Math.abs(z)
                    if (d <= r + randInt(rng, -1, 1)) buf.set(ox + x, y + yy, oz + z, d > r - 2 && rng() < 0.35 ? mats.dark : mats.leaf, 'pine-layer')
                }
            }
        }
    }
    buf.fillCylinder(ox, oy, oz, Math.max(1, Math.round(crownRadius * 0.12)), oy + trunkHeight + Math.round(crownRadius * 0.15), mats.trunk, 'pine-trunk-top')
    buf.set(ox, topY + 1, oz, mats.leaf, 'pine-tip')
}

function treeCrownWillow(buf: VoxelBuffer, ox: number, oy: number, oz: number, trunkHeight: number, crownRadius: number, rng: Rng, opts: StructureGenerationOptions): void {
    const mats = treeStyleMats('willow')
    const centerY = oy + trunkHeight + Math.round(crownRadius * 0.15)
    treeLeafBlob(buf, ox, centerY, oz, crownRadius, Math.round(crownRadius * 0.55), crownRadius, mats, rng, opts, 'willow-dome')
    const strands = Math.round(10 + opts.detail * 20)
    for (let i = 0; i < strands; i++) {
        const a = i / strands * Math.PI * 2 + randFloat(rng, -0.18, 0.18)
        const r = randInt(rng, Math.round(crownRadius * 0.45), crownRadius)
        let x = ox + Math.round(Math.cos(a) * r)
        let z = oz + Math.round(Math.sin(a) * r)
        const y0 = centerY - randInt(rng, 1, 3)
        const len = randInt(rng, 4, Math.max(5, Math.round(crownRadius * 1.1)))
        for (let j = 0; j < len; j++) {
            if (j === 0 || buf.has(x, y0 - j + 1, z) || j < 3) buf.set(x, y0 - j, z, j % 2 ? mats.leaf2 : mats.leaf, 'willow-hanging-leaf')
            if (rng() < 0.18 * opts.variation) {
                x += randInt(rng, -1, 1)
                z += randInt(rng, -1, 1)
            }
        }
    }
}

function treeDeadTips(buf: VoxelBuffer, endpoints: Array<{ x: number; y: number; z: number }>, rng: Rng, opts: StructureGenerationOptions): void {
    for (const e of endpoints) {
        if (rng() < 0.55 + opts.detail * 0.25) buf.line(e.x, e.y, e.z, e.x + randInt(rng, -2, 2), e.y + randInt(rng, 0, 3), e.z + randInt(rng, -2, 2), BLOCK.barkDark, 0, 'dead-twig')
    }
}

function treeFruitAndGroundDetails(buf: VoxelBuffer, ox: number, oy: number, oz: number, crownRadius: number, style: Exclude<TreeStyle, 'mixed'>, rng: Rng, opts: StructureGenerationOptions): void {
    if (style !== 'dead' && opts.tree.fruitChance > 0) {
        let placed = 0
        for (const v of buf.toArray()) {
            if (LEAF_BLOCKS.has(v.block) && placed < 60 && rng() < opts.tree.fruitChance * 0.08 && (buf.has(v.x, v.y + 1, v.z) || buf.has(v.x, v.y - 1, v.z))) {
                buf.set(v.x, v.y - 1, v.z, BLOCK.fruit, 'fruit-attached')
                placed++
            }
        }
    }
    if (opts.detail <= 0.6) return
    for (let i = 0; i < Math.round(2 + opts.detail * 5); i++) {
        const a = randFloat(rng, 0, Math.PI * 2)
        const r = randInt(rng, crownRadius + 2, crownRadius + 7)
        const x = ox + Math.round(Math.cos(a) * r)
        const z = oz + Math.round(Math.sin(a) * r)
        if (rng() < 0.45) {
            buf.set(x, oy, z, BLOCK.mushroom, 'ground-detail')
            buf.set(x, oy + 1, z, BLOCK.fruit, 'mushroom-cap')
        } else {
            buf.set(x, oy, z, BLOCK.flower, 'ground-detail')
        }
    }
}
