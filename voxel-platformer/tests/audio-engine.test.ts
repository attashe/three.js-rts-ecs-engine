import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine, type AudioAnalyser, type AudioBackend, type AudioBufferLike, type AudioBusId, type AudioMusicPlayer, type AudioVoice, type BufferPlaybackParams, type SpatialPlaybackParams, type Vec3Like } from '../src/engine/audio'

class FakeBackend implements AudioBackend {
    time = 0
    isUnlocked = false
    loadCalls: string[] = []
    voices: Array<FakeVoice | FakeSpatialVoice> = []
    musicPlayers: FakeMusicPlayer[] = []
    analysers: FakeAnalyser[] = []
    busVolumes = new Map<AudioBusId, number>()
    muted = false
    failNextMusicPlay = false

    get currentTime(): number {
        return this.time
    }

    get unlocked(): boolean {
        return this.isUnlocked
    }

    async unlock(): Promise<void> {
        this.isUnlocked = true
    }

    async loadBuffer(url: string): Promise<AudioBufferLike> {
        this.loadCalls.push(url)
        return { duration: 0.25 }
    }

    createBufferFromPcm(samples: Float32Array, sampleRate: number): AudioBufferLike {
        return { duration: samples.length / sampleRate }
    }

    playBuffer(_buffer: AudioBufferLike, params: BufferPlaybackParams): AudioVoice {
        const voice = new FakeVoice(this.time, params)
        this.voices.push(voice)
        return voice
    }

    playSpatialBuffer(_buffer: AudioBufferLike, params: SpatialPlaybackParams): AudioVoice {
        const voice = new FakeSpatialVoice(this.time, params)
        this.voices.push(voice)
        return voice
    }

    setListenerPose(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
        this.listenerPoses.push({
            position: { x: position.x, y: position.y, z: position.z },
            forward: { x: forward.x, y: forward.y, z: forward.z },
            up: { x: up.x, y: up.y, z: up.z },
        })
    }

    listenerPoses: Array<{ position: Vec3Like; forward: Vec3Like; up: Vec3Like }> = []

    createMusic(url: string, bus: Exclude<AudioBusId, 'master'>): AudioMusicPlayer {
        const player = new FakeMusicPlayer(url, bus, this.failNextMusicPlay)
        this.failNextMusicPlay = false
        this.musicPlayers.push(player)
        return player
    }

    createAnalyser(bus: AudioBusId): AudioAnalyser {
        const analyser = new FakeAnalyser(bus)
        this.analysers.push(analyser)
        return analyser
    }

    setBusVolume(bus: AudioBusId, volume: number): void {
        this.busVolumes.set(bus, volume)
    }

    setMuted(muted: boolean): void {
        this.muted = muted
    }

    dispose(): void {
        for (const voice of this.voices) voice.dispose()
        for (const player of this.musicPlayers) player.dispose()
    }
}

class FakeAnalyser implements AudioAnalyser {
    readonly fftSize = 1024
    readonly frequencyBinCount = 512
    disposed = false

    constructor(readonly bus: AudioBusId) {}

    getByteTimeDomainData(out: Uint8Array): void {
        out.fill(128)
    }

    getByteFrequencyData(out: Uint8Array): void {
        out.fill(0)
    }

    dispose(): void {
        this.disposed = true
    }
}

class FakeVoice implements AudioVoice {
    callbacks: Array<() => void> = []
    volumes: number[] = []
    didStop = false
    disposed = false
    readonly spatial = false

    constructor(readonly startedAt: number, readonly params: BufferPlaybackParams) {
        this.volumes.push(params.volume)
    }

    get stopped(): boolean {
        return this.didStop
    }

    stop(): void {
        if (this.didStop) return
        this.didStop = true
        for (const cb of this.callbacks.splice(0)) cb()
    }

    setVolume(volume: number): void {
        this.volumes.push(volume)
    }

    onEnded(cb: () => void): void {
        if (this.didStop) cb()
        else this.callbacks.push(cb)
    }

    dispose(): void {
        this.disposed = true
        this.stop()
    }
}

class FakeSpatialVoice implements AudioVoice {
    callbacks: Array<() => void> = []
    volumes: number[] = []
    positions: Vec3Like[] = []
    didStop = false
    disposed = false
    readonly spatial = true

    constructor(readonly startedAt: number, readonly params: SpatialPlaybackParams) {
        this.volumes.push(params.volume)
        this.positions.push({ x: params.position.x, y: params.position.y, z: params.position.z })
    }

    get stopped(): boolean {
        return this.didStop
    }

