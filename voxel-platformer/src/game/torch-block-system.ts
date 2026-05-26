import {
    Color,
    Mesh,
    PointLight,
    type Group,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import type { AudioEngine, SoundHandle, Vec3Like } from '../engine/audio'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import { PlayerControlled, Position } from '../engine/ecs/components'
import { disposeObject3D } from '../engine/render/dispose-object'
import { CHUNK_DIM, chunkKey, type ChunkKey } from '../engine/voxel/chunk'
import type { Chunk } from '../engine/voxel/chunk'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { isCollidable, isTorchBlock, occludesFaces } from '../engine/voxel/palette'
import {
    BLOCK_TORCH_LIGHT_SPEC,
    createBlockTorch,
    PLAYER_TORCH_FLAME,
} from './assets'

export type TorchMountKind = 'wall' | 'standing' | 'floating'

export interface TorchMount {
    kind: TorchMountKind
    normalX: number
    normalZ: number
}

export interface TorchBlockRenderOptions {
    /** Optional cut-plane for the editor's top-down view — torches with
     *  Y above this plane are hidden so the editor isn't littered with
     *  out-of-frame props. */
    cutY?: () => number | null
    /**
     * World-space focal point — typically the iso camera's `target`,
     * which tracks the player. Used for two things:
     *   1. Selecting which torches receive a pool light.
     *   2. Deciding which torches are close enough to animate.
     *
     * This MUST NOT be the camera's position. For an iso camera, the
     * camera sits ~50 units away from anything on screen, so every
     * torch is at roughly the same camera-distance — picking "nearest
     * to camera" produces near-arbitrary results that flicker as the
     * camera drifts. Distance to the focus point (player / look-at) is
     * the meaningful metric: 0 means "the player is standing on the
     * torch", ~12 units means "the torch is at the edge of the iso
     * viewport".
     *
     * If unset, the system falls back to the player entity's position
     * (PlayerControlled + Position). If there is no player either, the
     * pool lights stay parked and nothing animates.
     */
    focus?: () => Vec3Like | null
    /** Max distance from focus a torch is considered "near enough" to
     *  receive a pool light AND animate its flame. Default 14 units,
     *  matching the iso viewport's half-extent at default zoom. */
    focusRadius?: number
    /** When false, no pool lights are created at all. The editor uses
     *  this — the torches still mount and flicker visually, but
     *  they don't add lights to the chunk shader. */
    lightsEnabled?: boolean
    /** Pool size — number of PointLights pre-allocated and dynamically
     *  assigned to the nearest torches each frame. Defaults to 3.
     *  Each light in the scene adds a per-fragment lighting calculation
     *  to every PBR material in the world, so don't push this too
     *  high. */
    maxLights?: number
    audio?: AudioEngine
    audioReady?: Promise<unknown>
    soundId?: string
    soundVolume?: number
    soundRadius?: number
    maxSoundSources?: number
}

interface TorchBlockRecord {
    group: Group
    signature: string
    /** World Y of the block — drives cut-plane visibility in the editor. */
    y: number
    /** Cached world-space position used by the focus-distance test,
     *  pool light placement, and spatial sound. */
    posX: number
    posY: number
    posZ: number
    flames: TorchFlameRuntime[]
    flickerPhase: number
    /** Working scratch — squared distance from focus this frame. Reused
     *  by light + sound selection so we compute it once per record. */
    d2: number
    sound: SoundHandle | null
    soundX: number
    soundY: number
    soundZ: number
}

interface TorchFlameRuntime {
    mesh: Mesh
    baseScale: { x: number; y: number; z: number }
}

interface ChunkSnapshot {
    version: number
    torchKeys: Set<string>
}

interface LightPoolSlot {
    light: PointLight
    /** Per-slot flicker phase. Assigning a slot to a different torch
     *  keeps the slot's own phase, so the lit pool keeps animating
     *  smoothly even as it swaps which physical torch it represents. */
    phase: number
    baseIntensity: number
    baseDistance: number
}

const WALL_LEAN_RADIANS = 0.58
const WALL_STANDOFF = 0.13
const DEFAULT_TORCH_LIGHTS = 3
// Doubled from 14 (≈ iso viewport's half-extent at zoom 1) to 28 so
// torches turn on well before the player reaches them. At the previous
// radius, torches lit up roughly when the character walked into them,
// which read as "they only ignite on touch" instead of "they're
// already lit ahead of me". 28 covers a full screen-width of lead time
// in the typical iso view without bringing in torches the player can't
// actually see yet.
const DEFAULT_FOCUS_RADIUS = 28
const DEFAULT_TORCH_SOUND_RADIUS = 5
const DEFAULT_TORCH_SOUND_SOURCES = 3
const LIGHT_Y_OFFSET = 0.66
const PARK_X = 1e6
const PARK_Y = -1e6
const PARK_Z = 1e6

const WALL_DIRECTIONS = [
    { dx: -1, dz: 0, normalX: 1, normalZ: 0 },
    { dx: 1, dz: 0, normalX: -1, normalZ: 0 },
    { dx: 0, dz: -1, normalX: 0, normalZ: 1 },
    { dx: 0, dz: 1, normalX: 0, normalZ: -1 },
] as const

export function createTorchBlockRenderSystem(
    scene: Scene,
    chunks: ChunkManager,
    opts: TorchBlockRenderOptions = {},
): System {
    const records = new Map<string, TorchBlockRecord>()
    const chunkSnapshots = new Map<ChunkKey, ChunkSnapshot>()
    let paletteSignature = palettePropSignature(chunks)
    const lightsEnabled = opts.lightsEnabled !== false
    const poolSize = lightsEnabled ? Math.max(0, Math.floor(opts.maxLights ?? DEFAULT_TORCH_LIGHTS)) : 0
    const focusRadius = Math.max(1, opts.focusRadius ?? DEFAULT_FOCUS_RADIUS)
    const focusRadius2 = focusRadius * focusRadius
    const lightPool: LightPoolSlot[] = []
    let lightsParked = false
    let soundReady = !opts.audioReady
    let soundDisabled = false
    let elapsed = 0
    let lastCutY: number | null | undefined
    // Scratch buffers — reused each frame, never re-allocated.
    const activeRecords: TorchBlockRecord[] = []
    const tmpColor = new Color()
    const tmpFocus = { x: 0, y: 0, z: 0 }

    for (let i = 0; i < poolSize; i++) {
        const light = new PointLight(
            new Color(BLOCK_TORCH_LIGHT_SPEC.color),
            BLOCK_TORCH_LIGHT_SPEC.intensity,
            BLOCK_TORCH_LIGHT_SPEC.distance,
            BLOCK_TORCH_LIGHT_SPEC.decay,
        )
        light.name = `BlockTorchPoolLight${i}`
        light.castShadow = false
        // Visible = true from the start so the renderer's light list is
        // settled on frame zero — adding/removing lights forces a
        // recompile of every PBR material in the scene, the stalls we
        // used to see when a torch streamed in.
        light.visible = true
        light.position.set(PARK_X, PARK_Y, PARK_Z)
        light.intensity = 0
        scene.add(light)
        lightPool.push({
            light,
            phase: Math.random() * Math.PI * 2,
            baseIntensity: BLOCK_TORCH_LIGHT_SPEC.intensity,
            baseDistance: BLOCK_TORCH_LIGHT_SPEC.distance,
        })
    }

    if (opts.audioReady) {
        void opts.audioReady.then(() => {
            soundReady = true
        }).catch((err) => {
            soundDisabled = true
            console.warn('Torch sounds skipped because audio failed to initialise:', err)
        })
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
                    const group = createBlockTorch()
                    // Torch root + non-flame children never move once
                    // positioned. Opt out of three.js's per-frame
                    // matrixAutoUpdate so it doesn't recompute their
                    // local matrix every render. Flames still animate
                    // their scale, so they keep autoUpdate on.
                    group.matrixAutoUpdate = false
                    for (const child of group.children) {
                        if (child.userData[PLAYER_TORCH_FLAME]) continue
                        child.matrixAutoUpdate = false
                        child.updateMatrix()
                    }
                    const flames = collectTorchFlames(group)
                    record = {
                        group,
                        signature: '',
                        y: wy,
                        posX: wx + 0.5,
                        posY: wy + LIGHT_Y_OFFSET,
                        posZ: wz + 0.5,
                        flames,
                        flickerPhase: Math.random() * Math.PI * 2,
                        d2: Infinity,
                        sound: null,
                        soundX: wx + 0.5,
                        soundY: wy + 0.7,
                        soundZ: wz + 0.5,
                    }
                    records.set(torchKey, record)
                    scene.add(group)
                }
                record.y = wy
                if (record.signature !== signature) {
                    applyTorchTransform(record.group, wx, wy, wz, mount)
                    record.group.updateMatrix()
                    record.group.updateMatrixWorld(true)
                    record.signature = signature
                    record.posX = record.group.position.x
                    record.posY = record.group.position.y + LIGHT_Y_OFFSET
                    record.posZ = record.group.position.z
                    record.soundX = record.group.position.x
                    record.soundY = record.group.position.y + 0.56
                    record.soundZ = record.group.position.z
                    record.sound?.setPosition(soundPosition(record))
                }
            })
        }

        if (prev) {
            for (const oldKey of prev.torchKeys) {
                if (newKeys.has(oldKey)) continue
                const record = records.get(oldKey)
                if (!record) continue
                stopTorchSound(record, 0.2)
                disposeTorchRecord(record)
                records.delete(oldKey)
            }
        }
        chunkSnapshots.set(key, { version: chunk.version, torchKeys: newKeys })
    }

    function syncTorches(): void {
        const palSig = palettePropSignature(chunks)
        if (palSig !== paletteSignature) {
            // Palette swap / material edit may have moved the torch
            // entry index. Invalidate every snapshot and let the
            // per-chunk pass below repopulate.
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
                disposeTorchRecord(record)
                records.delete(torchKey)
            }
            chunkSnapshots.delete(key)
        }
    }

    function applyVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        if (cutY === lastCutY) return
        lastCutY = cutY
        for (const record of records.values()) {
            record.group.visible = cutY === null || record.y <= cutY
        }
    }

    /** Pull the focus point from the option, falling back to the
     *  player entity's world position. Returns null when neither is
     *  available (true for editor with no spawn entity). */
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

    /**
     * Single-pass classification:
     *   - For each visible torch, compute squared distance to focus.
     *   - If within `focusRadius`, the torch is "active": flame
     *     animation runs and it becomes a light-pool candidate.
     *   - Otherwise it's inactive: skip work, keep last flame scale.
     *
     * Iterating once and caching `record.d2` lets the light-pool
     * selection re-use the distance without recomputing it.
     */
    function classifyAndAnimate(focus: Vec3Like | null): void {
        activeRecords.length = 0
        if (!focus) return

        for (const record of records.values()) {
            if (!record.group.visible) continue
            const dx = record.posX - focus.x
            const dy = record.posY - focus.y
            const dz = record.posZ - focus.z
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 > focusRadius2) {
                record.d2 = d2
                continue
            }
            record.d2 = d2
            activeRecords.push(record)

            const pulse = flicker(elapsed, record.flickerPhase)
            const flameY = 0.9 + pulse * 0.22
            const flameXZ = 0.92 + (1 - pulse) * 0.1
            for (const flame of record.flames) {
                flame.mesh.scale.set(
                    flame.baseScale.x * flameXZ,
                    flame.baseScale.y * flameY,
                    flame.baseScale.z * flameXZ,
                )
            }
        }
    }

    /**
     * Sort the active set by distance and assign pool lights to the
     * nearest `poolSize` torches. Park unused pool slots so they cost
     * nothing in the lighting math.
     */
    function assignLightPool(): void {
        if (poolSize === 0) return
        if (activeRecords.length === 0) {
            parkAllLights()
            return
        }
        lightsParked = false

        // Active set is small (≤ ~30 torches in radius). Partial-sort
        // would be cleaner but full sort is comparable cost at this
        // size and dramatically simpler. The closer-to-focus tiebreak
        // keeps the picks stable when two torches are equidistant.
        activeRecords.sort(compareByDistance)

        const lit = Math.min(poolSize, activeRecords.length)
        for (let i = 0; i < lit; i++) {
            const record = activeRecords[i]!
            const slot = lightPool[i]!
            const pulse = flicker(elapsed, slot.phase)
            slot.light.position.set(record.posX, record.posY, record.posZ)
            slot.light.intensity = slot.baseIntensity * (0.84 + pulse * 0.32)
            slot.light.distance = slot.baseDistance * (0.95 + pulse * 0.12)
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
        name: 'torchBlocks',
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
                disposeTorchRecord(record)
            }
            records.clear()
            chunkSnapshots.clear()
            for (const slot of lightPool) {
                slot.light.removeFromParent()
                slot.light.dispose()
            }
            lightPool.length = 0
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
        const selected = pickNearestKeysWithinRadius(records, listener, radius, maxSources)

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

function compareByDistance(a: TorchBlockRecord, b: TorchBlockRecord): number {
    return a.d2 - b.d2
}

export interface TorchSoundCandidate extends Vec3Like {
    key: string
}

export interface TorchLightCandidate extends Vec3Like {
    key: string
}

/** Legacy export retained for the public test suite. The runtime uses
 *  the in-place active-record sort instead, which avoids the per-call
 *  Array.map / new Set allocations this helper does. */
export function selectTorchLightKeys(
    candidates: readonly TorchLightCandidate[],
    viewer: Vec3Like,
    maxLights: number,
): Set<string> {
    const count = Math.max(0, Math.floor(maxLights))
    if (count === 0) return new Set()
    return new Set(candidates
        .map((candidate) => ({
            key: candidate.key,
            d2: distanceSquared(candidate, viewer),
        }))
        .sort((a, b) => a.d2 - b.d2 || a.key.localeCompare(b.key))
        .slice(0, count)
        .map((candidate) => candidate.key))
}

/** Legacy export retained for the public test suite. */
export function selectTorchSoundKeys(
    candidates: readonly TorchSoundCandidate[],
    listener: Vec3Like,
    radius: number,
    maxSources: number,
): Set<string> {
    const count = Math.max(0, Math.floor(maxSources))
    if (count === 0) return new Set()
    const r2 = Math.max(0, radius) ** 2
    return new Set(candidates
        .map((candidate) => ({
            key: candidate.key,
            d2: distanceSquared(candidate, listener),
        }))
        .filter((candidate) => candidate.d2 <= r2)
        .sort((a, b) => a.d2 - b.d2 || a.key.localeCompare(b.key))
        .slice(0, count)
        .map((candidate) => candidate.key))
}

/** Sound-side variant of the light-pool selector — operates directly
 *  on the records map without an intermediate candidate array. */
function pickNearestKeysWithinRadius(
    records: Map<string, TorchBlockRecord>,
    listener: Vec3Like,
    radius: number,
    maxSources: number,
): Set<string> {
    const count = Math.max(0, Math.floor(maxSources))
    if (count === 0) return new Set()
    const r2 = Math.max(0, radius) ** 2

    const candidates: { key: string; d2: number }[] = []
    for (const [key, record] of records) {
        if (!record.group.visible) continue
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

function applyTorchTransform(group: Group, x: number, y: number, z: number, mount: TorchMount): void {
    group.rotation.set(0, 0, 0)
    if (mount.kind === 'wall') {
        const faceX = mount.normalX > 0 ? x : mount.normalX < 0 ? x + 1 : x + 0.5
        const faceZ = mount.normalZ > 0 ? z : mount.normalZ < 0 ? z + 1 : z + 0.5
        group.position.set(
            faceX + mount.normalX * WALL_STANDOFF,
            y + 0.24,
            faceZ + mount.normalZ * WALL_STANDOFF,
        )
        group.rotation.z = -mount.normalX * WALL_LEAN_RADIANS
        group.rotation.x = mount.normalZ * WALL_LEAN_RADIANS
        return
    }

    group.position.set(x + 0.5, y + (mount.kind === 'standing' ? 0.08 : 0.24), z + 0.5)
}

function collectTorchFlames(group: Group): TorchFlameRuntime[] {
    const flames: TorchFlameRuntime[] = []
    group.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        if (!obj.userData[PLAYER_TORCH_FLAME]) return
        flames.push({
            mesh: obj,
            baseScale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        })
    })
    return flames
}

function disposeTorchRecord(record: TorchBlockRecord): void {
    record.group.removeFromParent()
    disposeObject3D(record.group)
}

function stopTorchSound(record: TorchBlockRecord, fadeOut: number): void {
    if (!record.sound) return
    record.sound.stop(fadeOut)
    record.sound = null
}

function soundPosition(record: TorchBlockRecord): Vec3Like {
    return { x: record.soundX, y: record.soundY, z: record.soundZ }
}

function playerListenerPosition(world: Parameters<System['update']>[0]): Vec3Like | null {
    const players = query(world, [Position, PlayerControlled])
    const eid = players[0]
    if (eid === undefined) return null
    return { x: Position.x[eid]!, y: Position.y[eid]! + 0.9, z: Position.z[eid]! }
}

function distanceSquared(a: Vec3Like, b: Vec3Like): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dz = a.z - b.z
    return dx * dx + dy * dy + dz * dz
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
