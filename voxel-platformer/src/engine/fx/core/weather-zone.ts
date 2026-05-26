import { Color, Group, PointLight, Object3D, Vector3, type Scene } from 'three'
import type { EmitterDeps, EmitterStrategy, ExtraLayer, ParticlePool, WeatherZoneParams, WeatherZoneRuntime, WriteContext } from './types'
import { createParticlePool } from './particle-field'
import { makeRng } from './sim-utils'
import { modulateZoneLight } from '../lights/fx-light-controller'

/**
 * A single placed FX volume. Owns the Three group, the InstancedMesh
 * for the primary emitter, every extra layer, and the per-zone point
 * light. The actual physics + visuals are delegated to whatever
 * `EmitterStrategy` matches `params.type`.
 *
 * Lifecycle:
 *   1. `new WeatherZone(...)` allocates the runtime + group.
 *   2. `init(strategy, deps, scene)` builds meshes and adds to scene.
 *   3. `update(dt, elapsed, camera)` ticks simulation + writes
 *      InstancedMesh matrices.
 *   4. `dispose()` tears it down and removes from the scene.
 *
 * `rebuild()` is for runtime param changes that change topology
 * (count, type) — the zone tears down its meshes and re-invokes
 * `init` with the same strategy.
 */
export class WeatherZone {
    readonly group: Group
    readonly runtime: WeatherZoneRuntime
    private strategy: EmitterStrategy | null = null
    private deps: EmitterDeps | null = null
    private scene: Scene | null = null
    private readonly rng: () => number
    private readonly worldPosition = new Vector3()

    constructor(params: WeatherZoneParams) {
        this.group = new Group()
        this.group.name = `WeatherZone:${params.name}`
        this.group.position.set(params.position.x, params.position.y, params.position.z)
        const seed = params.id ? hashCode(params.id) : Math.floor(Math.random() * 0xffffffff)
        this.rng = makeRng(seed)

        const light = new PointLight(new Color(params.lightColor), params.lightIntensity, params.lightDistance, decayFor(params.type))
        light.userData = { wanted: params.lightIntensity }
        this.group.add(light)

        this.runtime = {
            params: { ...params },
            elapsed: 0,
            particles: createParticlePool(params.count),
            primary: null,
            extras: [],
            light,
            surface: null,
            surfaceOverlay: null,
            events: [],
            seed,
            visible: true,
            dirty: false,
            findExtra: (type: string): ExtraLayer | undefined => {
                for (const e of this.runtime.extras) if (e.type === type) return e
                return undefined
            },
        }
        this.syncObjects()
    }

    init(strategy: EmitterStrategy, deps: EmitterDeps, scene: Scene): void {
        this.strategy = strategy
        this.deps = deps
        this.scene = scene
        const created = strategy.create(this.runtime, deps)
        this.runtime.primary = created.primary
        this.group.add(created.primary)
        for (const extra of created.extras) {
            if (extra.mesh.parent) continue
            this.group.add(extra.mesh)
        }
        if (created.surface) {
            this.runtime.surface = created.surface
            this.group.add(created.surface)
        }
        if (created.surfaceOverlay) {
            this.runtime.surfaceOverlay = created.surfaceOverlay
            this.group.add(created.surfaceOverlay)
        }
        this.syncObjects()
        // Seed every particle.
        for (let i = 0; i < this.runtime.particles.count; i++) strategy.spawn(this.runtime, i, false, this.rng)
        scene.add(this.group)
    }

    update(dt: number, elapsed: number, camera: { position: { x: number; y: number; z: number }; dummy?: Object3D }, dummy: Object3D): void {
        const strategy = this.strategy
        if (!strategy) return
        if (this.runtime.dirty) this.rebuild()
        this.runtime.elapsed = elapsed
        modulateZoneLight(this.runtime, elapsed)
        if (!this.runtime.visible) return
        strategy.update(this.runtime, dt, elapsed, this.rng)
        this.group.getWorldPosition(this.worldPosition)
        const ctx: WriteContext = { cameraPosition: camera.position, zonePosition: this.worldPosition, dummy }
        strategy.write(this.runtime, elapsed, ctx)
    }

    /** Re-create the InstancedMesh + particle pool. Use after param
     *  changes that change topology (count, type). */
    rebuild(): void {
        if (!this.strategy || !this.deps || !this.scene) return
        const strategy = this.strategy
        const deps = this.deps
        const scene = this.scene
        this.disposeMeshes()
        ;(this.runtime as { particles: ParticlePool }).particles = createParticlePool(this.runtime.params.count)
        const created = strategy.create(this.runtime, deps)
        this.runtime.primary = created.primary
        this.group.add(created.primary)
        for (const extra of created.extras) this.group.add(extra.mesh)
        if (created.surface) { this.runtime.surface = created.surface; this.group.add(created.surface) }
        if (created.surfaceOverlay) { this.runtime.surfaceOverlay = created.surfaceOverlay; this.group.add(created.surfaceOverlay) }
        this.syncObjects()
        for (let i = 0; i < this.runtime.particles.count; i++) strategy.spawn(this.runtime, i, false, this.rng)
        this.runtime.dirty = false
        ;(void scene)
    }

