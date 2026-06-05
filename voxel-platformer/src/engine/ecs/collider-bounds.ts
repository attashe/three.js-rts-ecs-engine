import { hasComponent } from 'bitecs'
import { BoxCollider, Position, RigidBody } from './components'
import type { GameWorld } from './world'
import type { AABB, ColliderAnchor } from '../voxel/voxel-collide'

export function colliderAnchorForEntity(world: GameWorld, eid: number): ColliderAnchor {
    return hasComponent(world, eid, RigidBody) && RigidBody.centerAnchored[eid] === 1
        ? 'center'
        : 'foot'
}

export function colliderAabbForEntity(world: GameWorld, eid: number, out: AABB): AABB {
    return colliderAabbFromComponents(
        Position.x[eid],
        Position.y[eid],
        Position.z[eid],
        BoxCollider.x[eid],
        BoxCollider.y[eid],
        BoxCollider.z[eid],
        colliderAnchorForEntity(world, eid),
        out,
    )
}

export function colliderAabbFromComponents(
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    halfZ: number,
    anchor: ColliderAnchor,
    out: AABB,
): AABB {
    out.minX = x - halfX
    out.maxX = x + halfX
    out.minZ = z - halfZ
    out.maxZ = z + halfZ
    if (anchor === 'center') {
        out.minY = y - halfY
        out.maxY = y + halfY
    } else {
        out.minY = y
        out.maxY = y + halfY * 2
    }
    return out
}
