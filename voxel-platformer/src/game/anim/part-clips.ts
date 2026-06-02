// Procedural clips for the part-based humanoid (main character / keeper / troll).
// Tracks target the named nodes from main-character.ts: the upper-body pivot
// `Chest` (lean / twist), the limb pivots `LegL/R` + `UpperArmL/R`, and the
// whole-body wrapper `Figure` (the death topple). Same clip ids as the reference
// rig so the combat-locomotion graph drives either interchangeably.

import { eulerQuatTrack, type ProcClipDef, type ProcTrackDef } from '../../engine/anim'
import { HUMANOID_ANIM_TIMINGS } from './clip-timings'

type E3 = [number, number, number]

interface CyclePose {
    legAmp: number
    armAmp: number
    lean: number
    twist: number
    roll: number
}

function neutralFigure(duration: number): ProcTrackDef {
    return eulerQuatTrack('Figure', [{ t: 0, e: [0, 0, 0] }, { t: duration, e: [0, 0, 0] }])
}

/** Arm/leg locomotion with quarter keys. The extra chest twist/roll and
 *  asymmetric limb roll keep the tiny voxel body from reading like a metronome. */
function limbCycle(name: string, duration: number, pose: CyclePose): ProcClipDef {
    const half = duration / 2
    const q = duration / 4
    const leg = (sign: number): Array<{ t: number; e: E3 }> => [
        { t: 0, e: [sign * pose.legAmp, 0, 0.03 * sign] },
        { t: q, e: [0, 0.04 * sign, -0.02 * sign] },
        { t: half, e: [-sign * pose.legAmp, 0, -0.03 * sign] },
        { t: q * 3, e: [0, -0.04 * sign, 0.02 * sign] },
        { t: duration, e: [sign * pose.legAmp, 0, 0.03 * sign] },
    ]
    const arm = (sign: number): Array<{ t: number; e: E3 }> => [
        { t: 0, e: [sign * pose.armAmp, 0.02 * sign, -0.05 * sign] },
        { t: q, e: [0, -0.04 * sign, -0.02 * sign] },
        { t: half, e: [-sign * pose.armAmp, -0.02 * sign, 0.05 * sign] },
        { t: q * 3, e: [0, 0.04 * sign, 0.02 * sign] },
        { t: duration, e: [sign * pose.armAmp, 0.02 * sign, -0.05 * sign] },
    ]
    return {
        name,
        duration,
        tracks: [
            neutralFigure(duration),
            eulerQuatTrack('Chest', [
                { t: 0, e: [pose.lean, -pose.twist, pose.roll] },
                { t: q, e: [pose.lean * 1.08, 0, -pose.roll] },
                { t: half, e: [pose.lean, pose.twist, -pose.roll] },
                { t: q * 3, e: [pose.lean * 1.08, 0, pose.roll] },
                { t: duration, e: [pose.lean, -pose.twist, pose.roll] },
            ]),
            eulerQuatTrack('Head', [
                { t: 0, e: [-pose.lean * 0.2, pose.twist * 0.35, -pose.roll * 0.35] },
                { t: half, e: [-pose.lean * 0.2, -pose.twist * 0.35, pose.roll * 0.35] },
                { t: duration, e: [-pose.lean * 0.2, pose.twist * 0.35, -pose.roll * 0.35] },
            ]),
            eulerQuatTrack('LegR', leg(1)),
            eulerQuatTrack('LegL', leg(-1)),
            eulerQuatTrack('UpperArmR', arm(-1)),
            eulerQuatTrack('UpperArmL', arm(1)),
        ],
    }
}

