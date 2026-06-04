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
import { createNpcModel, npcModelUsesDefaultRig } from './npc-models'
import { createCritterAnimator, type NpcAnimator } from './npc-critter-animator'
import { npcAttackClip, npcCollisionAabb, npcEquipmentKey, type NpcAttackClip, type NpcConfig } from './npc-types'
import { disposeNpc, markNpcDefeated } from './npc-runtime'
import type { AABB } from '../../engine/voxel/voxel-collide'
import { getDebugInfoEnabled, subscribeDebugInfo } from '../../engine/render/render-settings'
import { AnimationController, attachToSocket, partRigSource } from '../../engine/anim'
import { createEquipment, equipmentSocketFrame } from '../anim/equipment'
import { computeLocomotionParams } from '../../engine/anim/core'
import { COMBAT_PARAM, combatLocomotionGraph } from '../anim/graph-defaults'
import { partCharacterClips } from '../anim/part-clips'
import { disposeObject3D } from '../../engine/render/dispose-object'

export interface NpcRenderSystemOptions {
    getNpcs: () => readonly NpcConfig[]
    /** Fired when an NPC takes a non-lethal hit, at its world position, so
     *  the caller can play a spatial hurt cue. */
    onHurt?: (position: { x: number; y: number; z: number }) => void
    /** Fired when an NPC launches an attack (the same frame the swing/draw
     *  animation starts), with the attack clip and the NPC's world position —
     *  e.g. to play the bow-release cue for the archer's `shoot`. */
    onAttack?: (clip: NpcAttackClip, position: { x: number; y: number; z: number }) => void
}

