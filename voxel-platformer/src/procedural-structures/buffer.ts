import type { Rng } from './math'
import type { StructureBounds, StructureVoxel } from './types'

export class VoxelBuffer {
    private readonly map = new Map<string, StructureVoxel>()
    removed = 0

    set(x: number, y: number, z: number, block: number, tag = 'block'): void {
        const vx = Math.round(x)
        const vy = Math.round(y)
        const vz = Math.round(z)
        this.map.set(key(vx, vy, vz), { x: vx, y: vy, z: vz, block, tag })
    }

    has(x: number, y: number, z: number): boolean {
        return this.map.has(key(Math.round(x), Math.round(y), Math.round(z)))
    }

    del(x: number, y: number, z: number): void {
        if (this.map.delete(key(Math.round(x), Math.round(y), Math.round(z)))) this.removed++
    }

    fillBox(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: number, tag = 'box'): void {
        const xa = Math.min(Math.round(x1), Math.round(x2))
        const xb = Math.max(Math.round(x1), Math.round(x2))
        const ya = Math.min(Math.round(y1), Math.round(y2))
        const yb = Math.max(Math.round(y1), Math.round(y2))
        const za = Math.min(Math.round(z1), Math.round(z2))
        const zb = Math.max(Math.round(z1), Math.round(z2))
        for (let x = xa; x <= xb; x++) {
            for (let y = ya; y <= yb; y++) {
                for (let z = za; z <= zb; z++) this.set(x, y, z, block, tag)
            }
        }
    }

    hollowBox(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, wall: number, block: number, tag = 'shell'): void {
        const xa = Math.min(Math.round(x1), Math.round(x2))
        const xb = Math.max(Math.round(x1), Math.round(x2))
        const ya = Math.min(Math.round(y1), Math.round(y2))
        const yb = Math.max(Math.round(y1), Math.round(y2))
        const za = Math.min(Math.round(z1), Math.round(z2))
        const zb = Math.max(Math.round(z1), Math.round(z2))
        const w = Math.max(1, Math.round(wall))
        for (let x = xa; x <= xb; x++) {
            for (let y = ya; y <= yb; y++) {
                for (let z = za; z <= zb; z++) {
                    const onWall = x - xa < w || xb - x < w || z - za < w || zb - z < w
                    if (onWall) this.set(x, y, z, block, tag)
                }
            }
        }
    }

    line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: number, radius = 0, tag = 'line'): void {
        for (const [x, y, z] of bresenham3D(Math.round(x1), Math.round(y1), Math.round(z1), Math.round(x2), Math.round(y2), Math.round(z2))) {
            if (radius <= 0) this.set(x, y, z, block, tag)
            else this.fillSphere(x, y, z, radius, radius, radius, block, tag, 1)
        }
    }

    fillSphere(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, block: number, tag = 'sphere', density = 1, rng?: Rng): void {
        const rxi = Math.max(1, Math.round(rx))
        const ryi = Math.max(1, Math.round(ry))
        const rzi = Math.max(1, Math.round(rz))
        for (let x = -rxi; x <= rxi; x++) {
            for (let y = -ryi; y <= ryi; y++) {
                for (let z = -rzi; z <= rzi; z++) {
                    const d = (x * x) / (rxi * rxi) + (y * y) / (ryi * ryi) + (z * z) / (rzi * rzi)
                    if (d <= 1 && (density >= 1 || !rng || rng() < density || d < 0.55)) {
                        this.set(cx + x, cy + y, cz + z, block, tag)
                    }
                }
            }
        }
    }

    fillCylinder(cx: number, y1: number, cz: number, r: number, y2: number, block: number, tag = 'cylinder'): void {
        const radius = Math.max(1, Math.round(r))
        const ya = Math.min(Math.round(y1), Math.round(y2))
        const yb = Math.max(Math.round(y1), Math.round(y2))
        for (let y = ya; y <= yb; y++) {
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    if (x * x + z * z <= radius * radius) this.set(cx + x, y, cz + z, block, tag)
                }
            }
        }
    }

    shellCylinder(cx: number, y1: number, cz: number, outer: number, inner: number, y2: number, block: number, tag = 'shellCylinder'): void {
        const ro = Math.max(1, Math.round(outer))
        const ri = Math.max(0, Math.round(inner))
        const ya = Math.min(Math.round(y1), Math.round(y2))
        const yb = Math.max(Math.round(y1), Math.round(y2))
        for (let y = ya; y <= yb; y++) {
            for (let x = -ro; x <= ro; x++) {
                for (let z = -ro; z <= ro; z++) {
                    const d = x * x + z * z
                    if (d <= ro * ro && d >= ri * ri) this.set(cx + x, y, cz + z, block, tag)
                }
            }
        }
    }

    toArray(): StructureVoxel[] {
        return [...this.values()]
    }

    values(): IterableIterator<StructureVoxel> {
        return this.map.values()
    }
}

export function boundsOf(voxels: StructureVoxel[]): StructureBounds {
    if (voxels.length === 0) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, width: 0, height: 0, depth: 0 }
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const v of voxels) {
        minX = Math.min(minX, v.x)
        minY = Math.min(minY, v.y)
        minZ = Math.min(minZ, v.z)
        maxX = Math.max(maxX, v.x)
        maxY = Math.max(maxY, v.y)
        maxZ = Math.max(maxZ, v.z)
    }
    return {
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        depth: maxZ - minZ + 1,
    }
}

export function key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

export function neighbors6(x: number, y: number, z: number): Array<[number, number, number]> {
    return [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]]
}

export function bresenham3D(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Array<[number, number, number]> {
    const points: Array<[number, number, number]> = []
    let x = x1
    let y = y1
    let z = z1
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const dz = Math.abs(z2 - z1)
    const xs = x2 > x1 ? 1 : -1
    const ys = y2 > y1 ? 1 : -1
    const zs = z2 > z1 ? 1 : -1
    if (dx >= dy && dx >= dz) {
        let p1 = 2 * dy - dx
        let p2 = 2 * dz - dx
        while (x !== x2) {
            points.push([x, y, z])
            x += xs
            if (p1 >= 0) { y += ys; p1 -= 2 * dx }
            if (p2 >= 0) { z += zs; p2 -= 2 * dx }
            p1 += 2 * dy
            p2 += 2 * dz
        }
    } else if (dy >= dx && dy >= dz) {
        let p1 = 2 * dx - dy
        let p2 = 2 * dz - dy
        while (y !== y2) {
            points.push([x, y, z])
            y += ys
            if (p1 >= 0) { x += xs; p1 -= 2 * dy }
            if (p2 >= 0) { z += zs; p2 -= 2 * dy }
            p1 += 2 * dx
            p2 += 2 * dz
        }
    } else {
        let p1 = 2 * dy - dz
        let p2 = 2 * dx - dz
        while (z !== z2) {
            points.push([x, y, z])
            z += zs
            if (p1 >= 0) { y += ys; p1 -= 2 * dz }
            if (p2 >= 0) { x += xs; p2 -= 2 * dz }
            p1 += 2 * dy
            p2 += 2 * dx
        }
    }
    points.push([x2, y2, z2])
    return points
}
