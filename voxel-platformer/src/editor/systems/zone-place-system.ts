import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import { copyZoneScriptAction, type EditorState, type EditorZone } from '../editor-state'

/**
 * Click-to-place editor zones. Active only when
 * `editorState.mode === 'place-zone'`. LMB drops a `zoneSize × zoneHeight ×
 * zoneSize` AABB centred on the cursor (Y starts at the working plane).
 * RMB pops the last placed zone — quick undo without leaving placement
 * mode.
 *
 * Each zone gets a fresh id (`zone-{counter}`) so that save / load round
 * trips uniquely identify it. The id is opaque from the user's POV; they
 * label zones via `editorState.zoneLabel`.
 */
export function createZonePlaceSystem(input: Input, editorState: EditorState): System {
    let counter = 0
    function nextId(): string {
        counter += 1
        const taken = new Set(editorState.zones.map((z) => z.id))
        while (taken.has(`zone-${counter}`)) counter += 1
        return `zone-${counter}`
    }

    return {
        fixed: true,
        // After paint / pickup / piston / spawn — each system bails when
        // the mode isn't theirs so we share the click queue safely.
        order: FixedOrder.input + 10,
        update(world) {
            if (editorState.mode !== 'place-zone') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return
            const cursor = editorState.cursor
            if (!cursor) return

            for (const click of clicks) {
                if (click.button === 2) {
                    removeLastZone(world as GameWorld, editorState)
                } else if (click.button === 0) {
                    placeZone(world as GameWorld, editorState, cursor, nextId())
                }
            }
        },
    }
}

function placeZone(world: GameWorld, state: EditorState, cursor: VoxelCoord, id: string): void {
    const size = Math.max(1, Math.floor(state.zoneSize))
    const halfBefore = Math.floor((size - 1) / 2)
    const heightCells = Math.max(1, Math.floor(state.zoneHeight))
    const min: VoxelCoord = {
        x: cursor.x - halfBefore,
        y: state.workingPlaneY,
        z: cursor.z - halfBefore,
    }
    const max: VoxelCoord = {
        // AABB convention is exclusive on max, so `max = min + size`.
        x: min.x + size,
        y: state.workingPlaneY + heightCells,
        z: min.z + size,
    }
    const zone: EditorZone = {
        id,
        kind: state.zoneKind,
        label: state.zoneLabel.trim() || undefined,
        min,
        max,
        triggerSources: triggerSourcesForMode(state.zoneTriggerMode),
        script: state.zoneScriptActions.length > 0
            ? { actions: state.zoneScriptActions.map(copyZoneScriptAction) }
            : undefined,
    }
    state.zones.push(zone)
    pushLog(world, `Zone "${zone.label ?? zone.id}" placed (${zone.kind}, ${max.x - min.x}×${max.y - min.y}×${max.z - min.z}).`)
}

function triggerSourcesForMode(mode: EditorState['zoneTriggerMode']): EditorZone['triggerSources'] {
    if (mode === 'both') return ['player', 'arrow']
    return [mode]
}

function removeLastZone(world: GameWorld, state: EditorState): void {
    const removed = state.zones.pop()
    if (!removed) return
    pushLog(world, `Removed zone "${removed.label ?? removed.id}".`)
}
