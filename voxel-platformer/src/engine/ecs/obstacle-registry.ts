import type { AABB } from '../voxel/voxel-collide'

const EPS = 1e-6

/**
 * Spatial registry of "settled" dynamic-body AABBs. The voxel-collide
 * `aabbBlocked` helper consults this in addition to the voxel grid, so a
 * sleeping rigid body acts as a solid wall to characters and other moving
 * bodies without needing to be baked into the voxel chunks.
 *
 * Keyed by integer voxel cell. An AABB that spans multiple cells is filed
 * under each cell it touches; lookup iterates the spanned cells of the query
 * AABB and dedupes by entity id.
 */
export class ObstacleRegistry {
    private readonly entries = new Map<number, AABB>()
    private readonly cells = new Map<string, number[]>()
    /** Reused set for query traversal. Cleared at the start of each `intersects`. */
    private readonly seen = new Set<number>()

    add(eid: number, aabb: AABB): void {
        this.removeIfPresent(eid)
        const stored: AABB = { ...aabb }
        this.entries.set(eid, stored)
        this.forEachCell(stored, (key) => {
            let bucket = this.cells.get(key)
            if (!bucket) {
                bucket = []
                this.cells.set(key, bucket)
            }
            bucket.push(eid)
        })
    }

    remove(eid: number): void {
        this.removeIfPresent(eid)
    }

    has(eid: number): boolean {
        return this.entries.has(eid)
    }

    get(eid: number): AABB | undefined {
        return this.entries.get(eid)
    }

    /** True if any registered AABB (other than `excludeEid`) overlaps `query`. */
    intersects(query: AABB, excludeEid?: number): boolean {
        let hit = false
        this.seen.clear()
        const x0 = Math.floor(query.minX)
        const y0 = Math.floor(query.minY)
        const z0 = Math.floor(query.minZ)
        const x1 = Math.floor(query.maxX - EPS)
        const y1 = Math.floor(query.maxY - EPS)
        const z1 = Math.floor(query.maxZ - EPS)

        for (let y = y0; y <= y1 && !hit; y++) {
            for (let z = z0; z <= z1 && !hit; z++) {
                for (let x = x0; x <= x1 && !hit; x++) {
                    const bucket = this.cells.get(cellKey(x, y, z))
                    if (!bucket) continue
                    for (let i = 0; i < bucket.length; i++) {
                        const eid = bucket[i]
                        if (eid === excludeEid) continue
                        if (this.seen.has(eid)) continue
                        this.seen.add(eid)
                        const a = this.entries.get(eid)
                        if (!a) continue
                        if (aabbOverlap(query, a)) {
                            hit = true
                            break
                        }
                    }
                }
            }
        }
        return hit
    }

    /** Number of registered obstacles (test/debug aid). */
    size(): number {
        return this.entries.size
    }

    private removeIfPresent(eid: number): void {
        const existing = this.entries.get(eid)
        if (!existing) return
        this.forEachCell(existing, (key) => {
            const bucket = this.cells.get(key)
            if (!bucket) return
            const idx = bucket.indexOf(eid)
            if (idx >= 0) bucket.splice(idx, 1)
            if (bucket.length === 0) this.cells.delete(key)
        })
        this.entries.delete(eid)
    }

    private forEachCell(aabb: AABB, fn: (key: string) => void): void {
        const x0 = Math.floor(aabb.minX)
        const y0 = Math.floor(aabb.minY)
        const z0 = Math.floor(aabb.minZ)
        const x1 = Math.floor(aabb.maxX - EPS)
        const y1 = Math.floor(aabb.maxY - EPS)
        const z1 = Math.floor(aabb.maxZ - EPS)
        for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
                for (let x = x0; x <= x1; x++) {
                    fn(cellKey(x, y, z))
                }
            }
        }
    }
}

function cellKey(x: number, y: number, z: number): string {
    return `${x}|${y}|${z}`
}

function aabbOverlap(a: AABB, b: AABB): boolean {
    return a.maxX > b.minX && a.minX < b.maxX &&
        a.maxY > b.minY && a.minY < b.maxY &&
        a.maxZ > b.minZ && a.minZ < b.maxZ
}
