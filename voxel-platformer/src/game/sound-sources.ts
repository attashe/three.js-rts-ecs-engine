import { query } from 'bitecs'
import type { AudioEngine, SoundHandle, Vec3Like } from '../engine/audio'
import { PlayerControlled, Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'

/**
 * Authored audio data loaded by the level. Three flavours:
 *
 *  - **Point sources** (`SoundSourceConfig`) — `audio.playSpatial` at a
 *    fixed world position; falloff drives gain as the listener moves.
 *  - **Sound zones** (`SoundZoneConfig`) — AABB regions whose audio
 *    fades in while the player is inside the box and out when they
 *    leave. Pairs the spatial channel with "biome" behaviour.
 *  - **Environment** (`EnvironmentConfig`) — a single level-wide
 *    stereo ambient bed that plays as long as the level is alive.
 *
 * Each shape ships with its own runtime system; the editor writes
 * matching metadata and `level-from-meta` translates 1:1.
 */

/**
 * Fraction of a sound source's `radius` that sits inside the
 * full-volume "core" (the `refDistance` ring). Outside the core the
 * gain falls linearly to zero at `radius`. Exported so the editor's
 * source render system can draw the same falloff visualisation the
 * runtime audio engine will produce.
 */
export const SOURCE_CORE_RATIO = 0.3

export interface SoundSourceConfig {
    id: string
    soundId: string
    label?: string
    position: Vec3Like
    radius: number
    volume: number
    loop: boolean
    autoplay: boolean
}

export interface SoundZoneConfig {
    id: string
    label?: string
    min: { x: number; y: number; z: number }
    max: { x: number; y: number; z: number }
    soundId: string
    volume: number
    fadeTime: number
}

export interface EnvironmentConfig {
    soundId: string
    volume: number
}

export interface SoundSourceSystemOptions {
    /** Promise that resolves after the manifest is loaded. Without this,
     *  sources start immediately and unknown ids throw synchronously. */
    audioReady?: Promise<unknown>
    /** Fade applied when tearing down looped sources. */
    fadeOut?: number
}

/**
 * Static spatial emitters for level-authored ambience. The editor writes
 * these into level metadata; playtest registers every autoplay source here.
 */
export function createSoundSourceSystem(
    audio: AudioEngine,
    sources: readonly SoundSourceConfig[],
    opts: SoundSourceSystemOptions = {},
): System {
    const handles = new Map<string, SoundHandle>()
    let disposed = false

    function startAll(): void {
        if (disposed) return
        for (const source of sources) {
            if (!source.autoplay || handles.has(source.id)) continue
            try {
                const radius = clamp(source.radius, 0.5, 200)
                const handle = audio.playSpatial(source.soundId, source.position, {
                    deferUntilUnlocked: true,
                    loop: source.loop,
                    volume: clamp(source.volume, 0, 1),
                    // `radius` is the inaudible boundary; the inner
                    // full-gain core is `radius * SOURCE_CORE_RATIO`,
                    // giving every source the same proportional
                    // shape (~30 % full-gain core, ~70 % linear
                    // falloff zone). The previous clamp at 4 collapsed
                    // large sources to a tiny core with a huge falloff.
                    maxDistance: radius,
                    refDistance: Math.max(0.25, radius * SOURCE_CORE_RATIO),
                    rolloffModel: 'linear',
                })
                handles.set(source.id, handle)
            } catch (err) {
                console.warn(`Sound source "${source.label ?? source.id}" failed to start:`, err)
            }
        }
    }

    return {
        name: 'soundSources',
        init() {
            if (opts.audioReady) {
                void opts.audioReady.then(startAll).catch((err) => {
                    console.warn('Sound sources skipped because audio failed to initialise:', err)
                })
            } else {
                startAll()
            }
        },
        update() {},
        dispose() {
            disposed = true
            const fadeOut = Math.max(0, opts.fadeOut ?? 0.15)
            for (const handle of handles.values()) handle.stop(fadeOut)
            handles.clear()
        },
    }
}

interface ZoneRuntime {
    config: SoundZoneConfig
    handle: SoundHandle | null
    /** Faded gain, 0..1. Approaches `config.volume` while inside the
     *  zone, approaches 0 while outside. */
    gain: number
    inside: boolean
}

/**
 * Sound zone fader. Each frame, looks up the player's position, marks
 * which zones contain them, and ramps each zone's handle gain toward
 * its target (in-zone → `config.volume`, out → 0). Voices are spawned
 * the first time their zone goes "audible" and stay alive throughout
 * the level — much cheaper than rebuilding the audio graph on every
 * boundary crossing.
 *
 * Order is `RenderOrder.cameraFollow + 1` so the player's transform
 * has been updated for the frame before we sample it.
 */
export function createSoundZoneSystem(
    audio: AudioEngine,
    zones: readonly SoundZoneConfig[],
    opts: SoundSourceSystemOptions = {},
): System {
    const runtime: ZoneRuntime[] = zones.map((z) => ({ config: z, handle: null, gain: 0, inside: false }))
    let disposed = false
    let ready = false
    let armed = false

    function arm(): void {
        // Reserve the voices upfront with gain 0 so the in/out fades
        // are simple `setVolume(target, fadeTime)` calls — no spawn
        // latency on the first frame the player walks into the zone.
        for (const z of runtime) {
            const c = z.config
            const radius = Math.max(2, distance({ x: c.min.x, y: c.min.y, z: c.min.z }, { x: c.max.x, y: c.max.y, z: c.max.z }))
            try {
                const handle = audio.playSpatial(c.soundId, midpoint(c.min, c.max), {
                    deferUntilUnlocked: true,
                    loop: true,
                    volume: 0,
                    // Several zones may share one soundId (e.g. a level
                    // dotted with `AmbFire` zones). The asset's manifest
                    // `maxInstances` would silently steal the older
                    // voices once the cap is hit, leaving zones with a
                    // live handle but a dead voice — `setVolume` ramps
                    // become no-ops and the zone is permanently silent.
                    // Opt out of the per-asset cap; the global voice
                    // budget still applies.
                    maxInstances: Number.POSITIVE_INFINITY,
                    // Outrank ordinary SFX so a flurry of bow/hit
                    // sounds can't evict the always-on zone beds.
                    priority: 6,
                    maxDistance: radius * 2,
                    refDistance: Math.max(1, radius * 0.6),
                    rolloffModel: 'linear',
                })
                z.handle = handle
            } catch (err) {
                console.warn(`Sound zone "${c.label ?? c.id}" failed to start:`, err)
            }
        }
        armed = true
    }

    return {
        name: 'soundZones',
        order: RenderOrder.cameraFollow + 2,
        init() {
            if (opts.audioReady) void opts.audioReady.then(() => { ready = true })
            else ready = true
        },
        update(world, dt) {
            if (disposed) return
            if (!ready) return
            if (!armed) arm()
            if (runtime.length === 0) return

            // Player position — we drive the fade off whichever entity
            // holds PlayerControlled. Multi-player would need a per-zone
            // "any-player-inside" check; one player is the current case.
            const players = query(world, [Position, PlayerControlled])
            if (players.length === 0) return
            const pid = players[0]!
            const px = Position.x[pid]!
            const py = Position.y[pid]!
            const pz = Position.z[pid]!

            for (const z of runtime) {
                const c = z.config
                const inside = pointInAabb(px, py, pz, c.min, c.max)
                if (inside !== z.inside) {
                    z.inside = inside
                    if (z.handle) {
                        const target = inside ? clamp(c.volume, 0, 1) : 0
                        z.handle.setVolume(target, Math.max(0.05, c.fadeTime))
                    }
                }
                // Smoothed `gain` tracker for diagnostics; the handle
                // ramps itself in the audio graph.
                const target = inside ? c.volume : 0
                const k = Math.min(1, dt / Math.max(0.05, c.fadeTime))
                z.gain += (target - z.gain) * k
            }
        },
        dispose() {
            disposed = true
            const fadeOut = Math.max(0, opts.fadeOut ?? 0.15)
            for (const z of runtime) z.handle?.stop(fadeOut)
        },
    }
}

/**
 * Start a level-wide stereo ambient bed. Routes through the music bus
 * for music assets (so stinger-ducking still applies) and the sfx bus
 * for everything else. Returns a stop handle for sfx-bus tracks;
 * music-bus tracks are stopped via `audio.stopMusic`.
 *
 * Stereo on purpose — environment is "what the whole level sounds
 * like", not "something at a position". Spatial audio is for point
 * sources and zones.
 *
 * Caller is expected to pass the manifest so we can pick the bus
 * without poking at AudioEngine internals. `null` env / empty
 * `soundId` ⇒ nothing plays (the `(none)` case from the editor).
 */
export function startEnvironment(
    audio: AudioEngine,
    env: EnvironmentConfig | undefined,
    manifest: { music?: readonly { id: string }[]; sounds?: readonly { id: string }[] } | undefined,
): SoundHandle | null {
    if (!env || !env.soundId) return null
    const isMusic = manifest?.music?.some((a) => a.id === env.soundId) ?? false
    const volume = clamp(env.volume, 0, 1)
    try {
        if (isMusic) {
            // playMusic is async; we don't await — the deferred-unlock
            // queue handles the unlock-vs-call race internally.
            void audio.playMusic(env.soundId, { loop: true, volume, crossfade: 0.6 })
            return null
        }
        return audio.play(env.soundId, {
            deferUntilUnlocked: true,
            loop: true,
            volume,
        })
    } catch (err) {
        console.warn(`Environment "${env.soundId}" failed to start:`, err)
        return null
    }
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

function midpoint(a: Vec3Like, b: Vec3Like): Vec3Like {
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 }
}

function distance(a: Vec3Like, b: Vec3Like): number {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function pointInAabb(x: number, y: number, z: number, min: Vec3Like, max: Vec3Like): boolean {
    return x >= min.x && x < max.x && y >= min.y && y < max.y && z >= min.z && z < max.z
}
