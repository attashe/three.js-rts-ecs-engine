import type { Texture } from 'three'
import { makeParticleTexture, type ParticleTextureKind } from './procedural-particles'
import { makeSurfaceTexture, type SurfaceTextureKind } from './procedural-surfaces'
import type { TextureRegistryView } from '../core/types'

/**
 * Lazy-builds and caches procedural particle / surface textures. One
 * registry per FX system instance — multiple zones using the same kind
 * share a single GPU texture. Disposing the registry disposes every
 * cached entry, so don't share a registry between unrelated worlds.
 */
export class TextureRegistry implements TextureRegistryView {
    private particles = new Map<ParticleTextureKind, Texture>()
    private surfaces = new Map<SurfaceTextureKind, Texture>()

    particle(kind: string): Texture {
        const k = kind as ParticleTextureKind
        let t = this.particles.get(k)
        if (!t) {
            t = makeParticleTexture(k)
            this.particles.set(k, t)
        }
        return t
    }

    surface(kind: string): Texture {
        const k = kind as SurfaceTextureKind
        let t = this.surfaces.get(k)
        if (!t) {
            t = makeSurfaceTexture(k)
            this.surfaces.set(k, t)
        }
        return t
    }

    dispose(): void {
        for (const t of this.particles.values()) t.dispose()
        for (const t of this.surfaces.values()) t.dispose()
        this.particles.clear()
        this.surfaces.clear()
    }
}
