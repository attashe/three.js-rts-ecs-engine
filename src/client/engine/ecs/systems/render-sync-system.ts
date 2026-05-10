import { hasComponent, observe, onAdd, onRemove, query } from 'bitecs'
import type { Scene } from 'three'
import { Position, Renderable, Rotation, StaticRenderable } from '../components'
import type { System } from './system'
import { disposeObject3D } from '../../render/dispose-object'
import { RenderOrder } from './orders'

// Mirrors ECS Position/Rotation onto the side-table Object3D each render frame,
// and watches the Renderable tag to add/remove meshes from the scene.
export function createRenderSyncSystem(scene: Scene): System {
    let unsubscribeAdd: (() => void) | null = null
    let unsubscribeRemove: (() => void) | null = null
    let activeWorld: Parameters<NonNullable<System['init']>>[0] | null = null
    const syncedStatic = new Set<number>()

    return {
        order: RenderOrder.renderSync,
        init(world) {
            activeWorld = world
            // Catch any Renderable entities that were spawned before start();
            // observe() only fires for additions/removals after subscription.
            const existing = query(world, [Renderable])
            for (let i = 0; i < existing.length; i++) {
                const eid = existing[i]
                const obj = world.object3DByEid.get(eid)
                if (obj) {
                    syncTransform(world, eid, obj)
                    if (hasComponent(world, eid, StaticRenderable)) syncedStatic.add(eid)
                    scene.add(obj)
                }
            }
            unsubscribeAdd = observe(world, onAdd(Renderable), (eid) => {
                const obj = world.object3DByEid.get(eid)
                if (obj) {
                    syncTransform(world, eid, obj)
                    if (hasComponent(world, eid, StaticRenderable)) syncedStatic.add(eid)
                    scene.add(obj)
                }
            })
            unsubscribeRemove = observe(world, onRemove(Renderable), (eid) => {
                syncedStatic.delete(eid)
                const obj = world.object3DByEid.get(eid)
                if (obj) scene.remove(obj)
            })
        },

        update(world) {
            const renderables = query(world, [Renderable])
            let dynamicCount = 0
            for (let i = 0; i < renderables.length; i++) {
                const eid = renderables[i]
                const isStatic = hasComponent(world, eid, StaticRenderable)
                if (isStatic && syncedStatic.has(eid)) continue
                const obj = world.object3DByEid.get(eid)
                if (!obj) continue
                syncTransform(world, eid, obj)
                if (isStatic) {
                    syncedStatic.add(eid)
                } else {
                    syncedStatic.delete(eid)
                    dynamicCount++
                }
            }
            world.metrics.setGauge('renderSync.objects', renderables.length)
            world.metrics.setGauge('renderSync.dynamic', dynamicCount)
            world.metrics.setGauge('renderSync.static', renderables.length - dynamicCount)
        },

        dispose() {
            unsubscribeAdd?.()
            unsubscribeRemove?.()
            syncedStatic.clear()
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

function syncTransform(
    world: Parameters<NonNullable<System['update']>>[0],
    eid: number,
    obj: Parameters<Scene['add']>[0],
): void {
    if (hasComponent(world, eid, Position)) {
        obj.position.set(Position.x[eid], Position.y[eid], Position.z[eid])
    }
    if (hasComponent(world, eid, Rotation)) {
        obj.rotation.set(Rotation.x[eid], Rotation.y[eid], Rotation.z[eid])
    }
}
