import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Object3D,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { GameWorld } from '../../engine/ecs/world'
import { createNpcModel } from './npc-models'
import { npcCollisionAabb, npcEquipmentKey, type NpcConfig } from './npc-types'
import { disposeNpc } from './npc-runtime'
import type { AABB } from '../../engine/voxel/voxel-collide'
import { getDebugInfoEnabled, subscribeDebugInfo } from '../../engine/render/render-settings'
import { AnimationController, attachToSocket, partRigSource } from '../../engine/anim'
import { createEquipment, equipmentSocketFrame } from '../anim/equipment'
import { computeLocomotionParams } from '../../engine/anim/core'
import { combatLocomotionGraph } from '../anim/graph-defaults'
import { partCharacterClips } from '../anim/part-clips'
import { disposeObject3D } from '../../engine/render/dispose-object'

export interface NpcRenderSystemOptions {
    getNpcs: () => readonly NpcConfig[]
}

interface RenderedNpc {
    root: Object3D
    visualKey: string
    equipmentKey: string
    controller: AnimationController
}

// NPCs are static, so they animate from a fixed idle signal; attack/die are
// driven by the runtime request flags instead of movement.
const IDLE_SIGNAL = { speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 } as const
// Linger on the ground after settling into `dead` before despawning.
const DESPAWN_AFTER_DEAD_SECONDS = 1.2

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
    // Ids that died + despawned this level; skipped by sync so the still-present
    // config (meta.npcs) doesn't resurrect them.
    const despawned = new Set<string>()
    let debugInfoEnabled = getDebugInfoEnabled()
    let unsubscribeDebugInfo: (() => void) | null = null

    function buildNpc(npc: NpcConfig): RenderedNpc {
        const clipSet = partRigSource(() => createNpcModel(npc.model, { beard: npc.beard }), partCharacterClips()).instantiate()
        const controller = new AnimationController(clipSet, combatLocomotionGraph())
        const root = clipSet.root
        root.name = `NPC:${npc.id}`
        // Hold the model's items in its hands (per-hand loadout). Each socket is
        // inside its arm pivot, so the item animates with that arm.
        attachNpcEquipment(controller, root, npc)
        applyTransform(root, npc)
        group.add(root)
        return { root, visualKey: npcVisualKey(npc), equipmentKey: npcEquipmentKey(npc), controller }
    }

    function removeNpc(id: string, entry: RenderedNpc): void {
        group.remove(entry.root)
        entry.controller.dispose()
        disposeObject3D(entry.root)
        rendered.delete(id)
    }

    function sync(): void {
        const npcs = opts.getNpcs()
        const live = new Set(npcs.map((npc) => npc.id))
        // A config removed from the level clears its despawn marker, so re-adding
        // the same id later rebuilds it.
        for (const id of despawned) if (!live.has(id)) despawned.delete(id)
        for (const [id, entry] of rendered) {
            if (live.has(id)) continue
            removeNpc(id, entry)
        }
        for (const npc of npcs) {
            if (despawned.has(npc.id)) continue
            const existing = rendered.get(npc.id)
            if (existing && (
                existing.visualKey !== npcVisualKey(npc) ||
                existing.equipmentKey !== npcEquipmentKey(npc)
            )) removeNpc(npc.id, existing)
            const liveEntry = rendered.get(npc.id)
            if (liveEntry) {
                applyTransform(liveEntry.root, npc)
                continue
            }
            rendered.set(npc.id, buildNpc(npc))
        }
        updateColliderBoxes(colliderBatch, npcs.filter((npc) => !despawned.has(npc.id)))
    }

    function animate(world: GameWorld, dt: number): void {
        for (const [id, entry] of rendered) {
            const controller = entry.controller
            controller.setParams(computeLocomotionParams(IDLE_SIGNAL))
            const runtime = world.npcRuntimeById.get(id)
            if (runtime?.requestAttack) {
                controller.machine.setParam('attack', 1)
                runtime.requestAttack = false
            }
            if (runtime?.requestDie) {
                controller.machine.setParam('dead', 1)
                runtime.requestDie = false
            }
            controller.update(dt)
            // Despawn once the body has lain dead for a beat.
            if (controller.machine.currentStateId === 'dead'
                && controller.machine.timeInCurrentState >= DESPAWN_AFTER_DEAD_SECONDS) {
                removeNpc(id, entry)
                despawned.add(id)
                disposeNpc(world, id)
            }
        }
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
        update(world, dt) {
            sync()
            animate(world, dt)
        },
        dispose() {
            for (const [id, entry] of rendered) removeNpc(id, entry)
            despawned.clear()
            scene.remove(group)
            scene.remove(colliderBatch.lines)
            colliderBatch.lines.geometry.dispose()
            colliderMaterial.dispose()
            unsubscribeDebugInfo?.()
            unsubscribeDebugInfo = null
        },
    }
}

function npcVisualKey(npc: Pick<NpcConfig, 'model' | 'beard'>): string {
    return `${npc.model}:${npc.beard}`
}

function attachNpcEquipment(controller: AnimationController, root: Object3D, npc: NpcConfig): void {
    for (const slot of ['handR', 'handL'] as const) {
        const kind = npc.equipment[slot]
        if (!kind) continue
        const frame = equipmentSocketFrame(kind, slot)
        attachToSocket(controller.sockets, slot, createEquipment(kind), {
            root,
            orient: frame.orient,
            offset: frame.offset,
        })
    }
}

function applyTransform(root: Object3D, npc: NpcConfig): void {
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
