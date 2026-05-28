import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { ChunkRenderer } from '../../engine/voxel/chunk-renderer'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { CHUNK_DIM } from '../../engine/voxel/chunk'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorState } from '../editor-state'

/**
 * Mirror `editorState.viewMode` + `workingPlaneY` to the camera and to
 * the voxel material. In top-down mode:
 *   - The camera switches to a straight-down ortho view.
 *   - The camera near plane clips cells above the working plane row so
 *     upper floors cannot depth-occlude the active layer.
 *   - A cover mask is built from hidden cells above the working plane and
 *     shipped to the material; active-layer cells in those XZ columns render
 *     faded so the editor still signals that upper geometry exists there.
 *
 * Orbit mode leaves layer clipping disabled and lets the orbit-camera system
 * drive the camera transform.
 *
 * Rebuilds the cover mask whenever the working plane Y or any chunk's
 * version changes, so adding/removing hidden upper voxels updates the
 * faded-column signal immediately.
 */
export function createViewModeSystem(
    iso: IsometricCamera,
    chunkRenderer: ChunkRenderer,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
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

    function* hiddenCellsAboveY(worldY: number): Generator<{ x: number; z: number }> {
        for (const chunk of chunks.allChunks()) {
            const baseX = chunk.cx * CHUNK_DIM
            const baseY = chunk.cy * CHUNK_DIM
            const baseZ = chunk.cz * CHUNK_DIM
            for (let ly = 0; ly < CHUNK_DIM; ly++) {
                if (baseY + ly <= worldY) continue
                for (let lz = 0; lz < CHUNK_DIM; lz++) {
                    for (let lx = 0; lx < CHUNK_DIM; lx++) {
                        if (chunk.getLocal(lx, ly, lz) === 0) continue
                        yield { x: baseX + lx, z: baseZ + lz }
                    }
                }
            }
        }
    }

    return {
        order: RenderOrder.cameraControl + 1,
        update() {
            iso.setViewMode(editorState.viewMode)
            const inTopDown = editorState.viewMode === 'top-down'
            iso.setCutPlaneY(inTopDown ? editorState.workingPlaneY : null)
            chunkRenderer.setCutY(inTopDown ? editorState.workingPlaneY : null)
            if (!inTopDown) {
                lastViewMode = editorState.viewMode
                return
            }

            const wyChanged = editorState.workingPlaneY !== lastWorkingPlaneY
            const modeChanged = editorState.viewMode !== lastViewMode
            const versChanged = chunksChanged()
            if (wyChanged || modeChanged || versChanged) {
                lastWorkingPlaneY = editorState.workingPlaneY
                lastViewMode = editorState.viewMode
                chunkRenderer.setCoverMaskCells(hiddenCellsAboveY(editorState.workingPlaneY))
            }
        },
    }
}
