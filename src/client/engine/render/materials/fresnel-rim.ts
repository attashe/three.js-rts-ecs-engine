import { Color } from 'three'
import { normalView, oneMinus, positionViewDirection, uniform } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export interface FresnelRimOpts {
    /** Base PBR color. Default `0x444466`. */
    base?: Color | number
    /** Rim color (additive emissive at silhouette). Default `0x9fefff` (cyan). */
    rim?: Color | number
    /** Rim sharpness exponent. 1 = soft halo, 3 = typical hover glow, 8+ = pixel-thin line. Default 3. */
    power?: number
}

// View-space fresnel rim. Bright at silhouette (normal ⊥ view), dark face-on.
// Hover highlights, ghost-placement shaders, important-NPC outlines.
export function createFresnelRim(opts: FresnelRimOpts = {}): MeshStandardNodeMaterial {
    const base = opts.base instanceof Color ? opts.base : new Color(opts.base ?? 0x444466)
    const rim = opts.rim instanceof Color ? opts.rim : new Color(opts.rim ?? 0x9fefff)
    const power = opts.power ?? 3

    const m = new MeshStandardNodeMaterial({ color: base })

    // dot(n, v): 1 face-on, 0 at silhouette. Both nodes are already view-space.
    const ndotv = normalView.dot(positionViewDirection).clamp(0, 1)
    const fresnel = oneMinus(ndotv).pow(power)
    m.emissiveNode = uniform(rim).mul(fresnel)
    return m
}
