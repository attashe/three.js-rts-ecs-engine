import {
    AdditiveBlending,
    Color,
    InstancedMesh,
    LightProbe,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    SphericalHarmonics3,
    Vector3,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import type { AudioEngine, SoundHandle, Vec3Like } from '../engine/audio'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import { PlayerControlled, Position } from '../engine/ecs/components'
import { CHUNK_DIM, chunkKey, type ChunkKey } from '../engine/voxel/chunk'
import type { Chunk } from '../engine/voxel/chunk'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { isCollidable, occludesFaces, torchBlockState } from '../engine/voxel/palette'
import { sharedCylinderGeometry, sharedMaterial, sharedSphereGeometry } from './assets/shared-primitives'

/**
 * Torches v2 — experimental LightProbe-based illumination.
 *
 * Same InstancedMesh-based geometry as the production
 * `torch-block-system.ts` (so visuals are identical at the model
 * level), but the per-torch PointLight pool is replaced with a single
 * global LightProbe whose SH9 coefficients are recomputed each frame
 * from the N nearest torches to the focus point. The probe
 * accumulates contributions as directional irradiance projected into
 * SH bands 0–1 (ambient + first-order directional). Surfaces sample
 * the probe via the standard material's existing SH9 dot product —
 * no extra per-fragment lights, no shadow maps.
 *
 * Trade-offs vs the production system:
 *
 *   - **Cheaper.** One LightProbe in the scene vs N PointLights. No
 *     shadow maps, no per-light evaluation in the fragment shader
 *     beyond the SH9 sum that the material already computes. On
 *     hardware where 3+ PointLights stresses fragment cost, this is
 *     the win.
 *
 *   - **Different look.** No distinct lit pools around each torch.
 *     The probe lights every surface in the scene uniformly with a
 *     soft warm directional ambient biased toward whichever torches
 *     are closest to the player. Reads as "warm cave" rather than
 *     "torch pool on stone". Far rooms get a faint warm wash that
 *     they shouldn't, because LightProbes have no spatial bound.
 *
 *   - **No shadows of any kind.** Probes are diffuse ambient; they
 *     can't cast shadows. The player-held torch's shadow caster
 *     (configured in `assets/torch.ts`) is unaffected and continues
 *     to work in this mode.
 *
 * This file is NOT the default torch system. The user opts in via
 * the Display panel's "Torch system" dropdown — `experimental` runs
 * this file; `classic` runs the production one. Keep them in sync
 * geometrically (mesh/animation) — the comparison only makes sense
 * if the visual difference is purely in the lighting model.
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
    /** Disabling the lights (editor mode) skips probe creation
     *  entirely — no SH updates, no probe in the scene. */
    lightsEnabled?: boolean
    audio?: AudioEngine
    audioReady?: Promise<unknown>
    soundId?: string
    soundVolume?: number
    soundRadius?: number
    maxSoundSources?: number
    maxInstances?: number
    /** How many torches' contributions are folded into the global
     *  SH each frame. Default 6 — enough to give a sense of "there
     *  are warm sources here" without computing for every torch
     *  in the level. */
    maxProbeSources?: number
    /** Multiplier applied to each torch's SH contribution before
     *  summation. Default 0.35; tune to match the desired ambient
     *  warmth versus the production lit-pool intensity. */
    probeIntensity?: number
}

