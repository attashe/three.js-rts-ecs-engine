import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { CHUNK_DIM } from '../../engine/voxel/chunk'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorState } from '../editor-state'

const OUTLINE_COLOUR = 0x00ffe1
const FLOATS_PER_LINE_EDGE = 6
const LINE_EDGES_PER_CELL = 4
const FLOATS_PER_LINE_CELL = FLOATS_PER_LINE_EDGE * LINE_EDGES_PER_CELL

/**
 * Outlines the top face of every non-air cell that lives at exactly
 * `workingPlaneY`. The voxel material already darkens the cell's painted
 * colour at this layer (see `voxel-vertex-color`), so the user can read
 * the colour. The cyan outline marks the cell boundary so adjacent cells
 * don't merge into one shape from above.
 *
 * Active only in top-down view. Rebuilds whenever the working plane, view
 * mode, or any chunk's version changes.
 */
export function createWorkingPlaneOutlinesSystem(
    scene: Scene,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const lineMaterial = new LineBasicMaterial({
        color: OUTLINE_COLOUR,
        transparent: true,
        opacity: 1.0,
        depthTest: false,
        depthWrite: false,
    })
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(lineGeometry, lineMaterial)
    lines.name = 'EditorWorkingPlaneOutlines'
    lines.frustumCulled = false
    lines.renderOrder = 999

    let capacity = 0
    let lastWorkingPlaneY = Number.NaN
    let lastViewMode: EditorState['viewMode'] | null = null
    const lastVersions = new Map<string, number>()

    function chunksChanged(): boolean {
        let changed = false
        for (const c of chunks.allChunks()) {
            const key = `${c.cx},${c.cy},${c.cz}`
            if (lastVersions.get(key) !== c.version) {
                lastVersions.set(key, c.version)
                changed = true
            }
        }
        return changed
    }

    function rebuild(): void {
        const wy = editorState.workingPlaneY
        const cells: { x: number; z: number }[] = []
        for (const chunk of chunks.allChunks()) {
            const baseY = chunk.cy * CHUNK_DIM
            const localY = wy - baseY
            if (localY < 0 || localY >= CHUNK_DIM) continue
            const baseX = chunk.cx * CHUNK_DIM
            const baseZ = chunk.cz * CHUNK_DIM
            for (let lz = 0; lz < CHUNK_DIM; lz++) {
                for (let lx = 0; lx < CHUNK_DIM; lx++) {
                    if (chunk.getLocal(lx, localY, lz) !== 0) {
                        cells.push({ x: baseX + lx, z: baseZ + lz })
                    }
                }
            }
        }

        const count = cells.length
        if (count === 0) {
            lines.geometry.setDrawRange(0, 0)
            return
        }
        if (count > capacity) {
            capacity = Math.max(16, capacity)
            while (capacity < count) capacity *= 2
            const fresh = new BufferGeometry()
            const buf = new Float32BufferAttribute(new Float32Array(capacity * FLOATS_PER_LINE_CELL), 3)
            buf.setUsage(35048) // DynamicDrawUsage
            fresh.setAttribute('position', buf)
            lines.geometry.dispose()
            lines.geometry = fresh
        }
        const linePos = lines.geometry.getAttribute('position') as Float32BufferAttribute
        const lineArr = linePos.array as Float32Array
        // The top-down camera clips everything above wy + 1. Keep the
        // overlay just inside the active cell and draw it with depthTest
        // disabled so it still reads as a top-face outline.
        const yTop = wy + 0.99
        const inset = 0.02
        for (let i = 0; i < count; i++) {
            const c = cells[i]!
            const minX = c.x + inset
            const maxX = c.x + 1 - inset
            const minZ = c.z + inset
            const maxZ = c.z + 1 - inset
            writeLineCell(lineArr, i * FLOATS_PER_LINE_CELL, minX, maxX, minZ, maxZ, yTop)
        }
        linePos.needsUpdate = true
        lines.geometry.setDrawRange(0, count * LINE_EDGES_PER_CELL * 2)
    }

    return {
        order: RenderOrder.debug + 6,
        init() {
            scene.add(lines)
        },
        update() {
            const inTopDown = editorState.viewMode === 'top-down'
            lines.visible = inTopDown
            if (!inTopDown) return
            const wyChanged = editorState.workingPlaneY !== lastWorkingPlaneY
            const modeChanged = editorState.viewMode !== lastViewMode
            const versChanged = chunksChanged()
            if (wyChanged || modeChanged || versChanged) {
                lastWorkingPlaneY = editorState.workingPlaneY
                lastViewMode = editorState.viewMode
                rebuild()
            }
        },
        dispose() {
            scene.remove(lines)
            lines.geometry.dispose()
            lineMaterial.dispose()
        },
    }
}

function writeLineCell(arr: Float32Array, off: number, minX: number, maxX: number, minZ: number, maxZ: number, y: number): void {
    arr[off + 0] = minX; arr[off + 1] = y; arr[off + 2] = minZ
    arr[off + 3] = maxX; arr[off + 4] = y; arr[off + 5] = minZ
    arr[off + 6] = maxX; arr[off + 7] = y; arr[off + 8] = minZ
    arr[off + 9] = maxX; arr[off + 10] = y; arr[off + 11] = maxZ
    arr[off + 12] = maxX; arr[off + 13] = y; arr[off + 14] = maxZ
    arr[off + 15] = minX; arr[off + 16] = y; arr[off + 17] = maxZ
    arr[off + 18] = minX; arr[off + 19] = y; arr[off + 20] = maxZ
    arr[off + 21] = minX; arr[off + 22] = y; arr[off + 23] = minZ
}
