import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { brushDragFootprint, brushFootprint, isDragBrush } from '../brush'
import type { EditorState } from '../editor-state'
import { addOffset, pistonOffset } from '../piston-direction'
import { scatterBrushCells } from './prop-place-system'

const MAX_RAY = 60
const RMB = 2
const PAINT_OUTLINE_COLOUR = 0x9cff57
const ERASE_OUTLINE_COLOUR = 0xff8a5a
const PICKUP_OUTLINE_COLOUR = 0x8fb6ff
const PISTON_FROM_COLOUR = 0xc594ff
const SPAWN_OUTLINE_COLOUR = 0x57e1ff
const SOUND_OUTLINE_COLOUR = 0x66e6ff

/**
 * Render-side cursor preview for the editor:
 *
 *  - Wireframe outline of every cell the active brush will affect.
 *  - Translucent ghost block at the anchor cell, tinted with the active
 *    palette colour so the user can see what they're about to paint.
 *
 * Cursor placement: ray-marches the mouse pointer through the voxel grid;
 * if no solid voxel is hit, falls back to intersecting the ray with the
 * spawn-Y horizontal plane so the cursor stays visible even when the user
 * is aiming over empty space.
 *
 * Cursor cell is mode-dependent — in paint mode it's the empty cell
 * adjacent to the hit face (so painting lands on top of the surface), in
 * erase / spawn-pickup it's the hit cell itself.
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

    const outlineMaterial = new LineBasicMaterial({
        color: PAINT_OUTLINE_COLOUR,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
    })
    const lines = new LineSegments(new BufferGeometry(), outlineMaterial)
    lines.frustumCulled = false
    lines.renderOrder = 999
    root.add(lines)

    const ghostMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
    })
    const ghostGeometry = new BoxGeometry(0.94, 0.94, 0.94)
    const ghost = new Mesh(ghostGeometry, ghostMaterial)
    ghost.renderOrder = 998
    ghost.frustumCulled = false
    root.add(ghost)

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
                ghost.visible = false
                return
            }
            screenToWorldRay(pointer.x, pointer.y, iso.camera, ray)

            const eraseGesture = editorState.mode === 'erase' ||
                (editorState.mode === 'paint' && input.isMouseButtonDown(RMB))
            const cursorCell = resolveCursorCell(chunks, ray, editorState, eraseGesture)
            editorState.cursor = cursorCell
            if (editorState.mode === 'select') {
                lines.visible = false
                ghost.visible = false
                return
            }
            if (!cursorCell) {
                lines.visible = false
                ghost.visible = false
                return
            }

            const cells = brushAffectedCells(editorState, cursorCell)
            outlineMaterial.color.setHex(outlineColour(editorState.mode))
            capacity = writeBoxes(lines, cells, capacity)
            lines.visible = true

            // Ghost block sits at the anchor cell, tinted with whatever the
            // active block will paint (red for erase, sky for spawn, gold
            // for piston `to` cell).
            const [gr, gg, gb] = ghostColour(chunks, editorState)
            ghostMaterial.color.setRGB(gr, gg, gb)
            const ghostCell = editorState.mode === 'place-piston'
                ? addOffset(cursorCell, pistonOffset(editorState.pistonDirection, editorState.pistonDistance))
                : cursorCell
            ghost.position.set(ghostCell.x + 0.5, ghostCell.y + 0.5, ghostCell.z + 0.5)
            ghost.visible = true
        },
        dispose() {
            scene.remove(root)
            lines.geometry.dispose()
            outlineMaterial.dispose()
            ghostGeometry.dispose()
            ghostMaterial.dispose()
        },
    }
}

function resolveCursorCell(
    chunks: ChunkManager,
    ray: ReturnType<typeof makeRay>,
    editorState: EditorState,
    eraseGesture: boolean,
): { x: number; y: number; z: number } | null {
    // Lock-to-plane: even if the ray hits a voxel, force the cursor onto the
    // working plane so the user can paint a specific layer through existing
    // geometry.
    if (editorState.planeLock) {
        return intersectGroundPlane(ray, editorState.workingPlaneY)
    }
    const hit = voxelRaycast(chunks, ray.origin, ray.direction, MAX_RAY)
    if (hit) {
        // Paint + spawn + sound sources want the empty cell adjacent to
        // the hit face. Erase / pickup / piston want the hit cell itself.
        if (
            (editorState.mode === 'paint' && !eraseGesture) ||
            editorState.mode === 'place-spawn' ||
            editorState.mode === 'place-sound' ||
            editorState.mode === 'place-prop' ||
            editorState.mode === 'scatter-props'
        ) {
            return {
                x: hit.voxel.x + hit.normal.x,
                y: hit.voxel.y + hit.normal.y,
                z: hit.voxel.z + hit.normal.z,
            }
        }
        return { ...hit.voxel }
    }
    // No voxel hit — intersect against the working plane so the cursor
    // stays visible over empty terrain.
    return intersectGroundPlane(ray, editorState.workingPlaneY)
}

/** Cells the active operation will affect. Place-piston shows two outlines
 *  (from + to); pickups / spawn / sound sources show one; place-zone shows
 *  the full XZ footprint at the working plane; paint / erase show the brush
 *  footprint. */
