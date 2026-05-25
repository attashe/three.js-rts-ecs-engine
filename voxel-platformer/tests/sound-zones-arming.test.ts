import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine, type AudioAnalyser, type AudioBackend, type AudioBufferLike, type AudioBusId, type AudioMusicPlayer, type AudioVoice, type BufferPlaybackParams, type SpatialPlaybackParams, type Vec3Like } from '../src/engine/audio'
import { createGameWorld } from '../src/engine/ecs/world'
import { createSoundZoneSystem, type SoundZoneConfig } from '../src/game/sound-sources'

/**
 * Regression for the bug where many zones sharing one soundId would
 * silently steal each other's voices. The manifest's `maxInstances`
 * cap should NOT clamp armed zones, because each zone needs its own
 * live voice to drive the per-zone fade in/out.
 */

class StubBackend implements AudioBackend {
    unlocked = true
    voices: StubSpatialVoice[] = []

    get currentTime(): number { return 0 }
    async unlock(): Promise<void> {}
    async loadBuffer(): Promise<AudioBufferLike> { return { duration: 1 } }
    playBuffer(): AudioVoice { throw new Error('not used') }
    playSpatialBuffer(_buf: AudioBufferLike, params: SpatialPlaybackParams): AudioVoice {
        const voice = new StubSpatialVoice(params)
        this.voices.push(voice)
        return voice
    }
    setListenerPose(): void {}
    createMusic(): AudioMusicPlayer { throw new Error('not used') }
    createAnalyser(): AudioAnalyser { throw new Error('not used') }
    setBusVolume(): void {}
    setMuted(): void {}
    dispose(): void {}
}

class StubSpatialVoice implements AudioVoice {
    readonly startedAt = 0
    readonly spatial = true
    private stopped_ = false
    private callbacks: Array<() => void> = []

    constructor(readonly params: SpatialPlaybackParams) {}

    get stopped(): boolean { return this.stopped_ }
    stop(): void {
        if (this.stopped_) return
        this.stopped_ = true
        for (const cb of this.callbacks.splice(0)) cb()
    }
    setVolume(): void {}
    setPosition(_pos: Vec3Like): void {}
    onEnded(cb: () => void): void { if (this.stopped_) cb(); else this.callbacks.push(cb) }
    dispose(): void { this.stop() }
}

// 'amb' is the soundId every zone uses; the cap is intentionally smaller
// than the number of zones we'll create so we exercise the stealing path
// that the fix opts out of.
const ZONE_COUNT = 5
const MAX_INSTANCES = 2
const SOUND_ID = 'amb'

function manifest(): Parameters<AudioEngine['loadManifest']>[0] {
    return {
        sounds: [
            { id: SOUND_ID, url: '/amb.wav', loop: true, maxInstances: MAX_INSTANCES, priority: 1 },
        ],
    }
}

function zonesAt(count: number): SoundZoneConfig[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `zone-${i}`,
        min: { x: i * 10, y: 0, z: 0 },
        max: { x: i * 10 + 4, y: 4, z: 4 },
        soundId: SOUND_ID,
        volume: 0.5,
        fadeTime: 0.5,
    }))
}

test('Sound zones sharing one soundId all keep live voices past the manifest maxInstances cap', async () => {
    const backend = new StubBackend()
    const audio = new AudioEngine({ backend })
    await audio.loadManifest(manifest())

    const world = createGameWorld()
    const system = createSoundZoneSystem(audio, zonesAt(ZONE_COUNT))

    // Init schedules arm()-via-audioReady; here we have no audioReady
    // so init/start happens lazily on the first update tick.
    system.init?.(world)
    system.update(world, 1 / 60)
    // Arm spins up the voices through async loadBuffer → wait for the
    // microtask queue to drain.
    await new Promise<void>((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setTimeout(r, 0))

    assert.equal(
        backend.voices.length,
        ZONE_COUNT,
        `expected ${ZONE_COUNT} spatial voices, got ${backend.voices.length}`,
    )
    const live = backend.voices.filter((v) => !v.stopped)
    assert.equal(
        live.length,
        ZONE_COUNT,
        `expected all ${ZONE_COUNT} voices alive (maxInstances=${MAX_INSTANCES} should not steal zone voices)`,
    )
})
