import { hasComponent } from 'bitecs'
import { MovingObject, Position, Sleeping } from '../engine/ecs/components'
import { despawnEntity } from '../engine/ecs/entity'
import type { GameWorld } from '../engine/ecs/world'
import {
    MovingObjectKind,
    spawnFallingStone,
    stoneOptionsForConfig,
    type StonePlacementConfig,
} from './moving-objects'

let nextScriptStoneId = 1

export function spawnLevelStone(world: GameWorld, config: StonePlacementConfig): number | null {
    if (config.enabled === false) return null
    const eid = spawnFallingStone(
        world,
        config.position,
        config.velocity ?? { x: 0, y: 0, z: 0 },
        stoneOptionsForConfig(config),
    )
    if (config.id) world.stoneEntityByScriptId.set(config.id, eid)
    return eid
}

export function spawnScriptStone(world: GameWorld, config: StonePlacementConfig): string {
    const scriptId = config.id ?? `stone:${nextScriptStoneId++}`
    const existing = world.stoneEntityByScriptId.get(scriptId)
    if (existing !== undefined && isLiveStone(world, existing)) return scriptId
    if (existing !== undefined) world.stoneEntityByScriptId.delete(scriptId)

    const eid = spawnFallingStone(
        world,
        config.position,
        config.velocity ?? { x: 0, y: 0, z: 0 },
        stoneOptionsForConfig(config),
    )
    world.stoneEntityByScriptId.set(scriptId, eid)
    return scriptId
}

export function despawnScriptStone(world: GameWorld, scriptId: string): boolean {
    const eid = world.stoneEntityByScriptId.get(scriptId)
    if (eid === undefined) return false
    world.stoneEntityByScriptId.delete(scriptId)
    if (!isLiveStone(world, eid)) return false
    if (hasComponent(world, eid, Sleeping)) world.obstacles.remove(eid)
    despawnEntity(world, eid)
    return true
}

export function scriptStoneExists(world: GameWorld, scriptId: string): boolean {
    const eid = world.stoneEntityByScriptId.get(scriptId)
    return eid !== undefined && isLiveStone(world, eid)
}

function isLiveStone(world: GameWorld, eid: number): boolean {
    return hasComponent(world, eid, Position) &&
        hasComponent(world, eid, MovingObject) &&
        MovingObject.kind[eid] === MovingObjectKind.Stone
}
