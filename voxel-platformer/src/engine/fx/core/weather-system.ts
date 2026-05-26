import { Camera, Object3D, type Scene } from 'three'
import type { AmbientWeatherState, WeatherZoneParams } from './types'
import { WeatherZone } from './weather-zone'
import { AmbientWeather, defaultAmbientState } from './ambient-weather'
import { TextureRegistry } from '../textures/texture-registry'
import { MaterialRegistry } from '../materials/material-registry'
import { LightBudget } from '../lights/light-budget'
import { getEmitter } from '../emitters/registry'

export interface WeatherSystemOptions {
    /** Whether this system owns level-wide sky/fog/sun/weather. Default true. */
    ambient?: boolean
    /** Cap on simultaneous lit FX point lights. Default 6. */
    maxLights?: number
    /** Skip a zone's update if its centre is more than `cullDistance`
     *  units from the camera. 0 disables culling. Default 80. */
    cullDistance?: number
}

/**
 * Top-level FX manager. Owns:
 *
 *  - `AmbientWeather` — camera-following rain / snow / clouds / sky /
 *    fog / sun / lightning flash light. One instance per system.
 *  - `WeatherZone[]` — bounded effect volumes (fire pits, explosions,
 *    magic motes, water surfaces, lava pools…) placed by the level
 *    or fired off as one-shot events.
 *  - Shared registries — textures, materials, light budget.
 *
 * Call `update(dt, camera)` once per frame from your game loop after
 * the renderer's clock is updated. Call `dispose()` when tearing the
 * scene down.
 */
export class WeatherSystem {
    readonly ambient: AmbientWeather | DisabledAmbientWeather
    readonly textures = new TextureRegistry()
    readonly materials = new MaterialRegistry()
    private readonly zones = new Map<string, WeatherZone>()
    private readonly oneShots: { zone: WeatherZone; expireAt: number }[] = []
    private readonly lightBudget: LightBudget
    private readonly dummy = new Object3D()
    private elapsed = 0
    private readonly cullDistance: number

    constructor(private readonly scene: Scene, opts: WeatherSystemOptions = {}) {
        this.ambient = opts.ambient === false ? new DisabledAmbientWeather() : new AmbientWeather(scene)
        this.lightBudget = new LightBudget(opts.maxLights ?? 6)
        this.cullDistance = opts.cullDistance ?? 80
    }

    /** Apply a patch to the ambient state (rain/snow/sky/fog/sun…). */
    setAmbient(patch: Partial<AmbientWeatherState>): void {
        this.ambient.setState(patch)
    }

    addZone(params: WeatherZoneParams): WeatherZone {
        const id = params.id ?? `zone:${this.zones.size + 1}:${Math.random().toString(36).slice(2, 8)}`
        const ready: WeatherZoneParams = { ...params, id }
        const zone = new WeatherZone(ready)
        const strategy = getEmitter(ready.type)
        zone.init(strategy, { textures: this.textures, materials: this.materials }, this.scene)
        this.zones.set(id, zone)
        return zone
    }

    removeZone(id: string): void {
        const zone = this.zones.get(id)
        if (!zone) return
        zone.dispose()
        this.zones.delete(id)
    }

    getZone(id: string): WeatherZone | undefined {
        return this.zones.get(id)
    }

    updateZone(id: string, patch: Partial<WeatherZoneParams>): void {
        const zone = this.zones.get(id)
        if (!zone) return
        const oldType = zone.runtime.params.type
        zone.setParams(patch)
        if (patch.type !== undefined && patch.type !== oldType) {
            zone.setStrategy(getEmitter(patch.type))
        }
    }

