import type {
    AudioAsset,
    AudioAnalyser,
    AudioBackend,
    AudioBufferLike,
    AudioBusId,
    AudioEngineOptions,
    AudioListenerView,
    AudioManifest,
    AudioMusicPlayer,
    AudioSnapshot,
    AudioVoice,
    MusicOptions,
    PanningModel,
    RolloffModel,
    SoundHandle,
    SoundOptions,
    Spatial3DParams,
    SpatialSoundOptions,
    Vec3Like,
} from './types'
import { WebAudioBackend } from './web-audio-backend'

type SoundCategory = 'sounds' | 'stingers'
type SoundBus = 'sfx' | 'stinger' | 'ui'

interface ActiveVoice {
    handle: ManagedSoundHandle
    voice: AudioVoice
    assetId: string
    category: SoundCategory
    priority: number
    startedAt: number
}

interface PendingSound {
    asset: AudioAsset
    category: SoundCategory
    bus: SoundBus
    options: SoundOptions
    spatial: Required<Spatial3DParams> | null
    handle: ManagedSoundHandle
}

/** Attachment record — the audio-emitter-system reads these each
 *  frame and syncs `handle.setPosition` from the entity's transform. */
interface AttachedEmitter {
    handle: ManagedSoundHandle
    entityId: number
    offset: Vec3Like
}

const DEFAULT_SPATIAL: Required<Omit<Spatial3DParams, 'position' | 'velocity'>> = {
    refDistance: 1,
    maxDistance: 50,
    rolloffFactor: 1,
    rolloffModel: 'inverse',
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 0,
    panningModel: 'HRTF',
}

interface ActiveMusic {
    id: string
    player: AudioMusicPlayer
}

const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'ui', 'stinger']

export class AudioEngine {
    private readonly backend: AudioBackend
    private readonly maxVoices: number
    private readonly stingerDuckVolume: number
    private readonly stingerDuckRamp: number
    private readonly abort = new AbortController()

    private sounds = new Map<string, AudioAsset>()
    private stingers = new Map<string, AudioAsset>()
    private music = new Map<string, AudioAsset>()
    private buffersByUrl = new Map<string, AudioBufferLike>()
    private loadsByUrl = new Map<string, Promise<AudioBufferLike>>()
    private activeVoices: ActiveVoice[] = []
    private pendingSounds: PendingSound[] = []
    private currentMusic: ActiveMusic | null = null
    private retiringMusic = new Set<AudioMusicPlayer>()
    private pendingMusic: { id: string; options: MusicOptions } | null = null
    private busVolumes = new Map<AudioBusId, number>(BUS_IDS.map((id) => [id, 1]))
    private stingerDucks = 0
    private disposed = false

    readonly listener: AudioListenerView
    private readonly spatialDefaults: Required<Omit<Spatial3DParams, 'position' | 'velocity'>>
    private readonly attachedEmitters = new Map<ManagedSoundHandle, AttachedEmitter>()

    constructor(opts: AudioEngineOptions = {}) {
        this.backend = opts.backend ?? new WebAudioBackend()
        this.maxVoices = Math.max(1, opts.maxVoices ?? 32)
        this.stingerDuckVolume = opts.stingerDuckVolume ?? 0.58
        this.stingerDuckRamp = opts.stingerDuckRamp ?? 0.08
        this.spatialDefaults = { ...DEFAULT_SPATIAL, ...(opts.spatialDefaults ?? {}) }
        this.listener = {
            setPose: (position, forward, up) => {
                if (this.disposed) return
                this.backend.setListenerPose(position, forward, up)
            },
        }
    }

    get unlocked(): boolean {
        return this.backend.unlocked
    }

    async unlock(): Promise<void> {
        if (this.disposed) return
        await this.backend.unlock()
        this.flushPendingSounds()
        const pending = this.pendingMusic
        if (pending) {
            this.pendingMusic = null
            await this.playMusic(pending.id, pending.options)
        }
    }

    async loadManifest(manifest: AudioManifest): Promise<void> {
        this.assertLive()
        validateManifest(manifest)
        this.sounds = mapAssets(manifest.sounds)
        this.stingers = mapAssets(manifest.stingers)
        this.music = mapAssets(manifest.music)
        const preload: Promise<AudioBufferLike>[] = []
        for (const asset of this.sounds.values()) preload.push(this.loadBuffer(asset))
        for (const asset of this.stingers.values()) preload.push(this.loadBuffer(asset))
        await Promise.all(preload)
    }

