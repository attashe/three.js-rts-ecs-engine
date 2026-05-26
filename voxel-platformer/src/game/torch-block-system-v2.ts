import {
    Color,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    PointLight,
    Quaternion,
    Vector3,
    AdditiveBlending,
    type Camera,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import type { AudioEngine, SoundHandle, Vec3Like } from '../engine/audio'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import { PlayerControlled, Position } from '../engine/ecs/components'
import { CHUNK_DIM, chunkKey, type ChunkKey } from '../engine/voxel/chunk'
import { RENDER_LAYER } from '../engine/render/render-layers'
import type { Chunk } from '../engine/voxel/chunk'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { isCollidable, isTorchBlock, occludesFaces } from '../engine/voxel/palette'
import { sharedCylinderGeometry, sharedMaterial, sharedSphereGeometry } from './assets/shared-primitives'

/**
 * Torches 2.0 — InstancedMesh-based render with shadow-casting pool
 * lights. Compared to `torch-block-system.ts`:
 *
 * - **Draw calls.** Four InstancedMeshes (handle / head / outer flame
 *   / inner flame) for the entire scene. v1 spawned one Group with
 *   four meshes per torch, so a level with 30 visible torches paid
 *   120 draw calls in v1 vs 4 in v2.
 *
 * - **Geometry.** Lower-poly than v1 (6-segment handle, 8-segment
 *   head, 8×6-segment flame, 6×4-segment core). At iso scale the
 *   difference isn't perceivable.
 *
 * - **Shadows.** Pool lights enable `castShadow`; each gets a small
 *   cube shadow map (256×256) bounded by the light's `distance` so
 *   the shadow render touches only the immediate neighbourhood.
 *   Handle + head InstancedMeshes opt into castShadow too so torch
 *   geometry blocks the sun's shadow ray.
 *
 * Architectural shape mirrors v1 — same `createTorchBlockRenderSystem`
 * signature, same per-chunk version tracking, same focus-driven
 * pool selection, same audio handling. Logic was copy-pasted (not
 * extracted into a shared module) deliberately: until v2 is
 * validated, we want v1 to stay byte-identical to its committed form.
 */

export type TorchMountKind = 'wall' | 'standing' | 'floating'

export interface TorchMount {
    kind: TorchMountKind
    normalX: number
    normalZ: number
}

export interface TorchBlockRenderV2Options {
    cutY?: () => number | null
    focus?: () => Vec3Like | null
    focusRadius?: number
    lightsEnabled?: boolean
    maxLights?: number
    audio?: AudioEngine
    audioReady?: Promise<unknown>
    soundId?: string
    soundVolume?: number
    soundRadius?: number
    maxSoundSources?: number
    /** Cap on simultaneously-rendered torches. Default 256 — beyond
     *  this the system silently drops extras. */
    maxInstances?: number
    /** Cube shadow-map size for the shadow-casting pool slot(s).
     *  Default 256 — small enough that one shadow light costs ~3 MB
     *  and 6 face renders per frame. */
    shadowMapSize?: number
    /** How many pool slots cast shadows. Default 1 — only the
     *  *nearest* torch casts. Each shadow light adds 6 extra cube
     *  shadow-map renders per frame plus the chunk scan in each
     *  face's projection, so this number multiplies the shadow cost
     *  linearly. Set to 0 for "no shadow casting" (same as
     *  classic v1 lights, but still benefits from the v2 draw-call
     *  reduction). */
    maxShadows?: number
}

interface TorchRecord {
    /** Index into the four InstancedMeshes. Invalid (≥ live count)
     *  while the torch is in the free list. */
    slot: number
    signature: string
    y: number
    /** Cached centre — drives the focus distance test. */
    posX: number
    posY: number
    posZ: number
    /** Base rotation quaternion (no flicker scale). Composed with the
     *  per-frame scale to produce flame matrices. */
    baseQuat: Quaternion
    /** Base translation. */
    basePos: Vector3
    /** Per-torch flicker phase so neighbouring torches don't sync. */
    flickerPhase: number
    /** Working scratch — squared distance to focus this frame. */
    d2: number
    sound: SoundHandle | null
    soundX: number
    soundY: number
    soundZ: number
}

interface ChunkSnapshot {
    version: number
    torchKeys: Set<string>
}

interface LightPoolSlot {
    light: PointLight
    phase: number
    baseIntensity: number
    baseDistance: number
}

const WALL_LEAN_RADIANS = 0.58
const WALL_STANDOFF = 0.13
const DEFAULT_TORCH_LIGHTS = 3
const DEFAULT_FOCUS_RADIUS = 28
const DEFAULT_TORCH_SOUND_RADIUS = 5
const DEFAULT_TORCH_SOUND_SOURCES = 3
const DEFAULT_MAX_INSTANCES = 256
const DEFAULT_SHADOW_MAP_SIZE = 256
const PARK_X = 1e6
const PARK_Y = -1e6
const PARK_Z = 1e6

/** Light position offset from the torch's base position. Mirrors the
 *  flame Y in the original v1 visual. */
const LIGHT_LOCAL_OFFSET = new Vector3(0, 0.66, 0.02)

const WALL_DIRECTIONS = [
    { dx: -1, dz: 0, normalX: 1, normalZ: 0 },
    { dx: 1, dz: 0, normalX: -1, normalZ: 0 },
    { dx: 0, dz: -1, normalX: 0, normalZ: 1 },
    { dx: 0, dz: 1, normalX: 0, normalZ: -1 },
] as const

// Part-local offsets within the torch's base coordinate frame. Apply
// the torch's base transform on top of these to land the part in
// world space.
const HANDLE_LOCAL_Y = 0.22
const HEAD_LOCAL_Y = 0.54
const FLAME_LOCAL_Y = 0.74
const CORE_LOCAL_Y = 0.7
const FLAME_BASE_SCALE = new Vector3(0.74, 1.75, 0.74)
const CORE_BASE_SCALE = new Vector3(0.72, 1.28, 0.72)
// Torches 2.0 keeps the visual ~96 % the size of v1, matching the
// hand-tuned `root.scale.setScalar(0.96)` from createBlockTorch.
const TORCH_SCALE = 0.96

// Shared flame materials (module-level so all instances render with
// the same shader/program key).
let outerFlameMat: MeshBasicMaterial | null = null
let innerFlameMat: MeshBasicMaterial | null = null
function getOuterFlameMaterial(): MeshBasicMaterial {
    if (!outerFlameMat) {
        outerFlameMat = new MeshBasicMaterial({
            color: 0xff7a24,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
        })
        outerFlameMat.blending = AdditiveBlending
        outerFlameMat.toneMapped = false
    }
    return outerFlameMat
}
function getInnerFlameMaterial(): MeshBasicMaterial {
    if (!innerFlameMat) {
        innerFlameMat = new MeshBasicMaterial({
            color: 0xffe083,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
        })
        innerFlameMat.blending = AdditiveBlending
        innerFlameMat.toneMapped = false
    }
    return innerFlameMat
}

export function createTorchBlockRenderSystemV2(
    scene: Scene,
    chunks: ChunkManager,
    opts: TorchBlockRenderV2Options = {},
): System {
    const records = new Map<string, TorchRecord>()
    const chunkSnapshots = new Map<ChunkKey, ChunkSnapshot>()
    let paletteSignature = palettePropSignature(chunks)
    const maxInstances = Math.max(1, Math.floor(opts.maxInstances ?? DEFAULT_MAX_INSTANCES))
    const lightsEnabled = opts.lightsEnabled !== false
    const poolSize = lightsEnabled ? Math.max(0, Math.floor(opts.maxLights ?? DEFAULT_TORCH_LIGHTS)) : 0
    const focusRadius = Math.max(1, opts.focusRadius ?? DEFAULT_FOCUS_RADIUS)
    const focusRadius2 = focusRadius * focusRadius
    const shadowMapSize = Math.max(64, Math.floor(opts.shadowMapSize ?? DEFAULT_SHADOW_MAP_SIZE))
    // Default cap is 0 — no block-torch shadow casting. The whole
    // point of v2-as-merged-system is: keep v1's "fast unshadowed
    // pool" lighting for block torches, get v2's instanced-draw-call
    // savings for the geometry, and let *only* the player-held torch
    // cast direct shadows (configured separately in
    // `assets/torch.ts`). Each shadow-casting block-torch light
    // multiplies the frame's cube shadow-map renders, which on
    // mid-range GPUs already eats the perf budget the v2 mesh
    // architecture would otherwise return.
    const maxShadows = Math.max(0, Math.min(poolSize, Math.floor(opts.maxShadows ?? 0)))

    // ── Geometry. Lower-poly than v1; the iso camera + tone mapping
    //    hide the segment reduction. Shared via the existing primitives
    //    cache so reloading the system reuses GPU buffers.
    const handleGeo = sharedCylinderGeometry(0.025, 0.034, 0.58, 6)
    const headGeo = sharedCylinderGeometry(0.07, 0.06, 0.13, 8)
    const flameGeo = sharedSphereGeometry(0.1, 8, 6)
    const coreGeo = sharedSphereGeometry(0.065, 6, 4)

    // ── InstancedMeshes. Pre-allocated with `maxInstances` slots; we
    //    grow `count` as torches are registered and swap-remove on
    //    teardown so the visible range stays packed.
    const handleMesh = new InstancedMesh(handleGeo, sharedMaterial(0x4a2715, 0.86), maxInstances)
    const headMesh = new InstancedMesh(headGeo, sharedMaterial(0x1c1510, 0.78), maxInstances)
    const flameMesh = new InstancedMesh(flameGeo, getOuterFlameMaterial(), maxInstances)
    const coreMesh = new InstancedMesh(coreGeo, getInnerFlameMaterial(), maxInstances)

    handleMesh.castShadow = true
    headMesh.castShadow = true
    handleMesh.receiveShadow = true
    headMesh.receiveShadow = true
    flameMesh.castShadow = false
    coreMesh.castShadow = false
    // Transparent flame meshes render after opaque parts.
    flameMesh.renderOrder = 1
    coreMesh.renderOrder = 2
    // Frustum culling for an InstancedMesh uses the GEOMETRY's
    // bounding sphere (a small region around origin for our part
    // geometries), not the per-instance positions. Since each
    // InstancedMesh holds torches spread across the world, three.js
    // would cull the whole mesh whenever the camera looked away from
    // the origin — which is the visible-models bug we hit on the
    // first v2 run. Per-instance positions live in the matrices, so
    // disable frustum culling at the mesh level and let the renderer
    // walk the instance list directly.
    handleMesh.frustumCulled = false
    headMesh.frustumCulled = false
    flameMesh.frustumCulled = false
    coreMesh.frustumCulled = false

    handleMesh.count = 0
    headMesh.count = 0
    flameMesh.count = 0
    coreMesh.count = 0

    scene.add(handleMesh, headMesh, flameMesh, coreMesh)

    // ── Pool lights. The first `maxShadows` slots cast cube shadows;
    //    the rest are cheap fills. Sorting by distance later means
    //    the shadow slot(s) automatically land on the nearest
    //    torch(es), where shadows are most visible — distant
    //    torches don't need them.
    //
    //    castShadow is fixed at construction (not toggled per frame):
    //    flipping it forces three.js to recompile the shaders that
    //    sample the light's shadow map, which would defeat the
    //    "scene state stable from frame 0" property the pool design
    //    relies on.
    const lightPool: LightPoolSlot[] = []
    let lightsParked = false
    for (let i = 0; i < poolSize; i++) {
        const light = new PointLight(new Color(0xffa85a), 4.8, 9, 1.35)
        light.name = `TorchV2PoolLight${i}`
        const castsShadow = i < maxShadows
        light.castShadow = castsShadow
        if (castsShadow) {
            light.shadow.mapSize.set(shadowMapSize, shadowMapSize)
            light.shadow.camera.near = 0.1
            light.shadow.camera.far = 9
            light.shadow.bias = -0.001
            light.shadow.normalBias = 0.04
            light.shadow.camera.updateProjectionMatrix()
        }
        light.visible = true
        light.position.set(PARK_X, PARK_Y, PARK_Z)
        light.intensity = 0
        // Illuminate the player rig (PLAYER layer) too — without
        // this the player walks past block torches in pitch black.
        light.layers.enable(RENDER_LAYER.PLAYER)
        scene.add(light)
        lightPool.push({
            light,
            phase: Math.random() * Math.PI * 2,
            baseIntensity: 4.8,
            baseDistance: 9,
        })
    }

    // ── Slot allocation. `keyBySlot` is the reverse map so swap-remove
    //    can patch the swapped torch's record without scanning the
    //    full records map.
    const keyBySlot: (string | null)[] = new Array(maxInstances).fill(null)
    let liveCount = 0

    // Working scratch — never reallocated per frame.
    const activeRecords: TorchRecord[] = []
    const tmpFocus = { x: 0, y: 0, z: 0 }
    const tmpMatrix = new Matrix4()
    const tmpScale = new Vector3()
    const tmpVec = new Vector3()
    const tmpColor = new Color()

    let soundReady = !opts.audioReady
    let soundDisabled = false
    let elapsed = 0
    let lastCutY: number | null | undefined

    if (opts.audioReady) {
        void opts.audioReady.then(() => {
            soundReady = true
        }).catch((err) => {
            soundDisabled = true
            console.warn('Torch sounds skipped because audio failed to initialise:', err)
        })
    }

    function allocateSlot(): number {
        if (liveCount >= maxInstances) return -1
        const slot = liveCount
        liveCount++
        // CRITICAL: keep mesh.count in sync with liveCount. Three.js
        // draws `count` instances regardless of how many matrices have
        // been written, so missing this assignment makes every torch
        // invisible — the original v2 bug. Bumping it here is cheap;
        // the actual matrices get written by the caller in
        // setMountTransform immediately after.
        handleMesh.count = liveCount
        headMesh.count = liveCount
        flameMesh.count = liveCount
        coreMesh.count = liveCount
        return slot
    }

    function releaseSlot(slot: number): void {
        const lastSlot = liveCount - 1
        if (slot !== lastSlot) {
            // Swap last → this. Copy matrices in every InstancedMesh
            // so the layout stays packed [0, liveCount). Patch the
            // record that owned the last slot to point at its new
            // location.
            const movedKey = keyBySlot[lastSlot]!
            handleMesh.getMatrixAt(lastSlot, tmpMatrix)
            handleMesh.setMatrixAt(slot, tmpMatrix)
            headMesh.getMatrixAt(lastSlot, tmpMatrix)
            headMesh.setMatrixAt(slot, tmpMatrix)
            flameMesh.getMatrixAt(lastSlot, tmpMatrix)
            flameMesh.setMatrixAt(slot, tmpMatrix)
            coreMesh.getMatrixAt(lastSlot, tmpMatrix)
            coreMesh.setMatrixAt(slot, tmpMatrix)
            keyBySlot[slot] = movedKey
            const movedRecord = records.get(movedKey)
            if (movedRecord) movedRecord.slot = slot
        }
        keyBySlot[lastSlot] = null
        liveCount--
        handleMesh.count = liveCount
        headMesh.count = liveCount
        flameMesh.count = liveCount
        coreMesh.count = liveCount
        markAllInstanceBuffersDirty()
    }

    function markAllInstanceBuffersDirty(): void {
        handleMesh.instanceMatrix.needsUpdate = true
        headMesh.instanceMatrix.needsUpdate = true
        flameMesh.instanceMatrix.needsUpdate = true
        coreMesh.instanceMatrix.needsUpdate = true
    }

    function writeStaticParts(record: TorchRecord): void {
        // Handle, head — pure base * local-translation. No animation,
        // so we set them once when the torch is created / mount
        // changes, and forget.
        composeWithLocalY(record, HANDLE_LOCAL_Y, 1, tmpMatrix)
        handleMesh.setMatrixAt(record.slot, tmpMatrix)
        composeWithLocalY(record, HEAD_LOCAL_Y, 1, tmpMatrix)
        headMesh.setMatrixAt(record.slot, tmpMatrix)
    }

    function composeWithLocalY(
        record: TorchRecord,
        localY: number,
        scale: number,
        out: Matrix4,
    ): void {
        // Local position: (0, localY, 0) in torch frame.
        tmpVec.set(0, localY, 0)
        // Apply torch's base rotation to the local offset.
        tmpVec.applyQuaternion(record.baseQuat)
        tmpVec.add(record.basePos)
        tmpScale.setScalar(scale * TORCH_SCALE)
        out.compose(tmpVec, record.baseQuat, tmpScale)
    }

    function composeFlame(
        record: TorchRecord,
        localY: number,
        baseScale: Vector3,
        xzMul: number,
        yMul: number,
        out: Matrix4,
    ): void {
        tmpVec.set(0, localY, 0)
        tmpVec.applyQuaternion(record.baseQuat)
        tmpVec.add(record.basePos)
        tmpScale.set(
            baseScale.x * xzMul * TORCH_SCALE,
            baseScale.y * yMul * TORCH_SCALE,
            baseScale.z * xzMul * TORCH_SCALE,
        )
        out.compose(tmpVec, record.baseQuat, tmpScale)
    }

    function setMountTransform(record: TorchRecord, x: number, y: number, z: number, mount: TorchMount): void {
        // Mirror v1's applyTorchTransform — base position + Euler
        // rotation. Convert the Euler rotation to a quaternion so we
        // can compose per-part matrices later.
        if (mount.kind === 'wall') {
            const faceX = mount.normalX > 0 ? x : mount.normalX < 0 ? x + 1 : x + 0.5
            const faceZ = mount.normalZ > 0 ? z : mount.normalZ < 0 ? z + 1 : z + 0.5
            record.basePos.set(
                faceX + mount.normalX * WALL_STANDOFF,
                y + 0.24,
                faceZ + mount.normalZ * WALL_STANDOFF,
            )
            // Euler (rotationX, rotationY, rotationZ) -> quaternion.
            // v1 set rotation.z = -normalX * lean, rotation.x = normalZ * lean.
            // Order doesn't matter here since either x or z is zero.
            const rx = mount.normalZ * WALL_LEAN_RADIANS
            const rz = -mount.normalX * WALL_LEAN_RADIANS
            setEulerQuat(record.baseQuat, rx, 0, rz)
        } else {
            record.basePos.set(x + 0.5, y + (mount.kind === 'standing' ? 0.08 : 0.24), z + 0.5)
            record.baseQuat.identity()
        }
        record.posX = record.basePos.x
        record.posY = record.basePos.y + LIGHT_LOCAL_OFFSET.y
        record.posZ = record.basePos.z + LIGHT_LOCAL_OFFSET.z
        record.soundX = record.basePos.x
        record.soundY = record.basePos.y + 0.56
        record.soundZ = record.basePos.z
        writeStaticParts(record)
        // Initial flame matrices so newly-spawned torches render even
        // before they enter the focus radius (sub-pixel size but
        // visible from afar).
        composeFlame(record, FLAME_LOCAL_Y, FLAME_BASE_SCALE, 1, 1, tmpMatrix)
        flameMesh.setMatrixAt(record.slot, tmpMatrix)
        composeFlame(record, CORE_LOCAL_Y, CORE_BASE_SCALE, 1, 1, tmpMatrix)
        coreMesh.setMatrixAt(record.slot, tmpMatrix)
        markAllInstanceBuffersDirty()
        record.sound?.setPosition(soundPosition(record))
    }

    function syncChunk(chunk: Chunk, key: ChunkKey): void {
        const prev = chunkSnapshots.get(key)
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        const newKeys = new Set<string>()
        if (chunk.nonAirCount > 0) {
            chunk.forEachSolid((lx, ly, lz, value) => {
                if (!isTorchBlock(chunks.palette, value)) return
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const torchKey = `${wx},${wy},${wz}`
                newKeys.add(torchKey)

                const mount = resolveTorchMount(chunks, wx, wy, wz)
                const signature = mountSignature(mount)
                let record = records.get(torchKey)
                if (!record) {
                    const slot = allocateSlot()
                    if (slot < 0) return // pool exhausted; silently drop
                    record = {
                        slot,
                        signature: '',
                        y: wy,
                        posX: 0,
                        posY: 0,
                        posZ: 0,
                        baseQuat: new Quaternion(),
                        basePos: new Vector3(),
                        flickerPhase: Math.random() * Math.PI * 2,
                        d2: Infinity,
                        sound: null,
                        soundX: 0,
                        soundY: 0,
                        soundZ: 0,
                    }
                    records.set(torchKey, record)
                    keyBySlot[slot] = torchKey
                }
                record.y = wy
                if (record.signature !== signature) {
                    setMountTransform(record, wx, wy, wz, mount)
                    record.signature = signature
                }
            })
        }

        if (prev) {
            for (const oldKey of prev.torchKeys) {
                if (newKeys.has(oldKey)) continue
                const record = records.get(oldKey)
                if (!record) continue
                stopTorchSound(record, 0.2)
                releaseSlot(record.slot)
                records.delete(oldKey)
            }
        }
        chunkSnapshots.set(key, { version: chunk.version, torchKeys: newKeys })
    }

    function syncTorches(): void {
        const palSig = palettePropSignature(chunks)
        if (palSig !== paletteSignature) {
            paletteSignature = palSig
            for (const snapshot of chunkSnapshots.values()) snapshot.version = -1
        }
        const seenChunks = new Set<ChunkKey>()
        for (const chunk of chunks.allChunks()) {
            const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)
            seenChunks.add(key)
            const snapshot = chunkSnapshots.get(key)
            if (snapshot && snapshot.version === chunk.version) continue
            syncChunk(chunk, key)
        }
        for (const key of chunkSnapshots.keys()) {
            if (seenChunks.has(key)) continue
            const snapshot = chunkSnapshots.get(key)!
            for (const torchKey of snapshot.torchKeys) {
                const record = records.get(torchKey)
                if (!record) continue
                stopTorchSound(record, 0.2)
                releaseSlot(record.slot)
                records.delete(torchKey)
            }
            chunkSnapshots.delete(key)
        }
    }

    function applyVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        if (cutY === lastCutY) return
        lastCutY = cutY
        // For v2 we collapse visibility to the InstancedMesh.visible
        // flag at the mesh level since per-instance visibility
        // requires `setInstanceMatrix` with a zero-scale matrix for
        // each hidden slot — overkill for the editor's coarse-grained
        // cutY toggle which usually flips all-or-nothing.
        const anyHidden = cutY !== null
        if (!anyHidden) {
            handleMesh.visible = true
            headMesh.visible = true
            flameMesh.visible = true
            coreMesh.visible = true
            return
        }
        // Editor mode with cutY set — fall back to per-instance
        // hide via zero-scale matrices for torches above the cut.
        for (const record of records.values()) {
            const hidden = record.y > cutY
            const scale = hidden ? 0 : 1
            composeWithLocalY(record, HANDLE_LOCAL_Y, scale, tmpMatrix)
            handleMesh.setMatrixAt(record.slot, tmpMatrix)
            composeWithLocalY(record, HEAD_LOCAL_Y, scale, tmpMatrix)
            headMesh.setMatrixAt(record.slot, tmpMatrix)
            composeFlame(record, FLAME_LOCAL_Y, FLAME_BASE_SCALE, scale, scale, tmpMatrix)
            flameMesh.setMatrixAt(record.slot, tmpMatrix)
            composeFlame(record, CORE_LOCAL_Y, CORE_BASE_SCALE, scale, scale, tmpMatrix)
            coreMesh.setMatrixAt(record.slot, tmpMatrix)
        }
        markAllInstanceBuffersDirty()
    }

    function resolveFocus(world: Parameters<System['update']>[0]): Vec3Like | null {
        const provided = opts.focus?.()
        if (provided) {
            tmpFocus.x = provided.x
            tmpFocus.y = provided.y
            tmpFocus.z = provided.z
            return tmpFocus
        }
        const players = query(world, [Position, PlayerControlled])
        const pid = players[0]
        if (pid === undefined) return null
        tmpFocus.x = Position.x[pid]!
        tmpFocus.y = Position.y[pid]!
        tmpFocus.z = Position.z[pid]!
        return tmpFocus
    }

    function classifyAndAnimate(focus: Vec3Like | null): void {
        activeRecords.length = 0
        if (!focus) return
        for (const record of records.values()) {
            const dx = record.posX - focus.x
            const dy = record.posY - focus.y
            const dz = record.posZ - focus.z
            const d2 = dx * dx + dy * dy + dz * dz
            record.d2 = d2
            if (d2 > focusRadius2) continue
            activeRecords.push(record)

            const pulse = flicker(elapsed, record.flickerPhase)
            const flameY = 0.9 + pulse * 0.22
            const flameXZ = 0.92 + (1 - pulse) * 0.1
            composeFlame(record, FLAME_LOCAL_Y, FLAME_BASE_SCALE, flameXZ, flameY, tmpMatrix)
            flameMesh.setMatrixAt(record.slot, tmpMatrix)
            composeFlame(record, CORE_LOCAL_Y, CORE_BASE_SCALE, flameXZ, flameY, tmpMatrix)
            coreMesh.setMatrixAt(record.slot, tmpMatrix)
        }
        if (activeRecords.length > 0) {
            flameMesh.instanceMatrix.needsUpdate = true
            coreMesh.instanceMatrix.needsUpdate = true
        }
    }

    function assignLightPool(): void {
        if (poolSize === 0) return
        if (activeRecords.length === 0) {
            parkAllLights()
            return
        }
        lightsParked = false
        activeRecords.sort(compareByDistance)
        const lit = Math.min(poolSize, activeRecords.length)
        for (let i = 0; i < lit; i++) {
            const record = activeRecords[i]!
            const slot = lightPool[i]!
            const pulse = flicker(elapsed, slot.phase)
            slot.light.position.set(record.posX, record.posY, record.posZ)
            slot.light.intensity = slot.baseIntensity * (0.84 + pulse * 0.32)
            slot.light.distance = slot.baseDistance * (0.95 + pulse * 0.12)
            slot.light.shadow.camera.far = slot.light.distance
            slot.light.shadow.camera.updateProjectionMatrix()
            tmpColor.setHSL(0.078 + pulse * 0.014, 1, 0.58 + pulse * 0.12)
            slot.light.color.copy(tmpColor)
        }
        for (let i = lit; i < lightPool.length; i++) {
            const slot = lightPool[i]!
            slot.light.intensity = 0
            slot.light.position.set(PARK_X, PARK_Y, PARK_Z)
        }
    }

    function parkAllLights(): void {
        if (lightsParked) return
        for (const slot of lightPool) {
            slot.light.intensity = 0
            slot.light.position.set(PARK_X, PARK_Y, PARK_Z)
        }
        lightsParked = true
    }

    return {
        name: 'torchBlocksV2',
        order: RenderOrder.worldRender + 2,
        init() {
            syncTorches()
            lastCutY = undefined
            applyVisibility()
        },
        update(world, dt) {
            elapsed += dt
            syncTorches()
            applyVisibility()
            const focus = resolveFocus(world)
            classifyAndAnimate(focus)
            assignLightPool()
            syncTorchSounds(world)
        },
        dispose() {
            for (const record of records.values()) {
                stopTorchSound(record, 0.15)
            }
            records.clear()
            chunkSnapshots.clear()
            for (const slot of lightPool) {
                slot.light.removeFromParent()
                slot.light.dispose()
            }
            lightPool.length = 0
            scene.remove(handleMesh, headMesh, flameMesh, coreMesh)
            handleMesh.dispose()
            headMesh.dispose()
            flameMesh.dispose()
            coreMesh.dispose()
        },
    }

    function syncTorchSounds(world: Parameters<System['update']>[0]): void {
        const audio = opts.audio
        const soundId = opts.soundId
        if (!audio || !soundId || soundDisabled) return
        if (!soundReady) return
        const listener = playerListenerPosition(world)
        if (!listener) {
            stopAllTorchSounds(0.25)
            return
        }
        const radius = Math.max(0.1, opts.soundRadius ?? DEFAULT_TORCH_SOUND_RADIUS)
        const maxSources = Math.max(0, Math.floor(opts.maxSoundSources ?? DEFAULT_TORCH_SOUND_SOURCES))
        const selected = pickNearestSoundKeys(records, listener, radius, maxSources)

        for (const [key, record] of records) {
            const shouldPlay = selected.has(key)
            if (!shouldPlay) {
                stopTorchSound(record, 0.35)
                continue
            }
            if (record.sound?.stopped) record.sound = null
            if (record.sound) {
                record.sound.setPosition(soundPosition(record))
                continue
            }
            try {
                record.sound = audio.playSpatial(soundId, soundPosition(record), {
                    deferUntilUnlocked: true,
                    loop: true,
                    volume: opts.soundVolume ?? 0.18,
                    fadeIn: 0.35,
                    fadeOut: 0.35,
                    refDistance: 0.85,
                    maxDistance: radius,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    maxInstances: Math.max(1, maxSources),
                    priority: 1,
                })
            } catch (err) {
                console.warn(`Torch sound "${soundId}" failed to start:`, err)
                soundDisabled = true
                stopAllTorchSounds(0.1)
                break
            }
        }
    }

    function stopAllTorchSounds(fadeOut: number): void {
        for (const record of records.values()) stopTorchSound(record, fadeOut)
    }
}