    /**
     * Spawn an event-style effect (explosion, lightning fork) at a
     * position. The zone disposes itself once `lifetime + 1.5s` has
     * elapsed — long enough for shockwaves + debris to settle.
     */
    triggerExplosion(position: { x: number; y: number; z: number }, overrides: Partial<WeatherZoneParams> = {}): WeatherZone {
        const params = mergeParams({
            type: 'explosion',
            name: 'oneshot-explosion',
            color: '#ffb13b',
            position,
            size: { x: 10, y: 8.5, z: 10 },
            count: 600,
            particleSize: 0.36,
            opacity: 0.98,
            speed: 10.5,
            turbulence: 0.65,
            windX: 0, windZ: 0,
            gravity: 0.72,
            lifetime: 2.15,
            streaks: false, streakLength: 0.35,
            lightEnabled: true, lightColor: '#ff9a2d', lightIntensity: 16, lightDistance: 36, lightning: false,
        }, overrides)
        const zone = this.addZone(params)
        // Flag the runtime so the explosion emitter never reschedules a
        // second burst. Without this, the recurring-burst path would
        // fire ≈ `lifetime + 1.35 s` after spawn — which overlapped the
        // despawn window (`lifetime + 1.5 s`) by 0.15 s and produced a
        // visible "echo" right before the zone disappeared.
        ;(zone.runtime as { _explosionOneShot?: boolean })._explosionOneShot = true
        this.oneShots.push({ zone, expireAt: this.elapsed + params.lifetime + 1.5 })
        return zone
    }

    update(dt: number, camera: Camera): void {
        this.elapsed += dt
        this.ambient.update(dt, this.elapsed, camera, this.dummy)
        // Visibility / LOD pass.
        if (this.cullDistance > 0) {
            const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z
            const d2 = this.cullDistance * this.cullDistance
            for (const zone of this.zones.values()) {
                const dx = zone.runtime.params.position.x - cx
                const dy = zone.runtime.params.position.y - cy
                const dz = zone.runtime.params.position.z - cz
                zone.runtime.visible = (dx * dx + dy * dy + dz * dz) <= d2
            }
        }
        for (const zone of this.zones.values()) zone.update(dt, this.elapsed, camera, this.dummy)
        // Light budget runs after emitters have written their wanted
        // intensities to `light.userData.wanted`.
        const lights = [...this.zones.values()].map((z) => z.runtime.light)
        this.lightBudget.apply(lights, camera)

        // Expire one-shots.
        for (let i = this.oneShots.length - 1; i >= 0; i--) {
            if (this.elapsed >= this.oneShots[i]!.expireAt) {
                this.removeZone(this.oneShots[i]!.zone.runtime.params.id!)
                this.oneShots.splice(i, 1)
            }
        }
    }

    /** Serialize every zone + the ambient state. */
    serialize(): { version: 1; ambient: AmbientWeatherState; zones: WeatherZoneParams[] } {
        return {
            version: 1,
            ambient: { ...this.ambient.state },
            zones: [...this.zones.values()].map((z) => z.toJSON()),
        }
    }

    deserialize(data: { ambient?: Partial<AmbientWeatherState>; zones?: WeatherZoneParams[] }): void {
        for (const zone of this.zones.values()) zone.dispose()
        this.zones.clear()
        if (data.ambient) this.ambient.setState(data.ambient)
        for (const params of data.zones ?? []) this.addZone(params)
    }

    dispose(): void {
        for (const zone of this.zones.values()) zone.dispose()
        this.zones.clear()
        this.ambient.dispose()
        this.materials.dispose()
        this.textures.dispose()
    }
}

class DisabledAmbientWeather {
    readonly state: AmbientWeatherState = defaultAmbientState()

    setState(patch: Partial<AmbientWeatherState>): void {
        Object.assign(this.state, patch)
    }

    update(_dt: number, _elapsed: number, _camera: Camera, _dummy: Object3D): void {
        // Zone-only systems deliberately do not own scene sky/fog/lights.
    }

    dispose(): void {
        // Nothing to release.
    }
}

function mergeParams(base: WeatherZoneParams, patch: Partial<WeatherZoneParams>): WeatherZoneParams {
    return {
        ...base,
        ...patch,
        position: { ...base.position, ...(patch.position ?? {}) },
        size: { ...base.size, ...(patch.size ?? {}) },
    }
}
