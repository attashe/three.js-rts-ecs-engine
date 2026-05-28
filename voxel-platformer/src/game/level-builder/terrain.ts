/**
 * Terrain builder - a thin, chainable layer over `ChunkManager` for
 * code-defined (procedural) levels.
 *
 * Procedural levels used to hand-write `for(z) for(x) for(y) setVoxel(...)`
 * loops for every shape, re-deriving the same flat-ground / box / stair /
 * platform patterns with subtle off-by-one differences. This class names
 * those shapes once so a level reads as *what it contains* rather than the
 * loop mechanics that place it.
 *
 * It owns the level frame (`size`, `groundY`) so coordinate helpers like
 * `stand(x, z)` (standing height) don't repeat `groundY + 1` everywhere.
 * All writes go straight through `chunks.setVoxel` - matching how the old
 * generators wrote, no bulk wrapper needed at generation time.
 */

import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { BLOCK } from '../../engine/voxel/palette'
import { ellipse, pathMask, type TerrainMask, type TerrainPoint } from './masks'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

/** Inclusive integer span `[lo, hi]`. Either order is accepted - the
 *  builder normalises to min/max - so `[20, 16]` and `[16, 20]` are
 *  equivalent. */
export type Span = readonly [number, number]

/** A constant block index, or a per-cell function of `(x, z)` for varied
 *  surfaces (paths, checker patterns, edges). */
export type BlockOrFn = number | ((x: number, z: number) => number)
export type HeightOrFn = number | ((x: number, z: number) => number)

export interface TerrainFrame {
    /** XZ extent in cells. The ground primitive fills `[0, size)` squared. */
    size: number
    /** Y of the walkable surface. The flat ground's top layer sits here;
     *  `stand(x, z)` returns one cell above. */
    groundY: number
}

export interface GroundOptions {
    /** Surface block at `y = groundY` (constant or per-cell). */
    top: BlockOrFn
    /** Block one layer under the surface (`y = groundY - 1`). Default dirt. */
    soil?: number
    /** Block filling everything below the soil (`0 <= y < groundY - 1`).
     *  Default stone. */
    base?: number
}

export interface HeightfieldOptions {
    /** Surface Y for each `(x,z)` cell. Values are floored to whole voxels. */
    heightAt: HeightOrFn
    /** Surface block at the resolved height. */
    top: BlockOrFn
    /** Block one layer under the surface. Default dirt. */
    soil?: number
    /** Block filling everything below the soil. Default stone. */
    base?: number
    /** Lowest Y the heightfield writes. Default 0. */
    minY?: number
}

export interface StairsOptions {
    /** X span the steps occupy (full width of each tread). */
    x: Span
    /** Z of the first (lowest) step's near edge. Steps march +Z. */
    startZ: number
    /** Number of steps. */
    steps: number
    /** Tread depth in cells along Z. Default 1. */
    depth?: number
    /** Y gained per step. Default 1. */
    rise?: number
    /** Tread (cap) block. */
    block: number
    /** When set, fills the solid riser under each tread from `baseY` up. */
    fillUnder?: number
    /** Y of the first tread. Default `groundY + 1`. */
    baseY?: number
}

export interface PlatformOptions {
    /** X span of the slab. */
    x: Span
    /** Z span of the slab. */
    z: Span
    /** Y of the walkable cap. */
    topY: number
    /** Cap block (the surface you stand on). */
    top: number
    /** Solid fill block from `baseY` up to (but not including) `topY`. */
    fill: number
    /** Y where the solid fill starts. Default `groundY + 1`. */
    baseY?: number
}

export interface MaskRaiseOptions {
    fill?: number
    top?: BlockOrFn
}

export interface MaskLowerOptions {
    minY?: number
    top?: BlockOrFn
}

export interface CarveOptions {
    depth?: number
    toY?: number
    minY?: number
    bed?: BlockOrFn
}

export interface PathOptions {
    points: readonly TerrainPoint[]
    width: number
    block: number
    edgeBlock?: number
    edgeWidth?: number
}