    stop(): void {
        if (this.didStop) return
        this.didStop = true
        for (const cb of this.callbacks.splice(0)) cb()
    }

    setVolume(volume: number): void {
        this.volumes.push(volume)
    }

    setPosition(position: Vec3Like): void {
        this.positions.push({ x: position.x, y: position.y, z: position.z })
    }

    onEnded(cb: () => void): void {
        if (this.didStop) cb()
        else this.callbacks.push(cb)
    }

    dispose(): void {
        this.disposed = true
        this.stop()
    }
}

class FakeMusicPlayer implements AudioMusicPlayer {
    loop = false
    volumes: number[] = []
    played = false
    didStop = false
    disposed = false

    constructor(
        readonly url: string,
        readonly bus: Exclude<AudioBusId, 'master'>,
        private readonly failPlay = false,
    ) {}

    get stopped(): boolean {
        return this.didStop
    }

    setLoop(loop: boolean): void {
        this.loop = loop
    }

    setVolume(volume: number): void {
        this.volumes.push(volume)
    }

    async play(): Promise<void> {
        if (this.failPlay) throw new Error('music play failed')
        this.played = true
    }

    stop(fadeOut = 0): void {
        this.didStop = true
        if (fadeOut <= 0) this.dispose()
    }

    dispose(): void {
        this.disposed = true
        this.didStop = true
    }
}

const manifest = {
    sounds: [
        { id: 'jump', url: '/jump.wav', maxInstances: 2, priority: 1 },
        { id: 'hit', url: '/hit.wav', priority: 2 },
        { id: 'rare', url: '/rare.wav', priority: 8 },
    ],
    music: [
        { id: 'bg', url: '/bg.mp3', loop: true, volume: 0.5 },
        { id: 'boss', url: '/boss.mp3', loop: true, volume: 0.7 },
    ],
    stingers: [
        { id: 'sting', url: '/sting.wav', priority: 9 },
    ],
}

async function ready(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

test('AudioEngine validates duplicate manifest ids', async () => {
    const engine = new AudioEngine({ backend: new FakeBackend() })
    await assert.rejects(
        engine.loadManifest({
            sounds: [{ id: 'dup', url: '/a.wav' }],
            music: [{ id: 'dup', url: '/b.mp3' }],
        }),
        /Duplicate audio asset id: dup/,
    )
})

test('AudioEngine caches concurrent loads by URL', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest({
        sounds: [
            { id: 'a', url: '/same.wav' },
            { id: 'b', url: '/same.wav' },
        ],
    })

    assert.deepEqual(backend.loadCalls, ['/same.wav'])
})

test('AudioEngine addAssets merges new assets and rejects existing ids', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.addAssets({
        sounds: [{ id: 'local.pop', url: '/pop.wav' }],
        music: [{ id: 'local.loop', url: '/loop.mp3' }],
    })

    assert.deepEqual(engine.snapshot().assetCounts, { sounds: 4, music: 3, stingers: 1 })
    await assert.rejects(
        engine.addAssets({ sounds: [{ id: 'jump', url: '/other.wav' }] }),
        /Duplicate audio asset id: jump/,
    )
})

test('AudioEngine creates a fresh voice per SFX playback', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    engine.play('jump')
    engine.play('jump')
    await ready()

    assert.equal(backend.voices.length, 2)
    assert.notEqual(backend.voices[0], backend.voices[1])
    assert.equal(backend.voices[0]?.params.bus, 'sfx')
})

test('AudioEngine plays generated PCM on the UI bus and supports deferred unlock', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    const pcm = { samples: new Float32Array(3200), sampleRate: 32000 }

    const handle = engine.playGenerated('dialogue.voice.test', pcm, {
        volume: 0.4,
        deferUntilUnlocked: true,
    })
    await ready()
    assert.equal(backend.voices.length, 0)

    await engine.unlock()
    await ready()
    assert.equal(handle.stopped, false)
    assert.equal(backend.voices.length, 1)
    assert.equal(backend.voices[0]?.params.bus, 'ui')
    assert.equal(backend.voices[0]?.params.volume, 0.4)
})

test('AudioEngine defers opt-in SFX until unlock', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)

    engine.play('jump')
    const deferred = engine.play('hit', { deferUntilUnlocked: true })
    await ready()
    assert.equal(backend.voices.length, 0)

    await engine.unlock()
    await ready()
    assert.equal(backend.voices.length, 1)
    assert.equal(deferred.stopped, false)
})

