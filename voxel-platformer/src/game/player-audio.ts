import { hasComponent, query } from 'bitecs'
import type { AudioEngine } from '../engine/audio'
import { Grounded, PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import { GameAudio } from './audio'

/** Footstep surface family the player is currently walking on. */
export type FootstepSurface = 'grass' | 'dirt' | 'stone' | 'wood' | 'water'

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
    /** Round-robin index into the active surface's footstep pool. */
    stepIdx: number
    /** Last post-physics foot position. Footsteps use real movement
     *  instead of intended velocity so collisions and acceleration stay
     *  audible in sync with what the player sees. */
    lastX: number
    lastZ: number
    /** True while the player is actively walking on the ground. Used to
     *  give the first audible step a short lead-in instead of waiting a
     *  whole stride from standstill. */
    walking: boolean
}

export interface PlayerLocomotionAudioOptions {
    /** World-units between footsteps at the player's full walking
     *  speed. Lower = more frequent. Default 1.38 — a brisk natural
     *  cadence given the demo player's 5 m/s top speed. */
    stepDistance?: number
    /** Minimum airborne seconds before a landing fires. Stops a single
     *  bumpy ledge from registering as "jump+land+jump+land". Default
     *  0.12. */
    minAirTimeForLand?: number
    /** Don't fire a footstep below this horizontal speed — keeps the
     *  cadence from triggering when the player is just nudging a wall. */
    minHorizontalSpeed?: number
    /** Voxel world. When omitted, footsteps always pick the `dirt`
     *  pool — the same behaviour as a level without authored geometry
     *  metadata. */
    chunks?: ChunkManager
}

const FOOTSTEP_POOLS: Record<FootstepSurface, readonly string[]> = {
    grass: [GameAudio.FootstepGrass1, GameAudio.FootstepGrass2],
    dirt:  [GameAudio.FootstepDirt1,  GameAudio.FootstepDirt2],
    stone: [GameAudio.FootstepStone1, GameAudio.FootstepStone2],
    wood:  [GameAudio.FootstepWood1,  GameAudio.FootstepWood2],
    water: [GameAudio.FootstepWater1, GameAudio.FootstepWater2],
}

/**
 * Classify a palette block id into a footstep surface family. Default
 * is `dirt` — keeps unauthored / unknown blocks audible without
 * needing a per-block table. Water has special handling at the
 * locomotion layer (player walking *into* water uses splash steps
 * even though the block under their feet may be solid).
 */
export function surfaceForBlock(block: number): FootstepSurface {
    switch (block) {
        case BLOCK.grass: return 'grass'
        case BLOCK.leaf:  return 'grass'
        case BLOCK.dirt:  return 'dirt'
        case BLOCK.sand:  return 'dirt'
        case BLOCK.stone: return 'stone'
        case BLOCK.brick: return 'stone'
        case BLOCK.glow:  return 'stone'
        case BLOCK.noWalk: return 'stone'
        case BLOCK.door:  return 'wood'
        case BLOCK.wood:  return 'wood'
        case BLOCK.plank: return 'wood'
        case BLOCK.water: return 'water'
        default: return 'dirt'
    }
}

/**
 * Plays footstep + landing cues for `PlayerControlled` entities.
 *
 * Footsteps: post-physics distance-driven cadence (not time-driven) so
 * the cadence follows the movement that actually happened, including
 * acceleration and blocked movement. Surface is queried from the
 * voxel one cell under the player's feet (or the voxel the foot is
 * in, when wading through water). Two variants per surface rotate
 * round-robin and each play gets a small random pitch jitter so the
 * pattern doesn't read as a metronome.
 *
 * Landings: edge-detect the `Grounded` tag. Only fires after
 * `minAirTimeForLand` so a player walking off a 1-voxel kerb doesn't
 * make a thud; landing volume + pitch scale with the inbound vertical
 * speed so a 4-block drop sounds heavier than a hop. The land cue
 * uses the surface the player landed on (water lands splash, stone
 * lands clack).
 *
 * Runs in the fixed-step bucket after physics so the Grounded tag we
 * read this frame is the one physics just wrote.
 */
