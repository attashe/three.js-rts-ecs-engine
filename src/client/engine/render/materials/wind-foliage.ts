import { Color, DoubleSide } from 'three'
import { positionLocal, sin, time, vec3 } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export interface WindFoliageOpts {
    /** PBR base color. Default `0x4caf50` (leaf green). */
    base?: Color | number
    /** Maximum lateral offset at top of the mesh (Y=1). Default 0.15. */
    amplitude?: number
    /** Wave frequency (Hz). Default 1.5. */
    frequency?: number
    /** Render both sides of triangles — useful for billboard grass / leaf cards. Default true. */
    doubleSided?: boolean
}

// Vertex displacement: top of the mesh sways, base anchored. Grass, leaves,
// banners. The sway is phase-shifted by the vertex's local X/Z so different
// blades drift out of sync without per-vertex noise.
export function createWindFoliage(opts: WindFoliageOpts = {}): MeshStandardNodeMaterial {
    const base = opts.base instanceof Color ? opts.base : new Color(opts.base ?? 0x4caf50)
    const amplitude = opts.amplitude ?? 0.15
    const frequency = opts.frequency ?? 1.5

    const m = new MeshStandardNodeMaterial({
        color: base,
        side: opts.doubleSided ?? true ? DoubleSide : undefined,
    })

    // 0 at root (Y=0), `amplitude` at Y=1, clamped above.
    const sway = positionLocal.y.clamp(0, 1).mul(amplitude)
    // Phase by Z (and X) so neighbouring blades aren't in lockstep.
    const angularFrequency = frequency * Math.PI * 2
    const offsetX = sin(time.mul(angularFrequency).add(positionLocal.z)).mul(sway)
    const offsetZ = sin(time.mul(angularFrequency).add(positionLocal.x)).mul(sway).mul(0.5)
    m.positionNode = positionLocal.add(vec3(offsetX, 0, offsetZ))
    return m
}