export interface PondOptions {
    center: TerrainPoint
    radius?: number
    radiusX?: number
    radiusZ?: number
    waterY: number
    shoreWidth?: number
    shoreBlock?: number
    bedBlock?: number
    waterBlock?: number
}

/** Create a terrain builder bound to a chunk manager and a level frame. */
export function terrain(chunks: ChunkManager, frame: TerrainFrame): Terrain {
    return new Terrain(chunks, frame)
}

export class Terrain {
    readonly size: number
    readonly groundY: number
    private readonly surfaceHeights: Int16Array

    constructor(private readonly chunks: ChunkManager, frame: TerrainFrame) {
        this.size = frame.size
        this.groundY = frame.groundY
        this.surfaceHeights = new Int16Array(this.size * this.size)
        this.surfaceHeights.fill(this.groundY)
    }

    /** Single voxel. Escape hatch equal to `chunks.setVoxel`. */
    set(x: number, y: number, z: number, block: number): this {
        this.write(x, y, z, block)
        return this
    }

    /** Clear a single voxel to air - e.g. the hole a teleport piston needs
     *  at its target cell. */
    clear(x: number, y: number, z: number): this {
        this.write(x, y, z, BLOCK.air)
        return this
    }

    /** Inclusive box fill. `box` is an alias. */
    fill(x: Span, y: Span, z: Span, block: number): this {
        const [x0, x1] = order(x)
        const [y0, y1] = order(y)
        const [z0, z1] = order(z)
        for (let zz = z0; zz <= z1; zz++) {
            for (let yy = y0; yy <= y1; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    this.write(xx, yy, zz, block)
                }
            }
        }
        return this
    }

    /** Alias for {@link fill}; reads better for walls and pillars. */
    box(x: Span, y: Span, z: Span, block: number): this {
        return this.fill(x, y, z, block)
    }

    /** Flat ground across the whole `size x size` footprint: a `base`
     *  column (default stone), one `soil` layer (default dirt) at
     *  `groundY - 1`, and a `top` surface (constant or per-cell) at
     *  `groundY`. */
    ground(opts: GroundOptions): this {
        const soil = opts.soil ?? BLOCK.dirt
        const base = opts.base ?? BLOCK.stone
        const topFn = asFn(opts.top)
        const { size, groundY } = this
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                for (let y = 0; y < groundY; y++) {
                    this.chunks.setVoxel(x, y, z, y === groundY - 1 ? soil : base)
                }
                this.write(x, groundY, z, topFn(x, z))
            }
        }
        return this
    }

    /** Variable-height terrain across the whole frame. Like `ground`, but
     *  `heightAt(x,z)` chooses each column's top Y and the builder records
     *  those heights for `standAt` / `surfaceAt`. */
    heightfield(opts: HeightfieldOptions): this {
        const soil = opts.soil ?? BLOCK.dirt
        const base = opts.base ?? BLOCK.stone
        const minY = Math.max(0, Math.floor(opts.minY ?? 0))
        const topFn = asFn(opts.top)
        const heightFn = asHeightFn(opts.heightAt)

        for (let z = 0; z < this.size; z++) {
            for (let x = 0; x < this.size; x++) {
                const oldY = this.heightAt(x, z)
                const topY = Math.max(minY, Math.floor(heightFn(x, z)))
                if (oldY > topY) {
                    for (let y = oldY; y > topY; y--) this.write(x, y, z, BLOCK.air)
                }
                for (let y = minY; y < topY; y++) {
                    this.write(x, y, z, y === topY - 1 ? soil : base)
                }
                this.write(x, topY, z, topFn(x, z))
            }
        }
        return this
    }

    /** A flight of steps marching along +Z, each tread a `block` cap with
     *  an optional solid riser beneath. */
    stairs(opts: StairsOptions): this {
        const depth = opts.depth ?? 1
        const rise = opts.rise ?? 1
        const baseY = opts.baseY ?? this.groundY + 1
        for (let i = 0; i < opts.steps; i++) {
            const stepY = baseY + i * rise
            const z0 = opts.startZ + i * depth
            const z: Span = [z0, z0 + depth - 1]
            this.fill(opts.x, [stepY, stepY], z, opts.block)
            if (opts.fillUnder !== undefined && stepY > baseY) {
                this.fill(opts.x, [baseY, stepY - 1], z, opts.fillUnder)
            }
        }
        return this
    }

    /** A raised slab: a solid `fill` body from `baseY` up to `topY`, capped
     *  with a `top` surface at `topY`. */
    platform(opts: PlatformOptions): this {
        const baseY = opts.baseY ?? this.groundY + 1
        if (opts.topY > baseY) {
            this.fill(opts.x, [baseY, opts.topY - 1], opts.z, opts.fill)
        }
        this.fill(opts.x, [opts.topY, opts.topY], opts.z, opts.top)
        return this
    }

    /** Paint the current top voxel wherever `mask(x,z)` is true. */
    paintSurface(mask: TerrainMask, block: BlockOrFn): this {
        const blockFn = asFn(block)
        this.forEachMaskedCell(mask, (x, z) => {
            this.write(x, this.heightAt(x, z), z, blockFn(x, z))
        })
        return this
    }

    /** Raise masked terrain columns by whole voxels. */
    raise(mask: TerrainMask, amount: number, opts: MaskRaiseOptions = {}): this {
        const steps = Math.floor(amount)
        if (steps <= 0) return steps < 0 ? this.lower(mask, -steps) : this
        const fill = opts.fill ?? BLOCK.dirt
        const topFn = asFn(opts.top ?? fill)
        this.forEachMaskedCell(mask, (x, z) => {
            const oldY = this.heightAt(x, z)
            const newY = oldY + steps
            for (let y = oldY; y < newY; y++) this.write(x, y, z, fill)
            this.write(x, newY, z, topFn(x, z))
        })
        return this
    }

    /** Lower masked terrain columns by whole voxels. */
    lower(mask: TerrainMask, amount: number, opts: MaskLowerOptions = {}): this {
        const steps = Math.floor(amount)
        if (steps <= 0) return steps < 0 ? this.raise(mask, -steps) : this
        const minY = Math.max(0, Math.floor(opts.minY ?? 0))
        const topFn = opts.top === undefined ? null : asFn(opts.top)
        this.forEachMaskedCell(mask, (x, z) => {
            const oldY = this.heightAt(x, z)
            const newY = Math.max(minY, oldY - steps)
            for (let y = oldY; y > newY; y--) this.write(x, y, z, BLOCK.air)
            if (topFn) this.write(x, newY, z, topFn(x, z))
        })
        return this
    }

    /** Carve masked cells down to `toY` or by `depth`, optionally replacing
     *  the exposed floor with a bed block. */
    carve(mask: TerrainMask, opts: CarveOptions = {}): this {
        const minY = Math.max(0, Math.floor(opts.minY ?? 0))
        const depth = Math.max(1, Math.floor(opts.depth ?? 1))
        const bedFn = opts.bed === undefined ? null : asFn(opts.bed)
        this.forEachMaskedCell(mask, (x, z) => {
            const oldY = this.heightAt(x, z)
            const targetY = Math.max(minY, Math.floor(opts.toY ?? oldY - depth))
            for (let y = oldY; y > targetY; y--) this.write(x, y, z, BLOCK.air)
            if (bedFn) this.write(x, targetY, z, bedFn(x, z))
        })
        return this
    }

    /** Fill masked cells with water at `waterY`, clearing terrain above that
     *  level and optionally writing a bed voxel one layer below. */
    fillWater(mask: TerrainMask, waterY: number, bedBlock: number = BLOCK.sand, waterBlock: number = BLOCK.water): this {
        const y = Math.floor(waterY)
        this.forEachMaskedCell(mask, (x, z) => {
            if (y > 0) this.write(x, y - 1, z, bedBlock)
            for (let clearY = this.heightAt(x, z); clearY > y; clearY--) {
                this.write(x, clearY, z, BLOCK.air)
            }
            this.write(x, y, z, waterBlock)
            this.write(x, y + 1, z, BLOCK.air)
        })
        return this
    }

    /** Paint a polyline path on the current surface. `edgeBlock` paints a
     *  wider underlay first, useful for banks or trim. */
    path(opts: PathOptions): this {
        if (opts.edgeBlock !== undefined) {
            this.paintSurface(pathMask(opts.points, opts.width + (opts.edgeWidth ?? 1) * 2), opts.edgeBlock)
        }
        return this.paintSurface(pathMask(opts.points, opts.width), opts.block)
    }

    /** Carve a simple pond and shore into the current surface. */
    pond(opts: PondOptions): this {
        const radiusX = opts.radiusX ?? opts.radius
        const radiusZ = opts.radiusZ ?? opts.radius
        if (radiusX === undefined || radiusZ === undefined) {
            throw new Error('Terrain.pond requires radius or radiusX/radiusZ')
        }
        const shoreWidth = opts.shoreWidth ?? 1
        const shore = ellipse(opts.center, radiusX + shoreWidth, radiusZ + shoreWidth)
        const water = ellipse(opts.center, radiusX, radiusZ)
        this.paintSurface(shore, opts.shoreBlock ?? BLOCK.sand)
        this.fillWater(water, opts.waterY, opts.bedBlock ?? opts.shoreBlock ?? BLOCK.sand, opts.waterBlock ?? BLOCK.water)
        return this
    }

    /** Standing position one cell above the flat surface - the usual spawn
     *  / placement height. */
    stand(x: number, z: number): VoxelCoord {
        return { x, y: this.groundY + 1, z }
    }

    /** A surface-relative point: `{ x, y: groundY + dy, z }`. `dy = 0` is
     *  the surface itself; `dy = 1` is standing height (same as `stand`). */
    surface(x: number, z: number, dy = 0): VoxelCoord {
        return { x, y: this.groundY + dy, z }
    }

    /** Highest non-air voxel currently recorded for the column containing
     *  `(x,z)`. Falls back to `groundY` outside the builder frame. */
    heightAt(x: number, z: number): number {
        const ix = Math.floor(x)
        const iz = Math.floor(z)
        if (!this.inFrame(ix, iz)) return this.groundY
        return this.surfaceHeights[this.index(ix, iz)]!
    }

    /** Standing coordinate one cell above the current column surface. */
    standAt(x: number, z: number): VoxelCoord {
        return { x, y: this.heightAt(x, z) + 1, z }
    }

    /** Surface-relative coordinate using the current column height. */
    surfaceAt(x: number, z: number, dy = 0): VoxelCoord {
        return { x, y: this.heightAt(x, z) + dy, z }
    }

    private forEachMaskedCell(mask: TerrainMask, fn: (x: number, z: number) => void): void {
        for (let z = 0; z < this.size; z++) {
            for (let x = 0; x < this.size; x++) {
                if (mask(x, z)) fn(x, z)
            }
        }
    }

    private write(x: number, y: number, z: number, block: number): void {
        this.chunks.setVoxel(x, y, z, block)
        this.recordHeightWrite(x, y, z, block)
    }

    private recordHeightWrite(x: number, y: number, z: number, block: number): void {
        if (!this.inFrame(x, z)) return
        const idx = this.index(x, z)
        const current = this.surfaceHeights[idx]!
        if (block !== BLOCK.air) {
            if (y >= current) this.surfaceHeights[idx] = y
            return
        }
        if (y === current) this.rescanHeight(x, z, idx, y - 1)
    }

    private rescanHeight(x: number, z: number, idx: number, startY: number): void {
        for (let y = startY; y >= 0; y--) {
            if (this.chunks.getVoxel(x, y, z) !== BLOCK.air) {
                this.surfaceHeights[idx] = y
                return
            }
        }
        this.surfaceHeights[idx] = -1
    }

    private inFrame(x: number, z: number): boolean {
        return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < this.size && z < this.size
    }

    private index(x: number, z: number): number {
        return x + z * this.size
    }
}

function order(span: Span): [number, number] {
    return span[0] <= span[1] ? [span[0], span[1]] : [span[1], span[0]]
}

function asFn(block: BlockOrFn): (x: number, z: number) => number {
    return typeof block === 'function' ? block : () => block
}

function asHeightFn(height: HeightOrFn): (x: number, z: number) => number {
    return typeof height === 'function' ? height : () => height
}
