import type { ChunkManager } from './chunk-manager'
import { isCollidable, isPathSurface } from './palette'

export interface PathOptions {
    /** Max search nodes before giving up. Default 4096. */
    maxNodes?: number
    /** Max vertical step up (in voxels). Default 1. */
    maxStepUp?: number
    /** Max vertical drop (in voxels). Default 2. */
    maxDrop?: number
    /** Vertical search range when computing surface height around a column. Default 64. */
    surfaceSearchRange?: number
    /** Optional runtime blocker for dynamic bodies such as characters. */
    isBlocked?: (x: number, y: number, z: number) => boolean
}

/**
 * Surface-grid A*. Each search node is a (x, z) column with `y` = standing
 * height (one above the topmost solid voxel). Movement is 4-connected on the
 * XZ plane; vertical motion is handled implicitly by the column resolver,
 * subject to `maxStepUp` / `maxDrop` tolerances.
 *
 * Returns `null` if no path exists within `maxNodes`. Returns the start cell
 * alone if start === goal.
 *
 * Coordinate convention: paths are arrays of voxel-coord centres. To get
 * world-space waypoints add `(0.5, 0, 0.5)` so the player walks the centre
 * of each cell.
 */
export interface PathPoint {
    x: number
    y: number
    z: number
}

export function findPath(
    manager: ChunkManager,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
    opts: PathOptions = {},
): PathPoint[] | null {
    const maxNodes = opts.maxNodes ?? 4096
    const maxStepUp = opts.maxStepUp ?? 1
    const maxDrop = opts.maxDrop ?? 2
    const searchRange = opts.surfaceSearchRange ?? 64

    const canStandAt = (x: number, y: number, z: number): boolean => {
        return (
            isPathSurface(manager.palette, manager.getVoxel(x, y - 1, z)) &&
            !isCollidable(manager.palette, manager.getVoxel(x, y, z)) &&
            !isCollidable(manager.palette, manager.getVoxel(x, y + 1, z))
        )
    }

    // Standing height = support block y + 1. Search outwards from `fromY`,
    // bounded by the movement tolerance, so stacked floors prefer the surface
    // that is actually reachable from the current layer.
    const surfaceY = (x: number, z: number, fromY: number, up: number, down: number): number | null => {
        const maxOffset = Math.max(up, down)
        for (let offset = 0; offset <= maxOffset; offset++) {
            const above = fromY + offset
            if (offset <= up && canStandAt(x, above, z)) return above
            const below = fromY - offset
            if (offset > 0 && offset <= down && canStandAt(x, below, z)) return below
        }
        return null
    }

    const resolveEndpointY = (x: number, z: number, fromY: number): number | null => {
        for (let offset = 0; offset <= searchRange; offset++) {
            const above = fromY + offset
            if (canStandAt(x, above, z)) return above
            const below = fromY - offset
            if (offset > 0 && canStandAt(x, below, z)) return below
        }
        return null
    }

    const startStand = resolveEndpointY(start.x, start.z, start.y) ?? start.y
    const goalStand = resolveEndpointY(goal.x, goal.z, goal.y) ?? goal.y

    if (start.x === goal.x && start.z === goal.z && startStand === goalStand) {
        return [{ x: start.x, y: startStand, z: start.z }]
    }

    // A* with a hash-keyed open set + g-score map.
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`
    const heuristic = (x: number, z: number) => Math.abs(x - goal.x) + Math.abs(z - goal.z)

    interface Node {
        x: number
        z: number
        y: number
        g: number
        f: number
        order: number
        parent: Node | null
    }

    const open = new BinaryMinHeap<Node>((a, b) => a.f === b.f ? a.order - b.order : a.f - b.f)
    const gScore = new Map<string, number>()
    let pushOrder = 0
    const startNode: Node = {
        x: start.x, z: start.z, y: startStand,
        g: 0, f: heuristic(start.x, start.z), order: pushOrder++, parent: null,
    }
    open.push(startNode)
    gScore.set(key(start.x, startStand, start.z), 0)

    let visited = 0
    const NEIGHBORS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

    while (open.length > 0) {
        if (visited++ > maxNodes) return null

        const cur = open.pop()!
        if (gScore.get(key(cur.x, cur.y, cur.z)) !== cur.g) continue

        if (cur.x === goal.x && cur.z === goal.z && cur.y === goalStand) {
            // Reconstruct path.
            const path: PathPoint[] = []
            for (let n: Node | null = cur; n; n = n.parent) {
                path.push({ x: n.x, y: n.y, z: n.z })
            }
            path.reverse()
            return path
        }

        for (const [dx, dz] of NEIGHBORS) {
            const nx = cur.x + dx
            const nz = cur.z + dz
            const ny = surfaceY(nx, nz, cur.y, maxStepUp, maxDrop)
            if (ny === null) continue
            if (opts.isBlocked?.(nx, ny, nz)) continue

            const tentative = cur.g + 1
            const nKey = key(nx, ny, nz)
            const prev = gScore.get(nKey)
            if (prev !== undefined && prev <= tentative) continue
            gScore.set(nKey, tentative)

            open.push({
                x: nx, z: nz, y: ny,
                g: tentative,
                f: tentative + heuristic(nx, nz),
                order: pushOrder++,
                parent: cur,
            })
        }
    }
    return null
}

class BinaryMinHeap<T> {
    private readonly items: T[] = []

    constructor(private readonly compare: (a: T, b: T) => number) {}

    get length(): number {
        return this.items.length
    }

    push(item: T): void {
        this.items.push(item)
        this.bubbleUp(this.items.length - 1)
    }

    pop(): T | undefined {
        if (this.items.length === 0) return undefined
        const first = this.items[0]!
        const last = this.items.pop()!
        if (this.items.length > 0) {
            this.items[0] = last
            this.sinkDown(0)
        }
        return first
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parent = (index - 1) >> 1
            if (this.compare(this.items[index]!, this.items[parent]!) >= 0) return
            this.swap(index, parent)
            index = parent
        }
    }

    private sinkDown(index: number): void {
        for (;;) {
            const left = index * 2 + 1
            const right = left + 1
            let best = index
            if (left < this.items.length && this.compare(this.items[left]!, this.items[best]!) < 0) best = left
            if (right < this.items.length && this.compare(this.items[right]!, this.items[best]!) < 0) best = right
            if (best === index) return
            this.swap(index, best)
            index = best
        }
    }

    private swap(a: number, b: number): void {
        const tmp = this.items[a]!
        this.items[a] = this.items[b]!
        this.items[b] = tmp
    }
}