test('AudioEngine snapshot reports pending sounds and current music', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)

    engine.play('jump', { deferUntilUnlocked: true })
    await engine.playMusic('bg')
    assert.equal(engine.snapshot().pendingSounds, 1)
    assert.equal(engine.snapshot().currentMusicId, 'bg')

    await engine.unlock()
    await ready()
    assert.equal(engine.snapshot().pendingSounds, 0)
    assert.equal(engine.snapshot().activeVoices, 1)
})

test('AudioEngine enforces max voices and steals lower-priority voices first', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend, maxVoices: 2 })
    await engine.loadManifest(manifest)
    await engine.unlock()

    engine.play('jump')
    backend.time += 0.1
    engine.play('hit')
    backend.time += 0.1
    engine.play('rare')
    await ready()

    assert.equal(backend.voices.length, 3)
    assert.equal(backend.voices[0]?.stopped, true)
    assert.equal(backend.voices[1]?.stopped, false)
    assert.equal(backend.voices[2]?.stopped, false)
})

test('AudioEngine clamps and applies bus volume and mute', () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })

    engine.setBusVolume('music', 0.42)
    engine.setBusVolume('sfx', 3)
    engine.mute(true)

    assert.equal(backend.busVolumes.get('music'), 0.42)
    assert.equal(backend.busVolumes.get('sfx'), 1)
    assert.equal(backend.muted, true)
})

test('AudioEngine crossfades music and disposes the old track when fade is zero', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    await engine.playMusic('bg', { crossfade: 0 })
    await engine.playMusic('boss', { crossfade: 0 })

    assert.equal(backend.musicPlayers.length, 2)
    assert.equal(backend.musicPlayers[0]?.disposed, true)
    assert.equal(backend.musicPlayers[1]?.played, true)
    assert.deepEqual(backend.musicPlayers[1]?.volumes, [0, 0.7])
})

test('AudioEngine stopMusic clears current music without stopping voices', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()
    engine.play('jump')
    await engine.playMusic('bg', { crossfade: 0 })
    await ready()

    engine.stopMusic(0)

    assert.equal(backend.musicPlayers[0]?.disposed, true)
    assert.equal(engine.snapshot().currentMusicId, null)
    assert.equal(engine.snapshot().activeVoices, 1)
})

test('AudioEngine removeAsset stops active voices and clears cached local assets', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.addAssets({ sounds: [{ id: 'local.one', url: '/local.wav' }] })
    await engine.unlock()

    engine.play('local.one')
    await ready()
    assert.equal(engine.removeAsset('local.one'), true)

    assert.equal(backend.voices[0]?.disposed, true)
    assert.equal(engine.snapshot().assetCounts.sounds, 3)
})

test('AudioEngine creates backend analysers by bus', () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    const analyser = engine.createAnalyser('music')

    assert.equal(analyser.bus, 'music')
    assert.equal(backend.analysers.length, 1)
})

test('AudioEngine disposes a newly-created music player when play fails', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()
    backend.failNextMusicPlay = true

    await assert.rejects(engine.playMusic('bg', { crossfade: 0 }), /music play failed/)

    assert.equal(backend.musicPlayers.length, 1)
    assert.equal(backend.musicPlayers[0]?.disposed, true)
})

test('AudioEngine stingers duck and restore the music bus', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend, stingerDuckVolume: 0.4 })
    await engine.loadManifest(manifest)
    await engine.unlock()
    engine.setBusVolume('music', 0.8)

    engine.playStinger('sting')
    await ready()
    assert.equal(Number(backend.busVolumes.get('music')?.toFixed(2)), 0.32)

    backend.voices[0]?.stop()
    assert.equal(backend.busVolumes.get('music'), 0.8)
})

test('AudioEngine dispose stops active voices and music', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    engine.play('jump')
    await engine.playMusic('bg', { crossfade: 0 })
    await ready()
    engine.dispose()

    assert.equal(backend.voices[0]?.disposed, true)
    assert.equal(backend.musicPlayers[0]?.disposed, true)
})

test('AudioEngine.playSpatial routes through the spatial backend path with merged defaults', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({
        backend,
        spatialDefaults: { refDistance: 2, maxDistance: 40, rolloffModel: 'exponential', panningModel: 'equalpower' },
    })
    await engine.loadManifest(manifest)
    await engine.unlock()

    const handle = engine.playSpatial('jump', { x: 3, y: 1, z: -4 }, { rolloffFactor: 0.5 })
    await ready()

    assert.equal(handle.spatial, true)
    const voice = backend.voices[0]
    assert.ok(voice instanceof FakeSpatialVoice, 'spatial backend path used')
    const spatial = voice as unknown as FakeSpatialVoice
    assert.deepEqual(spatial.positions[0], { x: 3, y: 1, z: -4 })
    // Engine defaults flow through when the call site doesn't override.
    assert.equal(spatial.params.refDistance, 2)
    assert.equal(spatial.params.maxDistance, 40)
    assert.equal(spatial.params.rolloffModel, 'exponential')
    assert.equal(spatial.params.panningModel, 'equalpower')
    // Per-call override wins over engine default.
    assert.equal(spatial.params.rolloffFactor, 0.5)
})