function brushAffectedCells(state: EditorState, cursor: { x: number; y: number; z: number }): { x: number; y: number; z: number }[] {
    if (state.mode === 'spawn-pickup' || state.mode === 'place-spawn' || state.mode === 'place-sound' || state.mode === 'place-prop') return [cursor]
    if (state.mode === 'scatter-props') return scatterBrushCells(state, cursor)
    if (state.mode === 'place-piston') {
        const target = addOffset(cursor, pistonOffset(state.pistonDirection, state.pistonDistance))
        return [cursor, target]
    }
    if (state.mode === 'place-zone') {
        const size = Math.max(1, Math.floor(state.zoneSize))
        const halfBefore = Math.floor((size - 1) / 2)
        const minX = cursor.x - halfBefore
        const minZ = cursor.z - halfBefore
        const cells: { x: number; y: number; z: number }[] = []
        for (let dz = 0; dz < size; dz++) {
            for (let dx = 0; dx < size; dx++) {
                cells.push({ x: minX + dx, y: state.workingPlaneY, z: minZ + dz })
            }
        }
        return cells
    }
    if (
        (state.mode === 'paint' || state.mode === 'erase') &&
        state.brushDragAnchor &&
        isDragBrush(state.brush)
    ) {
        return brushDragFootprint(state.brush, state.brushDragAnchor, cursor)
    }
    return brushFootprint(state.brush, cursor)
}

function intersectGroundPlane(
    ray: ReturnType<typeof makeRay>,
    planeFloorY: number,
): { x: number; y: number; z: number } | null {
    // Plane sits at world y = planeFloorY. Solve origin.y + dir.y * t = planeFloorY;
    // ignore rays that are parallel or pointing the wrong way.
    if (Math.abs(ray.direction.y) < 1e-6) return null
    const t = (planeFloorY - ray.origin.y) / ray.direction.y
    if (t < 0) return null
    const hitX = ray.origin.x + ray.direction.x * t
    const hitZ = ray.origin.z + ray.direction.z * t
    return { x: Math.floor(hitX), y: planeFloorY, z: Math.floor(hitZ) }
}

function outlineColour(mode: EditorState['mode']): number {
    switch (mode) {
        case 'select': return 0xffd166
        case 'paint': return PAINT_OUTLINE_COLOUR
        case 'erase': return ERASE_OUTLINE_COLOUR
        case 'spawn-pickup': return PICKUP_OUTLINE_COLOUR
        case 'place-piston': return PISTON_FROM_COLOUR
        case 'place-spawn': return SPAWN_OUTLINE_COLOUR
        case 'place-zone': return 0xff66cc
        case 'place-sound': return SOUND_OUTLINE_COLOUR
        case 'place-sound-zone': return 0x4af6c8
        case 'place-weather': return 0xffd6f0
        case 'place-prop': return 0xb3e5b3
        case 'scatter-props': return 0x9be66f
    }
}

function ghostColour(chunks: ChunkManager, state: EditorState): [number, number, number] {
    if (state.mode === 'select') return [1, 0.82, 0.4]
    if (state.mode === 'erase') return [1, 0.4, 0.32]
    if (state.mode === 'spawn-pickup') return [0.56, 0.71, 1]
    if (state.mode === 'place-piston') return [1, 0.82, 0.4]
    if (state.mode === 'place-spawn') return [0.34, 0.88, 1]
    if (state.mode === 'place-zone') return [1, 0.4, 0.8]
    if (state.mode === 'place-sound') return [0.4, 0.9, 1]
    if (state.mode === 'place-sound-zone') return [0.29, 0.96, 0.78]
    if (state.mode === 'place-weather') return [1, 0.84, 0.94]
    if (state.mode === 'scatter-props') return [0.6, 0.9, 0.44]
    const entry = chunks.palette.entries[state.activeBlock]
    if (!entry) return [1, 1, 1]
    return [entry.color[0], entry.color[1], entry.color[2]]
}

/** Build N-cube wireframes in one geometry. Returns the new capacity. */
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
