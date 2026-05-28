import { Group, type Scene } from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { NpcConfig } from './npc-types'
import { createNpcModel } from './npc-models'

export interface NpcRenderSystemOptions {
    getNpcs: () => readonly NpcConfig[]
}

interface RenderedNpc {
    root: Group
    model: NpcConfig['model']
}

export function createNpcRenderSystem(scene: Scene, opts: NpcRenderSystemOptions): System {
    const group = new Group()
    group.name = 'NPCs'
    const rendered = new Map<string, RenderedNpc>()

    function sync(): void {
        const npcs = opts.getNpcs()
        const live = new Set(npcs.map((npc) => npc.id))
        for (const [id, entry] of rendered) {
            if (live.has(id)) continue
            group.remove(entry.root)
            rendered.delete(id)
        }
        for (const npc of npcs) {
            const existing = rendered.get(npc.id)
            if (existing && existing.model !== npc.model) {
                group.remove(existing.root)
                rendered.delete(npc.id)
            }
            const liveEntry = rendered.get(npc.id)
            if (liveEntry) {
                applyTransform(liveEntry.root, npc)
                continue
            }
            const root = createNpcModel(npc.model)
            root.name = `NPC:${npc.id}`
            applyTransform(root, npc)
            group.add(root)
            rendered.set(npc.id, { root, model: npc.model })
        }
    }

    return {
        name: 'npcRender',
        order: RenderOrder.worldRender + 1,
        init() {
            scene.add(group)
            sync()
        },
        update() {
            sync()
        },
        dispose() {
            for (const entry of rendered.values()) group.remove(entry.root)
            rendered.clear()
            scene.remove(group)
        },
    }
}

function applyTransform(root: Group, npc: NpcConfig): void {
    root.position.set(npc.position.x, npc.position.y, npc.position.z)
    root.rotation.y = npc.yaw
    root.scale.setScalar(Math.max(0.001, npc.scale))
}
