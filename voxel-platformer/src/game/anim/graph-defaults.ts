// Default locomotion graph for humanoid characters. Pure data (no three), so it
// is shared by the runtime, the future authoring page, and unit tests.
//
// State ids equal clip ids equal the Blender REQUIRED_CLIP_IDS, so the same
// graph drives the code reference rig and an imported .glb identically.

import { LOCOMOTION_PARAM, type AnimGraphDef } from '../../engine/anim/core'

const P = LOCOMOTION_PARAM

// Speed thresholds (world units/s). Player default moveSpeed ≈ 5, so run kicks
// in around two-thirds of top speed; small hysteresis avoids walk/run flicker.
const WALK_ON = 0.6
const WALK_OFF = 0.4
const RUN_ON = 3.2
const RUN_OFF = 3.0
const LAND_SECONDS = 0.22

export const LOCOMOTION_GRAPH_ID = 'humanoid.locomotion'

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
