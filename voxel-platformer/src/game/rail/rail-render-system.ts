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
import { isRailBlock } from '../../engine/voxel/palette'
import {
    railConnectionMask,
    railVariantFromMask,
    type RailVariant,
    type RailVariantInfo,
} from './rail-network'

export interface RailRenderOptions {
    cutY?: () => number | null
    maxInstancesPerVariant?: number
}

interface RailRecord {
    key: string
    slot: number
    bucketKey: string
    y: number
}

interface ChunkSnapshot {
    signature: string
    railKeys: Set<string>
}

interface Bucket {
    mesh: InstancedMesh
    keyBySlot: (string | null)[]
    liveCount: number
    capacity: number
    dirty: boolean
}

const VARIANTS: readonly RailVariant[] = ['isolated', 'end', 'straight', 'corner', 't', 'cross']
const MAX_INITIAL_CAPACITY = 256
const tmpPos = new Vector3()
const tmpQuat = new Quaternion()
const tmpScale = new Vector3(1, 1, 1)
const tmpMatrix = new Matrix4()
const tmpYAxis = new Vector3(0, 1, 0)

let sharedMaterial: MeshStandardMaterial | null = null

function railMaterial(): MeshStandardMaterial {
    if (!sharedMaterial) {
        sharedMaterial = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.72,
            metalness: 0.15,
            flatShading: true,
        })
    }
    return sharedMaterial
}

