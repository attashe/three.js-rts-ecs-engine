import type { Texture } from 'three'
import { makeParticleTexture, type ParticleTextureKind } from './procedural-particles'
import type { TextureRegistryView } from '../core/types'

/**
 * Lazy-builds and caches procedural particle textures. One registry
 * per FX system instance — multiple zones using the same kind share a
 * single GPU texture. Disposing the registry disposes every cached
 * entry, so don't share a registry between unrelated worlds.
 *
 * Surface textures (water caustics, lava crust, etc.) used to live
 * here but are now built directly in the liquid surface shaders;
 * `surface()` remains as an extension point if a future effect wants
 * to register one. By default it throws — call sites that need a
 * surface texture should register a custom registry or extend this
 * class.
 */
export class TextureRegistry implements TextureRegistryView {
    private particles = new Map<ParticleTextureKind, Texture>()
    private surfaces = new Map<string, Texture>()

    particle(kind: string): Texture {
        const k = kind as ParticleTextureKind
        let t = this.particles.get(k)
        if (!t) {
            t = makeParticleTexture(k)
            this.particles.set(k, t)
        }
        return t
    }

    /** Lookup or register a surface texture. Throws if `kind` isn't
     *  registered — use `registerSurface(kind, tex)` to add one. */
    surface(kind: string): Texture {
        const t = this.surfaces.get(kind)
        if (!t) throw new Error(`No surface texture registered for kind "${kind}". Register one via registerSurface().`)
        return t
    }

    registerSurface(kind: string, texture: Texture): void {
        const existing = this.surfaces.get(kind)
        if (existing && existing !== texture) existing.dispose()
        this.surfaces.set(kind, texture)
    }

    dispose(): void {
        for (const t of this.particles.values()) t.dispose()
        for (const t of this.surfaces.values()) t.dispose()
        this.particles.clear()
        this.surfaces.clear()
    }
}
