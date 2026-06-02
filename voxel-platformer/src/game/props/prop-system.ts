import {
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    Vector3,
    type Scene,
} from 'three'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { RENDER_LAYER } from '../../engine/render/render-layers'
import { PROP_KINDS, type EditorProp, type EditorPropKind } from './prop-types'
import { disposePropModels, getPropModel } from './prop-models'

/**
 * Decorative-prop render system. Drives one InstancedMesh per kind
 * from a flat array of `EditorProp` records — the same array the
 * editor mutates while authoring, or the loaded level metadata at
 * gameplay time. Resync happens only when a quick fingerprint of the
 * array changes, so the per-frame cost in a settled scene is a single
 * map lookup per kind.
 *
 * Slot allocator behaviour mirrors the torch system: instances live
 * in [0, count) inside each InstancedMesh, swap-removed on
 * disappearance, `mesh.count` updated in lockstep. There is no
 * per-frame matrix churn — props don't animate, so once the matrix
 * is written for a slot it stays until the prop's transform changes
 * (rare).
 *
 * Why one InstancedMesh per kind instead of one InstancedMesh total:
 * each kind has its own merged geometry, and InstancedMesh allows only
 * one geometry. The materials are shared (see `sharedPropMaterial`
 * below) so we keep a single shader program key across kinds; the
 * draw-call count is the kind-count, not the instance-count.
 */

export interface PropRenderSystemOptions {
    /** Returns the current list of props. The system polls this each
     *  frame; the returned array is held by reference (no copy), so
     *  mutating it in place is the expected pattern from the editor. */
    getProps: () => readonly EditorProp[]
    /** Optional cap on instances per kind. Default 256. */
    maxInstancesPerKind?: number
    /** Toggle shadow casting. The editor pass uses `true` so authors
     *  see the same shading they'll get in game. */
    castShadows?: boolean
}

interface KindBucket {
    mesh: InstancedMesh
    /** Slot index → prop id, so swap-remove can patch the moved
     *  record's slotByPropId entry. */
    propIdBySlot: (string | null)[]
    liveCount: number
    capacity: number
    /** Set by writeMatrix / releaseSlot, flushed once at the end of
     *  syncFromArray so the GPU upload happens once per dirty bucket
     *  rather than once per slot touched. */
    dirty: boolean
}

/** Single MeshStandardMaterial shared across all prop kinds. Vertex
 *  colours carry the per-part tint, so one material is enough. Cached
 *  at module scope — every PropRenderSystem instance points at the
 *  same material. */
let sharedMaterial: MeshStandardMaterial | null = null
function getSharedPropMaterial(): MeshStandardMaterial {
    if (!sharedMaterial) {
        sharedMaterial = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0,
            flatShading: true,
        })
    }
    return sharedMaterial
}