    async addAssets(manifest: AudioManifest): Promise<void> {
        this.assertLive()
        validateManifest(manifest, this.allAssetIds())
        const preload: Promise<AudioBufferLike>[] = []
        for (const asset of manifest.sounds ?? []) {
            this.sounds.set(asset.id, { ...asset })
            preload.push(this.loadBuffer(asset))
        }
        for (const asset of manifest.stingers ?? []) {
            this.stingers.set(asset.id, { ...asset })
            preload.push(this.loadBuffer(asset))
        }
        for (const asset of manifest.music ?? []) this.music.set(asset.id, { ...asset })
        await Promise.all(preload)
    }

    removeAsset(id: string): boolean {
        const asset = this.sounds.get(id) ?? this.stingers.get(id) ?? this.music.get(id)
        if (!asset) return false
        this.sounds.delete(id)
        this.stingers.delete(id)
        this.music.delete(id)
        this.pendingSounds = this.pendingSounds.filter((pending) => {
            if (pending.asset.id !== id) return true
            pending.handle.finish()
            return false
        })
        for (const active of this.activeVoices.filter((voice) => voice.assetId === id)) {
            active.voice.dispose()
            active.handle.finish()
        }
        this.activeVoices = this.activeVoices.filter((voice) => voice.assetId !== id)
        if (this.pendingMusic?.id === id) this.pendingMusic = null
        if (this.currentMusic?.id === id) this.stopMusic(0)
        if (!this.hasAssetUrl(asset.url)) this.buffersByUrl.delete(asset.url)
        return true
    }

    play(id: string, opts: SoundOptions = {}): SoundHandle {
        const asset = this.asset(this.sounds, id, 'sound')
        return this.enqueueOrPlay(asset, 'sounds', opts, 'sfx', null)
    }

    playStinger(id: string, opts: SoundOptions = {}): SoundHandle {
        const asset = this.asset(this.stingers, id, 'stinger')
        return this.enqueueOrPlay(asset, 'stingers', opts, 'stinger', null)
    }

    /**
     * Spatial counterpart to `play`. The sound is positioned at
     * `position` in world space; the returned handle is `spatial: true`
     * and accepts `setPosition` / `setVelocity` updates. Defaults for
     * the falloff curve come from `AudioEngineOptions.spatialDefaults`.
     */
    playSpatial(id: string, position: Vec3Like, opts: SpatialSoundOptions = {}): SoundHandle {
        const asset = this.asset(this.sounds, id, 'sound')
        const spatial = this.resolveSpatial({ ...opts, position })
        return this.enqueueOrPlay(asset, 'sounds', opts, 'sfx', spatial)
    }

    /**
     * Attach a spatial handle to an ECS entity. The
     * `audio-emitter-system` reads this list each frame and forwards
     * the entity's world transform to `handle.setPosition`. Pass an
     * optional `offset` to position the emitter relative to the
     * entity (e.g. for a footstep emitter at the player's feet).
     */
    attachToEntity(handle: SoundHandle, entityId: number, offset: Vec3Like = ZERO): void {
        if (!handle.spatial) return
        const managed = handle as ManagedSoundHandle
        this.attachedEmitters.set(managed, {
            handle: managed,
            entityId,
            offset: { x: offset.x, y: offset.y, z: offset.z },
        })
    }

    detachFromEntity(handle: SoundHandle): void {
        this.attachedEmitters.delete(handle as ManagedSoundHandle)
    }

    /** Internal: iterate active attached emitters. Used by
     *  `audio-emitter-system`. Don't mutate during iteration. */
    iterateAttached(): IterableIterator<AttachedEmitter> {
        return this.attachedEmitters.values()
    }