interface TorchRecord {
    slot: number
    signature: string
    y: number
    posX: number
    posY: number
    posZ: number
    baseQuat: Quaternion
    basePos: Vector3
    flickerPhase: number
    /** Unlit lanterns share static torch geometry but produce no flame,
     *  probe contribution, or ambient loop. */
    lit: boolean
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

const WALL_LEAN_RADIANS = 0.58
const WALL_STANDOFF = 0.13
const DEFAULT_FOCUS_RADIUS = 28
const DEFAULT_TORCH_SOUND_RADIUS = 5
const DEFAULT_TORCH_SOUND_SOURCES = 3
const DEFAULT_MAX_INSTANCES = 256
const DEFAULT_MAX_PROBE_SOURCES = 6
const DEFAULT_PROBE_INTENSITY = 0.35

const HANDLE_LOCAL_Y = 0.22
const HEAD_LOCAL_Y = 0.54
const FLAME_LOCAL_Y = 0.74
const CORE_LOCAL_Y = 0.7
const FLAME_BASE_SCALE = new Vector3(0.74, 1.75, 0.74)
const CORE_BASE_SCALE = new Vector3(0.72, 1.28, 0.72)
const TORCH_SCALE = 0.96

// Torch tint passed to the probe — same hue as the PointLight pool in
// the production system, so the warm-cave feel matches.
const TORCH_COLOR_R = 1.0
const TORCH_COLOR_G = 0.66
const TORCH_COLOR_B = 0.35

// SH9 projection constants for a directional light. We project bands
// 0 and 1 only; band 2 adds shape that the SH9 evaluation can
// represent but which adds little for warm ambient fill — skipping it
// keeps the update loop tight.
//   L_00  = c * 0.886227
//   L_1m1 = c * 1.023327 * dir.y
//   L_10  = c * 1.023327 * dir.z
//   L_11  = c * 1.023327 * dir.x
const SH_BAND_0 = 0.886227
const SH_BAND_1 = 1.023327

const WALL_DIRECTIONS = [
    { dx: -1, dz: 0, normalX: 1, normalZ: 0 },
    { dx: 1, dz: 0, normalX: -1, normalZ: 0 },
    { dx: 0, dz: -1, normalX: 0, normalZ: 1 },
    { dx: 0, dz: 1, normalX: 0, normalZ: -1 },
] as const

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
    const focusRadius = Math.max(1, opts.focusRadius ?? DEFAULT_FOCUS_RADIUS)
    const focusRadius2 = focusRadius * focusRadius
    const maxProbeSources = Math.max(0, Math.floor(opts.maxProbeSources ?? DEFAULT_MAX_PROBE_SOURCES))
    const probeIntensity = Math.max(0, opts.probeIntensity ?? DEFAULT_PROBE_INTENSITY)

    // ── Geometry (same as production).
    const handleGeo = sharedCylinderGeometry(0.025, 0.034, 0.58, 6)
    const headGeo = sharedCylinderGeometry(0.07, 0.06, 0.13, 8)
    const flameGeo = sharedSphereGeometry(0.1, 8, 6)
    const coreGeo = sharedSphereGeometry(0.065, 6, 4)

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
    flameMesh.renderOrder = 1
    coreMesh.renderOrder = 2
    handleMesh.frustumCulled = false
    headMesh.frustumCulled = false
    flameMesh.frustumCulled = false
    coreMesh.frustumCulled = false

    handleMesh.count = 0
    headMesh.count = 0
    flameMesh.count = 0
    coreMesh.count = 0

    scene.add(handleMesh, headMesh, flameMesh, coreMesh)

    // ── LightProbe replaces the pool. We only add it to the scene
    //    when lights are enabled; the editor's `lightsEnabled: false`
    //    path skips it entirely.
    let probe: LightProbe | null = null
    if (lightsEnabled) {
        probe = new LightProbe()
        probe.intensity = 1
        scene.add(probe)
    }

    const keyBySlot: (string | null)[] = new Array(maxInstances).fill(null)
    let liveCount = 0

