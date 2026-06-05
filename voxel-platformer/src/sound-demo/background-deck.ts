import type { AudioEngine, SoundHandle } from '../engine/audio'

/**
 * "Background samples" deck — the replacement for the old single-
 * track music deck. The point is to let the user *layer* multiple
 * ambient sounds (rain + wind + cave music + magic shimmer) and
 * audition how a composition mixes, then drop spatial emitters on
 * top to verify the spatial layer sits well in that bed.
 *
 * Each row is one playable channel pinned to one asset. Channels are
 * stereo (no spatial position) so they read as "the music / the
 * ambience that surrounds the player" regardless of where the
 * listener avatar walks. Volume + loop + delay-before-start are
 * adjustable per channel.
 */

export interface BackgroundTrack {
    /** Asset id the channel plays. Constant for the lifetime of the track. */
    readonly assetId: string
    /** Display label shown in the deck. */
    label: string
    /** Mixer volume 0..1 — applied per-handle, multiplies the
     *  per-asset volume + the SFX bus. */
    volume: number
    /** Whether the channel should loop. Defaults to true for loop
     *  assets, false for one-shots. Stinger-style behaviour comes
     *  from setting loop=false. */
    loop: boolean
    /** Seconds to wait between Play and the first sample of audio.
     *  Useful for composition timing tests. */
    delay: number
    /** Whether this channel is the music-bus (vs. sfx-bus). Music
     *  pieces should be on `music` so the existing stinger-duck
     *  mechanic still works against them. */
    bus: 'music' | 'sfx'
    /** True while a voice (or a pending delay timer) is alive. */
    isPlaying: boolean
}

export interface DeckListener {
    /** Fires whenever any track's `isPlaying` flips. */
    onChange?(): void
}

export class BackgroundDeck {
    private tracks: BackgroundTrack[] = []
    private handles = new Map<BackgroundTrack, SoundHandle>()
    private timers = new Map<BackgroundTrack, ReturnType<typeof setTimeout>>()

    constructor(private readonly audio: AudioEngine, private readonly listener: DeckListener = {}) {}

    /** Replace the deck contents. Stops any in-flight playback. */
    setTracks(tracks: BackgroundTrack[]): void {
        this.stopAll()
        this.tracks = tracks.map((t) => ({ ...t }))
        this.listener.onChange?.()
    }

    list(): readonly BackgroundTrack[] {
        return this.tracks
    }

    update(assetId: string, patch: Partial<BackgroundTrack>): void {
        const track = this.tracks.find((t) => t.assetId === assetId)
        if (!track) return
        Object.assign(track, patch)
        // If volume changed and the voice is alive, ramp it.
        if (patch.volume !== undefined && track.isPlaying) {
            this.handles.get(track)?.setVolume(track.volume, 0.05)
        }
        this.listener.onChange?.()
    }

    /** Toggle play/stop for one track. */
    toggle(assetId: string): void {
        const track = this.tracks.find((t) => t.assetId === assetId)
        if (!track) return
        if (track.isPlaying) this.stop(track)
        else void this.play(track)
    }

    /** Force-start a track. Resolves once the play has been requested
     *  (not necessarily once audio is audible — see `delay`). */
    async play(track: BackgroundTrack): Promise<void> {
        if (track.isPlaying) return
        await this.audio.unlock()
        if (this.tracks.indexOf(track) < 0) return // removed mid-await
        track.isPlaying = true
        this.listener.onChange?.()
        const fire = () => {
            this.timers.delete(track)
            if (!track.isPlaying || this.tracks.indexOf(track) < 0) return
            const handle = this.spawn(track)
            this.handles.set(track, handle)
            handle.ended.then(() => {
                this.handles.delete(track)
                // Non-loop tracks flip themselves back to idle when
                // they finish. Loop tracks only flip when stopped
                // externally.
                if (!track.loop && track.isPlaying) {
                    track.isPlaying = false
                    this.listener.onChange?.()
                }
            })
        }
        if (track.delay > 0) {
            this.timers.set(track, setTimeout(fire, track.delay * 1000))
        } else {
            fire()
        }
    }

    stop(track: BackgroundTrack, fadeOut = 0.15): void {
        const timer = this.timers.get(track)
        if (timer) {
            clearTimeout(timer)
            this.timers.delete(track)
        }
        const handle = this.handles.get(track)
        if (handle) {
            handle.stop(fadeOut)
            this.handles.delete(track)
        }
        track.isPlaying = false
        this.listener.onChange?.()
    }

    stopAll(): void {
        for (const t of this.tracks) this.stop(t, 0.1)
    }

    private spawn(track: BackgroundTrack): SoundHandle {
        // Background tracks are stereo (no 3D position) — they belong
        // to the player, not the world. The `bus` decides whether
        // ducking applies (music bus only).
        if (track.bus === 'music') {
            // playMusic returns a Promise<void>; we need a stop handle
            // for the deck. Wrap into a tiny adapter.
            const adapter = new MusicHandleAdapter(track.assetId, () => this.audio.stopMusic(0.15))
            // Music API uses crossfade-based volume; sync once now.
            void this.audio.playMusic(track.assetId, { volume: track.volume, loop: track.loop, crossfade: 0.4 })
            return adapter
        }
        return this.audio.play(track.assetId, {
            volume: track.volume,
            loop: track.loop,
        })
    }
}

/**
 * Music doesn't return a SoundHandle (only Promise<void> + a separate
 * `stopMusic`). The deck wants a uniform handle interface, so we
 * wrap.
 */
class MusicHandleAdapter implements SoundHandle {
    readonly spatial = false
    private resolveEnded!: () => void
    private done = false
    readonly ended: Promise<void>

    constructor(readonly id: string, private readonly stopper: () => void) {
        this.ended = new Promise<void>((r) => { this.resolveEnded = r })
    }

    get stopped(): boolean { return this.done }

    stop(_fadeOut?: number): void {
        if (this.done) return
        this.done = true
        this.stopper()
        this.resolveEnded()
    }

    setVolume(): void { /* music volume is set via the next playMusic call */ }
    setPosition(): void { /* non-spatial */ }
}