export function partCharacterClips(): ProcClipDef[] {
    return [
        {
            name: 'idle', duration: 2.0, tracks: [
                neutralFigure(2.0),
                eulerQuatTrack('Chest', [
                    { t: 0, e: [0, 0, 0] },
                    { t: 0.55, e: [0.025, 0.018, -0.01] },
                    { t: 1.15, e: [0.045, -0.012, 0.012] },
                    { t: 2, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('Head', [
                    { t: 0, e: [0, 0.01, 0] },
                    { t: 1.15, e: [-0.018, -0.012, 0.006] },
                    { t: 2, e: [0, 0.01, 0] },
                ]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0.02, 0, -0.04] }, { t: 1, e: [0.08, -0.02, -0.07] }, { t: 2, e: [0.02, 0, -0.04] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0.02, 0, 0.04] }, { t: 1, e: [0.08, 0.02, 0.07] }, { t: 2, e: [0.02, 0, 0.04] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.025, 0, 0.01] }, { t: 2, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.02, 0, -0.01] }, { t: 2, e: [0, 0, 0] }]),
            ],
        },
        limbCycle('walk', 0.82, { legAmp: 0.48, armAmp: 0.36, lean: 0.06, twist: 0.055, roll: 0.028 }),
        limbCycle('run', 0.54, { legAmp: 0.9, armAmp: 0.72, lean: 0.19, twist: 0.08, roll: 0.045 }),
        {
            name: 'jump', duration: 0.45, tracks: [
                neutralFigure(0.45),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.12, 0, 0] }, { t: 0.14, e: [-0.16, 0, 0] }, { t: 0.45, e: [-0.08, 0.02, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [-0.04, 0, 0] }, { t: 0.18, e: [0.08, 0, 0] }, { t: 0.45, e: [0.02, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0.15, 0, -0.1] }, { t: 0.16, e: [-2.15, -0.12, -0.18] }, { t: 0.45, e: [-1.6, 0.08, -0.12] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0.15, 0, 0.1] }, { t: 0.16, e: [-2.15, 0.12, 0.18] }, { t: 0.45, e: [-1.6, -0.08, 0.12] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0.35, 0, 0.02] }, { t: 0.18, e: [0.78, 0, 0.04] }, { t: 0.45, e: [0.28, 0, -0.02] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0.22, 0, -0.02] }, { t: 0.18, e: [0.52, 0, -0.04] }, { t: 0.45, e: [0.12, 0, 0.02] }]),
            ],
        },
        {
            name: 'fall', duration: 0.7, tracks: [
                neutralFigure(0.7),
                eulerQuatTrack('Chest', [{ t: 0, e: [-0.06, 0.02, 0.02] }, { t: 0.35, e: [-0.12, -0.02, -0.025] }, { t: 0.7, e: [-0.06, 0.02, 0.02] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0.04, 0, 0] }, { t: 0.35, e: [0.09, 0.02, 0] }, { t: 0.7, e: [0.04, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [-1.45, 0.16, -0.34] }, { t: 0.35, e: [-1.85, -0.04, -0.48] }, { t: 0.7, e: [-1.45, 0.16, -0.34] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [-1.45, -0.16, 0.34] }, { t: 0.35, e: [-1.85, 0.04, 0.48] }, { t: 0.7, e: [-1.45, -0.16, 0.34] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [-0.28, 0, -0.06] }, { t: 0.35, e: [0.08, 0, -0.1] }, { t: 0.7, e: [-0.28, 0, -0.06] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0.08, 0, 0.06] }, { t: 0.35, e: [-0.28, 0, 0.1] }, { t: 0.7, e: [0.08, 0, 0.06] }]),
            ],
        },
        {
            name: 'land', duration: 0.32, tracks: [
                neutralFigure(0.32),
                eulerQuatTrack('Chest', [{ t: 0, e: [-0.04, 0, 0] }, { t: 0.1, e: [0.34, 0, 0] }, { t: 0.22, e: [-0.06, 0, 0] }, { t: 0.32, e: [0, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0.05, 0, 0] }, { t: 0.1, e: [-0.08, 0, 0] }, { t: 0.32, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [-1.2, 0, -0.2] }, { t: 0.1, e: [-0.28, 0.05, -0.18] }, { t: 0.32, e: [0, 0, -0.04] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [-1.2, 0, 0.2] }, { t: 0.1, e: [-0.28, -0.05, 0.18] }, { t: 0.32, e: [0, 0, 0.04] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0.2, 0, 0.02] }, { t: 0.1, e: [0.72, 0, 0.04] }, { t: 0.32, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0.2, 0, -0.02] }, { t: 0.1, e: [0.72, 0, -0.04] }, { t: 0.32, e: [0, 0, 0] }]),
            ],
        },
        {
            // Sword thrust: the blade points forward in the hand frame, and the
            // right arm/chest drive it straight toward the target.
            name: 'attack', duration: 0.44, tracks: [
                neutralFigure(0.44),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.02, -0.08, 0] }, { t: 0.12, e: [-0.02, 0.06, -0.02] }, { t: 0.22, e: [0.1, 0.02, 0] }, { t: 0.34, e: [0.02, -0.05, 0.015] }, { t: 0.44, e: [0, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0, 0.06, 0] }, { t: 0.22, e: [-0.02, 0.02, 0] }, { t: 0.44, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [-0.25, 0.08, -0.08] }, { t: 0.12, e: [-1.1, 0.08, -0.06] }, { t: 0.22, e: [-1.78, 0.02, -0.02] }, { t: 0.34, e: [-0.86, 0.04, -0.06] }, { t: 0.44, e: [0, 0, -0.04] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0.05, 0, 0.08] }, { t: 0.16, e: [-0.18, -0.08, 0.2] }, { t: 0.44, e: [0, 0, 0.04] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.22, e: [-0.12, 0, 0.03] }, { t: 0.44, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.22, e: [0.16, 0, -0.03] }, { t: 0.44, e: [0, 0, 0] }]),
            ],
        },
        {
            // Spear thrust: a longer committed lunge. The held spear's +Y axis
            // stays nearly level and forward at the authored impact moment.
            name: 'spearAttack', duration: HUMANOID_ANIM_TIMINGS.spearAttack, tracks: [
                neutralFigure(HUMANOID_ANIM_TIMINGS.spearAttack),
                eulerQuatTrack('Chest', [
                    { t: 0, e: [0.02, -0.06, 0] },
                    { t: 0.12, e: [-0.08, -0.2, -0.025] },
                    { t: 0.22, e: [0.12, 0.025, 0.012] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [0.2, 0.01, 0] },
                    { t: 0.4, e: [0.06, -0.04, 0.01] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('Head', [
                    { t: 0, e: [0, 0.03, 0] },
                    { t: 0.12, e: [0.04, -0.12, 0] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [-0.04, 0.02, 0] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('UpperArmR', [
                    { t: 0, e: [-0.18, 0.08, -0.08] },
                    { t: 0.12, e: [-0.92, 0.16, -0.18] },
                    { t: 0.22, e: [-0.36, 0.04, -0.06] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [-0.12, 0.02, -0.02] },
                    { t: 0.4, e: [-0.34, 0.05, -0.06] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, -0.04] },
                ]),
                eulerQuatTrack('UpperArmL', [
                    { t: 0, e: [-0.1, -0.08, 0.12] },
                    { t: 0.14, e: [-0.42, -0.26, 0.22] },
                    { t: 0.22, e: [-0.34, -0.16, 0.16] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [-0.24, -0.08, 0.1] },
                    { t: 0.4, e: [-0.22, -0.08, 0.1] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, 0.04] },
                ]),
                eulerQuatTrack('LegR', [
                    { t: 0, e: [0.02, 0, 0.02] },
                    { t: 0.18, e: [-0.12, 0, 0.06] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [-0.26, 0, 0.08] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('LegL', [
                    { t: 0, e: [-0.02, 0, -0.02] },
                    { t: 0.18, e: [0.2, 0, -0.06] },
                    { t: HUMANOID_ANIM_TIMINGS.spearImpact, e: [0.34, 0, -0.1] },
                    { t: HUMANOID_ANIM_TIMINGS.spearAttack, e: [0, 0, 0] },
                ]),
            ],
        },
        {
            // Wide swing: a slower right-to-left cut that gives the sword a broad
            // readable arc in the iso camera.
            name: 'attackWide', duration: 0.56, tracks: [
                neutralFigure(0.56),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.02, 0.5, -0.04] }, { t: 0.16, e: [0.04, 0.72, -0.06] }, { t: 0.33, e: [0.02, -0.9, 0.07] }, { t: 0.45, e: [0.09, -0.42, 0.02] }, { t: 0.56, e: [0, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0, 0.18, 0] }, { t: 0.18, e: [0, 0.28, 0] }, { t: 0.33, e: [0, -0.32, 0] }, { t: 0.56, e: [0, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [-1.22, 0.74, -0.12] }, { t: 0.16, e: [-1.45, 0.88, -0.08] }, { t: 0.33, e: [-1.68, -0.72, 0.1] }, { t: 0.45, e: [-1.12, -0.24, 0.02] }, { t: 0.56, e: [0, 0, -0.04] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [-0.12, -0.24, 0.22] }, { t: 0.2, e: [-0.44, -0.42, 0.3] }, { t: 0.38, e: [-0.16, -0.12, 0.16] }, { t: 0.56, e: [0, 0, 0.04] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0.08, 0, 0.04] }, { t: 0.33, e: [-0.32, 0, 0.05] }, { t: 0.56, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [-0.04, 0, -0.04] }, { t: 0.33, e: [0.2, 0, -0.05] }, { t: 0.56, e: [0, 0, 0] }]),
            ],
        },
        {
            // Raised shield guard: the left hand carries the shield from the
            // passive side position into a readable front block, then clamps
            // there while the guard input is held.
            name: 'shieldBlock', duration: HUMANOID_ANIM_TIMINGS.shieldBlock, tracks: [
                neutralFigure(HUMANOID_ANIM_TIMINGS.shieldBlock),
                eulerQuatTrack('Chest', [
                    { t: 0, e: [0.02, -0.08, 0.015] },
                    { t: 0.18, e: [0.06, -0.22, 0.04] },
                    { t: 0.44, e: [0.075, -0.18, 0.035] },
                    { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [0.075, -0.18, 0.035] },
                ]),
                eulerQuatTrack('Head', [
                    { t: 0, e: [0, -0.04, 0] },
                    { t: 0.24, e: [-0.02, -0.12, 0] },
                    { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [-0.02, -0.12, 0] },
                ]),
                eulerQuatTrack('UpperArmL', [
                    { t: 0, e: [-0.18, 0.5, 0.18] },
                    { t: 0.16, e: [-0.58, 1.16, 0.28] },
                    { t: 0.44, e: [-0.66, 1.22, 0.32] },
                    { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [-0.66, 1.22, 0.32] },
                ]),
                eulerQuatTrack('UpperArmR', [
                    { t: 0, e: [-0.12, 0.02, -0.08] },
                    { t: 0.18, e: [-0.42, -0.18, -0.16] },
                    { t: 0.44, e: [-0.36, -0.12, -0.12] },
                    { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [-0.36, -0.12, -0.12] },
                ]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0.08, 0, 0.04] }, { t: 0.36, e: [0.18, 0, 0.06] }, { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [0.18, 0, 0.06] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [-0.06, 0, -0.04] }, { t: 0.36, e: [-0.16, 0, -0.06] }, { t: HUMANOID_ANIM_TIMINGS.shieldBlock, e: [-0.16, 0, -0.06] }]),
            ],
        },
        {
            // Staff bonk: fast wind-up, then the weighted pointy head snaps
            // forward/down. The authored impact pose deliberately makes the
            // staff's +Y axis (its striking head) point into the enemy.
            name: 'staffAttack', duration: 0.64, tracks: [
                neutralFigure(0.64),
                eulerQuatTrack('Chest', [
                    { t: 0, e: [0.02, -0.08, 0] },
                    { t: 0.1, e: [-0.08, -0.46, -0.08] },
                    { t: 0.22, e: [-0.16, -0.68, -0.1] },
                    { t: 0.34, e: [0.34, 0.18, 0.02] },
                    { t: 0.46, e: [0.42, 0.1, 0.02] },
                    { t: 0.64, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('Head', [
                    { t: 0, e: [0, -0.04, 0] },
                    { t: 0.18, e: [-0.08, -0.28, 0] },
                    { t: 0.34, e: [0.12, 0.18, 0] },
                    { t: 0.64, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('UpperArmR', [
                    { t: 0, e: [0.02, 0, -0.04] },
                    { t: 0.1, e: [-0.8, -0.52, -0.32] },
                    { t: 0.22, e: [-1.7, -0.38, -0.52] },
                    { t: 0.34, e: [1.32, 0.14, -0.12] },
                    { t: 0.46, e: [1.65, 0.04, -0.08] },
                    { t: 0.64, e: [0, 0, -0.04] },
                ]),
                eulerQuatTrack('UpperArmL', [
                    { t: 0, e: [0.02, 0, 0.04] },
                    { t: 0.14, e: [-0.48, 0.28, 0.26] },
                    { t: 0.32, e: [-0.94, -0.22, 0.34] },
                    { t: 0.46, e: [-0.36, -0.12, 0.18] },
                    { t: 0.64, e: [0, 0, 0.04] },
                ]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.34, e: [-0.26, 0, 0.08] }, { t: 0.64, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.34, e: [0.36, 0, -0.12] }, { t: 0.64, e: [0, 0, 0] }]),
            ],
        },
        {
            // Hammer smash: the carried hammer starts horizontal, lifts above
            // the shoulder, then drives down in front. NPC behaviour applies
            // the circular impact at HUMANOID_ANIM_TIMINGS.hammerImpact.
            name: 'hammerAttack', duration: HUMANOID_ANIM_TIMINGS.hammerAttack, tracks: [
                neutralFigure(HUMANOID_ANIM_TIMINGS.hammerAttack),
                eulerQuatTrack('Chest', [
                    { t: 0, e: [0.02, 0, 0] },
                    { t: 0.16, e: [-0.08, -0.12, -0.02] },
                    { t: 0.3, e: [-0.32, -0.2, -0.04] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [0.5, 0.04, 0.02] },
                    { t: 0.66, e: [0.32, 0.02, 0.01] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('Head', [
                    { t: 0, e: [0, 0, 0] },
                    { t: 0.3, e: [-0.1, -0.08, 0] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [0.16, 0.03, 0] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('UpperArmR', [
                    { t: 0, e: [-0.12, 0, -0.06] },
                    { t: 0.16, e: [-0.72, -0.1, -0.18] },
                    { t: 0.3, e: [-2.15, -0.08, -0.22] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [0.62, 0.04, -0.1] },
                    { t: 0.66, e: [0.46, 0.03, -0.08] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, -0.04] },
                ]),
                eulerQuatTrack('UpperArmL', [
                    { t: 0, e: [0.02, 0, 0.04] },
                    { t: 0.16, e: [-0.52, 0.16, 0.18] },
                    { t: 0.3, e: [-1.75, 0.1, 0.28] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [0.42, -0.02, 0.08] },
                    { t: 0.66, e: [0.28, -0.02, 0.07] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, 0.04] },
                ]),
                eulerQuatTrack('LegR', [
                    { t: 0, e: [0, 0, 0] },
                    { t: 0.3, e: [0.18, 0, 0.08] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [-0.34, 0, 0.12] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, 0] },
                ]),
                eulerQuatTrack('LegL', [
                    { t: 0, e: [0, 0, 0] },
                    { t: 0.3, e: [-0.2, 0, -0.08] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerImpact, e: [0.42, 0, -0.14] },
                    { t: HUMANOID_ANIM_TIMINGS.hammerAttack, e: [0, 0, 0] },
                ]),
            ],
        },
        {
            // Bow shot: chest turns side-on (archer's stance, reads well from
            // iso), the left arm pushes the bow out front and holds steady, the
            // right arm draws the string back to the cheek, then the release
            // snaps it forward. The held bow (left hand) sells the motion.
            name: 'shoot', duration: 0.62, tracks: [
                neutralFigure(0.62),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.02, 0, 0] }, { t: 0.14, e: [0.02, 0.5, -0.02] }, { t: 0.44, e: [0.015, 0.52, -0.02] }, { t: 0.5, e: [0.04, 0.42, 0] }, { t: 0.62, e: [0, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0, 0.05, 0] }, { t: 0.18, e: [0, 0.22, 0] }, { t: 0.5, e: [0.03, 0.18, 0] }, { t: 0.62, e: [0, 0, 0] }]),
                // Bow arm: out front, level, dead steady through the draw.
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0.05, 0, 0.05] }, { t: 0.14, e: [-1.45, -0.14, 0.02] }, { t: 0.48, e: [-1.52, -0.1, 0.02] }, { t: 0.62, e: [0, 0, 0.04] }]),
                // Draw arm: up to the string, pull back (elbow swings out), hold,
                // then release snaps it back toward the bow.
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0.05, 0, -0.05] }, { t: 0.16, e: [-1.35, 0.35, -0.22] }, { t: 0.42, e: [-1.26, 0.85, -0.5] }, { t: 0.49, e: [-1.52, 0.12, -0.04] }, { t: 0.62, e: [0, 0, -0.04] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0.02] }, { t: 0.42, e: [-0.08, 0, 0.04] }, { t: 0.62, e: [0, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, -0.02] }, { t: 0.42, e: [0.12, 0, -0.04] }, { t: 0.62, e: [0, 0, 0] }]),
            ],
        },
        {
            // Fall: topple the whole Figure forward to the ground over ~0.7s.
            // The Figure pivots at the feet (origin), so it lays out flat. The
            // graph clamps the last frame, then hands off to `dead`.
            name: 'die', duration: 0.78, tracks: [
                eulerQuatTrack('Figure', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [-0.16, 0.08, -0.08] }, { t: 0.32, e: [0.55, -0.05, 0.22] }, { t: 0.78, e: [DEATH_X, 0, DEATH_Z] }]),
                eulerQuatTrack('Chest', [{ t: 0, e: [0, 0, 0] }, { t: 0.22, e: [-0.18, 0.18, -0.08] }, { t: 0.78, e: [0.35, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0, 0, 0] }, { t: 0.22, e: [0.22, -0.16, 0.05] }, { t: 0.78, e: [0.1, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [0, 0, -0.04] }, { t: 0.32, e: [-0.75, 0.25, -0.62] }, { t: 0.78, e: [1.0, 0, -0.3] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [0, 0, 0.04] }, { t: 0.32, e: [-0.7, -0.2, 0.62] }, { t: 0.78, e: [1.0, 0, 0.3] }]),
                eulerQuatTrack('LegR', [{ t: 0, e: [0, 0, 0] }, { t: 0.32, e: [-0.2, 0, 0.08] }, { t: 0.78, e: [-0.35, 0, 0] }]),
                eulerQuatTrack('LegL', [{ t: 0, e: [0, 0, 0] }, { t: 0.32, e: [-0.35, 0, -0.08] }, { t: 0.78, e: [-0.5, 0, 0] }]),
            ],
        },
        {
            // Settled: the body lies on the ground, holding the toppled pose with
            // a faint sink. Loops so a dead character stays down indefinitely.
            name: 'dead', duration: 1.5, tracks: [
                eulerQuatTrack('Figure', [{ t: 0, e: [DEATH_X, 0, DEATH_Z] }, { t: 1.5, e: [DEATH_X, 0, DEATH_Z] }]),
                eulerQuatTrack('Chest', [{ t: 0, e: [0.35, 0, 0] }, { t: 0.8, e: [0.37, 0, 0] }, { t: 1.5, e: [0.35, 0, 0] }]),
                eulerQuatTrack('Head', [{ t: 0, e: [0.1, 0, 0] }, { t: 1.5, e: [0.1, 0, 0] }]),
                eulerQuatTrack('UpperArmR', [{ t: 0, e: [1.0, 0, -0.3] }, { t: 0.8, e: [1.04, 0, -0.32] }, { t: 1.5, e: [1.0, 0, -0.3] }]),
                eulerQuatTrack('UpperArmL', [{ t: 0, e: [1.0, 0, 0.3] }, { t: 0.8, e: [1.04, 0, 0.32] }, { t: 1.5, e: [1.0, 0, 0.3] }]),
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
