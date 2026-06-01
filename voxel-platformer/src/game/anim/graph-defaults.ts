// Default locomotion graph for humanoid characters. Pure data (no three), so it
// is shared by the runtime, the future authoring page, and unit tests.
//
// State ids equal clip ids equal the Blender REQUIRED_CLIP_IDS, so the same
// graph drives the code reference rig and an imported .glb identically.

import { LOCOMOTION_PARAM, type AnimGraphDef } from '../../engine/anim/core'
import { HUMANOID_ANIM_TIMINGS } from './clip-timings'

const P = LOCOMOTION_PARAM

// Speed thresholds (world units/s). Player default moveSpeed ≈ 5, so run kicks
// in around two-thirds of top speed; small hysteresis avoids walk/run flicker.
const WALK_ON = 0.6
const WALK_OFF = 0.4
const RUN_ON = 3.2
const RUN_OFF = 3.0
const LAND_SECONDS = HUMANOID_ANIM_TIMINGS.land
const ATTACK_SECONDS = HUMANOID_ANIM_TIMINGS.attack
const ATTACK_WIDE_SECONDS = HUMANOID_ANIM_TIMINGS.attackWide
const STAFF_ATTACK_SECONDS = HUMANOID_ANIM_TIMINGS.staffAttack
const HAMMER_ATTACK_SECONDS = HUMANOID_ANIM_TIMINGS.hammerAttack
const SHOOT_SECONDS = HUMANOID_ANIM_TIMINGS.shoot
// Duration of the `die` topple before settling into the held `dead` pose.
const DIE_SECONDS = HUMANOID_ANIM_TIMINGS.die

/** Living states death can interrupt. Enumerated (rather than `from: '*'`) so the
 *  terminal `dead` state can't re-trigger `die` on itself. */
const LIVING_STATES = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'attack', 'attackWide', 'staffAttack', 'hammerAttack', 'shoot', 'shieldBlock'] as const
/** States where player/NPC combat may start. Airborne and terminal states are
 *  deliberately excluded so attack/shoot clips do not fight jump/death poses. */
const GROUNDED_COMBAT_START_STATES = ['idle', 'walk', 'run', 'land'] as const

export const LOCOMOTION_GRAPH_ID = 'humanoid.locomotion'
export const COMBAT_GRAPH_ID = 'humanoid.combatLocomotion'

/** Param names for the combat overlay. `attack` (melee thrust), `attackWide`
 *  (wide slash), `staffAttack` (staff bonk), `hammerAttack` (heavy NPC slam),
 *  and `shoot` (bow) are one-shot triggers; `shieldBlock` is held while
 *  guarding; `dead` latches once set. */
export const COMBAT_PARAM = {
    attack: 'attack',
    attackWide: 'attackWide',
    staffAttack: 'staffAttack',
    hammerAttack: 'hammerAttack',
    shoot: 'shoot',
    shieldBlock: 'shieldBlock',
    dead: 'dead',
} as const

