import { hasComponent, query } from 'bitecs'
import type { AudioEngine } from '../engine/audio'
import { Grounded, PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import { GameAudio } from './audio'

interface PlayerState {
    /** True last frame — used to detect the false→true transition that
     *  defines a landing. */
    grounded: boolean
    /** Seconds spent continuously airborne. We use this both to
     *  suppress phantom-landing on a single bumpy step and to scale
     *  landing volume / pitch with how big the drop was. */
    airTime: number
    /** Distance-since-last-step accumulator. Resets on each footstep
     *  trigger and on takeoff so we don't fire mid-air. */
    stepPhase: number
    /** Round-robin index into the footstep variant pool. */
    stepIdx: number
}

export interface PlayerLocomotionAudioOptions {
    /** World-units between footsteps at the player's full walking
     *  speed. Lower = more frequent. Default 1.6 — a brisk natural
     *  cadence given the demo player's 5 m/s top speed. */
    stepDistance?: number
    /** Minimum airborne seconds before a landing fires. Stops a single
     *  bumpy ledge from registering as "jump+land+jump+land". Default
     *  0.12. */
    minAirTimeForLand?: number
    /** Don't fire a footstep below this horizontal speed — keeps the
     *  cadence from triggering when the player is just nudging a wall. */
    minHorizontalSpeed?: number
}

const FOOTSTEP_IDS = [GameAudio.Footstep1, GameAudio.Footstep2, GameAudio.Footstep3] as const

/**
 * Plays footstep + landing cues for `PlayerControlled` entities.
 *
 * Footsteps: distance-driven cadence (not time-driven) so the cadence
 * scales naturally with movement speed without us baking in a BPM.
 * Three variants cycle round-robin and each instance gets a small
 * random pitch jitter so the pattern doesn't read as a metronome.
 *
 * Landings: edge-detect the `Grounded` tag. Only fires after
 * `minAirTimeForLand` so a player walking off a 1-voxel kerb doesn't
 * make a thud; landing volume + pitch scale with the inbound vertical
 * speed so a 4-block drop sounds heavier than a hop.
 *
 * Runs in the fixed-step bucket after physics so the Grounded tag we
 * read this frame is the one physics just wrote.
 */
export function createPlayerLocomotionAudioSystem(
    audio: AudioEngine,
    opts: PlayerLocomotionAudioOptions = {},
): System {
    const stepDistance = opts.stepDistance ?? 1.6
    const minAirTime = opts.minAirTimeForLand ?? 0.12
    const minHorizontalSpeed = opts.minHorizontalSpeed ?? 0.6
    const states = new Map<number, PlayerState>()

    return {
        name: 'playerLocomotionAudio',
        fixed: true,
        order: FixedOrder.postPhysics + 5,
        update(world, dt) {
            const eids = query(world, [PlayerControlled, Position, Velocity])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]!
                const grounded = hasComponent(world, eid, Grounded)
                let state = states.get(eid)
                if (!state) {
                    state = { grounded, airTime: 0, stepPhase: 0, stepIdx: 0 }
                    states.set(eid, state)
                    continue
                }

                // ── Landing edge ────────────────────────────────────
                // We sampled Velocity.y before physics zeroed it on
                // ground contact, so the "inbound speed" we want is
                // last frame's vy. Reading vy now would be 0 — we
                // approximate from airTime + gravity instead.
                if (grounded && !state.grounded && state.airTime >= minAirTime) {
                    // Approximate inbound speed: airTime * gravity (24 m/s²)
                    // clamped to the engine's terminal fall (40). Maps to
                    // 0.6..1.0 volume and 0.92..1.06 rate for variety.
                    const approxInbound = Math.min(40, state.airTime * 24)
                    const heaviness = Math.min(1, approxInbound / 12) // 0..1
                    const volume = 0.65 + 0.35 * heaviness
                    const rate = 1.06 - 0.14 * heaviness + (Math.random() - 0.5) * 0.04
                    audio.play(GameAudio.Land, {
                        deferUntilUnlocked: true,
                        volume,
                        rate,
                    })
                }

                // ── Airborne / step bookkeeping ─────────────────────
                if (!grounded) {
                    state.airTime += dt
                    // Reset step phase so we don't dump a footstep the
                    // instant we touch down.
                    state.stepPhase = 0
                } else {
                    state.airTime = 0
                    const vx = Velocity.x[eid]!
                    const vz = Velocity.z[eid]!
                    const speed = Math.hypot(vx, vz)
                    if (speed >= minHorizontalSpeed) {
                        state.stepPhase += speed * dt
                        if (state.stepPhase >= stepDistance) {
                            state.stepPhase -= stepDistance
                            const id = FOOTSTEP_IDS[state.stepIdx % FOOTSTEP_IDS.length]!
                            state.stepIdx++
                            audio.play(id, {
                                deferUntilUnlocked: true,
                                rate: 0.94 + Math.random() * 0.12,
                                volume: 0.85 + Math.random() * 0.15,
                            })
                        }
                    } else {
                        // Decay the phase so the first step after
                        // stopping doesn't fire instantly from
                        // accumulated buffer.
                        state.stepPhase *= Math.exp(-6 * dt)
                    }
                }

                state.grounded = grounded
            }

            // Garbage-collect state for retired players (e.g. on death).
            if (states.size > eids.length) {
                const live = new Set(eids)
                for (const key of states.keys()) {
                    if (!live.has(key)) states.delete(key)
                }
            }
        },
    }
}