    async playMusic(id: string, opts: MusicOptions = {}): Promise<void> {
        if (this.disposed) return
        const asset = this.asset(this.music, id, 'music')
        if (!this.backend.unlocked) {
            this.pendingMusic = { id, options: opts }
            return
        }

        const crossfade = Math.max(0, opts.crossfade ?? 1.25)
        const fadeIn = Math.max(0, opts.fadeIn ?? crossfade)
        const fadeOut = Math.max(0, opts.fadeOut ?? crossfade)
        const targetVolume = clampVolume(opts.volume ?? asset.volume ?? 1)
        const next = this.backend.createMusic(asset.url, 'music')
        next.setLoop(opts.loop ?? asset.loop ?? true)
        next.setVolume(0)
        try {
            await next.play()
        } catch (err) {
            next.dispose()
            throw err
        }
        next.setVolume(targetVolume, fadeIn)

        const previous = this.currentMusic
        this.currentMusic = { id, player: next }
        if (previous) {
            previous.player.stop(fadeOut)
            this.retiringMusic.add(previous.player)
            this.cleanupRetiringMusic(previous.player, fadeOut)
        }
    }

    stopMusic(fadeOut = 0): void {
        this.pendingMusic = null
        const current = this.currentMusic
        if (!current) return
        this.currentMusic = null
        const safeFade = Math.max(0, fadeOut)
        current.player.stop(safeFade)
        if (safeFade > 0) {
            this.retiringMusic.add(current.player)
            this.cleanupRetiringMusic(current.player, safeFade)
        }
    }

    setBusVolume(bus: AudioBusId, volume: number, ramp = 0): void {
        const safe = clampVolume(volume)
        this.busVolumes.set(bus, safe)
        this.applyBusVolume(bus, ramp)
    }

    mute(muted: boolean): void {
        this.backend.setMuted(muted)
    }

    snapshot(): AudioSnapshot {
        return {
            unlocked: this.backend.unlocked,
            activeVoices: this.activeVoices.length,
            pendingSounds: this.pendingSounds.length,
            currentMusicId: this.currentMusic?.id ?? this.pendingMusic?.id ?? null,
            retiringMusicCount: this.retiringMusic.size,
            assetCounts: {
                sounds: this.sounds.size,
                music: this.music.size,
                stingers: this.stingers.size,
            },
        }
    }

    createAnalyser(bus: AudioBusId): AudioAnalyser {
        this.assertLive()
        return this.backend.createAnalyser(bus)
    }

    stopAll(): void {
        for (const active of [...this.activeVoices]) {
            active.voice.dispose()
            active.handle.finish()
        }
        this.activeVoices = []
        for (const pending of this.pendingSounds.splice(0)) pending.handle.finish()
        this.stopMusic(0)
        for (const player of this.retiringMusic) player.dispose()
        this.retiringMusic.clear()
        this.stingerDucks = 0
        this.attachedEmitters.clear()
        this.applyBusVolume('music')
    }

    dispose(): void {
        if (this.disposed) return
        this.stopAll()
        this.abort.abort()
        this.buffersByUrl.clear()
        this.loadsByUrl.clear()
        this.backend.dispose()
        this.disposed = true
    }

    private enqueueOrPlay(
        asset: AudioAsset,
        category: SoundCategory,
        opts: SoundOptions,
        bus: SoundBus,
        spatial: PendingSound['spatial'],
    ): SoundHandle {
        const handle = new ManagedSoundHandle(asset.id, spatial !== null)
        if (this.disposed) {
            handle.finish()
            return handle
        }
        if (!this.backend.unlocked) {
            if (opts.deferUntilUnlocked) this.pendingSounds.push({ asset, category, bus, options: opts, spatial, handle })
            else handle.finish()
            return handle
        }
        void this.startSound(asset, category, opts, bus, spatial, handle)
        return handle
    }

    private flushPendingSounds(): void {
        const pending = this.pendingSounds.splice(0)
        for (const item of pending) {
            if (!item.handle.stopped) void this.startSound(item.asset, item.category, item.options, item.bus, item.spatial, item.handle)
            else item.handle.finish()
        }
    }

