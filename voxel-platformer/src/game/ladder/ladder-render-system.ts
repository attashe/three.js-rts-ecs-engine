import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    Vector3,
    type Scene,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { CHUNK_DIM, chunkKey, type Chunk, type ChunkKey } from '../../engine/voxel/chunk'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isLadderBlock } from '../../engine/voxel/palette'

export interface LadderRenderOptions {
    cutY?: () => number | null
    maxInstances?: number
}

interface LadderRecord {
    key: string
    slot: number
    x: number
    y: number
    z: number
}

interface ChunkSnapshot {
    version: number
    ladderKeys: Set<string>
}

const MAX_INITIAL_CAPACITY = 256
const tmpPos = new Vector3()
const tmpQuat = new Quaternion()
const tmpScale = new Vector3(1, 1, 1)
const tmpMatrix = new Matrix4()

let sharedMaterial: MeshStandardMaterial | null = null
let sharedGeometry: BufferGeometry | null = null

function ladderMaterial(): MeshStandardMaterial {
    if (!sharedMaterial) {
        sharedMaterial = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.82,
            metalness: 0,
            flatShading: true,
        })
    }
    return sharedMaterial
}

function ladderGeometry(): BufferGeometry {
    if (!sharedGeometry) sharedGeometry = buildLadderGeometry()
    return sharedGeometry
}

