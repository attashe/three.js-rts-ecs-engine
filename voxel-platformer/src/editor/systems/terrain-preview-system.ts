import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import {
    findTerrainSurface,
    terrainBrushColumns,
    type TerrainColumn,
    type TerrainTool,
} from '../terrain-brush'
import type { EditorState } from '../editor-state'

const MAX_PREVIEW_COLUMNS = 4096

export function createTerrainPreviewSystem(
    scene: Scene,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const root = new Group()
    root.name = 'EditorTerrainPreview'
    root.visible = false

    const material = new LineBasicMaterial({
        color: colourForTool(editorState.terrainTool),
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(geometry, material)
    lines.frustumCulled = false
    lines.renderOrder = 1001
    root.add(lines)

    let capacity = 0

    return {
        order: RenderOrder.debug + 6,
        init() {
            scene.add(root)
        },
        update() {
            if (editorState.mode !== 'terrain' || !editorState.cursor) {
                root.visible = false
                return
            }
            const cursor = editorState.cursor
            const columns = editorState.terrainTool === 'ramp' && editorState.terrainDragAnchor
                ? rampPreviewColumns(editorState.terrainDragAnchor, cursor, Math.max(1, Math.floor(editorState.terrainRadius) * 2 + 1))
                : terrainBrushColumns(
                    { x: cursor.x, z: cursor.z },
                    {
                        shape: editorState.terrainBrushShape,
                        radius: Math.max(0, Math.floor(editorState.terrainRadius)),
                        falloff: editorState.terrainFalloff,
                    },
                )
            material.color.setHex(colourForTool(editorState.terrainTool))
            capacity = writeTopSquares(lines, chunks, columns.slice(0, MAX_PREVIEW_COLUMNS), cursor, editorState, capacity)
            root.visible = true
        },
        dispose() {
            scene.remove(root)
            lines.geometry.dispose()
            material.dispose()
        },
    }
}

function rampPreviewColumns(from: { x: number; z: number }, to: { x: number; z: number }, width: number): TerrainColumn[] {
    const half = Math.max(0, Math.floor((width - 1) / 2))
    const dx = to.x - from.x
    const dz = to.z - from.z
    const lenSq = dx * dx + dz * dz
    if (lenSq <= 1e-6) return [{ x: from.x, z: from.z, distance: 0, weight: 1 }]
    const minX = Math.floor(Math.min(from.x, to.x) - half - 1)
    const maxX = Math.ceil(Math.max(from.x, to.x) + half + 1)
    const minZ = Math.floor(Math.min(from.z, to.z) - half - 1)
    const maxZ = Math.ceil(Math.max(from.z, to.z) + half + 1)
    const out: TerrainColumn[] = []
    for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
            const px = x - from.x
            const pz = z - from.z
            const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / lenSq))
            const cx = from.x + dx * t
            const cz = from.z + dz * t
            const distance = Math.hypot(x - cx, z - cz)
            if (distance <= half + 0.5) out.push({ x, z, distance, weight: 1 })
        }
    }
    return out
}

function writeTopSquares(
    lines: LineSegments,
    chunks: ChunkManager,
    columns: readonly TerrainColumn[],
    cursor: { x: number; y: number; z: number },
    state: EditorState,
    capacity: number,
): number {
    let cap = capacity
    if (columns.length > cap) {
        cap = Math.max(16, cap)
        while (cap < columns.length) cap *= 2
        lines.geometry.dispose()
        lines.geometry = new BufferGeometry()
        lines.geometry.setAttribute('position', new Float32BufferAttribute(cap * 24, 3))
    }
    lines.geometry.setDrawRange(0, columns.length * 8)
    const attribute = lines.geometry.getAttribute('position') as Float32BufferAttribute
    const coords = attribute.array as Float32Array
    for (let i = 0; i < columns.length; i++) {
        const column = columns[i]!
        const surface = findTerrainSurface(chunks, chunks.palette, column.x, column.z, state.terrainMinY, state.terrainMaxY)
        const previewY = state.terrainTool === 'ramp' && state.terrainDragAnchor
            ? rampPreviewY(column, state.terrainDragAnchor, cursor, state.terrainTargetHeight)
            : (surface?.y ?? cursor.y)
        const y = previewY + 1.035
        writeSquare(coords, i * 24, column.x, y, column.z)
    }
    attribute.needsUpdate = true
    return cap
}

function rampPreviewY(
    column: TerrainColumn,
    from: { x: number; y: number; z: number },
    to: { x: number; z: number },
    targetY: number,
): number {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const lenSq = dx * dx + dz * dz
    if (lenSq <= 1e-6) return from.y
    const px = column.x - from.x
    const pz = column.z - from.z
    const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / lenSq))
    return from.y + (targetY - from.y) * t
}

function writeSquare(coords: Float32Array, offset: number, x: number, y: number, z: number): void {
    const minX = x + 0.04
    const maxX = x + 0.96
    const minZ = z + 0.04
    const maxZ = z + 0.96
    writePoint(coords, offset + 0, minX, y, minZ)
    writePoint(coords, offset + 3, maxX, y, minZ)
    writePoint(coords, offset + 6, maxX, y, minZ)
    writePoint(coords, offset + 9, maxX, y, maxZ)
    writePoint(coords, offset + 12, maxX, y, maxZ)
    writePoint(coords, offset + 15, minX, y, maxZ)
    writePoint(coords, offset + 18, minX, y, maxZ)
    writePoint(coords, offset + 21, minX, y, minZ)
}

function writePoint(coords: Float32Array, offset: number, x: number, y: number, z: number): void {
    coords[offset] = x
    coords[offset + 1] = y
    coords[offset + 2] = z
}

function colourForTool(tool: TerrainTool): number {
    switch (tool) {
        case 'sculpt': return 0x9cff57
        case 'flatten': return 0xffd166
        case 'smooth': return 0x66e6ff
        case 'ramp': return 0xc594ff
        case 'paint-surface': return 0xffb86b
    }
}