    const activeRecords: TorchRecord[] = []
    const tmpFocus = { x: 0, y: 0, z: 0 }
    const tmpMatrix = new Matrix4()
    const tmpScale = new Vector3()
    const tmpVec = new Vector3()

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
        handleMesh.count = liveCount
        headMesh.count = liveCount
        flameMesh.count = liveCount
        coreMesh.count = liveCount
        return slot
    }

    function releaseSlot(slot: number): void {
        const lastSlot = liveCount - 1
        if (slot !== lastSlot) {
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

    function composeWithLocalY(record: TorchRecord, localY: number, scale: number, out: Matrix4): void {
        tmpVec.set(0, localY, 0)
        tmpVec.applyQuaternion(record.baseQuat)
        tmpVec.add(record.basePos)
        tmpScale.setScalar(scale * TORCH_SCALE)
        out.compose(tmpVec, record.baseQuat, tmpScale)
    }

    function composeFlame(record: TorchRecord, localY: number, baseScale: Vector3, xzMul: number, yMul: number, out: Matrix4): void {
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

    function writeStaticParts(record: TorchRecord): void {
        composeWithLocalY(record, HANDLE_LOCAL_Y, 1, tmpMatrix)
        handleMesh.setMatrixAt(record.slot, tmpMatrix)
        composeWithLocalY(record, HEAD_LOCAL_Y, 1, tmpMatrix)
        headMesh.setMatrixAt(record.slot, tmpMatrix)
    }

    function setMountTransform(record: TorchRecord, x: number, y: number, z: number, mount: TorchMount): void {
        if (mount.kind === 'wall') {
            const faceX = mount.normalX > 0 ? x : mount.normalX < 0 ? x + 1 : x + 0.5
            const faceZ = mount.normalZ > 0 ? z : mount.normalZ < 0 ? z + 1 : z + 0.5
            record.basePos.set(
                faceX + mount.normalX * WALL_STANDOFF,
                y + 0.24,
                faceZ + mount.normalZ * WALL_STANDOFF,
            )
            const rx = mount.normalZ * WALL_LEAN_RADIANS
            const rz = -mount.normalX * WALL_LEAN_RADIANS
            setEulerQuat(record.baseQuat, rx, 0, rz)
        } else {
            record.basePos.set(x + 0.5, y + (mount.kind === 'standing' ? 0.08 : 0.24), z + 0.5)
            record.baseQuat.identity()
        }
        record.posX = record.basePos.x
        record.posY = record.basePos.y + 0.66
        record.posZ = record.basePos.z
        record.soundX = record.basePos.x
        record.soundY = record.basePos.y + 0.56
        record.soundZ = record.basePos.z
        writeStaticParts(record)
        const flameScale = record.lit ? 1 : 0
        composeFlame(record, FLAME_LOCAL_Y, FLAME_BASE_SCALE, flameScale, flameScale, tmpMatrix)
        flameMesh.setMatrixAt(record.slot, tmpMatrix)
        composeFlame(record, CORE_LOCAL_Y, CORE_BASE_SCALE, flameScale, flameScale, tmpMatrix)
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
                const state = torchBlockState(chunks.palette, value)
                if (!state) return
                const lit = state === 'lit'
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const torchKey = `${wx},${wy},${wz}`
                newKeys.add(torchKey)

                const mount = resolveTorchMount(chunks, wx, wy, wz)
                const signature = `${lit ? 'lit' : 'unlit'}:${mountSignature(mount)}`
                let record = records.get(torchKey)
                if (!record) {
                    const slot = allocateSlot()
                    if (slot < 0) return
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
                        lit,
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
                record.lit = lit
                if (!record.lit) stopTorchSound(record, 0.2)
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
        const anyHidden = cutY !== null
        if (!anyHidden) {
            handleMesh.visible = true
            headMesh.visible = true
            flameMesh.visible = true
            coreMesh.visible = true
            return
        }
        for (const record of records.values()) {
            const hidden = record.y > cutY
            const scale = hidden ? 0 : 1
            composeWithLocalY(record, HANDLE_LOCAL_Y, scale, tmpMatrix)
            handleMesh.setMatrixAt(record.slot, tmpMatrix)
            composeWithLocalY(record, HEAD_LOCAL_Y, scale, tmpMatrix)
            headMesh.setMatrixAt(record.slot, tmpMatrix)
            const flameScale = record.lit ? scale : 0
            composeFlame(record, FLAME_LOCAL_Y, FLAME_BASE_SCALE, flameScale, flameScale, tmpMatrix)
            flameMesh.setMatrixAt(record.slot, tmpMatrix)
            composeFlame(record, CORE_LOCAL_Y, CORE_BASE_SCALE, flameScale, flameScale, tmpMatrix)
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
            if (!record.lit) continue
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

    /**
     * Rebuild the LightProbe's SH9 from the nearest active torches.
     * The probe accumulates the SH projection of a directional light
     * for each torch — direction is the unit vector from the focus
     * point to the torch, colour is the torch tint pre-multiplied by
     * the flicker pulse and a distance falloff.
     *
     * The probe contributes ambient + first-order directional
     * irradiance to every surface in the scene. There's no spatial
     * cutoff (LightProbes are global), which is the main visible
     * difference from the production system.
     */
    function updateLightProbe(focus: Vec3Like | null): void {
        if (!probe) return
        const sh = probe.sh as SphericalHarmonics3
        sh.zero()
        if (!focus || activeRecords.length === 0) return

        activeRecords.sort(compareByDistance)
        const sourceCount = Math.min(maxProbeSources, activeRecords.length)
        for (let i = 0; i < sourceCount; i++) {
            const record = activeRecords[i]!
            const dx = record.posX - focus.x
            const dy = record.posY - focus.y
            const dz = record.posZ - focus.z
            const distSq = dx * dx + dy * dy + dz * dz
            if (distSq < 0.0001) continue
            const dist = Math.sqrt(distSq)
            // Quadratic falloff over the focus radius — torches at the
            // edge contribute 0, torches at the focus contribute 1.
            const t = Math.max(0, 1 - dist / focusRadius)
            const falloff = t * t
            const pulse = flicker(elapsed, record.flickerPhase)
            const tint = probeIntensity * falloff * (0.84 + pulse * 0.32)
            const r = TORCH_COLOR_R * tint
            const g = TORCH_COLOR_G * tint
            const b = TORCH_COLOR_B * tint
            const nx = dx / dist
            const ny = dy / dist
            const nz = dz / dist
            addDirectionalSH(sh, nx, ny, nz, r, g, b)
        }
    }

    return {
        name: 'torchBlocksProbe',
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
            updateLightProbe(focus)
            syncTorchSounds(world)
        },
        dispose() {
            for (const record of records.values()) {
                stopTorchSound(record, 0.15)
            }
            records.clear()
            chunkSnapshots.clear()
            if (probe) {
                scene.remove(probe)
                probe = null
            }
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
        if (!record.lit) continue
        const dx = record.soundX - listener.x
        const dy = record.soundY - listener.y
        const dz = record.soundZ - listener.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 <= r2) candidates.push({ key, d2 })
    }
    candidates.sort((a, b) => a.d2 - b.d2 || a.key.localeCompare(b.key))
    return new Set(candidates.slice(0, count).map((c) => c.key))
}

/**
 * Add the SH9 projection of a directional light at `dir` with colour
 * `(r, g, b)` to the SH coefficients. Bands 0–1 only; the full
 * directional projection includes band 2 (5 more coefficients), but
 * for warm-fill ambient the omission is invisible and the saved math
 * matters when this runs every frame.
 *
 * `sh.coefficients` order in three.js (see SphericalHarmonics3.fromArray):
 *   0:  Y(0,0)     — band 0, ambient
 *   1:  Y(1,-1)    — band 1, dir.y
 *   2:  Y(1, 0)    — band 1, dir.z
 *   3:  Y(1, 1)    — band 1, dir.x
 */
export function addDirectionalSH(
    sh: SphericalHarmonics3,
    dx: number,
    dy: number,
    dz: number,
    r: number,
    g: number,
    b: number,
): void {
    const c = sh.coefficients
    c[0]!.x += r * SH_BAND_0; c[0]!.y += g * SH_BAND_0; c[0]!.z += b * SH_BAND_0
    c[1]!.x += r * SH_BAND_1 * dy; c[1]!.y += g * SH_BAND_1 * dy; c[1]!.z += b * SH_BAND_1 * dy
    c[2]!.x += r * SH_BAND_1 * dz; c[2]!.y += g * SH_BAND_1 * dz; c[2]!.z += b * SH_BAND_1 * dz
    c[3]!.x += r * SH_BAND_1 * dx; c[3]!.y += g * SH_BAND_1 * dx; c[3]!.z += b * SH_BAND_1 * dx
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
