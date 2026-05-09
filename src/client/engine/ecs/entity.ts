import { addEntity as bitecsAddEntity, removeEntity as bitecsRemoveEntity } from 'bitecs'
import { MAX_ENTITIES } from './components'
import type { GameWorld } from './world'
import { disposeObject3D } from '../render/dispose-object'
import { clearEntityHostility } from './factions'

export function createEntity(world: GameWorld): number {
    const eid = bitecsAddEntity(world)
    if (eid >= MAX_ENTITIES) {
        bitecsRemoveEntity(world, eid)
        throw new Error(`createEntity: entity id ${eid} exceeds MAX_ENTITIES (${MAX_ENTITIES})`)
    }
    return eid
}

export function despawnEntity(world: GameWorld, eid: number): void {
    const obj = world.object3DByEid.get(eid)
    if (obj) {
        obj.removeFromParent()
        disposeObject3D(obj)
        world.object3DByEid.delete(eid)
    }
    world.pathByEid.delete(eid)
    world.interactionByEid.delete(eid)
    world.pickupByEid.delete(eid)
    world.projectileOwnerByEid.delete(eid)
    clearEntityHostility(world, eid)
    bitecsRemoveEntity(world, eid)
}