function compareByDistance(a: TorchRecord, b: TorchRecord): number {
    return a.d2 - b.d2
}

function pickNearestSoundKeys(
    records: Map<string, TorchRecord>,
    listener: Vec3Like,
    radius: number,
    maxSources: number,
): Set<string> {
    const count = Math.max(0, Math.floor(maxSources))
    if (count === 0) return new Set()
    const r2 = Math.max(0, radius) ** 2
    const candidates: { key: string; d2: number }[] = []
    for (const [key, record] of records) {
        const dx = record.soundX - listener.x
        const dy = record.soundY - listener.y
        const dz = record.soundZ - listener.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 <= r2) candidates.push({ key, d2 })
    }
    candidates.sort((a, b) => a.d2 - b.d2 || a.key.localeCompare(b.key))
    return new Set(candidates.slice(0, count).map((c) => c.key))
}

export function resolveTorchMount(chunks: ChunkManager, x: number, y: number, z: number): TorchMount {
    for (const direction of WALL_DIRECTIONS) {
        if (!isTorchSupport(chunks, x + direction.dx, y, z + direction.dz)) continue
        return { kind: 'wall', normalX: direction.normalX, normalZ: direction.normalZ }
    }
    if (isTorchSupport(chunks, x, y - 1, z)) return { kind: 'standing', normalX: 0, normalZ: 0 }
    return { kind: 'floating', normalX: 0, normalZ: 0 }
}