interface RenderedNpc {
    root: Object3D
    visualKey: string
    equipmentKey: string
    /** Rig-agnostic pose driver: a humanoid `AnimationController` wrapper or a
     *  bespoke critter animator (see `npcModelUsesDefaultRig`). */
    animator: NpcAnimator
    /** Last frame's XZ position + a smoothed speed, so a moving NPC plays the
     *  walk/run/hop cycle instead of gliding in an idle pose. */
    prevX: number
    prevZ: number
    speed: number
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
        depthWrite: false,
    })
    const colliderBatch = createColliderBatch(colliderMaterial)
    const rendered = new Map<string, RenderedNpc>()
    // Ids that died + despawned this level; skipped by sync so the still-present
    // config (meta.npcs) doesn't resurrect them.
    const despawned = new Set<string>()
    let debugInfoEnabled = getDebugInfoEnabled()
    let unsubscribeDebugInfo: (() => void) | null = null

    function buildNpc(npc: NpcConfig): RenderedNpc {
        const animator = npcModelUsesDefaultRig(npc.model)
            ? buildRiggedAnimator(npc)
            : createCritterAnimator(createNpcModel(npc.model, { beard: npc.beard, variant: npc.variant }))
        const root = animator.root
        root.name = `NPC:${npc.id}`
        applyTransform(root, npc.position, npc.yaw, npc.scale)
        group.add(root)
        return {
            root,
            visualKey: npcVisualKey(npc),
            equipmentKey: npcEquipmentKey(npc),
            animator,
            prevX: npc.position.x,
            prevZ: npc.position.z,
            speed: 0,
        }
    }

    /** Humanoid path: the shared rig + clip set + combat graph, wrapped behind
     *  the rig-agnostic NpcAnimator the render loop drives. */
    function buildRiggedAnimator(npc: NpcConfig): NpcAnimator {
        const clipSet = partRigSource(() => createNpcModel(npc.model, { beard: npc.beard, variant: npc.variant }), partCharacterClips()).instantiate()
        const controller = new AnimationController(clipSet, combatLocomotionGraph())
        // Hold the model's items in its hands (per-hand loadout). Each socket is
        // inside its arm pivot, so the item animates with that arm.
        attachNpcEquipment(controller, clipSet.root, npc)
        return {
            root: clipSet.root,
            setLocomotion(s) { controller.setParams(computeLocomotionParams({ ...IDLE_SIGNAL, speedXZ: s })) },
            triggerAttack(clip) { controller.machine.setParam(clip, 1) },
            triggerDie() { controller.machine.setParam('dead', 1) },
            setShieldGuard(raised) { controller.machine.setParam(COMBAT_PARAM.shieldBlock, raised ? 1 : 0) },
            update(dt) { controller.update(dt) },
            deadSettled() {
                return controller.machine.currentStateId === 'dead'
                    && controller.machine.timeInCurrentState >= DESPAWN_AFTER_DEAD_SECONDS
            },
            dispose() { controller.dispose() },
        }
    }

    function removeNpc(id: string, entry: RenderedNpc): void {
        group.remove(entry.root)
        entry.animator.dispose()
        disposeObject3D(entry.root)
        rendered.delete(id)
    }

    function sync(world?: GameWorld): void {
        const npcs = opts.getNpcs()
        const live = new Set(npcs.map((npc) => npc.id))
        // A config removed from the level clears its despawn marker, so re-adding
        // the same id later rebuilds it.
        for (const id of despawned) if (!live.has(id)) despawned.delete(id)
        for (const [id, entry] of rendered) {
            if (live.has(id) && !world?.defeatedNpcIds.has(id)) continue
            removeNpc(id, entry)
        }
        for (const npc of npcs) {
            if (despawned.has(npc.id) || world?.defeatedNpcIds.has(npc.id)) continue
            const existing = rendered.get(npc.id)
            if (existing && (
                existing.visualKey !== npcVisualKey(npc) ||
                existing.equipmentKey !== npcEquipmentKey(npc)
            )) removeNpc(npc.id, existing)
            const liveEntry = rendered.get(npc.id)
            if (liveEntry) {
                // A live brain owns the NPC's transform; fall back to the static
                // config placement when the NPC has no runtime yet.
                const rt = world?.npcRuntimeById.get(npc.id)
                applyTransform(liveEntry.root, rt?.position ?? npc.position, rt?.yaw ?? npc.yaw, npc.scale)
                continue
            }
            rendered.set(npc.id, buildNpc(npc))
        }
        const boxes: AABB[] = []
        for (const npc of npcs) {
            if (despawned.has(npc.id) || world?.defeatedNpcIds.has(npc.id)) continue
            const box = liveNpcAabb(world, npc)
            if (box) boxes.push(box)
        }
        updateColliderBoxes(colliderBatch, boxes)
    }

    function animate(world: GameWorld, dt: number): void {
        for (const [id, entry] of rendered) {
            const animator = entry.animator
            const runtime = world.npcRuntimeById.get(id)
            // Drive the walk/run/hop cycle from how fast the NPC actually moved
            // this frame (the behaviour system slides `runtime.position`),
            // smoothed so it doesn't flicker idle⇆run between fixed ticks.
            if (runtime && dt > 1e-5) {
                const moved = Math.hypot(runtime.position.x - entry.prevX, runtime.position.z - entry.prevZ)
                entry.speed += (moved / dt - entry.speed) * Math.min(1, dt * 12)
                entry.prevX = runtime.position.x
                entry.prevZ = runtime.position.z
            }
            animator.setLocomotion(entry.speed)
            if (runtime?.shieldGuard) {
                animator.setShieldGuard(runtime.shieldGuard.raised && !runtime.requestAttack)
            }
            if (runtime?.requestAttack) {
                const npc = opts.getNpcs().find((candidate) => candidate.id === id)
                const clip = runtime.requestAttackClip ?? runtime.attackClip ?? (npc ? npcAttackClip(npc) : 'attack')
                animator.triggerAttack(clip)
                opts.onAttack?.(clip, runtime.position)
                runtime.requestAttack = false
                runtime.requestAttackClip = undefined
            }
            if (runtime?.requestDie) {
                animator.triggerDie()
                runtime.requestDie = false
            }
            if (runtime?.requestHurt) {
                opts.onHurt?.(runtime.position)
                runtime.requestHurt = false
            }
            animator.update(dt)
            // Despawn once the body has lain dead/settled for a beat.
            if (animator.deadSettled()) {
                removeNpc(id, entry)
                markNpcDefeated(world, id)
                despawned.add(id)
                disposeNpc(world, id)
            }
        }
    }

    return {
        name: 'npcRender',
        order: RenderOrder.worldRender + 1,
        init(world) {
            scene.add(group)
            scene.add(colliderBatch.lines)
            colliderBatch.lines.visible = debugInfoEnabled
            unsubscribeDebugInfo = subscribeDebugInfo((enabled) => {
                debugInfoEnabled = enabled
                colliderBatch.lines.visible = enabled
            })
            sync(world)
        },
        update(world, dt) {
            sync(world)
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

function npcVisualKey(npc: Pick<NpcConfig, 'model' | 'variant' | 'beard'>): string {
    return `${npc.model}:${npc.variant}:${npc.beard}`
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

function applyTransform(root: Object3D, pos: { x: number; y: number; z: number }, yaw: number, scale: number): void {
    root.position.set(pos.x, pos.y, pos.z)
    root.rotation.y = yaw
    root.scale.setScalar(Math.max(0.001, scale))
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

/** The debug collider AABB for an NPC: its live runtime box (so it follows a
 *  moving NPC) when a runtime exists, else the static config placement. */
function liveNpcAabb(world: GameWorld | undefined, npc: NpcConfig): AABB | null {
    const rt = world?.npcRuntimeById.get(npc.id)
    if (!rt) return npcCollisionAabb(npc)
    const r = rt.colliderRadius
    return {
        minX: rt.position.x - r,
        minY: rt.position.y,
        minZ: rt.position.z - r,
        maxX: rt.position.x + r,
        maxY: rt.position.y + rt.colliderHeight,
        maxZ: rt.position.z + r,
    }
}

function updateColliderBoxes(batch: ColliderBatchState, boxes: readonly AABB[]): void {
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