export function createPropRenderSystem(scene: Scene, opts: PropRenderSystemOptions): System {
    const maxInstancesPerKind = Math.max(1, Math.floor(opts.maxInstancesPerKind ?? 256))
    const castShadows = opts.castShadows !== false
    const material = getSharedPropMaterial()

    // Per-kind state. Allocated lazily on the first prop of each kind
    // so a level with only flowers doesn't pay for chair / book
    // InstancedMeshes.
    const buckets = new Map<EditorPropKind, KindBucket>()
    /** Reverse lookup: prop id → its kind + slot. Lets us locate an
     *  existing record in O(1) during fingerprint resync. */
    const slotByPropId = new Map<string, { kind: EditorPropKind; slot: number }>()

    // Numeric fingerprint (FNV-1a-ish) — comparing a single int is
    // cheaper than the previous string-join with per-prop toFixed
    // allocations. -1 is the sentinel for "not yet computed", which
    // can never collide with the unsigned hash domain.
    let lastFingerprint = -1
    const tmpMatrix = new Matrix4()
    const tmpPos = new Vector3()
    const tmpQuat = new Quaternion()
    const tmpScale = new Vector3()
    const tmpYAxis = new Vector3(0, 1, 0)

    function createMesh(kind: EditorPropKind, capacity: number): InstancedMesh {
        const model = getPropModel(kind)
        const mesh = new InstancedMesh(model.geometry, material, capacity)
        mesh.name = `Props:${kind}`
        // InstancedMesh culling uses a mesh-level bounding sphere, not
        // per-instance culling. We recompute that sphere after matrix uploads,
        // which lets clustered props disappear when offscreen while keeping the
        // one-draw-call-per-kind batching model.
        mesh.frustumCulled = true
        mesh.castShadow = castShadows
        mesh.receiveShadow = true
        mesh.count = 0
        mesh.layers.enable(RENDER_LAYER.PLAYER)
        return mesh
    }

    function ensureBucket(kind: EditorPropKind): KindBucket {
        let bucket = buckets.get(kind)
        if (bucket) return bucket
        const mesh = createMesh(kind, maxInstancesPerKind)
        scene.add(mesh)
        bucket = {
            mesh,
            propIdBySlot: new Array(maxInstancesPerKind).fill(null),
            liveCount: 0,
            capacity: maxInstancesPerKind,
            dirty: false,
        }
        buckets.set(kind, bucket)
        return bucket
    }

    function writeMatrix(bucket: KindBucket, slot: number, prop: EditorProp): void {
        tmpPos.set(prop.position.x, prop.position.y, prop.position.z)
        tmpQuat.setFromAxisAngle(tmpYAxis, prop.yaw)
        const s = Math.max(0.0001, prop.scale)
        tmpScale.setScalar(s)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        bucket.mesh.setMatrixAt(slot, tmpMatrix)
        bucket.dirty = true
    }

    function allocateSlot(kind: EditorPropKind, bucket: KindBucket, propId: string): number {
        if (bucket.liveCount >= bucket.capacity) growBucket(kind, bucket, bucket.liveCount + 1)
        const slot = bucket.liveCount
        bucket.liveCount++
        bucket.mesh.count = bucket.liveCount
        bucket.propIdBySlot[slot] = propId
        return slot
    }

    function growBucket(kind: EditorPropKind, bucket: KindBucket, minCapacity: number): void {
        let nextCapacity = Math.max(1, bucket.capacity)
        while (nextCapacity < minCapacity) nextCapacity *= 2
        const nextMesh = createMesh(kind, nextCapacity)
        nextMesh.count = bucket.liveCount
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
        bucket.propIdBySlot.length = nextCapacity
        for (let i = bucket.liveCount; i < nextCapacity; i++) bucket.propIdBySlot[i] = null
    }

    function releaseSlot(bucket: KindBucket, slot: number): void {
        const lastSlot = bucket.liveCount - 1
        if (slot !== lastSlot) {
            // Swap last → freed. Copy matrix, repoint the swapped
            // prop's slotByPropId entry so future lookups land on the
            // new slot.
            const movedId = bucket.propIdBySlot[lastSlot]!
            bucket.mesh.getMatrixAt(lastSlot, tmpMatrix)
            bucket.mesh.setMatrixAt(slot, tmpMatrix)
            bucket.propIdBySlot[slot] = movedId
            const lookup = slotByPropId.get(movedId)
            if (lookup) lookup.slot = slot
        }
        bucket.propIdBySlot[lastSlot] = null
        bucket.liveCount--
        bucket.mesh.count = bucket.liveCount
        bucket.dirty = true
    }

    function syncFromArray(): void {
        const props = opts.getProps()
        const fp = fingerprint(props)
        if (fp === lastFingerprint) return
        lastFingerprint = fp

        // 1. Mark every existing prop unseen, then walk the array to
        //    re-mark / add / mutate.
        const seen = new Set<string>()
        for (const prop of props) {
            // Skip props whose kind isn't in the registry — saved
            // levels may reference removed kinds during dev.
            if (!isKnownKind(prop.kind)) continue
            if (prop.visible === false) continue
            seen.add(prop.id)
            const existing = slotByPropId.get(prop.id)
            if (existing) {
                if (existing.kind !== prop.kind) {
                    // Kind changed (editor allowed swap). Re-allocate
                    // in the new bucket and free the old slot.
                    const oldBucket = buckets.get(existing.kind)
                    if (oldBucket) releaseSlot(oldBucket, existing.slot)
                    slotByPropId.delete(prop.id)
                    addProp(prop)
                } else {
                    // Same kind — just refresh the matrix in case yaw
                    // / scale / position changed.
                    const bucket = buckets.get(existing.kind)!
                    writeMatrix(bucket, existing.slot, prop)
                }
            } else {
                addProp(prop)
            }
        }

        // 2. Drop anything in slotByPropId that isn't in the array.
        for (const [propId, info] of slotByPropId) {
            if (seen.has(propId)) continue
            const bucket = buckets.get(info.kind)
            if (bucket) releaseSlot(bucket, info.slot)
            slotByPropId.delete(propId)
        }

        // 3. Flush every bucket the resync touched. The boolean flag is
        //    set by writeMatrix / releaseSlot; here we hand the GPU a
        //    single upload per dirty bucket instead of one per slot.
        for (const bucket of buckets.values()) {
            if (!bucket.dirty) continue
            bucket.mesh.instanceMatrix.needsUpdate = true
            bucket.mesh.computeBoundingSphere()
            bucket.dirty = false
        }
    }

    function addProp(prop: EditorProp): void {
        const bucket = ensureBucket(prop.kind)
        const slot = allocateSlot(prop.kind, bucket, prop.id)
        writeMatrix(bucket, slot, prop)
        slotByPropId.set(prop.id, { kind: prop.kind, slot })
    }

    return {
        name: 'propRender',
        order: RenderOrder.worldRender + 3,
        init() {
            syncFromArray()
        },
        update() {
            syncFromArray()
        },
        dispose() {
            for (const bucket of buckets.values()) {
                scene.remove(bucket.mesh)
                bucket.mesh.dispose()
            }
            buckets.clear()
            slotByPropId.clear()
            // The cached geometries + shared material outlive any
            // single system instance — multiple PropRenderSystems
            // (editor + game) share them within one page load — so
            // we don't dispose them here. Tests can call
            // `disposePropModels()` directly when they need to.
        },
    }
}

