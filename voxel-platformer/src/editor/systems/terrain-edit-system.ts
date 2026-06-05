import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import type { ChunkManager, VoxelEdit } from '../../engine/voxel/chunk-manager'
import { BLOCK } from '../../engine/voxel/palette'
import {
    buildRampEdits,
    buildTerrainStrokeEdits,
    findTerrainSurface,
    type TerrainTool,
} from '../terrain-brush'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'

const LMB = 0
const RMB = 2
const STAMP_INTERVAL_SECONDS = 0.08
const MAX_TERRAIN_RADIUS = 32

interface StrokeCell {
    x: number
    y: number
    z: number
    before: number
    after: number
}

export function createTerrainEditSystem(
    chunks: ChunkManager,
    input: Input,
    editorState: EditorState,
    history: CommandStack,
): System {
    let strokeActive = false
    let strokeTool: TerrainTool = editorState.terrainTool
    let strokeDirection: 1 | -1 = 1
    let stampTimer = 0
    let lastStampKey = ''
    let rampAnchor: { x: number; y: number; z: number } | null = null
    let rampLast: { x: number; y: number; z: number } | null = null
    const strokeCells = new Map<string, StrokeCell>()

    function beginStroke(direction: 1 | -1): void {
        strokeActive = true
        strokeTool = editorState.terrainTool
        strokeDirection = direction
        stampTimer = STAMP_INTERVAL_SECONDS
        lastStampKey = ''
        strokeCells.clear()
        if (strokeTool === 'ramp' && editorState.cursor) {
            const anchor = rampPointAtSurface(editorState.cursor)
            rampAnchor = anchor
            rampLast = { ...anchor }
            editorState.terrainDragAnchor = { ...anchor }
        }
    }

    function clearStroke(): void {
        strokeActive = false
        rampAnchor = null
        rampLast = null
        lastStampKey = ''
        editorState.terrainDragAnchor = null
    }

    function recordEdits(edits: readonly VoxelEdit[]): void {
        if (edits.length === 0) return
        for (const edit of edits) {
            const key = `${edit.x},${edit.y},${edit.z}`
            const existing = strokeCells.get(key)
            if (existing) {
                existing.after = edit.value
            } else {
                strokeCells.set(key, {
                    x: edit.x,
                    y: edit.y,
                    z: edit.z,
                    before: chunks.getVoxel(edit.x, edit.y, edit.z),
                    after: edit.value,
                })
            }
        }
        chunks.applyBulk(edits)
    }

    function applyRamp(): void {
        if (!rampAnchor || !rampLast) return
        const target = { ...rampLast, y: editorState.terrainTargetHeight }
        recordEdits(buildRampEdits(chunks, chunks.palette, rampAnchor, target, {
            width: Math.max(1, terrainRadius(editorState) * 2 + 1),
            minY: editorState.terrainMinY,
            maxY: editorState.terrainMaxY,
            fillBlock: terrainFillBlock(chunks, editorState),
            repaintTop: editorState.terrainRepaintTop,
            activeBlock: editorState.activeBlock,
        }))
    }

    function rampPointAtSurface(point: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
        const surface = findTerrainSurface(chunks, chunks.palette, point.x, point.z, editorState.terrainMinY, editorState.terrainMaxY)
        return { x: point.x, y: surface?.y ?? point.y, z: point.z }
    }

    function applyStamp(cursor: { x: number; y: number; z: number }): void {
        recordEdits(buildTerrainStrokeEdits(chunks, chunks.palette, strokeTool, cursor, {
            shape: editorState.terrainBrushShape,
            radius: terrainRadius(editorState),
            falloff: editorState.terrainFalloff,
            strength: Math.max(0, editorState.terrainStrength),
            targetHeight: editorState.terrainTargetHeight,
            minY: editorState.terrainMinY,
            maxY: editorState.terrainMaxY,
            fillBlock: terrainFillBlock(chunks, editorState),
            repaintTop: editorState.terrainRepaintTop,
            activeBlock: editorState.activeBlock,
        }, strokeDirection))
    }

    function endStroke(): void {
        if (!strokeActive) return
        if (strokeTool === 'ramp') applyRamp()
        const labelTool = strokeTool
        clearStroke()
        const cells = [...strokeCells.values()].filter((c) => c.before !== c.after)
        strokeCells.clear()
        if (cells.length === 0) return
        history.pushApplied({
            label: `terrain ${labelTool}`,
            apply: () => chunks.applyBulk(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, value: c.after }))),
            revert: () => chunks.applyBulk(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, value: c.before }))),
        })
    }

    return {
        fixed: true,
        order: FixedOrder.input + 1,
        update(_world, dt) {
            const inTerrain = editorState.mode === 'terrain'
            if (editorState.viewMode === 'orbit') {
                if (strokeActive) endStroke()
                editorState.terrainDragAnchor = null
                if (!inTerrain || !editorState.cursor) return
                const clicks = input.consumeClicks()
                if (clicks.length === 0) return
                for (const click of clicks) {
                    if (click.button !== LMB && click.button !== RMB) continue
                    if (editorState.terrainTool === 'ramp') continue
                    if (editorState.terrainTool !== 'sculpt' && click.button !== LMB) continue
                    beginStroke(editorState.terrainTool === 'sculpt' && click.button === RMB ? -1 : 1)
                    applyStamp(editorState.cursor)
                    endStroke()
                }
                return
            }
            const lmb = input.isMouseButtonDown(LMB)
            const rmb = input.isMouseButtonDown(RMB)
            const anyDown = lmb || rmb

            if (strokeActive && (!inTerrain || !anyDown || !editorState.cursor)) {
                endStroke()
            }
            if (!inTerrain) {
                editorState.terrainDragAnchor = null
                return
            }
            const cursor = editorState.cursor
            if (!cursor) return
            if (!anyDown) return
            if (editorState.terrainTool !== 'sculpt' && !lmb) return

            const direction: 1 | -1 = editorState.terrainTool === 'sculpt' && rmb && !lmb ? -1 : 1
            if (
                strokeActive &&
                (strokeTool !== editorState.terrainTool || strokeDirection !== direction)
            ) {
                endStroke()
            }
            if (!strokeActive) beginStroke(direction)

            if (strokeTool === 'ramp') {
                rampLast = { ...cursor }
                return
            }

            stampTimer += dt
            const stampKey = `${strokeTool}:${strokeDirection}:${cursor.x},${cursor.y},${cursor.z}`
            if (stampTimer < STAMP_INTERVAL_SECONDS && stampKey === lastStampKey) return
            stampTimer = 0
            lastStampKey = stampKey
            applyStamp(cursor)
        },
    }
}

function terrainRadius(state: EditorState): number {
    return Math.max(0, Math.min(MAX_TERRAIN_RADIUS, Math.floor(state.terrainRadius)))
}

function terrainFillBlock(chunks: ChunkManager, state: EditorState): number {
    const block = Math.floor(state.terrainFillBlock)
    return block > 0 && block < chunks.palette.entries.length ? block : BLOCK.dirt
}
