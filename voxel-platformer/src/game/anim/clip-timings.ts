/**
 * Shared authored clip timings used by gameplay and the animation graph.
 *
 * Keep gameplay moments here when code reacts to a procedural clip pose. This
 * avoids drifting a hit frame in one file while the visible strike lives in
 * another.
 */
export const HUMANOID_ANIM_TIMINGS = {
    land: 0.24,
    attack: 0.44,
    attackWide: 0.56,
    staffAttack: 0.64,
    hammerAttack: 0.78,
    hammerImpact: 0.56,
    shoot: 0.62,
    shieldBlock: 0.72,
    die: 0.78,
} as const
