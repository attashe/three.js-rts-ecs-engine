import { Color, type Material } from 'three'

interface TintedMaterial extends Material {
    color?: Color
    opacity: number
    userData: { _tintColor?: string; _tintCache?: Color }
}

/**
 * Sync a material's `color` + `opacity` without allocating a fresh
 * `Color` instance every frame. The previous code base did:
 *
 * ```ts
 * material.color.set(new Color(params.color))  // ← allocates 1 Color
 * material.opacity = params.opacity
 * ```
 *
 * across every emitter, every layer, every frame. With 14 effects, 1–4
 * layers each, that's ~50 Color allocations per FX frame which the GC
 * happily eats — but it shows up as jitter under stress.
 *
 * `tintMaterial` caches one `Color` per material instance, only calls
 * `.set()` when the input hex string actually changed, and writes
 * `opacity` directly. Zero allocations after the first call.
 *
 * Accepts `Material | Material[]` directly so callers can pass
 * `mesh.material` from any Three mesh without a manual cast.
 * Multi-material meshes get every slot tinted.
 */
export function tintMaterial(mat: Material | Material[], color: string | number, opacity: number): void {
    if (Array.isArray(mat)) {
        for (const m of mat) tintOne(m, color, opacity)
    } else {
        tintOne(mat, color, opacity)
    }
}

function tintOne(mat: Material, color: string | number, opacity: number): void {
    const m = mat as TintedMaterial
    if (!m.userData) m.userData = {} as TintedMaterial['userData']
    let cache = m.userData._tintCache
    if (!cache) {
        cache = new Color(color)
        m.userData._tintCache = cache
        m.userData._tintColor = String(color)
        if (m.color) m.color.copy(cache)
    } else if (m.userData._tintColor !== String(color)) {
        cache.set(color)
        m.userData._tintColor = String(color)
        if (m.color) m.color.copy(cache)
    }
    m.opacity = opacity
}
