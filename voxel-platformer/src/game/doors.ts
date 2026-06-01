import { query } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../engine/ecs/components'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { AIR, BLOCK } from '../engine/voxel/palette'
import type { DoorRuntime, GameWorld, VoxelCoord } from '../engine/ecs/world'
import type { InteractionProviderTarget } from './interaction-system'

const DOOR_BLOCK = BLOCK.door
const DOOR_INTERACT_RADIUS = 2.6
// Door clusters bigger than this are treated as walls/decoration, not doors,
// so a solid bank of door-coloured blocks can't be toggled away wholesale.
const MAX_DOOR_CELLS = 24

/**
 * Scan the voxel world for connected clusters of door blocks and register each
 * as an openable {@link DoorRuntime}. This is how base-game-style doors — placed
 * as `BLOCK.door` voxels by the house/church/stable generators and by
 * hand-authored levels — become interactive in procedural structures without
 * threading door metadata through the whole generation pipeline.
 *
 * Call once per location after the chunks are in place; it replaces
 * `world.doors`.
 */
export function scanDoors(world: GameWorld, chunks: ChunkManager): void {
    const doorCells = collectDoorCells(chunks)
    const visited = new Set<string>()
    const doors: DoorRuntime[] = []
    let index = 0
    for (const key of doorCells) {
        if (visited.has(key)) continue
        const cluster = floodFill(key, doorCells, visited)
        if (cluster.length === 0 || cluster.length > MAX_DOOR_CELLS) continue
        // Real doorways stand upright; a single-layer slab of door blocks is a
        // floor pad / decoration, not something you walk through.
        if (verticalExtent(cluster) < 1) continue
        doors.push(makeDoor(`door-${index++}`, cluster))
    }
    world.doors = doors
}

/** Nearest openable door within reach — wired into the interaction system's
 *  provider list so pressing E toggles it open/closed. */
export function nearestDoorInteractionTarget(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
    chunks: ChunkManager,
): InteractionProviderTarget | null {
    let best: DoorRuntime | null = null
    let bestDistSq = Infinity
    for (const door of world.doors) {
        const dx = player.x - (door.center.x + 0.5)
        const dy = player.y - (door.center.y + 0.5)
        const dz = player.z - (door.center.z + 0.5)
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > door.radius * door.radius) continue
        if (d2 >= bestDistSq) continue
        bestDistSq = d2
        best = door
    }
    if (!best) return null
    const door = best
    return {
        id: door.id,
        prompt: door.open ? 'Close door' : 'Open door',
        anchor: { x: door.anchor.x + 0.5, y: door.anchor.y, z: door.anchor.z + 0.5 },
        distanceSq: bestDistSq,
        interact() {
            toggleDoor(world, chunks, door)
        },
    }
}

function toggleDoor(world: GameWorld, chunks: ChunkManager, door: DoorRuntime): void {
    const opening = !door.open
    // Don't slam a door shut on whoever's standing in it.
    if (!opening && doorwayOccupied(world, door)) return
    const value = opening ? AIR : door.blockId
    chunks.applyBulk(door.cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, value })))
    door.open = opening
}

function doorwayOccupied(world: GameWorld, door: DoorRuntime): boolean {
    const eids = query(world, [PlayerControlled, Position, BoxCollider])
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        const px = Position.x[eid]!
        const py = Position.y[eid]!
        const pz = Position.z[eid]!
        const rx = BoxCollider.x[eid]!
        const rz = BoxCollider.z[eid]!
        const h = BoxCollider.y[eid]! * 2
        for (const cell of door.cells) {
            if (
                px + rx > cell.x && px - rx < cell.x + 1 &&
                py < cell.y + 1 && py + h > cell.y &&
                pz + rz > cell.z && pz - rz < cell.z + 1
            ) return true
        }
    }
    return false
}

function makeDoor(id: string, cells: VoxelCoord[]): DoorRuntime {
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const c of cells) {
        if (c.x < minX) minX = c.x
        if (c.y < minY) minY = c.y
        if (c.z < minZ) minZ = c.z
        if (c.x > maxX) maxX = c.x
        if (c.y > maxY) maxY = c.y
        if (c.z > maxZ) maxZ = c.z
    }
    const cx = Math.floor((minX + maxX) / 2)
    const cz = Math.floor((minZ + maxZ) / 2)
    return {
        id,
        cells,
        blockId: DOOR_BLOCK,
        open: false,
        center: { x: cx, y: Math.floor((minY + maxY) / 2), z: cz },
        anchor: { x: cx, y: maxY + 1, z: cz },
        radius: DOOR_INTERACT_RADIUS,
    }
}

function collectDoorCells(chunks: ChunkManager): Set<string> {
    const cells = new Set<string>()
    for (const chunk of chunks.allChunks()) {
        for (let z = 0; z < 32; z++) {
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 32; x++) {
                    if (chunk.getLocal(x, y, z) !== DOOR_BLOCK) continue
                    cells.add(cellKey(chunk.cx * 32 + x, chunk.cy * 32 + y, chunk.cz * 32 + z))
                }
            }
        }
    }
    return cells
}

function floodFill(start: string, cells: Set<string>, visited: Set<string>): VoxelCoord[] {
    const out: VoxelCoord[] = []
    const stack = [start]
    visited.add(start)
    while (stack.length > 0) {
        const key = stack.pop()!
        const { x, y, z } = parseKey(key)
        out.push({ x, y, z })
        if (out.length > MAX_DOOR_CELLS) break
        const neighbours = [
            cellKey(x + 1, y, z), cellKey(x - 1, y, z),
            cellKey(x, y + 1, z), cellKey(x, y - 1, z),
            cellKey(x, y, z + 1), cellKey(x, y, z - 1),
        ]
        for (const n of neighbours) {
            if (cells.has(n) && !visited.has(n)) {
                visited.add(n)
                stack.push(n)
            }
        }
    }
    return out
}

function verticalExtent(cells: readonly VoxelCoord[]): number {
    let minY = Infinity
    let maxY = -Infinity
    for (const c of cells) {
        if (c.y < minY) minY = c.y
        if (c.y > maxY) maxY = c.y
    }
    return maxY - minY
}

function cellKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

function parseKey(key: string): VoxelCoord {
    const parts = key.split(',')
    return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
}