    setParams(patch: Partial<WeatherZoneParams>): void {
        const changedCount = patch.count !== undefined && patch.count !== this.runtime.params.count
        const changedType = patch.type !== undefined && patch.type !== this.runtime.params.type
        Object.assign(this.runtime.params, patch)
        this.syncObjects()
        if (changedCount || changedType) this.runtime.dirty = true
    }

    setStrategy(strategy: EmitterStrategy): void {
        this.strategy = strategy
        this.runtime.dirty = true
    }

    dispose(): void {
        this.disposeMeshes()
        if (this.scene && this.group.parent) this.scene.remove(this.group)
    }

    private disposeMeshes(): void {
        if (this.runtime.primary) {
            this.group.remove(this.runtime.primary)
            this.runtime.primary.geometry.dispose()
            this.deps?.materials.release(this.runtime.primary.material as import('three').Material)
            this.runtime.primary = null
        }
        for (const extra of this.runtime.extras) {
            this.group.remove(extra.mesh)
            extra.geometry.dispose()
            this.deps?.materials.release(extra.material)
        }
        this.runtime.extras.length = 0
        if (this.runtime.surface) {
            this.group.remove(this.runtime.surface)
            this.runtime.surface.geometry.dispose()
            ;(this.runtime.surface.material as { dispose?: () => void }).dispose?.()
            this.runtime.surface = null
        }
        if (this.runtime.surfaceOverlay) {
            this.group.remove(this.runtime.surfaceOverlay)
            this.runtime.surfaceOverlay.geometry.dispose()
            ;(this.runtime.surfaceOverlay.material as { dispose?: () => void }).dispose?.()
            this.runtime.surfaceOverlay = null
        }
    }

    toJSON(): WeatherZoneParams {
        return JSON.parse(JSON.stringify(this.runtime.params)) as WeatherZoneParams
    }

    private syncObjects(): void {
        const p = this.runtime.params
        this.group.name = `WeatherZone:${p.name}`
        this.group.position.set(p.position.x, p.position.y, p.position.z)
        const lightYOffset = lightOffsetFor(p)
        this.runtime.light.position.set(0, lightYOffset, 0)
        this.runtime.light.color.set(new Color(p.lightColor))
        this.runtime.light.distance = lightDistanceFor(p)
        this.runtime.light.decay = decayFor(p.type)
        this.runtime.light.visible = p.lightEnabled
        if (this.runtime.surface) {
            this.runtime.surface.position.set(0, liquidSurfaceLevel(p), 0)
            this.runtime.surface.scale.set(p.size.x * 0.94, 1, p.size.z * 0.94)
        }
        if (this.runtime.surfaceOverlay) {
            const y = p.type === 'water' ? -p.size.y / 2 + 0.05 : liquidSurfaceLevel(p) + 0.03
            this.runtime.surfaceOverlay.position.set(0, y, 0)
            this.runtime.surfaceOverlay.scale.set(p.size.x * 0.94, 1, p.size.z * 0.94)
        }
    }
}

function decayFor(type: WeatherZoneParams['type']): number {
    switch (type) {
        case 'fire': return 1.35
        case 'fireTornado': return 1.3
        case 'explosion': return 1.2
        case 'firefly': return 1.7
        case 'lava': return 1.45
        default: return 2.0
    }
}

function liquidSurfaceLevel(params: WeatherZoneParams): number {
    if (params.type === 'water') return -params.size.y / 2 + params.size.y * 0.28
    if (params.type === 'lava') return -params.size.y / 2 + params.size.y * 0.30
    return 0
}

function lightOffsetFor(params: WeatherZoneParams): number {
    switch (params.type) {
        case 'fire': return -params.size.y * 0.34
        case 'fireTornado': return 0
        case 'explosion': return 0
        case 'boiling': return -params.size.y * 0.10
        case 'firefly': return 0
        case 'water': return -params.size.y * 0.16
        case 'lava': return liquidSurfaceLevel(params) + params.size.y * 0.16
        default: return params.size.y * 0.25
    }
}

function lightDistanceFor(params: WeatherZoneParams): number {
    if (params.type === 'explosion') return params.lightDistance * 1.15
    if (params.type === 'lightning') return params.lightDistance * 1.25
    return params.lightDistance
}

function hashCode(s: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h | 0
}