function isTorchSupport(chunks: ChunkManager, x: number, y: number, z: number): boolean {
    const value = chunks.getVoxel(x, y, z)
    return isCollidable(chunks.palette, value) || occludesFaces(chunks.palette, value)
}

function stopTorchSound(record: TorchRecord, fadeOut: number): void {
    if (!record.sound) return
    record.sound.stop(fadeOut)
    record.sound = null
}

function soundPosition(record: TorchRecord): Vec3Like {
    return { x: record.soundX, y: record.soundY, z: record.soundZ }
}

function playerListenerPosition(world: Parameters<System['update']>[0]): Vec3Like | null {
    const players = query(world, [Position, PlayerControlled])
    const eid = players[0]
    if (eid === undefined) return null
    return { x: Position.x[eid]!, y: Position.y[eid]! + 0.9, z: Position.z[eid]! }
}

function palettePropSignature(chunks: ChunkManager): string {
    let sig = ''
    for (const entry of chunks.palette.entries) {
        sig += entry.renderAs ?? ''
        sig += ','
    }
    return sig
}

function mountSignature(mount: TorchMount): string {
    return `${mount.kind}:${mount.normalX},${mount.normalZ}`
}

function flicker(elapsed: number, phase: number): number {
    const a = Math.sin(elapsed * 12.7 + phase) * 0.5 + 0.5
    const b = Math.sin(elapsed * 23.1 + phase * 1.7) * 0.5 + 0.5
    const c = Math.sin(elapsed * 7.3 + phase * 0.4) * 0.5 + 0.5
    return Math.max(0, Math.min(1, a * 0.5 + b * 0.32 + c * 0.18))
}

/** Quick Euler→quaternion compose. We only ever hit (x, 0, z) — wall
 *  leans pick one axis or the other — so a small inline equivalent
 *  beats reaching for three.Euler + setFromEuler each spawn. */
function setEulerQuat(q: Quaternion, x: number, y: number, z: number): void {
    const cx = Math.cos(x * 0.5)
    const cy = Math.cos(y * 0.5)
    const cz = Math.cos(z * 0.5)
    const sx = Math.sin(x * 0.5)
    const sy = Math.sin(y * 0.5)
    const sz = Math.sin(z * 0.5)
    q.set(
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz,
    )
}
