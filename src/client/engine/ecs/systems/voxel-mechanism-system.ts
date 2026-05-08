import { hasComponent, query } from 'bitecs'
import type { ChunkManager, AABB } from '../../voxel'
import { AIR, aabbFromFoot, voxelAABBOverlap } from '../../voxel'
import { BoxCollider, Interactable, PlayerControlled, Position, Velocity, Wanderer } from '../components'
import type { DoorMechanism, GameWorld, PistonMechanism, VoxelCoord } from '../world'
import { pushGameLog } from '../world'
import type { Input } from '../../input/input'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface VoxelMechanismOptions {
    interactionRange?: number
    inputBufferMs?: number
}

export function createVoxelMechanismSystem(
    chunks: ChunkManager,
    input: Input,
    opts: VoxelMechanismOptions = {},
): System {
    const interactionRange = opts.interactionRange ?? 2.1
    const inputBufferMs = opts.inputBufferMs ?? 160

    return {
        fixed: true,
        order: FixedOrder.mechanisms,
        update(world, dt) {
            tickPistons(chunks, world, dt)
            handleDoorInput(chunks, input, world, interactionRange, inputBufferMs)
        },
    }
}

function tickPistons(chunks: ChunkManager, world: GameWorld, dt: number): void {
    for (const mechanism of world.voxelMechanisms) {
        if (mechanism.kind !== 'piston') continue
        mechanism.timer -= dt
        if (mechanism.timer > 0) continue

        const moved = tryMovePiston(chunks, world, mechanism)
        mechanism.timer = moved ? mechanism.interval : Math.min(0.25, mechanism.interval)
    }
}

function tryMovePiston(chunks: ChunkManager, world: GameWorld, mechanism: PistonMechanism): boolean {
    const source = mechanism.occupied === 'from' ? mechanism.from : mechanism.to
    const target = mechanism.occupied === 'from' ? mechanism.to : mechanism.from
    const direction = {
        x: Math.sign(target.x - source.x),
        y: Math.sign(target.y - source.y),
        z: Math.sign(target.z - source.z),
    }

    if (chunks.getVoxel(target.x, target.y, target.z) !== AIR) return false
    if (mechanism.characterPolicy === 'block' && voxelCellOverlapsCharacter(world, target)) return false
    if (mechanism.characterPolicy === 'push' && !tryPushCharactersFromCell(chunks, world, target, direction)) {
        return false
    }

    chunks.applyBulk([
        { ...source, value: AIR },
        { ...target, value: mechanism.block },
    ])
    mechanism.occupied = mechanism.occupied === 'from' ? 'to' : 'from'
    return true
}

function tryPushCharactersFromCell(
    chunks: ChunkManager,
    world: GameWorld,
    cell: VoxelCoord,
    direction: VoxelCoord,
): boolean {
    const occupants = overlappingCharacterEids(world, cell)
    if (occupants.length === 0) return true

    const nextPositions = new Map<number, { x: number; y: number; z: number }>()
    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    for (const eid of occupants) {
        const next = {
            x: Position.x[eid] + direction.x,
            y: Position.y[eid] + direction.y,
            z: Position.z[eid] + direction.z,
        }
        aabbFromFoot(next, { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }, tmp)
        if (voxelAABBOverlap(chunks, tmp)) return false
        nextPositions.set(eid, next)
    }

    for (const [eid, next] of nextPositions) {
        Position.x[eid] = next.x
        Position.y[eid] = next.y
        Position.z[eid] = next.z
        if (hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            Velocity.y[eid] = Math.max(0, Velocity.y[eid])
            Velocity.z[eid] = 0
        }
        world.pathByEid.delete(eid)
    }
    return true
}

function overlappingCharacterEids(world: GameWorld, pos: VoxelCoord): number[] {
    const eids = query(world, [Position, BoxCollider])
    const out: number[] = []
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (characterOverlapsVoxelCell(world, eid, pos)) out.push(eid)
    }
    return out
}

function handleDoorInput(
    chunks: ChunkManager,
    input: Input,
    world: GameWorld,
    range: number,
    inputBufferMs: number,
): void {
    if (!input.hasBufferedKeyPressed('KeyE', inputBufferMs)) return

    const players = query(world, [PlayerControlled, Position])
    if (players.length === 0) return
    const player = players[0]
    const door = findNearestDoor(world, player, range)
    if (!door) return

    const changed = door.open ? tryCloseDoor(chunks, world, door) : openDoor(chunks, door)
    input.consumeKeyPressed('KeyE')

    const message = changed
        ? door.open ? 'Door opened.' : 'Door closed.'
        : 'Door is blocked.'
    pushGameLog(world, { type: 'interaction', message })
}

function findNearestDoor(world: GameWorld, player: number, range: number): DoorMechanism | null {
    const eids = query(world, [Interactable, Position])
    let best: DoorMechanism | null = null
    let bestDistSq = range * range
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        const mechanism = world.mechanismByEid.get(eid)
        if (!mechanism || mechanism.kind !== 'door') continue

        const dx = Position.x[eid] - Position.x[player]
        const dy = Position.y[eid] - Position.y[player]
        const dz = Position.z[eid] - Position.z[player]
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq > bestDistSq) continue
        bestDistSq = distSq
        best = mechanism
    }
    return best
}

function openDoor(chunks: ChunkManager, door: DoorMechanism): boolean {
    const edits = door.blocks.map(({ pos }) => ({ ...pos, value: AIR }))
    chunks.applyBulk(edits)
    door.open = true
    return true
}

function tryCloseDoor(chunks: ChunkManager, world: GameWorld, door: DoorMechanism): boolean {
    for (const { pos } of door.blocks) {
        if (chunks.getVoxel(pos.x, pos.y, pos.z) !== AIR) return false
        if (voxelCellOverlapsCharacter(world, pos)) return false
    }
    chunks.applyBulk(door.blocks.map(({ pos, block }) => ({ ...pos, value: block })))
    door.open = false
    return true
}

function voxelCellOverlapsCharacter(world: GameWorld, pos: VoxelCoord): boolean {
    const eids = query(world, [Position, BoxCollider])
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (characterOverlapsVoxelCell(world, eid, pos)) return true
    }
    return false
}

function characterOverlapsVoxelCell(world: GameWorld, eid: number, pos: VoxelCoord): boolean {
    return hasCharacterBody(world, eid) &&
        Position.x[eid] + BoxCollider.x[eid] > pos.x &&
        Position.x[eid] - BoxCollider.x[eid] < pos.x + 1 &&
        Position.y[eid] < pos.y + 1 &&
        Position.y[eid] + BoxCollider.y[eid] * 2 > pos.y &&
        Position.z[eid] + BoxCollider.z[eid] > pos.z &&
        Position.z[eid] - BoxCollider.z[eid] < pos.z + 1
}

function hasCharacterBody(world: GameWorld, eid: number): boolean {
    return hasComponent(world, eid, PlayerControlled) ||
        hasComponent(world, eid, Wanderer) ||
        hasComponent(world, eid, Interactable)
}
