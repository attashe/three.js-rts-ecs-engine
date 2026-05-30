// Pure mapping from gameplay signals → animation param bag.
//
// This is the ECS adapter logic kept deliberately free of `three` and of bitecs
// so the threshold/encoding decisions are unit-testable. The animation-system
// gathers the raw signals from components and calls this; the graph's conditions
// reference the param names below.

import type { AnimParamBag } from './conditions'

/** Param names the default locomotion graph reads. Keep in sync with
 *  graph-defaults.ts conditions. */
export const LOCOMOTION_PARAM = {
    /** Horizontal speed magnitude (world units / s). */
    speed: 'speed',
    /** Vertical velocity (world units / s); + up, − down. */
    vy: 'vy',
    /** 1 when standing on a surface, else 0. */
    grounded: 'grounded',
    /** 1 when horizontally blocked by a wall, else 0. */
    blocked: 'blocked',
    /** MovementStateId mirror (idle/moving/airborne/blocked/repathing). */
    moveState: 'moveState',
} as const

export interface LocomotionSignals {
    speedXZ: number
    vy: number
    grounded: boolean
    blocked: boolean
    movementState: number
}

export function computeLocomotionParams(s: LocomotionSignals): AnimParamBag {
    return {
        [LOCOMOTION_PARAM.speed]: s.speedXZ,
        [LOCOMOTION_PARAM.vy]: s.vy,
        [LOCOMOTION_PARAM.grounded]: s.grounded ? 1 : 0,
        [LOCOMOTION_PARAM.blocked]: s.blocked ? 1 : 0,
        [LOCOMOTION_PARAM.moveState]: s.movementState,
    }
}
