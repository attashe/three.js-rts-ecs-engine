import { observe, onAdd, onRemove, query } from 'bitecs'
import type { Scene } from 'three'
import { Position, Renderable, Rotation } from '../components'
import type { System } from './system'
import { disposeObject3D } from '../../render/dispose-object'
import { RenderOrder } from './orders'

// Mirrors ECS Position/Rotation onto the side-table Object3D each render frame,
// and watches the Renderable tag to add/remove meshes from the scene.
export function createRenderSyncSystem(scene: Scene): System {
    let unsubscribeAdd: (() => void) | null = null
    let unsubscribeRemove: (() => void) | null = null
    let activeWorld: Parameters<NonNullable<System['init']>>[0] | null = null

    return {
        order: RenderOrder.renderSync,
        init(world) {
            activeWorld = world
            // Catch any Renderable entities that were spawned before start();
            // observe() only fires for additions/removals after subscription.
            const existing = query(world, [Renderable])
            for (let i = 0; i < existing.length; i++) {
                const obj = world.object3DByEid.get(existing[i])
                if (obj) scene.add(obj)
            }
            unsubscribeAdd = observe(world, onAdd(Renderable), (eid) => {
                const obj = world.object3DByEid.get(eid)
                if (obj) scene.add(obj)
            })
            unsubscribeRemove = observe(world, onRemove(Renderable), (eid) => {
                const obj = world.object3DByEid.get(eid)
                if (obj) scene.remove(obj)
            })
        },

        update(world) {
            const moved = query(world, [Renderable, Position])
            for (let i = 0; i < moved.length; i++) {
                const eid = moved[i]
                const obj = world.object3DByEid.get(eid)
                if (obj) {
                    obj.position.set(Position.x[eid], Position.y[eid], Position.z[eid])
                }
            }
            const rotated = query(world, [Renderable, Rotation])
            for (let i = 0; i < rotated.length; i++) {
                const eid = rotated[i]
                const obj = world.object3DByEid.get(eid)
                if (obj) {
                    obj.rotation.set(Rotation.x[eid], Rotation.y[eid], Rotation.z[eid])
                }
            }
        },

        dispose() {
            unsubscribeAdd?.()
            unsubscribeRemove?.()
            if (!activeWorld) return
            for (const obj of activeWorld.object3DByEid.values()) {
                scene.remove(obj)
                disposeObject3D(obj)
            }
            activeWorld.object3DByEid.clear()
            activeWorld = null
        },
    }
}
