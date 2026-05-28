import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { StoneFallSpawnerConfig, StonePlacementConfig } from '../../game/moving-objects'
import { nextStoneEditorId } from '../stone-ids'

const REMOVE_RADIUS = 1.75

export function createStonePlaceSystem(input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        order: FixedOrder.input + 14,
        update(world) {
            if (editorState.mode !== 'place-stone' && editorState.mode !== 'place-stone-spawner') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0 || !editorState.cursor) return

            for (const click of clicks) {
                if (click.button === 2) {
                    if (editorState.mode === 'place-stone') removeNearestStone(world, editorState)
                    else removeNearestSpawner(world, editorState)
                } else if (click.button === 0) {
                    if (editorState.mode === 'place-stone') {
                        const id = nextStoneEditorId(editorState.stones.map((stone) => stone.id), 'stone')
                        placeStone(world, editorState, id)
                    } else {
                        const id = nextStoneEditorId(editorState.stoneSpawners.map((spawner) => spawner.id), 'stone-spawner')
                        placeSpawner(world, editorState, id)
                    }
                }
            }
        },
    }
}

function placeStone(world: GameWorld, state: EditorState, id: string): void {
    const cursor = state.cursor
    if (!cursor) return
    const stone: StonePlacementConfig = {
        id,
        position: cursorFootPosition(cursor),
        velocity: { ...state.stoneVelocity },
        tier: state.stoneTier,
        size: Math.max(0.05, state.stoneSize),
    }
    state.stones.push(stone)
    state.selectedStoneId = stone.id ?? null
    pushLog(world, `Stone "${stone.id}" placed.`)
}

function placeSpawner(world: GameWorld, state: EditorState, id: string): void {
    const cursor = state.cursor
    if (!cursor) return
    const spawner: StoneFallSpawnerConfig = {
        id,
        enabled: state.stoneSpawnerEnabled,
        position: cursorFootPosition(cursor),
        velocity: { ...state.stoneSpawnerVelocity },
        interval: Math.max(0.05, state.stoneSpawnerInterval),
        delay: Math.max(0, state.stoneSpawnerDelay),
        maxLive: Math.max(1, Math.floor(state.stoneSpawnerMaxLive)),
        jitter: Math.max(0, state.stoneSpawnerJitter),
        tier: state.stoneSpawnerTier,
        size: Math.max(0.05, state.stoneSpawnerSize),
    }
    state.stoneSpawners.push(spawner)
    state.selectedStoneSpawnerId = spawner.id ?? null
    pushLog(world, `Stone spawner "${spawner.id}" placed.`)
}

function removeNearestStone(world: GameWorld, state: EditorState): void {
    const idx = nearestIndex(state.stones, state.cursor)
    if (idx < 0) return
    const [removed] = state.stones.splice(idx, 1)
    if (removed?.id && state.selectedStoneId === removed.id) state.selectedStoneId = null
    if (removed) pushLog(world, `Removed stone "${removed.id ?? idx}".`)
}

function removeNearestSpawner(world: GameWorld, state: EditorState): void {
    const idx = nearestIndex(state.stoneSpawners, state.cursor)
    if (idx < 0) return
    const [removed] = state.stoneSpawners.splice(idx, 1)
    if (removed?.id && state.selectedStoneSpawnerId === removed.id) state.selectedStoneSpawnerId = null
    if (removed) pushLog(world, `Removed stone spawner "${removed.id ?? idx}".`)
}

function nearestIndex(
    objects: readonly { position: { x: number; y: number; z: number } }[],
    cursor: VoxelCoord | null,
): number {
    if (!cursor) return -1
    const anchor = cursorFootPosition(cursor)
    let bestIndex = -1
    let bestDistSq = REMOVE_RADIUS * REMOVE_RADIUS
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i]!
        const dx = obj.position.x - anchor.x
        const dy = obj.position.y - anchor.y
        const dz = obj.position.z - anchor.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    return bestIndex
}

function cursorFootPosition(cursor: VoxelCoord): { x: number; y: number; z: number } {
    return {
        x: cursor.x + 0.5,
        y: cursor.y,
        z: cursor.z + 0.5,
    }
}
