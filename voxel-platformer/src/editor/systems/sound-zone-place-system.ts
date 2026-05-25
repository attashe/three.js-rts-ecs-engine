import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import type { EditorSoundZone, EditorState } from '../editor-state'

/**
 * Click-to-place editor *sound zones* — AABBs that fade an ambient
 * sound in while the player is inside.
 *
 *   LMB at the cursor cell drops a zone whose XZ extent is centred on
 *   the cursor (`state.soundZoneSize`) and whose Y extent starts at
 *   the working plane (`state.soundZoneHeight`).
 *
 *   RMB removes the nearest sound zone within ~1 cell of the cursor.
 *
 * Active only when `editorState.mode === 'place-sound-zone'`.
 */
export function createSoundZonePlaceSystem(input: Input, editorState: EditorState): System {
    let counter = 0
    function nextId(): string {
        counter += 1
        const taken = new Set(editorState.soundZones.map((z) => z.id))
        while (taken.has(`sound-zone-${counter}`)) counter += 1
        return `sound-zone-${counter}`
    }

    return {
        fixed: true,
        order: FixedOrder.input + 12,
        update(world) {
            if (editorState.mode !== 'place-sound-zone') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0 || !editorState.cursor) return

            for (const click of clicks) {
                if (click.button === 2) removeNearest(world as GameWorld, editorState)
                else if (click.button === 0) placeZone(world as GameWorld, editorState, editorState.cursor, nextId())
            }
        },
    }
}

function placeZone(world: GameWorld, state: EditorState, cursor: VoxelCoord, id: string): void {
    const sizeXZ = Math.max(1, Math.floor(state.soundZoneSize))
    const sizeY = Math.max(1, Math.floor(state.soundZoneHeight))
    const halfBefore = Math.floor((sizeXZ - 1) / 2)
    const halfAfter = sizeXZ - 1 - halfBefore
    const baseY = state.workingPlaneY
    const zone: EditorSoundZone = {
        id,
        label: state.soundZoneLabel.trim() || undefined,
        min: { x: cursor.x - halfBefore, y: baseY, z: cursor.z - halfBefore },
        max: { x: cursor.x + halfAfter + 1, y: baseY + sizeY, z: cursor.z + halfAfter + 1 },
        soundId: state.soundZoneSoundId,
        volume: clamp(state.soundZoneVolume, 0, 1),
        fadeTime: clamp(state.soundZoneFadeTime, 0, 10),
    }
    state.soundZones.push(zone)
    state.selectedSoundZoneId = zone.id
    pushLog(world, `Sound zone "${zone.label ?? zone.id}" placed (${zone.soundId}).`)
}

function removeNearest(world: GameWorld, state: EditorState): void {
    const cursor = state.cursor
    if (!cursor) return
    let bestIndex = -1
    let bestDistSq = 4.0 * 4.0 // forgive a little — zones can be large
    for (let i = 0; i < state.soundZones.length; i++) {
        const z = state.soundZones[i]!
        const cx = (z.min.x + z.max.x) / 2
        const cy = (z.min.y + z.max.y) / 2
        const cz = (z.min.z + z.max.z) / 2
        const dx = cx - (cursor.x + 0.5)
        const dy = cy - (cursor.y + 0.5)
        const dz = cz - (cursor.z + 0.5)
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    if (bestIndex < 0) return
    const [removed] = state.soundZones.splice(bestIndex, 1)
    if (state.selectedSoundZoneId === removed?.id) state.selectedSoundZoneId = null
    if (removed) pushLog(world, `Removed sound zone "${removed.label ?? removed.id}".`)
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}
