import { Color } from 'three'
import { sin, time, uniform } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export interface PulsingEmissiveOpts {
    /** Base PBR color (lit normally). Default `0x222233` (dark blue-grey). */
    base?: Color | number
    /** Emissive color that pulses on top. Default `0xffd45a` (warm gold). */
    glow?: Color | number
    /** Pulse rate in Hz. Default 2. */
    speed?: number
    /** Peak emissive multiplier. Default 1.0. Crank past 1 for HDR-glow effect with bloom. */
    intensity?: number
}

// Object pulses between `base` (PBR-lit) and `base + glow` (emissive add) at
// `speed` Hz. Quest markers, selected unit halos, "loot here" indicators.
export function createPulsingEmissive(opts: PulsingEmissiveOpts = {}): MeshStandardNodeMaterial {
    const base = opts.base instanceof Color ? opts.base : new Color(opts.base ?? 0x222233)
    const glow = opts.glow instanceof Color ? opts.glow : new Color(opts.glow ?? 0xffd45a)
    const speed = opts.speed ?? 2
    const intensity = opts.intensity ?? 1.0

    const glowU = uniform(glow)
    const m = new MeshStandardNodeMaterial({ color: base })
    // sin(t) ∈ [-1,1] → remap to [0,1] → multiply against glow color and intensity
    const pulse = sin(time.mul(speed * Math.PI * 2)).mul(0.5).add(0.5)
    m.emissiveNode = glowU.mul(pulse).mul(intensity)
    return m
}
