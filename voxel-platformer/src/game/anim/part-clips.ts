// Procedural clips for the part-based humanoid (main character / keeper / troll).
// Tracks target the named nodes from main-character.ts: the upper-body pivot
// `Chest` (lean / twist), the limb pivots `LegL/R` + `UpperArmL/R`, and the
// whole-body wrapper `Figure` (the death topple). Same clip ids as the reference
// rig so the combat-locomotion graph drives either interchangeably.

import { eulerQuatTrack, type ProcClipDef } from '../../engine/anim'

type E3 = [number, number, number]

/** Symmetric arm/leg swing: arms counter-swing the same-side leg, with a small
 *  forward torso lean. The lean rides the `Chest` pivot, so the head and arms
 *  bend with the torso instead of detaching from it. */
function limbCycle(name: string, duration: number, amp: number, lean: number): ProcClipDef {
    const half = duration / 2
    const swing = (sign: number): Array<{ t: number; e: E3 }> => [
        { t: 0, e: [sign * amp, 0, 0] },
        { t: half, e: [-sign * amp, 0, 0] },
        { t: duration, e: [sign * amp, 0, 0] },
    ]
    return {
        name,
        duration,
        tracks: [
            eulerQuatTrack('Chest', [{ t: 0, e: [lean, 0, 0] }, { t: duration, e: [lean, 0, 0] }]),
            eulerQuatTrack('LegR', swing(1)),
            eulerQuatTrack('LegL', swing(-1)),
            eulerQuatTrack('UpperArmR', swing(-1)),
            eulerQuatTrack('UpperArmL', swing(1)),
        ],
    }
}

export function partCharacterClips(): ProcClipDef[] {
    return [
        {
            name: 'idle', duration: 2.0, tracks: [
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.03, 0, 0] }, { t: 2, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.06, 0, 0] }, { t: 2, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.06, 0, 0] }, { t: 2, e: [0, 0, 0] }]),
            ],
        },
        limbCycle('walk', 0.8, 0.5, 0.05),
        limbCycle('run', 0.55, 0.95, 0.2),
        {
            name: 'jump', duration: 0.4, tracks: [
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [-0.12, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [-2.0, 0, 0] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [-2.0, 0, 0] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [0.7, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [0.5, 0, 0] }]),
            ],
        },
        {
            name: 'fall', duration: 0.7, tracks: [
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [-1.5, 0, 0] }, { t: 0.35, e: [-1.8, 0, 0] }, { t: 0.7, e: [-1.5, 0, 0] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [-1.5, 0, 0] }, { t: 0.35, e: [-1.8, 0, 0] }, { t: 0.7, e: [-1.5, 0, 0] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [-0.3, 0, 0] }, { t: 0.35, e: [0.1, 0, 0] }, { t: 0.7, e: [-0.3, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0.1, 0, 0] }, { t: 0.35, e: [-0.3, 0, 0] }, { t: 0.7, e: [0.1, 0, 0] }]),
            ],
        },
        {
            name: 'land', duration: 0.3, tracks: [
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.25, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.6, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.6, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
            ],
        },
        {
            // Horizontal sword swipe: the right arm lifts to shoulder height and
            // the chest yaws right→left, sweeping the blade through a flat arc in
            // front of the body. A horizontal slash reads far better from the iso
            // camera than a vertical chop. The whole upper body turns together
            // (chest yaw carries head + both arms + held sword). Hit reads
            // ~mid-clip; the damage hitbox is gameplay-side, not clip-bound.
            name: 'attack', duration: 0.42, tracks: [
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0, 0.5, 0] }, { t: 0.3, e: [0, -0.7, 0] }, { t: 0.42, e: [0, 0, 0] }]),
                // Arm raised forward to horizontal (-1.5 about X), swung across in
                // yaw with the chest; a touch of extra arm yaw leads the blade.
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [-1.5, 0.5, 0] }, { t: 0.3, e: [-1.45, -0.5, 0] }, { t: 0.42, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0] }, { t: 0.15, e: [-0.2, -0.3, 0.2] }, { t: 0.42, e: [0, 0, 0] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.3, e: [-0.2, 0, 0] }, { t: 0.42, e: [0, 0, 0] }]),
            ],
        },
        {
            // Bow shot: chest turns side-on (archer's stance, reads well from
            // iso), the left arm pushes the bow out front and holds steady, the
            // right arm draws the string back to the cheek, then the release
            // snaps it forward. The held bow (left hand) sells the motion.
            name: 'shoot', duration: 0.6, tracks: [
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.16, e: [0, 0.45, 0] }, { t: 0.45, e: [0, 0.45, 0] }, { t: 0.6, e: [0, 0, 0] }]),
                // Bow arm: out front, level, dead steady through the draw.
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0] }, { t: 0.16, e: [-1.5, -0.1, 0] }, { t: 0.5, e: [-1.5, -0.1, 0] }, { t: 0.6, e: [0, 0, 0] }]),
                // Draw arm: up to the string, pull back (elbow swings out), hold,
                // then release snaps it back toward the bow.
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, 0] }, { t: 0.16, e: [-1.4, 0.35, 0] }, { t: 0.42, e: [-1.3, 0.95, 0] }, { t: 0.48, e: [-1.45, 0.15, 0] }, { t: 0.6, e: [0, 0, 0] }]),
            ],
        },
        {
            // Fall: topple the whole Figure forward to the ground over ~0.7s.
            // The Figure pivots at the feet (origin), so it lays out flat. The
            // graph clamps the last frame, then hands off to `dead`.
            name: 'die', duration: 0.7, tracks: [
                eulerQuatTrack('Figure', [{ t: 0, e: [0, 0, 0] }, { t: 0.18, e: [-0.18, 0, 0.05] }, { t: 0.7, e: [DEATH_X, 0, DEATH_Z] }]),
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.7, e: [0.35, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, 0] }, { t: 0.4, e: [-0.6, 0, -0.5] }, { t: 0.7, e: [1.0, 0, -0.3] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0] }, { t: 0.4, e: [-0.6, 0, 0.5] }, { t: 0.7, e: [1.0, 0, 0.3] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.7, e: [-0.35, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.7, e: [-0.5, 0, 0] }]),
            ],
        },
        {
            // Settled: the body lies on the ground, holding the toppled pose with
            // a faint sink. Loops so a dead character stays down indefinitely.
            name: 'dead', duration: 1.5, tracks: [
                eulerQuatTrack('Figure', [{ t: 0, e: [DEATH_X, 0, DEATH_Z] }, { t: 1.5, e: [DEATH_X, 0, DEATH_Z] }]),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.35, 0, 0] }, { t: 1.5, e: [0.35, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [1.0, 0, -0.3] }, { t: 1.5, e: [1.0, 0, -0.3] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [1.0, 0, 0.3] }, { t: 1.5, e: [1.0, 0, 0.3] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [-0.35, 0, 0] }, { t: 1.5, e: [-0.35, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [-0.5, 0, 0] }, { t: 1.5, e: [-0.5, 0, 0] }]),
            ],
        },
    ]
}

// Final toppled orientation (radians): nearly prone (face-down), with a slight
// roll so it doesn't read as perfectly symmetric.
const DEATH_X = 1.5
const DEATH_Z = 0.18