/** Module-scope teardown for tests. Doesn't affect any running render
 *  system; clears the geometry cache so the next call to
 *  `createPropRenderSystem` rebuilds. */
export function __resetPropModelCache(): void {
    disposePropModels()
    if (sharedMaterial) {
        sharedMaterial.dispose()
        sharedMaterial = null
    }
}

function isKnownKind(kind: string): kind is EditorPropKind {
    return (PROP_KINDS as readonly string[]).includes(kind)
}

// Float→bit-pattern conversion buffer for hashing. Allocated once at
// module scope; each `floatBits` call mutates the typed array view but
// returns a plain number, so there's no per-frame allocation.
const __fpFloatBuf = new Float32Array(1)
const __fpIntBuf = new Int32Array(__fpFloatBuf.buffer)
function floatBits(x: number): number {
    __fpFloatBuf[0] = x
    return __fpIntBuf[0]
}

function mixInt(h: number, v: number): number {
    return Math.imul(h ^ (v | 0), 16777619)
}

function mixString(h: number, s: string): number {
    let acc = h
    for (let i = 0; i < s.length; i++) {
        acc = Math.imul(acc ^ s.charCodeAt(i), 16777619)
    }
    return acc
}

/** Cheap O(n) FNV-1a-style hash of the props array. Returns a 32-bit
 *  unsigned int so the cached `lastFingerprint` can be compared with a
 *  single `===`. The previous string-join allocated N+1 strings every
 *  frame; this version touches no GC. The `gridAligned` field is
 *  authoring metadata and doesn't affect the matrix, so it's excluded
 *  from the hash. */
function fingerprint(props: readonly EditorProp[]): number {
    let h = (0x811c9dc5 ^ props.length) | 0
    for (let i = 0; i < props.length; i++) {
        const p = props[i]!
        h = mixString(h, p.id)
        h = mixString(h, p.kind)
        h = mixInt(h, floatBits(p.position.x))
        h = mixInt(h, floatBits(p.position.y))
        h = mixInt(h, floatBits(p.position.z))
        h = mixInt(h, floatBits(p.yaw))
        h = mixInt(h, floatBits(p.scale))
        h = mixInt(h, p.visible === false ? 0 : 1)
    }
    return h >>> 0
}