    private async startSound(
        asset: AudioAsset,
        category: SoundCategory,
        opts: SoundOptions,
        bus: SoundBus,
        spatial: PendingSound['spatial'],
        handle: ManagedSoundHandle,
    ): Promise<void> {
        try {
            const buffer = await this.loadBuffer(asset)
            if (this.disposed || handle.stopped) {
                handle.finish()
                return
            }
            const priority = opts.priority ?? asset.priority ?? 0
            if (!this.claimVoiceSlot(asset, opts, priority)) {
                handle.finish()
                return
            }
            const volume = clampVolume((opts.volume ?? 1) * (asset.volume ?? 1))
            const rate = Math.max(0.05, opts.rate ?? 1)
            const detune = opts.detune ?? 0
            const loop = opts.loop ?? asset.loop ?? false
            const voice = spatial
                ? this.backend.playSpatialBuffer(buffer, {
                    bus, volume, rate, detune, loop,
                    position: spatial.position,
                    refDistance: spatial.refDistance,
                    maxDistance: spatial.maxDistance,
                    rolloffFactor: spatial.rolloffFactor,
                    rolloffModel: spatial.rolloffModel,
                    coneInnerAngle: spatial.coneInnerAngle,
                    coneOuterAngle: spatial.coneOuterAngle,
                    coneOuterGain: spatial.coneOuterGain,
                    panningModel: spatial.panningModel,
                })
                : this.backend.playBuffer(buffer, {
                    bus, volume, rate, detune, loop,
                    pan: Math.max(-1, Math.min(1, opts.pan ?? 0)),
                })
            const active: ActiveVoice = { handle, voice, assetId: asset.id, category, priority, startedAt: voice.startedAt }
            this.activeVoices.push(active)
            handle.attach(voice)
            if (category === 'stingers') this.beginDucking()
            voice.onEnded(() => {
                this.activeVoices = this.activeVoices.filter((v) => v !== active)
                if (category === 'stingers') this.endDucking()
                this.attachedEmitters.delete(handle)
                handle.finish()
            })
            if (opts.fadeIn && opts.fadeIn > 0) {
                voice.setVolume(0)
                voice.setVolume(volume, opts.fadeIn)
            }
        } catch (err) {
            console.warn(`AudioEngine: failed to play ${asset.id}`, err)
            handle.finish()
        }
    }

    private claimVoiceSlot(asset: AudioAsset, opts: SoundOptions, priority: number): boolean {
        const maxInstances = opts.maxInstances ?? asset.maxInstances
        if (maxInstances !== undefined) {
            const same = this.activeVoices
                .filter((v) => v.assetId === asset.id)
                .sort(compareVoiceForSteal)
            while (same.length >= Math.max(1, maxInstances)) {
                const victim = same.shift()
                if (!victim) break
                victim.voice.stop(opts.fadeOut ?? 0)
            }
        }

        const sorted = [...this.activeVoices].sort(compareVoiceForSteal)
        while (sorted.length >= this.maxVoices) {
            const victim = sorted.shift()
            if (!victim) return false
            if (victim.priority > priority) return false
            victim.voice.stop(opts.fadeOut ?? 0)
        }
        return true
    }

    private loadBuffer(asset: AudioAsset): Promise<AudioBufferLike> {
        const cached = this.buffersByUrl.get(asset.url)
        if (cached) return Promise.resolve(cached)
        const existing = this.loadsByUrl.get(asset.url)
        if (existing) return existing
        const load = this.backend.loadBuffer(asset.url, this.abort.signal).then((buffer) => {
            this.buffersByUrl.set(asset.url, buffer)
            this.loadsByUrl.delete(asset.url)
            return buffer
        }, (err) => {
            this.loadsByUrl.delete(asset.url)
            throw err
        })
        this.loadsByUrl.set(asset.url, load)
        return load
    }

    private beginDucking(): void {
        this.stingerDucks++
        this.applyBusVolume('music', this.stingerDuckRamp)
    }

    private endDucking(): void {
        this.stingerDucks = Math.max(0, this.stingerDucks - 1)
        this.applyBusVolume('music', this.stingerDuckRamp)
    }

    private applyBusVolume(bus: AudioBusId, ramp = 0): void {
        const base = this.busVolumes.get(bus) ?? 1
        const duck = bus === 'music' && this.stingerDucks > 0 ? this.stingerDuckVolume : 1
        this.backend.setBusVolume(bus, base * duck, ramp)
    }

    private cleanupRetiringMusic(player: AudioMusicPlayer, fadeOut: number): void {
        if (fadeOut <= 0) {
            player.dispose()
            this.retiringMusic.delete(player)
            return
        }
        setTimeout(() => {
            player.dispose()
            this.retiringMusic.delete(player)
        }, fadeOut * 1000 + 32)
    }

    private asset(map: Map<string, AudioAsset>, id: string, label: string): AudioAsset {
        const asset = map.get(id)
        if (!asset) throw new Error(`Unknown ${label}: ${id}`)
        return asset
    }

    private assertLive(): void {
        if (this.disposed) throw new Error('AudioEngine: disposed')
    }

