import { Camera, Frustum, Matrix4, Object3D, Sphere, Vector3, type Scene } from 'three'
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
    private readonly cullFrustum = new Frustum()
    private readonly cullMatrix = new Matrix4()
    private readonly cullSphere = new Sphere()
    private readonly cullCenter = new Vector3()
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

    setZoneActive(id: string, active: boolean): boolean {
        const zone = this.zones.get(id)
        if (!zone) return false
        zone.setActive(active)
        return true
    }

    getZone(id: string): WeatherZone | undefined {
        return this.zones.get(id)
    }

    /**
     * Pre-compile shaders + GPU pipelines for every spawned zone, including
     * ones currently hidden (`active === false`). Without this, the first
     * `setZoneActive(true)` of a level-authored-but-disabled zone stalls
     * the main thread for 100–500 ms on WebGPU while shaders compile —
     * the player perceives it as a half-second freeze the first time a
     * magic zone or rain volume comes online.
     *
     * `compileAsync(scene, camera)` walks the visible scene graph at call
     * time, so we briefly reveal hidden groups, hand off the work, and
     * restore visibility once the promise settles. Pre-spawning + warming
     * is cheap because compileAsync is asynchronous on WebGPU and runs
     * mostly off the main thread.
     */
    warmShaders(
        compileAsync: (scene: Scene, camera: Camera) => Promise<unknown>,
        camera: Camera,
    ): Promise<void> {
        const restored: WeatherZone[] = []
        for (const zone of this.zones.values()) {
            if (!zone.group.visible) {
                zone.group.visible = true
                restored.push(zone)
            }
        }
        const restore = () => {
            for (const z of restored) z.group.visible = false
        }
        return compileAsync(this.scene, camera).then(restore, (err) => {
            restore()
            throw err
        })
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
        // Visibility / LOD pass. Script-disabled zones remain allocated but
        // inactive so toggling them does not allocate/dispose particle meshes.
        const cullingEnabled = this.cullDistance > 0
        const useDistanceCull = cullingEnabled && !isOrthographicCamera(camera)
        if (cullingEnabled) {
            camera.updateMatrixWorld()
            this.cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            this.cullFrustum.setFromProjectionMatrix(this.cullMatrix)
        }
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z
        const d2 = this.cullDistance * this.cullDistance
        for (const zone of this.zones.values()) {
            let visible = zone.runtime.active
            if (visible && cullingEnabled) {
                const p = zone.runtime.params
                this.cullCenter.set(p.position.x, p.position.y, p.position.z)
                this.cullSphere.set(this.cullCenter, zoneCullRadius(p.size))
                visible = this.cullFrustum.intersectsSphere(this.cullSphere)
            }
            if (visible && useDistanceCull) {
                const p = zone.runtime.params.position
                const dx = p.x - cx
                const dy = p.y - cy
                const dz = p.z - cz
                visible = (dx * dx + dy * dy + dz * dz) <= d2
            }
            zone.runtime.visible = visible
            zone.group.visible = visible
        }
        for (const zone of this.zones.values()) zone.update(dt, this.elapsed, camera, this.dummy)
        // Light budget runs after emitters have written their wanted
        // intensities to `light.userData.wanted`.
        const lights = [...this.zones.values()]
            .filter((z) => z.runtime.active)
            .map((z) => z.runtime.light)
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

function isOrthographicCamera(camera: Camera): boolean {
    return (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true
}

function zoneCullRadius(size: { x: number; y: number; z: number }): number {
    return Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) * 0.5 + 4
}

class DisabledAmbientWeather {
    readonly state: AmbientWeatherState = defaultAmbientState()

    setState(patch: Partial<AmbientWeatherState>): void {
        Object.assign(this.state, patch)
    }

    setFocusPoint(_focus: { x: number; y: number; z: number } | null): void {
        // No sun to follow — accept and ignore for API parity with AmbientWeather.
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
