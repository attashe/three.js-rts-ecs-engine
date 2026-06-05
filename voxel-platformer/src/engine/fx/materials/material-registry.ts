import {
    AdditiveBlending,
    Color,
    DoubleSide,
    Material,
    MeshBasicMaterial,
    NormalBlending,
    Texture,
} from 'three'
import type { MaterialRegistryView, ParticleMaterialOpts } from '../core/types'

/**
 * Shared material pool. Most particle emitters can share a single
 * `MeshBasicMaterial` per (texture, blend, depthTest, depthWrite) tuple — colour
 * + opacity are read straight from the live params on every frame.
 *
 * Materials whose `cacheable` is false are owned by the calling
 * emitter; the registry returns a fresh one each time and refuses to
 * cache or refcount it.
 */
export class MaterialRegistry implements MaterialRegistryView {
    private cache = new Map<string, { mat: Material; refs: number }>()
    private owned = new Set<Material>()

    particleMaterial(opts: ParticleMaterialOpts): Material {
        const cacheable = opts.cacheable !== false
        if (!cacheable) return this.makeFresh(opts)

        const key = [
            opts.texture.uuid,
            opts.additive ? 'add' : 'normal',
            opts.depthTest ?? false ? 'dt' : 'nodt',
            opts.depthWrite ? 'dw' : 'nodw',
        ].join('|')
        let entry = this.cache.get(key)
        if (!entry) {
            const mat = this.makeFresh(opts)
            entry = { mat, refs: 0 }
            this.cache.set(key, entry)
        }
        entry.refs++
        // Live colour/opacity — emitters mutate these every frame from
        // the zone's params. The cache key intentionally ignores them.
        ;(entry.mat as MeshBasicMaterial).color.set(new Color(opts.color))
        ;(entry.mat as MeshBasicMaterial).opacity = opts.opacity
        return entry.mat
    }

    private makeFresh(opts: ParticleMaterialOpts): Material {
        const m = new MeshBasicMaterial({
            map: opts.texture,
            color: new Color(opts.color),
            transparent: true,
            opacity: opts.opacity,
            depthTest: opts.depthTest ?? false,
            depthWrite: opts.depthWrite ?? false,
            side: DoubleSide,
            blending: opts.additive ? AdditiveBlending : NormalBlending,
        })
        this.owned.add(m)
        return m
    }

    release(mat: Material): void {
        for (const [key, entry] of this.cache) {
            if (entry.mat !== mat) continue
            entry.refs--
            if (entry.refs <= 0) {
                mat.dispose()
                this.cache.delete(key)
                this.owned.delete(mat)
            }
            return
        }
        // Not in the shared cache — emitter-owned material.
        if (this.owned.has(mat)) {
            mat.dispose()
            this.owned.delete(mat)
        }
    }

    dispose(): void {
        for (const { mat } of this.cache.values()) mat.dispose()
        for (const mat of this.owned) mat.dispose()
        this.cache.clear()
        this.owned.clear()
    }
}