    private allAssetIds(): Set<string> {
        return new Set([...this.sounds.keys(), ...this.stingers.keys(), ...this.music.keys()])
    }

    private hasAssetUrl(url: string): boolean {
        for (const asset of this.sounds.values()) if (asset.url === url) return true
        for (const asset of this.stingers.values()) if (asset.url === url) return true
        for (const asset of this.music.values()) if (asset.url === url) return true
        return false
    }

    private resolveSpatial(opts: SpatialSoundOptions & { position: Vec3Like }): PendingSound['spatial'] {
        const refDistance = Math.max(0.0001, opts.refDistance ?? this.spatialDefaults.refDistance)
        const maxDistance = Math.max(refDistance + 0.001, opts.maxDistance ?? this.spatialDefaults.maxDistance)
        const rolloffFactor = Math.max(0, opts.rolloffFactor ?? this.spatialDefaults.rolloffFactor)
        const rolloffModel: RolloffModel = opts.rolloffModel ?? this.spatialDefaults.rolloffModel
        const panningModel: PanningModel = opts.panningModel ?? this.spatialDefaults.panningModel
        return {
            position: opts.position,
            refDistance,
            maxDistance,
            rolloffFactor,
            rolloffModel,
            coneInnerAngle: opts.coneInnerAngle ?? this.spatialDefaults.coneInnerAngle,
            coneOuterAngle: opts.coneOuterAngle ?? this.spatialDefaults.coneOuterAngle,
            coneOuterGain: opts.coneOuterGain ?? this.spatialDefaults.coneOuterGain,
            panningModel,
        }
    }
}

const ZERO: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 })

class ManagedSoundHandle implements SoundHandle {
    private voice: AudioVoice | null = null
    private resolveEnded!: () => void
    private isStopped = false
    private isFinished = false
    /** Position cached before the voice attaches — applied on attach so
     *  attach-order doesn't drop the first frame's spatial state. */
    private pendingPosition: Vec3Like | null = null
    readonly ended: Promise<void>

    constructor(readonly id: string, readonly spatial: boolean) {
        this.ended = new Promise<void>((resolve) => {
            this.resolveEnded = resolve
        })
    }

    get stopped(): boolean {
        return this.isStopped
    }

    attach(voice: AudioVoice): void {
        this.voice = voice
        if (this.isStopped) { voice.stop(0); return }
        if (this.pendingPosition && voice.setPosition) voice.setPosition(this.pendingPosition)
        this.pendingPosition = null
    }

    stop(fadeOut = 0): void {
        if (this.isFinished || this.isStopped) return
        this.isStopped = true
        if (this.voice) this.voice.stop(fadeOut)
        else this.finish()
    }

    setVolume(volume: number, ramp = 0): void {
        if (this.isFinished) return
        this.voice?.setVolume(clampVolume(volume), ramp)
    }

    setPosition(position: Vec3Like): void {
        if (this.isFinished || !this.spatial) return
        if (this.voice?.setPosition) this.voice.setPosition(position)
        else this.pendingPosition = { x: position.x, y: position.y, z: position.z }
    }

    finish(): void {
        if (this.isFinished) return
        this.isFinished = true
        this.isStopped = true
        this.resolveEnded()
    }
}

function validateManifest(manifest: AudioManifest, existing = new Set<string>()): void {
    const seen = new Set<string>(existing)
    for (const group of [manifest.sounds ?? [], manifest.music ?? [], manifest.stingers ?? []]) {
        for (const asset of group) {
            if (!asset.id.trim()) throw new Error('Audio manifest asset is missing id')
            if (!asset.url.trim()) throw new Error(`Audio manifest asset ${asset.id} is missing url`)
            if (seen.has(asset.id)) throw new Error(`Duplicate audio asset id: ${asset.id}`)
            seen.add(asset.id)
        }
    }
}

function mapAssets(assets: readonly AudioAsset[] | undefined): Map<string, AudioAsset> {
    const out = new Map<string, AudioAsset>()
    for (const asset of assets ?? []) out.set(asset.id, { ...asset })
    return out
}

function compareVoiceForSteal(a: ActiveVoice, b: ActiveVoice): number {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.startedAt - b.startedAt
}

function clampVolume(v: number): number {
    if (!Number.isFinite(v)) return 1
    return Math.max(0, Math.min(1, v))
}
