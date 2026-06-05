import {
    BoxGeometry,
    Color,
    EdgesGeometry,
    Group,
    InstancedMesh,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    MeshBasicMaterial,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { VoxelEdit } from '../../engine/voxel/chunk-manager'
import {
    anchorOffset,
    rotatedSize,
    structurePlacementEdits,
    type StructureAsset,
    type StructureSize,
} from '../../procedural-structures/asset'
import { boundsOf } from '../../procedural-structures/buffer'
import type { EditorState } from '../editor-state'
import { resolveStructureAsset, structurePreviewKey, wallPlacementEditsFromState, wallPreviewKey } from '../structure-asset-cache'

const PREVIEW_OPACITY = 0.5
const AABB_COLOUR = 0x9be0ff
const MAX_PREVIEW_VOXELS = 20000

/**
 * Render-side preview for `place-structure` mode: a translucent voxel
 * ghost of the configured structure plus a bounding-box wireframe,
 * following the editor cursor. This is the "show the size before you
 * commit" surface the integration plan asks for — the author sees the
 * exact footprint and height the stamp will occupy on the working plane.
 *
 * The ghost is rebuilt only when the source / seed / rotation changes
 * (`structurePreviewKey`); each frame just repositions the group to the
 * cursor (offset by the chosen anchor), so dragging the cursor is cheap
 * even for a multi-thousand-voxel tower.
 */
export function createStructurePreviewSystem(
    scene: Scene,
    editorState: EditorState,
    chunks: ChunkManager,
): System {
    const group = new Group()
    group.name = 'EditorStructurePreview'
    group.visible = false

    const cubeGeometry = new BoxGeometry(0.92, 0.92, 0.92)
    const ghostMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: PREVIEW_OPACITY,
        depthWrite: false,
    })
    const aabbMaterial = new LineBasicMaterial({
        color: AABB_COLOUR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })

    let ghost: InstancedMesh | null = null
    let aabb: LineSegments | null = null
    let builtKey = ''
    let builtSize: StructureSize = { width: 0, height: 0, depth: 0 }
    const matrix = new Matrix4()
    const colour = new Color()

    function clearBuilt(): void {
        if (ghost) {
            group.remove(ghost)
            ghost.dispose()
            ghost = null
        }
        if (aabb) {
            group.remove(aabb)
            aabb.geometry.dispose()
            aabb = null
        }
    }

    function rebuild(asset: StructureAsset): void {
        clearBuilt()
        const rotation = editorState.structureRotation
        const size = rotatedSize(asset, rotation)
        builtSize = size

        // Voxel ghost — local cells in [0, size), positioned so the group's
        // origin is the structure's min corner.
        const cells = structurePlacementEdits(asset, { origin: { x: 0, y: 0, z: 0 }, rotation, anchor: 'min-corner' })
        const count = Math.min(cells.length, MAX_PREVIEW_VOXELS)
        if (count > 0) {
            ghost = new InstancedMesh(cubeGeometry, ghostMaterial, count)
            ghost.frustumCulled = false
            ghost.renderOrder = 997
            const palette = chunks.palette
            for (let i = 0; i < count; i++) {
                const c = cells[i]!
                matrix.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5)
                ghost.setMatrixAt(i, matrix)
                const entry = palette.entries[c.value]
                if (entry) colour.setRGB(entry.color[0], entry.color[1], entry.color[2])
                else colour.setRGB(1, 1, 1)
                ghost.setColorAt(i, colour)
            }
            ghost.instanceMatrix.needsUpdate = true
            if (ghost.instanceColor) ghost.instanceColor.needsUpdate = true
            group.add(ghost)
        }

        // Bounding-box wireframe, centred over the local box.
        const box = new BoxGeometry(size.width, size.height, size.depth)
        const edges = new EdgesGeometry(box)
        box.dispose()
        aabb = new LineSegments(edges, aabbMaterial)
        aabb.frustumCulled = false
        aabb.renderOrder = 999
        aabb.position.set(size.width / 2, size.height / 2, size.depth / 2)
        group.add(aabb)
    }

    function rebuildWall(cells: VoxelEdit[]): void {
        clearBuilt()
        const count = Math.min(cells.length, MAX_PREVIEW_VOXELS)
        if (count > 0) {
            ghost = new InstancedMesh(cubeGeometry, ghostMaterial, count)
            ghost.frustumCulled = false
            ghost.renderOrder = 997
            const palette = chunks.palette
            for (let i = 0; i < count; i++) {
                const c = cells[i]!
                matrix.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5)
                ghost.setMatrixAt(i, matrix)
                const entry = palette.entries[c.value]
                if (entry) colour.setRGB(entry.color[0], entry.color[1], entry.color[2])
                else colour.setRGB(1, 1, 1)
                ghost.setColorAt(i, colour)
            }
            ghost.instanceMatrix.needsUpdate = true
            if (ghost.instanceColor) ghost.instanceColor.needsUpdate = true
            group.add(ghost)
        }

        const bounds = boundsOf(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, block: c.value, tag: 'wall-preview' })))
        if (bounds.width > 0 && bounds.height > 0 && bounds.depth > 0) {
            const box = new BoxGeometry(bounds.width, bounds.height, bounds.depth)
            const edges = new EdgesGeometry(box)
            box.dispose()
            aabb = new LineSegments(edges, aabbMaterial)
            aabb.frustumCulled = false
            aabb.renderOrder = 999
            aabb.position.set(
                bounds.minX + bounds.width / 2,
                bounds.minY + bounds.height / 2,
                bounds.minZ + bounds.depth / 2,
            )
            group.add(aabb)
        }
    }

    return {
        order: RenderOrder.debug + 4,
        init() {
            scene.add(group)
        },
        update() {
            if (editorState.mode !== 'place-structure' || !editorState.cursor) {
                group.visible = false
                return
            }
            if (editorState.structureSourceKind === 'procedural' && editorState.structureKind === 'wall') {
                const start = editorState.structureWallStart
                if (!start) {
                    group.visible = false
                    return
                }
                const key = wallPreviewKey(editorState, start, editorState.cursor)
                if (key !== builtKey || (!ghost && !aabb)) {
                    rebuildWall(wallPlacementEditsFromState(editorState, start, editorState.cursor))
                    builtKey = key
                }
                group.position.set(0, 0, 0)
                group.visible = true
                return
            }
            const asset = resolveStructureAsset(editorState, chunks.palette)
            const key = structurePreviewKey(editorState)
            if (key !== builtKey || (!ghost && !aabb)) {
                rebuild(asset)
                builtKey = key
            }
            // Position the min corner so the anchor cell lands on the cursor.
            const a = anchorOffset(builtSize, editorState.structureAnchor)
            const cursor = editorState.cursor
            group.position.set(cursor.x - a.x, cursor.y - a.y, cursor.z - a.z)
            group.visible = true
        },
        dispose() {
            clearBuilt()
            scene.remove(group)
            cubeGeometry.dispose()
            ghostMaterial.dispose()
            aabbMaterial.dispose()
        },
    }
}
