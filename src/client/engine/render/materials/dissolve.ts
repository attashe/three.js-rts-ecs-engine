import { Color } from 'three'
import { mx_noise_float, positionLocal, step, uniform } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

type UniformValue = ReturnType<typeof uniform>

export interface DissolveOpts {
    /** PBR base color. Default `0x66aaff`. */
    base?: Color | number
    /** Initial dissolve threshold. 0 = fully visible, 1 = fully gone. Default 0. */
    threshold?: number
    /** Frequency of the noise pattern. Bigger = finer grain. Default 6. */
    noiseScale?: number
}

export interface DissolveMaterial {
    material: MeshStandardNodeMaterial
    /** Drive `threshold.value` from a system to animate the dissolve. */
    threshold: UniformValue
}

// Spawn / despawn FX. Animate `threshold.value` from 0 → 1 to make the mesh
// dissolve away (or 1 → 0 to spawn in). Uses local-space noise so the pattern
// is stable when the object moves/rotates.
export function createDissolve(opts: DissolveOpts = {}): DissolveMaterial {
    const base = opts.base instanceof Color ? opts.base : new Color(opts.base ?? 0x66aaff)
    const noiseScale = opts.noiseScale ?? 6

    const thresholdU = uniform(opts.threshold ?? 0)

    const m = new MeshStandardNodeMaterial({ color: base })
    m.transparent = true
    m.alphaTest = 0.5

    // mx_noise_float ∈ ~[-1, 1]; remap to [0, 1] for thresholding.
    const noise = mx_noise_float(positionLocal.mul(noiseScale)).mul(0.5).add(0.5)
    // step(edge, x) = 0 if x < edge, 1 if x >= edge. With alphaTest=0.5, the 0s discard.
    m.opacityNode = step(thresholdU, noise)

    return { material: m, threshold: thresholdU }
}
