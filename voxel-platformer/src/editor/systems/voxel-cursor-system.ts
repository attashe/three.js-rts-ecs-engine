import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { brushFootprint } from '../brush'
import type { EditorState } from '../editor-state'

const MAX_RAY = 60
const PAINT_OUTLINE_COLOUR = 0x9cff57
const ERASE_OUTLINE_COLOUR = 0xff8a5a
const SPAWN_OUTLINE_COLOUR = 0x8fb6ff

/**
 * Renders the brush cursor as a wireframe overlay of every cell the brush
 * will affect, plus an "anchor" outline at the cursor hit cell. Reads the
 * mouse pointer + IsoCamera each frame, raycasts into the voxel grid via
 * `voxelRaycast`, and updates `editorState.cursor` with the hit voxel
 * (offset by the surface normal so painting lands on the empty cell in
 * front of the hit face).
 */
export function createVoxelCursorSystem(
    scene: Scene,
    iso: IsometricCamera,
    input: Input,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const root = new Group()
    root.name = 'EditorVoxelCursor'
    const material = new LineBasicMaterial({ color: PAINT_OUTLINE_COLOUR, depthTest: false })
    const lines = new LineSegments(new BufferGeometry(), material)
    lines.frustumCulled = false
    lines.renderOrder = 999
    root.add(lines)

    const ray = makeRay()
    let capacity = 0

    return {
        order: RenderOrder.debug + 5,
        init() {
            scene.add(root)
        },
        update() {
            const pointer = input.getPointer()
            if (!pointer) {
                editorState.cursor = null
                lines.visible = false
                return
            }
            screenToWorldRay(pointer.x, pointer.y, iso.camera, ray)
            const hit = voxelRaycast(chunks, ray.origin, ray.direction, MAX_RAY)
            if (!hit) {
                editorState.cursor = null
                lines.visible = false
                return
            }

            // For paint mode we want to deposit on the empty cell adjacent to
            // the hit face. For erase/spawn we target the hit cell itself —
            // erase wants to remove the block we clicked, spawn wants to
            // place at the surface we clicked.
            const cursorCell = editorState.mode === 'paint'
                ? {
                    x: hit.voxel.x + hit.normal.x,
                    y: hit.voxel.y + hit.normal.y,
                    z: hit.voxel.z + hit.normal.z,
                }
                : { ...hit.voxel }
            editorState.cursor = cursorCell

            const cells = editorState.mode === 'spawn-pickup'
                ? [cursorCell]
                : brushFootprint(editorState.brush, cursorCell)
            material.color.setHex(outlineColour(editorState.mode))
            capacity = writeBoxes(lines, cells, capacity)
            lines.visible = true
        },
        dispose() {
            scene.remove(root)
            lines.geometry.dispose()
            material.dispose()
        },
    }
}

function outlineColour(mode: EditorState['mode']): number {
    switch (mode) {
        case 'paint': return PAINT_OUTLINE_COLOUR
        case 'erase': return ERASE_OUTLINE_COLOUR
        case 'spawn-pickup': return SPAWN_OUTLINE_COLOUR
    }
}

/** Build an N-cube wireframe in one geometry. Returns the new capacity. */
function writeBoxes(lines: LineSegments, cells: readonly { x: number; y: number; z: number }[], capacity: number): number {
    const count = cells.length
    let cap = capacity
    if (count > cap) {
        cap = Math.max(8, cap)
        while (cap < count) cap *= 2
        lines.geometry.dispose()
        lines.geometry = new BufferGeometry()
        lines.geometry.setAttribute('position', new Float32BufferAttribute(cap * 72, 3))
    }
    lines.geometry.setDrawRange(0, count * 24)
    const attribute = lines.geometry.getAttribute('position') as Float32BufferAttribute
    const coords = attribute.array as Float32Array
    for (let i = 0; i < count; i++) {
        writeBox(coords, i * 72, cells[i]!)
    }
    attribute.needsUpdate = true
    return cap
}

function writeBox(coords: Float32Array, offset: number, cell: { x: number; y: number; z: number }): void {
    // Slight inset so adjacent brush cells don't z-fight.
    const minX = cell.x + 0.02, minY = cell.y + 0.02, minZ = cell.z + 0.02
    const maxX = cell.x + 0.98, maxY = cell.y + 0.98, maxZ = cell.z + 0.98

    writeEdge(coords, offset + 0,  minX, minY, minZ,  maxX, minY, minZ)
    writeEdge(coords, offset + 6,  maxX, minY, minZ,  maxX, minY, maxZ)
    writeEdge(coords, offset + 12, maxX, minY, maxZ,  minX, minY, maxZ)
    writeEdge(coords, offset + 18, minX, minY, maxZ,  minX, minY, minZ)
    writeEdge(coords, offset + 24, minX, maxY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 30, maxX, maxY, minZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 36, maxX, maxY, maxZ,  minX, maxY, maxZ)
    writeEdge(coords, offset + 42, minX, maxY, maxZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 48, minX, minY, minZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 54, maxX, minY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 60, maxX, minY, maxZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 66, minX, minY, maxZ,  minX, maxY, maxZ)
}

function writeEdge(
    coords: Float32Array,
    offset: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
): void {
    coords[offset + 0] = ax; coords[offset + 1] = ay; coords[offset + 2] = az
    coords[offset + 3] = bx; coords[offset + 4] = by; coords[offset + 5] = bz
}