test('AudioEngine.playSpatial honours per-call overrides for falloff + panner', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    engine.playSpatial('jump', { x: 0, y: 0, z: 0 }, {
        refDistance: 5,
        maxDistance: 30,
        rolloffFactor: 1.5,
        rolloffModel: 'linear',
        panningModel: 'HRTF',
        coneInnerAngle: 120,
        coneOuterAngle: 200,
        coneOuterGain: 0.2,
    })
    await ready()

    const spatial = backend.voices[0] as unknown as FakeSpatialVoice
    assert.equal(spatial.params.refDistance, 5)
    assert.equal(spatial.params.maxDistance, 30)
    assert.equal(spatial.params.rolloffFactor, 1.5)
    assert.equal(spatial.params.rolloffModel, 'linear')
    assert.equal(spatial.params.coneInnerAngle, 120)
    assert.equal(spatial.params.coneOuterAngle, 200)
    assert.equal(spatial.params.coneOuterGain, 0.2)
})

test('AudioEngine.playSpatial clamps refDistance/maxDistance so backend never gets invalid values', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    // refDistance 0 would crash a real PannerNode; maxDistance below
    // refDistance is also illegal. The engine clamps both.
    engine.playSpatial('jump', { x: 0, y: 0, z: 0 }, { refDistance: 0, maxDistance: -1 })
    await ready()

    const spatial = backend.voices[0] as unknown as FakeSpatialVoice
    assert.ok(spatial.params.refDistance > 0, 'refDistance pushed off zero')
    assert.ok(spatial.params.maxDistance > spatial.params.refDistance, 'maxDistance pushed above ref')
})

test('SoundHandle.setPosition forwards to the underlying spatial voice and is no-op for stereo', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    const spatialHandle = engine.playSpatial('jump', { x: 0, y: 0, z: 0 })
    const stereoHandle = engine.play('jump')
    await ready()

    spatialHandle.setPosition({ x: 7, y: 2, z: -3 })
    stereoHandle.setPosition({ x: 999, y: 999, z: 999 }) // ignored

    const spatial = backend.voices[0] as unknown as FakeSpatialVoice
    assert.deepEqual(spatial.positions[spatial.positions.length - 1], { x: 7, y: 2, z: -3 })
})

test('AudioEngine.listener.setPose pushes through the backend', () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })

    engine.listener.setPose({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 })
    assert.equal(backend.listenerPoses.length, 1)
    assert.deepEqual(backend.listenerPoses[0]?.position, { x: 1, y: 2, z: 3 })
    assert.deepEqual(backend.listenerPoses[0]?.forward, { x: 0, y: 0, z: -1 })
    assert.deepEqual(backend.listenerPoses[0]?.up, { x: 0, y: 1, z: 0 })
})

test('attachToEntity tracks the handle for iteration; detach + voice-end clear it', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    const a = engine.playSpatial('jump', { x: 0, y: 0, z: 0 })
    const b = engine.playSpatial('jump', { x: 0, y: 0, z: 0 })
    await ready()
    engine.attachToEntity(a, 42, { x: 0, y: 1.6, z: 0 })
    engine.attachToEntity(b, 7)

    const ids = [...engine.iterateAttached()].map((e) => e.entityId).sort((x, y) => x - y)
    assert.deepEqual(ids, [7, 42])

    engine.detachFromEntity(a)
    assert.deepEqual([...engine.iterateAttached()].map((e) => e.entityId), [7])

    // When the underlying voice ends, the engine auto-cleans the attachment.
    backend.voices[1]?.stop()
    assert.equal([...engine.iterateAttached()].length, 0)
})

test('attachToEntity is a no-op for non-spatial handles', async () => {
    const backend = new FakeBackend()
    const engine = new AudioEngine({ backend })
    await engine.loadManifest(manifest)
    await engine.unlock()

    const stereo = engine.play('jump')
    await ready()
    engine.attachToEntity(stereo, 99)
    assert.equal([...engine.iterateAttached()].length, 0)
})
