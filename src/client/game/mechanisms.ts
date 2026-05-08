import { addComponents } from 'bitecs'
import { Interactable, InteractionRange, Position } from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import type { DoorBlock, DoorMechanism, GameWorld, PistonMechanism, VoxelCoord } from '../engine/ecs/world'

export interface DoorMechanismConfig {
    position: VoxelCoord
    blocks: DoorBlock[]
    open?: boolean
}

export interface PistonMechanismConfig {
    from: VoxelCoord
    to: VoxelCoord
    block: number
    interval?: number
    characterPolicy?: PistonMechanism['characterPolicy']
}

export function registerDoorMechanism(world: GameWorld, config: DoorMechanismConfig): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Interactable, InteractionRange])
    Position.x[eid] = config.position.x + 0.5
    Position.y[eid] = config.position.y
    Position.z[eid] = config.position.z + 0.5
    InteractionRange.value[eid] = 2.1

    const mechanism: DoorMechanism = {
        kind: 'door',
        blocks: config.blocks,
        open: config.open ?? false,
    }
    world.mechanismByEid.set(eid, mechanism)
    world.voxelMechanisms.push(mechanism)
    world.interactionByEid.set(eid, {
        label: 'Door',
        message: 'Press E to open or close it.',
    })
    return eid
}

export function registerPistonMechanism(world: GameWorld, config: PistonMechanismConfig): void {
    const mechanism: PistonMechanism = {
        kind: 'piston',
        from: config.from,
        to: config.to,
        block: config.block,
        occupied: 'from',
        interval: config.interval ?? 2,
        timer: config.interval ?? 2,
        characterPolicy: config.characterPolicy ?? 'block',
    }
    world.voxelMechanisms.push(mechanism)
}
