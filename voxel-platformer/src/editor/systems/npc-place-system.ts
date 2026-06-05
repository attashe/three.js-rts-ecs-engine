import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import { makeRay } from '../../engine/input/pointer'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { EditorState } from '../editor-state'
import { DEFAULT_NPC, normalizeNpcConfig, sanitizeNpcId, type NpcConfig } from '../../game/npcs/npc-types'
import { mergeBehaviourIntoScript } from '../../game/npcs/npc-behaviour-script'
import {
    cursorFloorPosition,
    raycastClick,
    removeAnchor,
    resolvePlacement,
    type ClickPoint,
    type VoxelRayHit,
    type WorldPoint,
} from './placement-raycast'

const REMOVE_RADIUS = 1.8

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

            const getHit = (click: ClickPoint): VoxelRayHit | null => raycastClick(click, iso, chunks, ray)

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
        const position = resolvePlacement({
            gridAligned: state.npcGridAlign,
            cursor: state.cursor,
            ray,
            workingPlaneY: state.workingPlaneY,
            hit: getHit(click),
        })
        if (!position) return

        const id = sanitizeNpcId(nextNpcId())
        // Compile the draft behaviour into the script so a templated enemy/animal
        // works straight away with no hand-scripting.
        const behaviour = state.npcBehaviour
        const scriptSource = mergeBehaviourIntoScript(state.npcScriptSource, behaviour)
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
            invulnerable: state.npcInvulnerable,
            unprovokable: state.npcUnprovokable,
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
            scriptSource,
            behaviour,
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
}
