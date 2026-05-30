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
import { isFenceBlock } from '../../engine/voxel/palette'
import {
    fenceConnectionMask,
    fenceMaskHas,
    FenceDirection,
    type FenceConnectionMask,
} from './fence-network'

export interface FenceRenderOptions {
    cutY?: () => number | null
    maxInstancesPerVariant?: number
}

interface FenceRecord {
    key: string
    slot: number
    bucketKey: string
    x: number
    y: number
    z: number
}

interface ChunkSnapshot {
    signature: string
    fenceKeys: Set<string>
}

interface Bucket {
    mesh: InstancedMesh
    mask: FenceConnectionMask
    keyBySlot: (string | null)[]
    liveCount: number
    capacity: number
    dirty: boolean
}

const MAX_INITIAL_CAPACITY = 256
const tmpPos = new Vector3()
const tmpQuat = new Quaternion()
const tmpScale = new Vector3(1, 1, 1)
const tmpMatrix = new Matrix4()

let sharedMaterial: MeshStandardMaterial | null = null

function fenceMaterial(): MeshStandardMaterial {
    if (!sharedMaterial) {
        sharedMaterial = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.78,
            metalness: 0,
            flatShading: true,
        })
    }
    return sharedMaterial
}

export function createFenceRenderSystem(
    scene: Scene,
    chunks: ChunkManager,
    opts: FenceRenderOptions = {},
): System {
    const maxInstances = Math.max(1, Math.floor(opts.maxInstancesPerVariant ?? 8192))
    const records = new Map<string, FenceRecord>()
    const snapshots = new Map<ChunkKey, ChunkSnapshot>()
    const buckets = new Map<string, Bucket>()
    let lastCutY: number | null | undefined
    let lastChunkRevision = -1

    function ensureBucket(mask: FenceConnectionMask): Bucket {
        const key = String(mask)
        let bucket = buckets.get(key)
        if (bucket) return bucket
        const capacity = Math.min(maxInstances, MAX_INITIAL_CAPACITY)
        const mesh = new InstancedMesh(geometryForMask(mask), fenceMaterial(), capacity)
        mesh.name = `Fence:${key}`
        mesh.count = 0
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.frustumCulled = true
        scene.add(mesh)
        bucket = {
            mesh,
            mask,
            keyBySlot: new Array(capacity).fill(null),
            liveCount: 0,
            capacity,
            dirty: false,
        }
        buckets.set(key, bucket)
        return bucket
    }

    function allocateSlot(bucketKeyValue: string, bucket: Bucket, fenceKey: string): number {
        if (bucket.liveCount >= bucket.capacity) growBucket(bucketKeyValue, bucket, bucket.liveCount + 1)
        const slot = bucket.liveCount
        bucket.liveCount++
        bucket.mesh.count = bucket.liveCount
        bucket.keyBySlot[slot] = fenceKey
        return slot
    }

    function growBucket(bucketKeyValue: string, bucket: Bucket, minCapacity: number): void {
        if (bucket.capacity >= maxInstances) return
        let nextCapacity = bucket.capacity
        while (nextCapacity < minCapacity && nextCapacity < maxInstances) nextCapacity *= 2
        nextCapacity = Math.min(nextCapacity, maxInstances)
        const nextMesh = new InstancedMesh(geometryForMask(bucket.mask), fenceMaterial(), nextCapacity)
        nextMesh.name = `Fence:${bucketKeyValue}`
        nextMesh.count = bucket.liveCount
        nextMesh.castShadow = false
        nextMesh.receiveShadow = true
        nextMesh.frustumCulled = true
        for (let slot = 0; slot < bucket.liveCount; slot++) {
            bucket.mesh.getMatrixAt(slot, tmpMatrix)
            nextMesh.setMatrixAt(slot, tmpMatrix)
        }
        nextMesh.instanceMatrix.needsUpdate = true
        scene.remove(bucket.mesh)
        bucket.mesh.dispose()
        scene.add(nextMesh)
        bucket.mesh = nextMesh
        bucket.capacity = nextCapacity
        bucket.keyBySlot.length = nextCapacity
        for (let i = bucket.liveCount; i < nextCapacity; i++) bucket.keyBySlot[i] = null
    }

    function releaseRecord(record: FenceRecord): void {
        const bucket = buckets.get(record.bucketKey)
        if (!bucket) return
        const lastSlot = bucket.liveCount - 1
        if (record.slot !== lastSlot) {
            const movedKey = bucket.keyBySlot[lastSlot]!
            bucket.mesh.getMatrixAt(lastSlot, tmpMatrix)
            bucket.mesh.setMatrixAt(record.slot, tmpMatrix)
            bucket.keyBySlot[record.slot] = movedKey
            const moved = records.get(movedKey)
            if (moved) moved.slot = record.slot
        }
        bucket.keyBySlot[lastSlot] = null
        bucket.liveCount--
        bucket.mesh.count = bucket.liveCount
        bucket.dirty = true
    }

    function writeRecord(record: FenceRecord): void {
        const bucket = buckets.get(record.bucketKey)
        if (!bucket) return
        tmpPos.set(record.x + 0.5, record.y, record.z + 0.5)
        tmpQuat.identity()
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        bucket.mesh.setMatrixAt(record.slot, tmpMatrix)
        bucket.dirty = true
    }

    function upsertFence(wx: number, wy: number, wz: number, key: string): void {
        const mask = fenceConnectionMask(chunks, wx, wy, wz)
        const nextBucketKey = String(mask)
        let record = records.get(key)
        if (record && record.bucketKey !== nextBucketKey) {
            releaseRecord(record)
            records.delete(key)
            record = undefined
        }
        if (!record) {
            const bucket = ensureBucket(mask)
            if (bucket.liveCount >= maxInstances) return
            const slot = allocateSlot(nextBucketKey, bucket, key)
            record = { key, slot, bucketKey: nextBucketKey, x: wx, y: wy, z: wz }
            records.set(key, record)
        }
        record.x = wx
        record.y = wy
        record.z = wz
        writeRecord(record)
    }

    function syncChunk(chunk: Chunk, key: ChunkKey): void {
        const prev = snapshots.get(key)
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        const fenceKeys = new Set<string>()
        if (chunk.nonAirCount > 0) {
            chunk.forEachSolid((lx, ly, lz, value) => {
                if (!isFenceBlock(chunks.palette, value)) return
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const fenceKey = `${wx},${wy},${wz}`
                fenceKeys.add(fenceKey)
                upsertFence(wx, wy, wz, fenceKey)
            })
        }
        if (prev) {
            for (const oldKey of prev.fenceKeys) {
                if (fenceKeys.has(oldKey)) continue
                const record = records.get(oldKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(oldKey)
            }
        }
        snapshots.set(key, { signature: chunkSignature(chunks, chunk), fenceKeys })
    }

    function syncFences(): void {
        const revision = chunks.revision()
        if (revision === lastChunkRevision) return
        lastChunkRevision = revision
        const seen = new Set<ChunkKey>()
        for (const chunk of chunks.allChunks()) {
            const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)
            seen.add(key)
            const signature = chunkSignature(chunks, chunk)
            const snapshot = snapshots.get(key)
            if (snapshot?.signature === signature) continue
            syncChunk(chunk, key)
        }
        for (const key of [...snapshots.keys()]) {
            if (seen.has(key)) continue
            const snapshot = snapshots.get(key)!
            for (const fenceKey of snapshot.fenceKeys) {
                const record = records.get(fenceKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(fenceKey)
            }
            snapshots.delete(key)
        }
    }

    function applyCutVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        if (cutY === lastCutY) return
        lastCutY = cutY
        for (const record of records.values()) {
            const bucket = buckets.get(record.bucketKey)
            if (!bucket) continue
            if (cutY !== null && record.y > cutY) {
                tmpMatrix.makeScale(0, 0, 0)
                bucket.mesh.setMatrixAt(record.slot, tmpMatrix)
                bucket.dirty = true
            } else {
                writeRecord(record)
            }
        }
    }

    function flush(): void {
        for (const bucket of buckets.values()) {
            if (!bucket.dirty) continue
            bucket.mesh.instanceMatrix.needsUpdate = true
            bucket.mesh.computeBoundingSphere()
            bucket.dirty = false
        }
    }

    return {
        name: 'fenceRender',
        order: RenderOrder.worldRender + 2,
        init() {
            syncFences()
            applyCutVisibility()
            flush()
        },
        update() {
            syncFences()
            applyCutVisibility()
            flush()
        },
        dispose() {
            for (const bucket of buckets.values()) {
                scene.remove(bucket.mesh)
                bucket.mesh.dispose()
            }
            buckets.clear()
            records.clear()
            snapshots.clear()
        },
    }
}