export function locomotionGraph(): AnimGraphDef {
    return {
        schemaVersion: 1,
        id: LOCOMOTION_GRAPH_ID,
        initial: 'idle',
        params: [
            { name: P.speed, default: 0 },
            { name: P.vy, default: 0 },
            { name: P.grounded, default: 1 },
            { name: P.blocked, default: 0 },
            { name: P.moveState, default: 0 },
        ],
        states: [
            { id: 'idle', loop: 'loop' },
            { id: 'walk', loop: 'loop', syncToSpeed: true, syncRefSpeed: 1.8 },
            { id: 'run', loop: 'loop', syncToSpeed: true, syncRefSpeed: 4.6 },
            { id: 'jump', loop: 'clamp' },
            { id: 'fall', loop: 'loop' },
            { id: 'land', loop: 'once' },
        ],
        transitions: [
            // Airborne wins over everything (high priority, no debounce).
            { from: '*', to: 'jump', priority: 100, blendSeconds: 0.08,
                conditions: [{ param: P.grounded, op: '==', value: 0 }, { param: P.vy, op: '>=', value: 0.5 }] },
            { from: '*', to: 'fall', priority: 90, blendSeconds: 0.12,
                conditions: [{ param: P.grounded, op: '==', value: 0 }, { param: P.vy, op: '<', value: 0.5 }] },

            // Touchdown from the air → brief land state.
            { from: 'jump', to: 'land', priority: 80, blendSeconds: 0.06,
                conditions: [{ param: P.grounded, op: '==', value: 1 }] },
            { from: 'fall', to: 'land', priority: 80, blendSeconds: 0.06,
                conditions: [{ param: P.grounded, op: '==', value: 1 }] },

            // Land recovery, after the land clip has had time to read.
            { from: 'land', to: 'run', priority: 12, minTimeInState: LAND_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'land', to: 'walk', priority: 11, minTimeInState: LAND_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'land', to: 'idle', priority: 10, minTimeInState: LAND_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },

            // Ground locomotion (grounded-gated so it never fires mid-air).
            { from: 'idle', to: 'walk',
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'walk', to: 'idle',
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<', value: WALK_OFF }] },
            { from: 'walk', to: 'run',
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'run', to: 'walk',
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<', value: RUN_OFF }] },
            { from: 'run', to: 'idle',
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<', value: WALK_OFF }] },
        ],
    }
}

/**
 * Locomotion + combat: the base graph plus a one-shot `attack` swing and a
 * terminal `dead` state. Used by the part-based player/NPC rigs. The reference
 * rig / glb path keeps using `locomotionGraph()` (which has no attack/die clips).
 */
export function combatLocomotionGraph(): AnimGraphDef {
    const base = locomotionGraph()
    const C = COMBAT_PARAM
    return {
        ...base,
        id: COMBAT_GRAPH_ID,
        params: [
            ...base.params ?? [],
            { name: C.attack, default: 0, trigger: true },
            { name: C.attackWide, default: 0, trigger: true },
            { name: C.staffAttack, default: 0, trigger: true },
            { name: C.hammerAttack, default: 0, trigger: true },
            { name: C.shoot, default: 0, trigger: true },
            { name: C.shieldBlock, default: 0 },
            { name: C.dead, default: 0 },
        ],
        states: [
            ...base.states,
            { id: 'attack', loop: 'once' },
            { id: 'attackWide', loop: 'once' },
            { id: 'staffAttack', loop: 'once' },
            { id: 'hammerAttack', loop: 'once' },
            { id: 'shoot', loop: 'once' },
            { id: 'shieldBlock', loop: 'clamp' },
            // Death: `die` topples the body (clamps its last frame), then settles
            // into the looping `dead` lying pose. Both terminal.
            { id: 'die', loop: 'clamp' },
            { id: 'dead', loop: 'loop' },
        ],
        transitions: [
            // Death preempts everything: each living state can fall into `die`.
            ...LIVING_STATES.map((from) => ({
                from, to: 'die', priority: 1000, blendSeconds: 0.12,
                conditions: [{ param: C.dead, op: '==' as const, value: 1 }],
            })),
            // Settle into the held lying pose once the topple has played out.
            { from: 'die', to: 'dead', priority: 1000, minTimeInState: DIE_SECONDS,
                conditions: [{ param: C.dead, op: '==', value: 1 }] },
            // Attack: one-shot, grounded-only. Airborne and terminal states
            // ignore the trigger instead of letting the weapon pose fight
            // jump/fall/death.
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'attack', priority: 200, blendSeconds: 0.06,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.attack, op: '==' as const, value: 1 }],
            })),
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'attackWide', priority: 200, blendSeconds: 0.06,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.attackWide, op: '==' as const, value: 1 }],
            })),
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'staffAttack', priority: 210, blendSeconds: 0.08,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.staffAttack, op: '==' as const, value: 1 }],
            })),
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'hammerAttack', priority: 220, blendSeconds: 0.1,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.hammerAttack, op: '==' as const, value: 1 }],
            })),
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'shieldBlock', priority: 170, blendSeconds: 0.08,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.shieldBlock, op: '==' as const, value: 1 }],
            })),
            // Return to locomotion once the swing has read.
            { from: 'attack', to: 'run', priority: 12, minTimeInState: ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'attack', to: 'walk', priority: 11, minTimeInState: ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'attack', to: 'idle', priority: 10, minTimeInState: ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            { from: 'attackWide', to: 'run', priority: 12, minTimeInState: ATTACK_WIDE_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'attackWide', to: 'walk', priority: 11, minTimeInState: ATTACK_WIDE_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'attackWide', to: 'idle', priority: 10, minTimeInState: ATTACK_WIDE_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            { from: 'staffAttack', to: 'run', priority: 12, minTimeInState: STAFF_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'staffAttack', to: 'walk', priority: 11, minTimeInState: STAFF_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'staffAttack', to: 'idle', priority: 10, minTimeInState: STAFF_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            { from: 'hammerAttack', to: 'run', priority: 12, minTimeInState: HAMMER_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'hammerAttack', to: 'walk', priority: 11, minTimeInState: HAMMER_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'hammerAttack', to: 'idle', priority: 10, minTimeInState: HAMMER_ATTACK_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            // Shoot: one-shot bow draw + release, same grounded-only start rule.
            ...GROUNDED_COMBAT_START_STATES.map((from) => ({
                from, to: 'shoot', priority: 200, blendSeconds: 0.06,
                conditions: [{ param: P.grounded, op: '==' as const, value: 1 }, { param: C.shoot, op: '==' as const, value: 1 }],
            })),
            { from: 'shoot', to: 'run', priority: 12, minTimeInState: SHOOT_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'shoot', to: 'walk', priority: 11, minTimeInState: SHOOT_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'shoot', to: 'idle', priority: 10, minTimeInState: SHOOT_SECONDS,
                conditions: [{ param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            { from: 'shieldBlock', to: 'run', priority: 12, blendSeconds: 0.08,
                conditions: [{ param: C.shieldBlock, op: '==', value: 0 }, { param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: RUN_ON }] },
            { from: 'shieldBlock', to: 'walk', priority: 11, blendSeconds: 0.08,
                conditions: [{ param: C.shieldBlock, op: '==', value: 0 }, { param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '>', value: WALK_ON }] },
            { from: 'shieldBlock', to: 'idle', priority: 10, blendSeconds: 0.08,
                conditions: [{ param: C.shieldBlock, op: '==', value: 0 }, { param: P.grounded, op: '==', value: 1 }, { param: P.speed, op: '<=', value: WALK_ON }] },
            ...base.transitions,
        ],
    }
}
