// Tiny easing helpers for cinematic camera tweens and fades. The codebase has
// no central easing utility (day-cycle has a private `lerp`); keep this small
// and dependency-free so both the runtime director and the editor preview share
// exactly one implementation.

export type EaseKind = 'linear' | 'easeInOut' | 'easeOut'

/** Apply an easing curve to a normalized progress `t`, clamped to [0, 1]. */
export function ease(kind: EaseKind, t: number): number {
    const p = t <= 0 ? 0 : t >= 1 ? 1 : t
    switch (kind) {
        case 'linear':
            return p
        case 'easeOut':
            return 1 - (1 - p) * (1 - p)
        case 'easeInOut':
            return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2
        default:
            return p
    }
}

/** Scalar linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}