export function createLadderRenderSystem(
    scene: Scene,
    chunks: ChunkManager,
    opts: LadderRenderOptions = {},
): System {
    const maxInstances = Math.max(1, Math.floor(opts.maxInstances ?? 8192))
    const records = new Map<string, LadderRecord>()
    const snapshots = new Map<ChunkKey, ChunkSnapshot>()
    let mesh: InstancedMesh | null = null
    let capacity = 0
    let liveCount = 0
    let keyBySlot: (string | null)[] = []
    let dirty = false
    let lastCutY: number | null | undefined
    let lastChunkRevision = -1

    function ensureMesh(minCapacity = 1): InstancedMesh {
        if (mesh && capacity >= minCapacity) return mesh
        const nextCapacity = Math.min(maxInstances, Math.max(MAX_INITIAL_CAPACITY, minCapacity, capacity * 2 || 0))
        const next = new InstancedMesh(ladderGeometry(), ladderMaterial(), nextCapacity)
        next.name = 'Ladders'
        next.count = liveCount
        next.castShadow = false
        next.receiveShadow = true
        next.frustumCulled = true
        if (mesh) {
            for (let slot = 0; slot < liveCount; slot++) {
                mesh.getMatrixAt(slot, tmpMatrix)
                next.setMatrixAt(slot, tmpMatrix)
            }
            scene.remove(mesh)
            mesh.dispose()
        }
        scene.add(next)
        mesh = next
        capacity = nextCapacity
        keyBySlot.length = capacity
        for (let i = liveCount; i < capacity; i++) keyBySlot[i] = null
        dirty = true
        return mesh
    }

    function allocateSlot(key: string): number {
        ensureMesh(liveCount + 1)
        if (liveCount >= maxInstances) return -1
        const slot = liveCount
        liveCount++
        mesh!.count = liveCount
        keyBySlot[slot] = key
        return slot
    }

    function releaseRecord(record: LadderRecord): void {
        if (!mesh) return
        const lastSlot = liveCount - 1
        if (record.slot !== lastSlot) {
            const movedKey = keyBySlot[lastSlot]!
            mesh.getMatrixAt(lastSlot, tmpMatrix)
            mesh.setMatrixAt(record.slot, tmpMatrix)
            keyBySlot[record.slot] = movedKey
            const moved = records.get(movedKey)
            if (moved) moved.slot = record.slot
        }
        keyBySlot[lastSlot] = null
        liveCount--
        mesh.count = liveCount
        dirty = true
    }

    function writeRecord(record: LadderRecord): void {
        const target = ensureMesh()
        tmpPos.set(record.x + 0.5, record.y, record.z + 0.5)
        tmpQuat.identity()
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        target.setMatrixAt(record.slot, tmpMatrix)
        dirty = true
    }

    function upsertLadder(x: number, y: number, z: number, key: string): void {
        let record = records.get(key)
        if (!record) {
            const slot = allocateSlot(key)
            if (slot < 0) return
            record = { key, slot, x, y, z }
            records.set(key, record)
        }
        record.x = x
        record.y = y
        record.z = z
        writeRecord(record)
    }

    function syncChunk(chunk: Chunk, key: ChunkKey): void {
        const prev = snapshots.get(key)
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        const ladderKeys = new Set<string>()
        if (chunk.nonAirCount > 0) {
            chunk.forEachSolid((lx, ly, lz, value) => {
                if (!isLadderBlock(chunks.palette, value)) return
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const ladderKey = `${wx},${wy},${wz}`
                ladderKeys.add(ladderKey)
                upsertLadder(wx, wy, wz, ladderKey)
            })
        }
        if (prev) {
            for (const oldKey of prev.ladderKeys) {
                if (ladderKeys.has(oldKey)) continue
                const record = records.get(oldKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(oldKey)
            }
        }
        snapshots.set(key, { version: chunk.version, ladderKeys })
    }

    function syncLadders(): void {
        const revision = chunks.revision()
        if (revision === lastChunkRevision) return
        lastChunkRevision = revision
        lastCutY = undefined
        const seen = new Set<ChunkKey>()
        for (const chunk of chunks.allChunks()) {
            const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)
            seen.add(key)
            const snapshot = snapshots.get(key)
            if (snapshot?.version === chunk.version) continue
            syncChunk(chunk, key)
        }
        for (const key of [...snapshots.keys()]) {
            if (seen.has(key)) continue
            const snapshot = snapshots.get(key)!
            for (const ladderKey of snapshot.ladderKeys) {
                const record = records.get(ladderKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(ladderKey)
            }
            snapshots.delete(key)
        }
    }

    function applyCutVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        if (cutY === lastCutY) return
        lastCutY = cutY
        if (!mesh) return
        for (const record of records.values()) {
            if (cutY !== null && record.y > cutY) {
                tmpMatrix.makeScale(0, 0, 0)
                mesh.setMatrixAt(record.slot, tmpMatrix)
                dirty = true
            } else {
                writeRecord(record)
            }
        }
    }

    function flush(): void {
        if (!mesh || !dirty) return
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
        dirty = false
    }

    return {
        name: 'ladderRender',
        order: RenderOrder.worldRender + 2,
        init() {
            ensureMesh()
            syncLadders()
            applyCutVisibility()
            flush()
        },
        update() {
            syncLadders()
            applyCutVisibility()
            flush()
        },
        dispose() {
            if (mesh) {
                scene.remove(mesh)
                mesh.dispose()
            }
            mesh = null
            records.clear()
            snapshots.clear()
            keyBySlot = []
            capacity = 0
            liveCount = 0
        },
    }
}

function buildLadderGeometry(): BufferGeometry {
    const parts: BufferGeometry[] = []
    const rail = [0.38, 0.22, 0.10] as const
    const rung = [0.62, 0.42, 0.22] as const
    for (const x of [-0.28, 0.28]) {
        for (const z of [-0.24, 0.24]) {
            parts.push(box(0.08, 1.0, 0.08, x, 0.5, z, ...rail))
        }
    }
    for (const y of [0.24, 0.52, 0.80]) {
        parts.push(box(0.62, 0.07, 0.07, 0, y, -0.28, ...rung))
        parts.push(box(0.62, 0.07, 0.07, 0, y, 0.28, ...rung))
    }
    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error('buildLadderGeometry: failed to merge ladder parts')
    return merged
}

function box(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
): BufferGeometry {
    const geo = new BoxGeometry(width, height, depth)
    geo.translate(x, y, z)
    paintVertexColor(geo, r, g, b)
    return geo
}

function paintVertexColor(geo: BufferGeometry, r: number, g: number, b: number): void {
    const count = geo.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
        colors[i * 3 + 0] = r
        colors[i * 3 + 1] = g
        colors[i * 3 + 2] = b
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3))
}