function chunkSignature(chunks: ChunkManager, chunk: Chunk): string {
    return [
        chunk.version,
        chunks.getChunk(chunk.cx - 1, chunk.cy, chunk.cz)?.version ?? -1,
        chunks.getChunk(chunk.cx + 1, chunk.cy, chunk.cz)?.version ?? -1,
        chunks.getChunk(chunk.cx, chunk.cy, chunk.cz - 1)?.version ?? -1,
        chunks.getChunk(chunk.cx, chunk.cy, chunk.cz + 1)?.version ?? -1,
    ].join(':')
}

const geometryCache = new Map<string, BufferGeometry>()

function geometryForMask(mask: FenceConnectionMask): BufferGeometry {
    const key = String(mask)
    let geo = geometryCache.get(key)
    if (!geo) {
        geo = buildFenceGeometry(mask)
        geometryCache.set(key, geo)
    }
    return geo
}

function buildFenceGeometry(mask: FenceConnectionMask): BufferGeometry {
    const parts: BufferGeometry[] = []
    const wood = [0.36, 0.23, 0.12] as const
    const dark = [0.26, 0.16, 0.08] as const
    parts.push(box(0.18, 1.08, 0.18, 0, 0.54, 0, ...wood))
    parts.push(box(0.24, 0.12, 0.24, 0, 1.14, 0, ...dark))

    const connected = mask !== 0
    if (connected) {
        for (const dir of [FenceDirection.North, FenceDirection.East, FenceDirection.South, FenceDirection.West] as const) {
            if (!fenceMaskHas(mask, dir)) continue
            // Draw each connection once, from the north/west cell toward its
            // south/east neighbour. Rendering rails from both cells doubles
            // the geometry and creates overlapping bar halves on long runs.
            if (dir !== FenceDirection.East && dir !== FenceDirection.South) continue
            addRails(parts, dir)
        }
    } else {
        parts.push(box(0.62, 0.10, 0.12, 0, 0.50, 0, ...wood))
        parts.push(box(0.62, 0.10, 0.12, 0, 0.84, 0, ...wood))
    }

    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error(`buildFenceGeometry: failed to merge mask ${mask}`)
    return merged
}

function addRails(parts: BufferGeometry[], dir: FenceDirection): void {
    const wood = [0.43, 0.28, 0.14] as const
    for (const y of [0.48, 0.82]) {
        switch (dir) {
            case FenceDirection.South:
                parts.push(box(0.14, 0.12, 1.0, 0, y, 0.5, ...wood))
                break
            case FenceDirection.East:
                parts.push(box(1.0, 0.12, 0.14, 0.5, y, 0, ...wood))
                break
            case FenceDirection.North:
            case FenceDirection.West:
                break
        }
    }
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
