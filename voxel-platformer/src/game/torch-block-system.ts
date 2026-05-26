import {
    Color,
    Mesh,
    PointLight,
    Vector3,
    type Camera,
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
    cutY?: () => number | null
    camera?: () => Camera
    lightsEnabled?: boolean
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
    /** Cached torch position (centre + slight Y offset) — used by the
     *  pool light + spatial sound so we don't re-read group.position
     *  every frame. */
    posX: number
    posY: number
    posZ: number
    flames: TorchFlameRuntime[]
    flickerPhase: number
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
    /** Phase carried by the slot itself, not the torch it lights — keeps
     *  the flicker animation continuous when the slot is reassigned to
     *  a different torch as the player moves. */
    phase: number
    baseIntensity: number
    baseDistance: number
}

const WALL_LEAN_RADIANS = 0.58
const WALL_STANDOFF = 0.13
// Each PointLight in the scene adds a per-fragment lighting calculation
// to every PBR material in the world. Two is the empirical sweet spot
// for an iso platformer: enough to read "the nearest torch glows on
// the surrounding blocks" without inflating the fragment shader.
const DEFAULT_TORCH_LIGHTS = 2
// Skip flame animation for torches farther than this from the camera.
// They're already drawn at sub-pixel size, so animating the scale per
// frame is just CPU + matrix-recompute cost the viewer can't see.
const ANIMATION_CULL_DISTANCE = 28
const DEFAULT_TORCH_SOUND_RADIUS = 5
const DEFAULT_TORCH_SOUND_SOURCES = 3
const LIGHT_Y_OFFSET = 0.66

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
    // Per-chunk version snapshot. Steady-state cost is one map lookup +
    // version compare per loaded chunk — no string sort, no allocation.
    const chunkSnapshots = new Map<ChunkKey, ChunkSnapshot>()
    let paletteSignature = palettePropSignature(chunks)
    const lightsEnabled = opts.lightsEnabled !== false
    const poolSize = lightsEnabled ? Math.max(0, Math.floor(opts.maxLights ?? DEFAULT_TORCH_LIGHTS)) : 0
    // Light pool — every PointLight is created and added to the scene
    // exactly once. The scene's light count is therefore fixed for the
    // lifetime of the system, so three.js never has to recompile every
    // PBR material because a torch entered view.
    const lightPool: LightPoolSlot[] = []
    let lightsParked = false
    const PARK_POSITION = { x: 1e6, y: -1e6, z: 1e6 }
    let soundReady = !opts.audioReady
    let soundDisabled = false
    let elapsed = 0
    let lastCutY: number | null | undefined
    const lightCandidates: TorchLightCandidate[] = []
    const soundCandidates: TorchSoundCandidate[] = []
    const tmpColor = new Color()

    for (let i = 0; i < poolSize; i++) {
        const light = new PointLight(
            new Color(BLOCK_TORCH_LIGHT_SPEC.color),
            BLOCK_TORCH_LIGHT_SPEC.intensity,
            BLOCK_TORCH_LIGHT_SPEC.distance,
            BLOCK_TORCH_LIGHT_SPEC.decay,
        )
        light.name = `BlockTorchPoolLight${i}`
        light.castShadow = false
        // Visible from the start so the renderer's light list is
        // settled on frame zero. Position is offscreen until a torch
        // is assigned — three.js still iterates them, but the work is
        // bounded by `poolSize` (typically 4–8).
        light.visible = true
        light.position.set(PARK_POSITION.x, PARK_POSITION.y, PARK_POSITION.z)
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
                    // The torch root + its handle/head children never
                    // animate, so opt them out of three.js's per-frame
                    // matrixAutoUpdate. We re-fire the matrix manually
                    // below whenever the mount changes.
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

    function updateLightPool(): void {
        if (poolSize === 0) return
        const camera = opts.camera?.() ?? null

        lightCandidates.length = 0
        for (const [torchKey, record] of records) {
            if (!record.group.visible) continue
            lightCandidates.push({
                key: torchKey,
                x: record.posX,
                y: record.posY,
                z: record.posZ,
            })
        }

        if (lightCandidates.length === 0) {
            parkAllLights()
            return
        }
        lightsParked = false

        const activeKeys = camera
            ? selectTorchLightKeys(lightCandidates, camera.position, poolSize)
            : new Set(lightCandidates.slice(0, poolSize).map((c) => c.key))

        let slotIndex = 0
        for (const candidate of lightCandidates) {
            if (!activeKeys.has(candidate.key)) continue
            if (slotIndex >= lightPool.length) break
            const slot = lightPool[slotIndex]!
            const pulse = flicker(elapsed, slot.phase)
            slot.light.position.set(candidate.x, candidate.y, candidate.z)
            slot.light.intensity = slot.baseIntensity * (0.84 + pulse * 0.32)
            slot.light.distance = slot.baseDistance * (0.95 + pulse * 0.12)
            tmpColor.setHSL(0.078 + pulse * 0.014, 1, 0.58 + pulse * 0.12)
            slot.light.color.copy(tmpColor)
            slotIndex++
        }
        for (; slotIndex < lightPool.length; slotIndex++) {
            const slot = lightPool[slotIndex]!
            slot.light.intensity = 0
            slot.light.position.set(PARK_POSITION.x, PARK_POSITION.y, PARK_POSITION.z)
        }
    }

    function parkAllLights(): void {
        if (lightsParked) return
        for (const slot of lightPool) {
            slot.light.intensity = 0
            slot.light.position.set(PARK_POSITION.x, PARK_POSITION.y, PARK_POSITION.z)
        }
        lightsParked = true
    }

    function animateFlames(): void {
        // Flame animation only animates scale (not material opacity), so
        // the flame materials can be shared across every torch without
        // visible sync between them — different `flickerPhase`s give each
        // torch a slightly different beat.
        //
        // Torches beyond `ANIMATION_CULL_DISTANCE` from the camera skip
        // the scale update. They're rendered at sub-pixel size, so the
        // flicker isn't visible anyway, and skipping the assignment
        // avoids re-flagging the flame mesh's local matrix as dirty
        // (which would force three.js to recompute it during the next
        // matrixWorld traversal).
        const camera = opts.camera?.()
        const cx = camera?.position.x ?? 0
        const cy = camera?.position.y ?? 0
        const cz = camera?.position.z ?? 0
        const cull2 = ANIMATION_CULL_DISTANCE * ANIMATION_CULL_DISTANCE
        for (const record of records.values()) {
            if (!record.group.visible) continue
            if (camera) {
                const dx = record.posX - cx
                const dy = record.posY - cy
                const dz = record.posZ - cz
                if (dx * dx + dy * dy + dz * dz > cull2) continue
            }
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
            updateLightPool()
            animateFlames()
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
        soundCandidates.length = 0
        for (const [key, record] of records) {
            if (!record.group.visible) continue
            soundCandidates.push({ key, x: record.soundX, y: record.soundY, z: record.soundZ })
        }
        const selected = selectTorchSoundKeys(soundCandidates, listener, radius, maxSources)

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

export interface TorchSoundCandidate extends Vec3Like {
    key: string
}

export interface TorchLightCandidate extends Vec3Like {
    key: string
}

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
