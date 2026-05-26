import {
    Mesh,
    MeshBasicMaterial,
    PointLight,
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
import { CHUNK_DIM } from '../engine/voxel/chunk'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { isCollidable, isTorchBlock, occludesFaces } from '../engine/voxel/palette'
import {
    createBlockTorch,
    PLAYER_TORCH_FLAME,
    PLAYER_TORCH_LIGHT,
    type PlayerTorchLightUserData,
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
    y: number
    light: PointLight | null
    lightData: PlayerTorchLightUserData | null
    flames: TorchFlameRuntime[]
    sound: SoundHandle | null
    soundX: number
    soundY: number
    soundZ: number
}

interface TorchFlameRuntime {
    mesh: Mesh
    baseScale: { x: number; y: number; z: number }
}

const WALL_LEAN_RADIANS = 0.58
const WALL_STANDOFF = 0.13
const DEFAULT_TORCH_LIGHTS = 4
const DEFAULT_TORCH_SOUND_RADIUS = 5
const DEFAULT_TORCH_SOUND_SOURCES = 3

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
    const maxActiveLights = Math.max(0, Math.floor(opts.maxLights ?? DEFAULT_TORCH_LIGHTS))
    let soundReady = !opts.audioReady
    let soundDisabled = false
    let worldFingerprint = ''
    let elapsed = 0

    if (opts.audioReady) {
        void opts.audioReady.then(() => {
            soundReady = true
        }).catch((err) => {
            soundDisabled = true
            console.warn('Torch sounds skipped because audio failed to initialise:', err)
        })
    }

    function syncTorches(): void {
        const seen = new Set<string>()
        for (const chunk of chunks.allChunks()) {
            if (chunk.nonAirCount === 0) continue
            const baseX = chunk.cx * CHUNK_DIM
            const baseY = chunk.cy * CHUNK_DIM
            const baseZ = chunk.cz * CHUNK_DIM
            chunk.forEachSolid((lx, ly, lz, value) => {
                if (!isTorchBlock(chunks.palette, value)) return
                const wx = baseX + lx
                const wy = baseY + ly
                const wz = baseZ + lz
                const key = `${wx},${wy},${wz}`
                seen.add(key)

                const mount = resolveTorchMount(chunks, wx, wy, wz)
                const signature = mountSignature(mount)
                let record = records.get(key)
                if (!record) {
                    const group = createBlockTorch()
                    const runtime = collectTorchRuntime(group)
                    if (opts.lightsEnabled === false && runtime.light) {
                        runtime.light.removeFromParent()
                        runtime.light.dispose()
                        runtime.light = null
                    }
                    record = {
                        group,
                        signature: '',
                        y: wy,
                        sound: null,
                        soundX: wx + 0.5,
                        soundY: wy + 0.7,
                        soundZ: wz + 0.5,
                        ...runtime,
                    }
                    records.set(key, record)
                    scene.add(group)
                }
                record.y = wy
                if (record.signature !== signature) {
                    applyTorchTransform(record.group, wx, wy, wz, mount)
                    record.signature = signature
                    record.soundX = record.group.position.x
                    record.soundY = record.group.position.y + 0.56
                    record.soundZ = record.group.position.z
                    record.sound?.setPosition(soundPosition(record))
                }
            })
        }

        for (const [key, record] of records) {
            if (seen.has(key)) continue
            stopTorchSound(record, 0.2)
            disposeTorchRecord(record)
            records.delete(key)
        }
    }

    function applyVisibility(): void {
        const cutY = opts.cutY?.() ?? null
        for (const record of records.values()) {
            record.group.visible = cutY === null || record.y <= cutY
        }
    }

    return {
        name: 'torchBlocks',
        order: RenderOrder.worldRender + 2,
        init() {
            worldFingerprint = fingerprintWorld(chunks)
            syncTorches()
            applyVisibility()
        },
        update(world, dt) {
            elapsed += dt
            const fp = fingerprintWorld(chunks)
            if (fp !== worldFingerprint) {
                worldFingerprint = fp
                syncTorches()
            }
            applyVisibility()
            for (const record of records.values()) updateTorchFlicker(record, elapsed)
            applyTorchLightBudget(records, opts.camera?.() ?? null, maxActiveLights)
            syncTorchSounds(world)
        },
        dispose() {
            for (const record of records.values()) {
                stopTorchSound(record, 0.15)
                disposeTorchRecord(record)
            }
            records.clear()
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
        const candidates: TorchSoundCandidate[] = []
        for (const [key, record] of records) {
            if (!record.group.visible) continue
            candidates.push({ key, x: record.soundX, y: record.soundY, z: record.soundZ })
        }
        const selected = selectTorchSoundKeys(candidates, listener, radius, maxSources)

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

function collectTorchRuntime(group: Group): Pick<TorchBlockRecord, 'light' | 'lightData' | 'flames'> {
    const flames: TorchFlameRuntime[] = []
    let light: PointLight | null = null
    let lightData: PlayerTorchLightUserData | null = null
    group.traverse((obj) => {
        if (obj instanceof Mesh && obj.userData[PLAYER_TORCH_FLAME]) {
            flames.push({
                mesh: obj,
                baseScale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            })
            return
        }
        if (!(obj instanceof PointLight)) return
        const data = obj.userData[PLAYER_TORCH_LIGHT] as PlayerTorchLightUserData | undefined
        if (!data) return
        light = obj
        lightData = data
    })
    return { light, lightData, flames }
}

function updateTorchFlicker(record: TorchBlockRecord, elapsed: number): void {
    const pulse = flicker(elapsed, record.lightData?.phase ?? 0)
    if (record.light && record.lightData) {
        record.light.intensity = record.lightData.baseIntensity * (0.84 + pulse * 0.32)
        record.light.distance = record.lightData.baseDistance * (0.95 + pulse * 0.12)
        record.light.color.setHSL(0.078 + pulse * 0.014, 1, 0.58 + pulse * 0.12)
        ;(record.light.userData as Record<string, unknown>).wanted = record.light.intensity
    }

    const flameY = 0.9 + pulse * 0.22
    const flameXZ = 0.92 + (1 - pulse) * 0.1
    for (const flame of record.flames) {
        flame.mesh.scale.set(
            flame.baseScale.x * flameXZ,
            flame.baseScale.y * flameY,
            flame.baseScale.z * flameXZ,
        )
        if (flame.mesh.material instanceof MeshBasicMaterial) {
            flame.mesh.material.opacity = 0.74 + pulse * 0.18
        }
    }
}

function disposeTorchRecord(record: TorchBlockRecord): void {
    record.group.removeFromParent()
    record.group.traverse((obj) => {
        if (obj instanceof PointLight) obj.dispose()
    })
    disposeObject3D(record.group)
}

function applyTorchLightBudget(records: Map<string, TorchBlockRecord>, camera: Camera | null, maxLights: number): void {
    if (maxLights <= 0) {
        for (const record of records.values()) disableTorchLight(record)
        return
    }
    if (!camera) {
        let active = 0
        for (const record of records.values()) {
            if (!record.group.visible) {
                disableTorchLight(record)
                continue
            }
            setTorchLightActive(record, active < maxLights)
            active++
        }
        return
    }

    const activeKeys = selectTorchLightKeys([...records]
        .filter(([, record]) => record.group.visible && record.light)
        .map(([key, record]) => ({
            key,
            x: record.group.position.x,
            y: record.group.position.y,
            z: record.group.position.z,
        })),
        camera.position,
        maxLights,
    )

    for (const [key, record] of records) {
        setTorchLightActive(record, activeKeys.has(key))
    }
}

function setTorchLightActive(record: TorchBlockRecord, active: boolean): void {
    if (!record.light) return
    record.light.visible = active
    if (!active) record.light.intensity = 0
}

function disableTorchLight(record: TorchBlockRecord): void {
    setTorchLightActive(record, false)
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

function fingerprintWorld(chunks: ChunkManager): string {
    const parts = [`p:${chunks.palette.entries.map((entry) => entry.renderAs ?? '').join(',')}`]
    for (const chunk of chunks.allChunks()) {
        parts.push(`${chunk.cx},${chunk.cy},${chunk.cz}:${chunk.version}:${chunk.nonAirCount}`)
    }
    return parts.sort().join('|')
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
