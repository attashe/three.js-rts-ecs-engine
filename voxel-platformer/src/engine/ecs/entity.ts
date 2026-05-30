import { addEntity as bitecsAddEntity, removeEntity as bitecsRemoveEntity } from 'bitecs'
import { MAX_ENTITIES, Position, Rotation, Velocity } from './components'
import type { GameWorld } from './world'
import { disposeObject3D } from '../render/dispose-object'

export function createEntity(world: GameWorld): number {
    const eid = bitecsAddEntity(world)
    if (eid >= MAX_ENTITIES) {
        bitecsRemoveEntity(world, eid)
        throw new Error(`createEntity: entity id ${eid} exceeds MAX_ENTITIES (${MAX_ENTITIES})`)
    }
    // bitecs recycles entity ids without clearing component data, so a reused id
    // carries the previous occupant's transform. Tumbling stones accumulate
    // Rotation.x/z (physics-system) and arrows carry pitch — left stale, a reused
    // id would spawn a player or rail cart tipped onto its side. Zero the shared
    // kinematic components up front; spawners set what they actually need.
    Position.x[eid] = 0; Position.y[eid] = 0; Position.z[eid] = 0
    Rotation.x[eid] = 0; Rotation.y[eid] = 0; Rotation.z[eid] = 0
    Velocity.x[eid] = 0; Velocity.y[eid] = 0; Velocity.z[eid] = 0
    return eid
}

export function despawnEntity(world: GameWorld, eid: number): void {
    const obj = world.object3DByEid.get(eid)
    if (obj) {
        obj.removeFromParent()
        disposeObject3D(obj)
        world.object3DByEid.delete(eid)
    }
    bitecsRemoveEntity(world, eid)
}
