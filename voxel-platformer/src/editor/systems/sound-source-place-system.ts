import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import type { EditorSoundSource, EditorState } from '../editor-state'

/**
 * Click-to-place editor sound sources. Active only when
 * `editorState.mode === 'place-sound'`.
 *
 * LMB adds a source at the cursor cell centre. RMB removes the nearest
 * source around the cursor so sound placement matches the quick erase
 * behavior used by pickups and zones.
 */
export function createSoundSourcePlaceSystem(input: Input, editorState: EditorState): System {
    let counter = 0
    function nextId(): string {
        counter += 1
        const taken = new Set(editorState.soundSources.map((s) => s.id))
        while (taken.has(`sound-${counter}`)) counter += 1
        return `sound-${counter}`
    }

    return {
        fixed: true,
        order: FixedOrder.input + 11,
        update(world) {
            if (editorState.mode !== 'place-sound') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0 || !editorState.cursor) return

            for (const click of clicks) {
                if (click.button === 2) removeNearestSoundSource(world as GameWorld, editorState)
                else if (click.button === 0) placeSoundSource(world as GameWorld, editorState, editorState.cursor, nextId())
            }
        },
    }
}

function placeSoundSource(world: GameWorld, state: EditorState, cursor: VoxelCoord, id: string): void {
    const source: EditorSoundSource = {
        id,
        soundId: state.soundSourceSoundId,
        label: state.soundSourceLabel.trim() || undefined,
        position: {
            x: cursor.x + 0.5,
            y: cursor.y + 0.5,
            z: cursor.z + 0.5,
        },
        radius: clamp(state.soundSourceRadius, 0.5, 200),
        volume: clamp(state.soundSourceVolume, 0, 1),
        loop: state.soundSourceLoop,
        autoplay: state.soundSourceAutoplay,
    }
    state.soundSources.push(source)
    state.selectedSoundSourceId = source.id
    pushLog(world, `Sound source "${source.label ?? source.id}" placed (${source.soundId}).`)
}

function removeNearestSoundSource(world: GameWorld, state: EditorState): void {
    const cursor = state.cursor
    if (!cursor) return
    const cx = cursor.x + 0.5
    const cy = cursor.y + 0.5
    const cz = cursor.z + 0.5
    let bestIndex = -1
    let bestDistSq = 1.5 * 1.5
    for (let i = 0; i < state.soundSources.length; i++) {
        const source = state.soundSources[i]!
        const dx = source.position.x - cx
        const dy = source.position.y - cy
        const dz = source.position.z - cz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    if (bestIndex < 0) return
    const [removed] = state.soundSources.splice(bestIndex, 1)
    if (state.selectedSoundSourceId === removed?.id) state.selectedSoundSourceId = null
    if (removed) pushLog(world, `Removed sound source "${removed.label ?? removed.id}".`)
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}