export function createPlayerLocomotionAudioSystem(
    audio: AudioEngine,
    opts: PlayerLocomotionAudioOptions = {},
): System {
    const stepDistance = opts.stepDistance ?? 1.38
    const minAirTime = opts.minAirTimeForLand ?? 0.12
    const minHorizontalSpeed = opts.minHorizontalSpeed ?? 0.6
    const chunks = opts.chunks
    const states = new Map<number, PlayerState>()

    function surfaceUnder(eid: number): FootstepSurface {
        if (!chunks) return 'dirt'
        const px = Math.floor(Position.x[eid]!)
        const py = Math.floor(Position.y[eid]!)
        const pz = Math.floor(Position.z[eid]!)
        // First check the voxel the foot is inside — wading through
        // water reads as water steps even when there's solid ground
        // below.
        const foot = chunks.getVoxel(px, py, pz)
        if (foot === BLOCK.water) return 'water'
        // Otherwise the voxel directly below the foot (the actual
        // contact surface).
        const below = chunks.getVoxel(px, py - 1, pz)
        return surfaceForBlock(below)
    }

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
                    state = {
                        grounded,
                        airTime: 0,
                        stepPhase: 0,
                        stepIdx: 0,
                        lastX: Position.x[eid]!,
                        lastZ: Position.z[eid]!,
                        walking: false,
                    }
                    states.set(eid, state)
                    continue
                }

                const wasGrounded = state.grounded

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
                    const surface = surfaceUnder(eid)
                    // Water + grass landings use a heavier footstep
                    // from the same surface as the impact cue (splash
                    // or rustle reads as "land" naturally). Other
                    // surfaces use the dedicated `Land` thud which has
                    // more low-end body than any single footstep.
                    if (surface === 'water' || surface === 'grass') {
                        const pool = FOOTSTEP_POOLS[surface]
                        const id = pool[state.stepIdx % pool.length]!
                        audio.play(id, {
                            deferUntilUnlocked: true,
                            volume: Math.min(1, volume * 1.2),
                            rate,
                        })
                    } else {
                        audio.play(GameAudio.Land, {
                            deferUntilUnlocked: true,
                            volume,
                            rate,
                        })
                    }
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
                    const dx = Position.x[eid]! - state.lastX
                    const dz = Position.z[eid]! - state.lastZ
                    const moved = Math.hypot(dx, dz)
                    if (wasGrounded && speed >= minHorizontalSpeed && moved > 0.0005) {
                        if (!state.walking) {
                            state.stepPhase = Math.max(state.stepPhase, stepDistance * 0.55)
                        }
                        state.walking = true
                        // Clamp one-frame movement contribution so teleports
                        // or correction snaps do not dump several footfalls.
                        state.stepPhase += Math.min(moved, stepDistance * 0.75)
                        if (state.stepPhase >= stepDistance) {
                            state.stepPhase -= stepDistance
                            const surface = surfaceUnder(eid)
                            const pool = FOOTSTEP_POOLS[surface]
                            const id = pool[state.stepIdx % pool.length]!
                            state.stepIdx++
                            audio.play(id, {
                                deferUntilUnlocked: true,
                                rate: 0.94 + Math.random() * 0.12,
                                volume: 0.85 + Math.random() * 0.15,
                            })
                        }
                    } else {
                        state.walking = false
                        // Decay the phase so the first step after
                        // stopping doesn't fire instantly from
                        // accumulated buffer.
                        state.stepPhase *= Math.exp(-6 * dt)
                    }
                }

                state.grounded = grounded
                state.lastX = Position.x[eid]!
                state.lastZ = Position.z[eid]!
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
