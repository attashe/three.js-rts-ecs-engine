import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { NpcConfig } from './npc-types'
import { createNpcModel } from './npc-models'
import { npcCollisionAabb } from './npc-types'
import type { AABB } from '../../engine/voxel/voxel-collide'
import { getDebugInfoEnabled, subscribeDebugInfo } from '../../engine/render/render-settings'

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
    const colliderMaterial = new LineBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
    })
    const colliderBatch = createColliderBatch(colliderMaterial)
    const rendered = new Map<string, RenderedNpc>()
    let debugInfoEnabled = getDebugInfoEnabled()
    let unsubscribeDebugInfo: (() => void) | null = null

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
        updateColliderBoxes(colliderBatch, npcs)
    }

    return {
        name: 'npcRender',
        order: RenderOrder.worldRender + 1,
        init() {
            scene.add(group)
            scene.add(colliderBatch.lines)
            colliderBatch.lines.visible = debugInfoEnabled
            unsubscribeDebugInfo = subscribeDebugInfo((enabled) => {
                debugInfoEnabled = enabled
                colliderBatch.lines.visible = enabled
            })
            sync()
        },
        update() {
            sync()
        },
        dispose() {
            for (const entry of rendered.values()) group.remove(entry.root)
            rendered.clear()
            scene.remove(group)
            scene.remove(colliderBatch.lines)
            colliderBatch.lines.geometry.dispose()
            colliderMaterial.dispose()
            unsubscribeDebugInfo?.()
            unsubscribeDebugInfo = null
        },
    }
}

function applyTransform(root: Group, npc: NpcConfig): void {
    root.position.set(npc.position.x, npc.position.y, npc.position.z)
    root.rotation.y = npc.yaw
    root.scale.setScalar(Math.max(0.001, npc.scale))
}

interface ColliderBatchState {
    lines: LineSegments
    capacity: number
}

function createColliderBatch(material: LineBasicMaterial): ColliderBatchState {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(geometry, material)
    lines.name = 'NPCColliderDebug'
    lines.frustumCulled = false
    lines.renderOrder = 10_000
    return { lines, capacity: 0 }
}

function updateColliderBoxes(batch: ColliderBatchState, npcs: readonly NpcConfig[]): void {
    const boxes = npcs.map(npcCollisionAabb).filter((box): box is AABB => box !== null)
    ensureColliderCapacity(batch, boxes.length)
    batch.lines.geometry.setDrawRange(0, boxes.length * 24)
    const attribute = batch.lines.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    if (!attribute) return
    const coords = attribute.array as Float32Array
    for (let i = 0; i < boxes.length; i++) {
        writeAabb(coords, i * 72, boxes[i]!)
    }
    attribute.needsUpdate = true
}

function ensureColliderCapacity(batch: ColliderBatchState, count: number): void {
    if (count <= batch.capacity) return
    let capacity = Math.max(4, batch.capacity)
    while (capacity < count) capacity *= 2
    batch.lines.geometry.dispose()
    batch.lines.geometry = new BufferGeometry()
    batch.lines.geometry.setAttribute('position', new Float32BufferAttribute(capacity * 72, 3))
    batch.capacity = capacity
}

function writeAabb(coords: Float32Array, offset: number, aabb: AABB): void {
    const minX = aabb.minX
    const minY = aabb.minY
    const minZ = aabb.minZ
    const maxX = aabb.maxX
    const maxY = aabb.maxY
    const maxZ = aabb.maxZ

    writeEdge(coords, offset + 0,  minX, minY, minZ,  maxX, minY, minZ)
    writeEdge(coords, offset + 6,  maxX, minY, minZ,  maxX, minY, maxZ)
    writeEdge(coords, offset + 12, maxX, minY, maxZ,  minX, minY, maxZ)
    writeEdge(coords, offset + 18, minX, minY, maxZ,  minX, minY, minZ)
    writeEdge(coords, offset + 24, minX, maxY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 30, maxX, maxY, minZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 36, maxX, maxY, maxZ,  minX, maxY, maxZ)
    writeEdge(coords, offset + 42, minX, maxY, maxZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 48, minX, minY, minZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 54, maxX, minY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 60, maxX, minY, maxZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 66, minX, minY, maxZ,  minX, maxY, maxZ)
}

function writeEdge(
    coords: Float32Array,
    offset: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
): void {
    coords[offset + 0] = ax; coords[offset + 1] = ay; coords[offset + 2] = az
    coords[offset + 3] = bx; coords[offset + 4] = by; coords[offset + 5] = bz
}