export function createRailRenderSystem(
    scene: Scene,
    chunks: ChunkManager,
    opts: RailRenderOptions = {},
): System {
    const maxInstances = Math.max(1, Math.floor(opts.maxInstancesPerVariant ?? 8192))
    const records = new Map<string, RailRecord>()
    const snapshots = new Map<ChunkKey, ChunkSnapshot>()
    const buckets = new Map<string, Bucket>()
    let lastCutY: number | null | undefined

    function ensureBucket(info: RailVariantInfo): Bucket {
        const key = bucketKey(info)
        let bucket = buckets.get(key)
        if (bucket) return bucket
        const capacity = Math.min(maxInstances, MAX_INITIAL_CAPACITY)
        const mesh = new InstancedMesh(geometryForVariant(info.variant), railMaterial(), capacity)
        mesh.name = `Rail:${key}`
        mesh.count = 0
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        scene.add(mesh)
        bucket = {
            mesh,
            keyBySlot: new Array(capacity).fill(null),
            liveCount: 0,
            capacity,
            dirty: false,
        }
        buckets.set(key, bucket)
        return bucket
    }

    function allocateSlot(bucketKeyValue: string, bucket: Bucket, railKey: string): number {
        if (bucket.liveCount >= bucket.capacity) growBucket(bucketKeyValue, bucket, bucket.liveCount + 1)
        const slot = bucket.liveCount
        bucket.liveCount++
        bucket.mesh.count = bucket.liveCount
        bucket.keyBySlot[slot] = railKey
        return slot
    }

    function growBucket(bucketKeyValue: string, bucket: Bucket, minCapacity: number): void {
        if (bucket.capacity >= maxInstances) return
        let nextCapacity = bucket.capacity
        while (nextCapacity < minCapacity && nextCapacity < maxInstances) nextCapacity *= 2
        nextCapacity = Math.min(nextCapacity, maxInstances)
        const variant = bucketKeyValue.split(':')[0] as RailVariant
        const nextMesh = new InstancedMesh(geometryForVariant(variant), railMaterial(), nextCapacity)
        nextMesh.name = `Rail:${bucketKeyValue}`
        nextMesh.count = bucket.liveCount
        nextMesh.castShadow = true
        nextMesh.receiveShadow = true
        nextMesh.frustumCulled = false
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

    function releaseRecord(record: RailRecord): void {
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

    function writeRecord(record: RailRecord, x: number, y: number, z: number, info: RailVariantInfo): void {
        const bucket = buckets.get(record.bucketKey)
        if (!bucket) return
        tmpPos.set(x + 0.5, y, z + 0.5)
        tmpQuat.setFromAxisAngle(tmpYAxis, -info.rotation * Math.PI * 0.5)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        bucket.mesh.setMatrixAt(record.slot, tmpMatrix)
        bucket.dirty = true
    }

    function upsertRail(wx: number, wy: number, wz: number, key: string): void {
        const info = railVariantFromMask(railConnectionMask(chunks, wx, wy, wz))
        const nextBucketKey = bucketKey(info)
        let record = records.get(key)
        if (record && record.bucketKey !== nextBucketKey) {
            releaseRecord(record)
            records.delete(key)
            record = undefined
        }
        if (!record) {
            const bucket = ensureBucket(info)
            if (bucket.liveCount >= maxInstances) return
            const slot = allocateSlot(nextBucketKey, bucket, key)
            record = { key, slot, bucketKey: nextBucketKey, y: wy }
            records.set(key, record)
        }
        record.y = wy
        writeRecord(record, wx, wy, wz, info)
    }

    function syncChunk(chunk: Chunk, key: ChunkKey): void {
        const prev = snapshots.get(key)
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        const railKeys = new Set<string>()
        if (chunk.nonAirCount > 0) {
            chunk.forEachSolid((lx, ly, lz, value) => {
                if (!isRailBlock(chunks.palette, value)) return
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const railKey = `${wx},${wy},${wz}`
                railKeys.add(railKey)
                upsertRail(wx, wy, wz, railKey)
            })
        }
        if (prev) {
            for (const oldKey of prev.railKeys) {
                if (railKeys.has(oldKey)) continue
                const record = records.get(oldKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(oldKey)
            }
        }
        snapshots.set(key, { signature: chunkSignature(chunks, chunk), railKeys })
    }

    function syncRails(): void {
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
            for (const railKey of snapshot.railKeys) {
                const record = records.get(railKey)
                if (!record) continue
                releaseRecord(record)
                records.delete(railKey)
            }
            snapshots.delete(key)
        }
    }

    function applyCutVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        if (cutY === lastCutY) return
        lastCutY = cutY
        if (cutY === null) {
            for (const record of records.values()) {
                const [x, y, z] = record.key.split(',').map(Number) as [number, number, number]
                const info = railVariantInfoFromBucket(record.bucketKey)
                writeRecord(record, x, y, z, info)
            }
            return
        }
        for (const record of records.values()) {
            const [x, y, z] = record.key.split(',').map(Number) as [number, number, number]
            const info = railVariantInfoFromBucket(record.bucketKey)
            const bucket = buckets.get(record.bucketKey)
            if (!bucket) continue
            if (record.y > cutY) {
                tmpMatrix.makeScale(0, 0, 0)
                bucket.mesh.setMatrixAt(record.slot, tmpMatrix)
                bucket.dirty = true
            } else {
                writeRecord(record, x, y, z, info)
            }
        }
    }

    function flush(): void {
        for (const bucket of buckets.values()) {
            if (!bucket.dirty) continue
            bucket.mesh.instanceMatrix.needsUpdate = true
            bucket.dirty = false
        }
    }

    return {
        name: 'railRender',
        order: RenderOrder.worldRender + 2,
        init() {
            syncRails()
            applyCutVisibility()
            flush()
        },
        update() {
            syncRails()
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

function bucketKey(info: RailVariantInfo): string {
    return `${info.variant}:${info.rotation}`
}

function railVariantInfoFromBucket(key: string): RailVariantInfo {
    const [variant, rotation] = key.split(':') as [RailVariant, string]
    return { variant, rotation: Number(rotation) as 0 | 1 | 2 | 3 }
}

function chunkSignature(chunks: ChunkManager, chunk: Chunk): string {
    const versions = [
        chunk.version,
        chunks.getChunk(chunk.cx - 1, chunk.cy, chunk.cz)?.version ?? -1,
        chunks.getChunk(chunk.cx + 1, chunk.cy, chunk.cz)?.version ?? -1,
        chunks.getChunk(chunk.cx, chunk.cy, chunk.cz - 1)?.version ?? -1,
        chunks.getChunk(chunk.cx, chunk.cy, chunk.cz + 1)?.version ?? -1,
    ]
    return versions.join(':')
}

const geometryCache = new Map<RailVariant, BufferGeometry>()

function geometryForVariant(variant: RailVariant): BufferGeometry {
    let geo = geometryCache.get(variant)
    if (!geo) {
        geo = buildRailGeometry(variant)
        geometryCache.set(variant, geo)
    }
    return geo
}

function buildRailGeometry(variant: RailVariant): BufferGeometry {
    const parts: BufferGeometry[] = []
    const addNorth = variant === 'isolated' || variant === 'end' || variant === 'straight' || variant === 'corner' || variant === 't' || variant === 'cross'
    const addSouth = variant === 'straight' || variant === 't' || variant === 'cross'
    const addEast = variant === 'corner' || variant === 't' || variant === 'cross'
    const addWest = variant === 't' || variant === 'cross'

    if (addNorth) addSegment(parts, 'north')
    if (addSouth) addSegment(parts, 'south')
    if (addEast) addSegment(parts, 'east')
    if (addWest) addSegment(parts, 'west')

    if (variant === 'isolated') {
        parts.push(box(0.64, 0.06, 0.12, 0, 0.03, 0, 0.38, 0.24, 0.12))
        parts.push(box(0.06, 0.05, 0.36, -0.18, 0.09, 0, 0.55, 0.56, 0.56))
        parts.push(box(0.06, 0.05, 0.36, 0.18, 0.09, 0, 0.55, 0.56, 0.56))
    } else {
        addTie(parts, 0, 0)
        if (addNorth) addTie(parts, 0, -0.34)
        if (addSouth) addTie(parts, 0, 0.34)
        if (addEast) addTie(parts, 0.34, 0, true)
        if (addWest) addTie(parts, -0.34, 0, true)
    }

    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error(`buildRailGeometry: failed to merge ${variant}`)
    return merged
}

function addSegment(parts: BufferGeometry[], dir: 'north' | 'south' | 'east' | 'west'): void {
    const metal = [0.56, 0.57, 0.56] as const
    if (dir === 'north' || dir === 'south') {
        const z = dir === 'north' ? -0.24 : 0.24
        parts.push(box(0.055, 0.055, 0.5, -0.2, 0.095, z, ...metal))
        parts.push(box(0.055, 0.055, 0.5, 0.2, 0.095, z, ...metal))
    } else {
        const x = dir === 'east' ? 0.24 : -0.24
        parts.push(box(0.5, 0.055, 0.055, x, 0.095, -0.2, ...metal))
        parts.push(box(0.5, 0.055, 0.055, x, 0.095, 0.2, ...metal))
    }
}

function addTie(parts: BufferGeometry[], x: number, z: number, eastWest = false): void {
    if (eastWest) parts.push(box(0.12, 0.055, 0.68, x, 0.035, z, 0.36, 0.22, 0.12))
    else parts.push(box(0.68, 0.055, 0.12, x, 0.035, z, 0.36, 0.22, 0.12))
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
