import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { EditorState } from '../editor-state'
import { DEFAULT_NPC, normalizeNpcConfig, sanitizeNpcId, type NpcConfig } from '../../game/npcs/npc-types'

const MAX_RAY = 60
const REMOVE_RADIUS = 1.8
type VoxelRayHit = NonNullable<ReturnType<typeof voxelRaycast>>
type WorldPoint = { x: number; y: number; z: number }
type ClickPoint = { x: number; y: number }

export function createNpcPlaceSystem(
    input: Input,
    iso: IsometricCamera,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const ray = makeRay()
    let idCounter = 0

    function nextId(): string {
        const taken = new Set(editorState.npcs.map((npc) => npc.id))
        for (;;) {
            idCounter += 1
            const candidate = `npc-${idCounter}`
            if (!taken.has(candidate)) return candidate
        }
    }

    return {
        fixed: true,
        order: FixedOrder.input + 13,
        update(world) {
            if (editorState.mode !== 'place-npc') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return

            const getHit = (click: ClickPoint): VoxelRayHit | null => {
                screenToWorldRay(click.x, click.y, iso.camera, ray)
                return voxelRaycast(chunks, ray.origin, ray.direction, MAX_RAY)
            }

            for (const click of clicks) {
                if (click.button === 2) {
                    const anchor = editorState.cursor
                        ? cursorFloorPosition(editorState.cursor)
                        : removeAnchor(getHit(click))
                    removeNearestNpc(world as GameWorld, editorState, anchor)
                } else if (click.button === 0) {
                    placeNpc(world as GameWorld, editorState, click, getHit, nextId)
                }
            }
        },
    }

    function placeNpc(
        world: GameWorld,
        state: EditorState,
        click: ClickPoint,
        getHit: (click: ClickPoint) => VoxelRayHit | null,
        nextNpcId: () => string,
    ): void {
        const hit = state.npcGridAlign && state.cursor ? null : getHit(click)
        const position = state.npcGridAlign
            ? gridAlignedPosition(state.cursor, hit)
            : hit
                ? freeHitPosition(hit)
                : freePlanePosition(state)
        if (!position) return

        const id = sanitizeNpcId(nextNpcId())
        const npc: NpcConfig = normalizeNpcConfig({
            id,
            name: state.npcName || DEFAULT_NPC.name,
            model: state.npcModel,
            variant: state.npcVariant,
            beard: state.npcBeard,
            position,
            yaw: state.npcYaw,
            scale: state.npcScale,
            gridAligned: state.npcGridAlign,
            collisionEnabled: state.npcCollisionEnabled,
            colliderRadius: state.npcColliderRadius,
            colliderHeight: state.npcColliderHeight,
            interactionEnabled: state.npcInteractionEnabled,
            interactionRadius: state.npcInteractionRadius,
            interactionPrompt: state.npcInteractionPrompt,
            equipment: { ...state.npcEquipment },
            voice: {
                enabled: state.npcVoiceEnabled,
                preset: state.npcVoicePreset,
                seed: state.npcVoiceSeed,
                volume: state.npcVoiceVolume,
                rate: state.npcVoiceRate,
                pitchOffset: state.npcVoicePitchOffset,
            },
            scriptEnabled: state.npcScriptEnabled,
            scriptSource: state.npcScriptSource,
        })
        state.npcs.push(npc)
        state.selectedNpcId = npc.id
        pushLog(world, `NPC "${npc.name}" placed (${npc.id}).`)
    }

    function removeNearestNpc(
        world: GameWorld,
        state: EditorState,
        anchor: WorldPoint | null,
    ): void {
        if (!anchor) return
        let bestIndex = -1
        let bestDistSq = REMOVE_RADIUS * REMOVE_RADIUS
        for (let i = 0; i < state.npcs.length; i++) {
            const npc = state.npcs[i]!
            const dx = npc.position.x - anchor.x
            const dy = npc.position.y - anchor.y
            const dz = npc.position.z - anchor.z
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 < bestDistSq) {
                bestDistSq = d2
                bestIndex = i
            }
        }
        if (bestIndex < 0) return
        const [removed] = state.npcs.splice(bestIndex, 1)
        if (state.selectedNpcId === removed?.id) state.selectedNpcId = null
        if (removed) pushLog(world, `Removed NPC "${removed.name}" (${removed.id}).`)
    }

    function freeHitPosition(hit: VoxelRayHit): WorldPoint {
        return {
            x: ray.origin.x + ray.direction.x * hit.t,
            y: ray.origin.y + ray.direction.y * hit.t + 0.001,
            z: ray.origin.z + ray.direction.z * hit.t,
        }
    }

    function freePlanePosition(state: EditorState): WorldPoint | null {
        return intersectWorkingPlane(ray, state.workingPlaneY) ??
            (state.cursor ? cursorFloorPosition(state.cursor) : null)
    }
}

function gridAlignedPosition(cursor: VoxelCoord | null, hit: VoxelRayHit | null): WorldPoint | null {
    if (cursor) return cursorFloorPosition(cursor)
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

function removeAnchor(hit: VoxelRayHit | null): WorldPoint | null {
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

function cursorFloorPosition(cursor: VoxelCoord): WorldPoint {
    return {
        x: cursor.x + 0.5,
        y: cursor.y,
        z: cursor.z + 0.5,
    }
}

function intersectWorkingPlane(ray: ReturnType<typeof makeRay>, planeY: number): WorldPoint | null {
    if (Math.abs(ray.direction.y) < 1e-6) return null
    const t = (planeY - ray.origin.y) / ray.direction.y
    if (t < 0) return null
    return {
        x: ray.origin.x + ray.direction.x * t,
        y: planeY,
        z: ray.origin.z + ray.direction.z * t,
    }
}
