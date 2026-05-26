import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import type { EditorState, EditorWeatherZone } from '../editor-state'

/**
 * Click-to-place editor Visual FX zones. Active only when
 * `editorState.mode === 'place-weather'`.
 *
 *   LMB at the cursor cell drops a zone whose XZ extent is centred on
 *   the cursor (`state.weatherZoneSize`) and whose Y extent starts at
 *   the working plane (`state.weatherZoneHeight`). The preset id and
 *   paired-sound settings come from the draft fields on `editorState`.
 *
 *   RMB removes the nearest effect zone within ~4 cells of the
 *   cursor (forgiving, since effect zones are typically large).
 */
export function createWeatherZonePlaceSystem(input: Input, editorState: EditorState): System {
    let counter = 0
    function nextId(): string {
        counter += 1
        const taken = new Set(editorState.weatherZones.map((z) => z.id))
        while (taken.has(`effect-zone-${counter}`)) counter += 1
        return `effect-zone-${counter}`
    }

    return {
        fixed: true,
        order: FixedOrder.input + 13,
        update(world) {
            if (editorState.mode !== 'place-weather') return
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
    const sizeXZ = Math.max(1, Math.floor(state.weatherZoneSize))
    const sizeY = Math.max(1, Math.floor(state.weatherZoneHeight))
    const baseY = state.workingPlaneY
    // FX zone position is the AABB **centre** (matches WeatherSystem
    // convention). The cursor sits on a cell foot; centre is half a
    // cell to +X / +Z, and the AABB rises from the working plane.
    const centre = {
        x: cursor.x + 0.5,
        y: baseY + sizeY / 2,
        z: cursor.z + 0.5,
    }
    const zone: EditorWeatherZone = {
        id,
        label: state.weatherZoneLabel.trim() || undefined,
        presetId: state.weatherPresetId,
        position: centre,
        size: { x: sizeXZ, y: sizeY, z: sizeXZ },
        addSound: state.weatherZoneAddSound,
        soundId: state.weatherZoneSoundId.trim() || undefined,
        soundVolume: clamp(state.weatherZoneSoundVolume, 0, 1),
    }
    state.weatherZones.push(zone)
    state.selectedWeatherZoneId = zone.id
    pushLog(world, `Effect zone "${zone.label ?? zone.id}" placed (${zone.presetId}).`)
}

function removeNearest(world: GameWorld, state: EditorState): void {
    const cursor = state.cursor
    if (!cursor) return
    let bestIndex = -1
    let bestDistSq = 4.0 * 4.0
    for (let i = 0; i < state.weatherZones.length; i++) {
        const z = state.weatherZones[i]!
        const dx = z.position.x - (cursor.x + 0.5)
        const dy = z.position.y - (cursor.y + 0.5)
        const dz = z.position.z - (cursor.z + 0.5)
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    if (bestIndex < 0) return
    const [removed] = state.weatherZones.splice(bestIndex, 1)
    if (state.selectedWeatherZoneId === removed?.id) state.selectedWeatherZoneId = null
    if (removed) pushLog(world, `Removed effect zone "${removed.label ?? removed.id}".`)
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}
