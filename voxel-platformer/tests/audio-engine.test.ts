import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine, type AudioBackend, type AudioBufferLike, type AudioBusId, type AudioMusicPlayer, type AudioVoice, type BufferPlaybackParams } from '../src/engine/audio'

class FakeBackend implements AudioBackend {
    time = 0
    isUnlocked = false
    loadCalls: string[] = []
    voices: FakeVoice[] = []
    musicPlayers: FakeMusicPlayer[] = []
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

    playBuffer(_buffer: AudioBufferLike, params: BufferPlaybackParams): AudioVoice {
        const voice = new FakeVoice(this.time, params)
        this.voices.push(voice)
        return voice
    }

    createMusic(url: string, bus: Exclude<AudioBusId, 'master'>): AudioMusicPlayer {
        const player = new FakeMusicPlayer(url, bus, this.failNextMusicPlay)
        this.failNextMusicPlay = false
        this.musicPlayers.push(player)
        return player
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

class FakeVoice implements AudioVoice {
    callbacks: Array<() => void> = []
    volumes: number[] = []
    didStop = false
    disposed = false

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

    stop(): void {
        this.didStop = true
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
