import {
    AmbientLight,
    BackSide,
    BufferAttribute,
    Camera,
    Color,
    DirectionalLight,
    FogExp2,
    HemisphereLight,
    InstancedMesh,
    LinearFilter,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PlaneGeometry,
    PointLight,
    Scene,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    Vector3,
    CanvasTexture,
} from 'three'
import type { AmbientWeatherState } from './types'
import { clamp, makeRng, rand, smoothstep } from './sim-utils'
import { applyColor, applyColorTinted, sampleDayCycle, type CycleStop } from './day-cycle'

/**
 * Global ambient weather: rain that follows the camera, snow that
 * follows the camera, slow drifting cloud sprites, lightning flash
 * light, gradient sky dome, exponential fog, and a day-night-driven
 * sun direction. This is **the** system that the voxel-weather.html
 * demo was built around — its strength is that it follows the player
 * instead of being bound to a zone volume.
 *
 * `AmbientWeather` owns the sky / fog / sun, so the host application
 * should construct it AFTER its scene + renderer are ready but
 * BEFORE other ambient lights are added, then leave sky/sun mutation
 * to the system. Localized zones (rain *over a small area*, fire in a
 * pit, etc.) belong on `WeatherSystem`.
 */
export class AmbientWeather {
    readonly state: AmbientWeatherState = defaultAmbientState()
    private readonly skyMesh: Mesh
    private readonly skyColors: Float32Array
    private readonly ambient: AmbientLight
    private readonly sun: DirectionalLight
    private readonly hemi: HemisphereLight
    private readonly lightning: PointLight
    private readonly rain: AmbientField
    private readonly snow: AmbientField
    private readonly clouds: CloudField
    private readonly storm: LightningTimer
    private readonly previousFog: Scene['fog']
    private readonly sunOffset = { x: 30, y: 50, z: 20 }
    /** Where the sun's shadow frustum should be centred. Defaults to the
     *  camera's lookAt direction projected onto y = 0 when callers don't
     *  override it. Drives `positionSunForCamera`. */
    private readonly focusOverride = new Vector3()
    private focusOverrideSet = false
    private readonly tmpFocus = new Vector3()
    private readonly tmpForward = new Vector3()

    constructor(private readonly scene: Scene) {
        this.previousFog = scene.fog
        // Sky dome — back-side sphere with vertex-colour gradient.
        const skyGeo = new SphereGeometry(240, 32, 16)
        this.skyColors = new Float32Array(skyGeo.attributes.position!.count * 3)
        skyGeo.setAttribute('color', new BufferAttribute(this.skyColors, 3))
        const skyMat = new MeshBasicMaterial({ side: BackSide, vertexColors: true, depthWrite: false, fog: false })
        this.skyMesh = new Mesh(skyGeo, skyMat)
        this.skyMesh.renderOrder = -1
        scene.add(this.skyMesh)

        scene.fog = new FogExp2(new Color(this.state.fogColor).getHex(), this.state.fogDensity)

        this.ambient = new AmbientLight(new Color(this.state.ambientColor), this.state.ambientIntensity)
        this.sun = new DirectionalLight(new Color(this.state.sunColor), this.state.sunIntensity)
        this.sun.position.set(this.sunOffset.x, this.sunOffset.y, this.sunOffset.z)
        this.sun.castShadow = true
        // Tightened from ±36 to ±24 — the camera-following sun never needs
        // to shadow further than what's visible in the isometric viewport,
        // and a smaller frustum quadruples effective shadow-map resolution
        // for the same memory cost. Lifts wedge artefacts in tight vertical
        // mazes where a block 2 cells above the player would otherwise
        // project a low-res shadow across the lit pool.
        this.sun.shadow.camera.left = -24
        this.sun.shadow.camera.right = 24
        this.sun.shadow.camera.top = 24
        this.sun.shadow.camera.bottom = -24
        this.sun.shadow.camera.near = 1
        this.sun.shadow.camera.far = 180
        this.sun.shadow.camera.updateProjectionMatrix()
        this.sun.shadow.mapSize.set(2048, 2048)
        // Voxel surfaces are axis-aligned, so the projected depth is very
        // sensitive to bias. -0.0008 / 0.04 are the documented safe range
        // for unit-cube geometry and remove both acne (self-shadowing)
        // and the peter-panning that PCFSoftShadowMap leaves at default.
        this.sun.shadow.bias = -0.0008
        this.sun.shadow.normalBias = 0.04
        this.hemi = new HemisphereLight(0xb0c8e0, 0x2a2418, 0.3)
        this.lightning = new PointLight(new Color(this.state.lightningColor), 0, 200, 1.5)
        scene.add(this.ambient, this.sun, this.sun.target, this.hemi, this.lightning)

        this.rain = new AmbientField(scene, 'streak', { maxCount: 12000, geo: new PlaneGeometry(0.12, 0.9) })
        this.snow = new AmbientField(scene, 'flake', { maxCount: 8000, geo: new PlaneGeometry(0.4, 0.4) })
        this.clouds = new CloudField(scene)
        this.storm = new LightningTimer()

        this.applyAtmosphere()
    }

    setState(patch: Partial<AmbientWeatherState>): void {
        Object.assign(this.state, patch)
        this.applyAtmosphere()
    }

    /**
     * Override the world-space point the sun's shadow frustum follows.
     * Pass `null` to fall back to projecting the camera's view onto y=0.
     *
     * The previous behaviour anchored the shadow frustum to
     * `camera.position`, which silently broke an orbiting iso camera —
     * yaw rotation moved the camera around the player, so the ±24-unit
     * shadow square would orbit off the player and shadows would only
     * appear for one specific rotation. Letting the host pin the focus
     * to the iso target (i.e. the player) keeps shadows stable across
     * camera moves.
     */
    setFocusPoint(focus: { x: number; y: number; z: number } | null): void {
        if (focus === null) {
            this.focusOverrideSet = false
            return
        }
        this.focusOverride.set(focus.x, focus.y, focus.z)
        this.focusOverrideSet = true
    }

    update(dt: number, elapsed: number, camera: Camera, dummy: Object3D): void {
        this.tickTime(dt)
        this.applyAtmosphere()
        this.skyMesh.position.copy(camera.position)
        this.positionSunForCamera(camera)
        const gust = Math.sin(elapsed * 0.4) * Math.cos(elapsed * 0.13) * this.state.windGusts
        const effWindX = this.state.windX + gust * 2
        const effWindZ = this.state.windZ + gust * 1.4

        this.rain.update({
            on: this.state.rainOn,
            count: this.state.rainCount,
            speed: this.state.rainSpeed,
            opacity: this.state.rainOpacity,
            color: this.state.rainColor,
            windX: effWindX,
            windZ: effWindZ,
        }, dt, elapsed, camera, dummy, 'rain')
        this.snow.update({
            on: this.state.snowOn,
            count: this.state.snowCount,
            speed: this.state.snowSpeed,
            opacity: this.state.snowOpacity,
            color: '#ffffff',
            windX: effWindX * 0.4,
            windZ: effWindZ * 0.4,
            sway: this.state.snowSway,
        }, dt, elapsed, camera, dummy, 'snow')
        this.clouds.update(dt, elapsed, camera, this.state)
        this.storm.update(dt, this.state, this.lightning, camera)
    }

    /**
     * Advance `timeOfDay` if the cycle is animated. Wraps at 24h.
     * `cycleSeconds` is the *real-time* duration of one in-game day; a
     * value of 600 means the in-game hour ticks at 24/600 hours per
     * real second (one day every ten minutes).
     */
    private tickTime(dt: number): void {
        if (!this.state.cycleEnabled) return
        const seconds = Math.max(1, this.state.cycleSeconds)
        const hoursPerSecond = 24 / seconds
        this.state.timeOfDay = ((this.state.timeOfDay + dt * hoursPerSecond) % 24 + 24) % 24
    }

    /**
     * Dispatch sky/sun/ambient/fog refresh by mode.
     *
     *  - `outdoor` → sample the day-cycle table, layer modulators, paint.
     *  - `indoor` → hide sky dome + sun + hemi; ambient from authored
     *    state only; fog from authored state if any.
     *  - `custom` → legacy path: every colour field read literally.
     */
    private applyAtmosphere(): void {
        const mode = this.state.mode ?? 'outdoor'
        if (mode === 'indoor') {
            this.applyIndoor()
            return
        }
        if (mode === 'custom') {
            this.applyCustom()
            return
        }
        this.applyOutdoor()
    }

    private applyOutdoor(): void {
        this.skyMesh.visible = true
        this.sun.visible = true
        const cycle = sampleDayCycle(this.state.timeOfDay)
        const tint = sanitizeTint(this.state.skyTint)
        const sunMul = Number.isFinite(this.state.sunIntensityMul) ? Math.max(0, this.state.sunIntensityMul) : 1
        const fogMul = Number.isFinite(this.state.fogDensityMul) ? Math.max(0, this.state.fogDensityMul) : 1
        this.paintSkyFromCycle(cycle, tint)
        this.paintFogFromCycle(cycle, fogMul)
        this.paintLightsFromCycle(cycle, sunMul)
    }

    private applyIndoor(): void {
        this.skyMesh.visible = false
        this.sun.visible = false
        this.hemi.intensity = 0
        const fog = this.scene.fog as FogExp2 | null
        if (fog) {
            fog.color.set(this.state.fogColor)
            fog.density = this.state.fogDensity
        }
        this.ambient.color.set(this.state.ambientColor)
        this.ambient.intensity = this.state.ambientIntensity
    }

    private applyCustom(): void {
        this.skyMesh.visible = true
        this.sun.visible = true
        this.refreshSky()
        this.refreshFog()
        this.refreshSun()
    }

    private paintSkyFromCycle(cycle: CycleStop, tint: [number, number, number]): void {
        const geo = this.skyMesh.geometry as SphereGeometry
        const positions = geo.attributes.position as BufferAttribute
        const radius = 240
        const top = new Color()
        const bot = new Color()
        applyColorTinted(top, cycle.skyTop, tint)
        applyColorTinted(bot, cycle.skyBottom, tint)
        const dim = 1 - this.state.cloudCoverage * 0.25
        top.multiplyScalar(dim)
        bot.multiplyScalar(0.9 + dim * 0.1)
        const tmp = new Color()
        for (let i = 0; i < positions.count; i++) {
            const ny = positions.getY(i) / radius
            const t = smoothstep(ny, -0.25, 0.65)
            tmp.copy(bot).lerp(top, t)
            this.skyColors[i * 3]     = tmp.r
            this.skyColors[i * 3 + 1] = tmp.g
            this.skyColors[i * 3 + 2] = tmp.b
        }
        ;(geo.attributes.color as BufferAttribute).needsUpdate = true
    }

    private paintFogFromCycle(cycle: CycleStop, densityMul: number): void {
        const fog = this.scene.fog as FogExp2 | null
        if (!fog) return
        fog.color.setRGB(cycle.fogColor[0], cycle.fogColor[1], cycle.fogColor[2])
        fog.density = cycle.fogDensity * densityMul
    }

    private paintLightsFromCycle(cycle: CycleStop, sunMul: number): void {
        // Compute sun direction from time-of-day + azimuth. Position +
        // target get applied later by `positionSunForCamera` (so the
        // shadow frustum follows the player). Only `sunOffset` and the
        // light parameters need updating here.
        const dayPhase = (this.state.timeOfDay - 6) / 12
        const angle = dayPhase * Math.PI
        const az = this.state.sunAzimuth * Math.PI / 180
        const horiz = Math.cos(angle) * 60
        const height = Math.sin(angle) * 50
        this.sunOffset.x = horiz * Math.cos(az)
        this.sunOffset.y = height
        this.sunOffset.z = horiz * Math.sin(az)
        const horizonFalloff = clamp(smoothstep(height, -5, 8), 0, 1)
        applyColor(this.sun.color, cycle.sunColor)
        this.sun.intensity = cycle.sunIntensity * sunMul * horizonFalloff
        applyColor(this.ambient.color, cycle.ambientColor)
        this.ambient.intensity = cycle.ambientIntensity
        applyColor(this.hemi.color, cycle.hemiSky)
        applyColor(this.hemi.groundColor, cycle.hemiGround)
        this.hemi.intensity = cycle.hemiIntensity
    }

    dispose(): void {
        this.scene.remove(this.skyMesh, this.ambient, this.sun, this.sun.target, this.hemi, this.lightning)
        this.scene.fog = this.previousFog
        this.skyMesh.geometry.dispose()
        ;(this.skyMesh.material as { dispose?: () => void }).dispose?.()
        this.rain.dispose()
        this.snow.dispose()
        this.clouds.dispose()
    }

    private refreshSky(): void {
        const geo = this.skyMesh.geometry as SphereGeometry
        const positions = geo.attributes.position as BufferAttribute
        const radius = 240
        const top = new Color(this.state.skyTop)
        const bot = new Color(this.state.skyBottom)
        const dim = 1 - this.state.cloudCoverage * 0.25
        top.multiplyScalar(dim)
        bot.multiplyScalar(0.9 + dim * 0.1)
        const tmp = new Color()
        for (let i = 0; i < positions.count; i++) {
            const ny = positions.getY(i) / radius
            const t = smoothstep(ny, -0.25, 0.65)
            tmp.copy(bot).lerp(top, t)
            this.skyColors[i * 3]     = tmp.r
            this.skyColors[i * 3 + 1] = tmp.g
            this.skyColors[i * 3 + 2] = tmp.b
        }
        ;(geo.attributes.color as BufferAttribute).needsUpdate = true
    }

    private refreshFog(): void {
        const fog = this.scene.fog as FogExp2 | null
        if (!fog) return
        fog.color.set(this.state.fogColor)
        fog.density = this.state.fogDensity
    }

    private refreshSun(): void {
        const dayPhase = (this.state.timeOfDay - 6) / 12
        const angle = dayPhase * Math.PI
        const az = this.state.sunAzimuth * Math.PI / 180
        const horiz = Math.cos(angle) * 60
        const height = Math.sin(angle) * 50
        this.sunOffset.x = horiz * Math.cos(az)
        this.sunOffset.y = height
        this.sunOffset.z = horiz * Math.sin(az)
        this.sun.position.set(this.sunOffset.x, this.sunOffset.y, this.sunOffset.z)
        this.sun.target.position.set(this.sunOffset.x * -0.02, 0, this.sunOffset.z * -0.02)
        const horizonFalloff = clamp(smoothstep(height, -5, 8), 0, 1)
        this.sun.intensity = this.state.sunIntensity * horizonFalloff
        this.sun.color.set(this.state.sunColor)
        this.ambient.color.set(this.state.ambientColor)
        this.ambient.intensity = this.state.ambientIntensity
    }

    private positionSunForCamera(camera: Camera): void {
        const focus = this.resolveSunFocus(camera)
        this.sun.position.set(
            focus.x + this.sunOffset.x,
            focus.y + this.sunOffset.y,
            focus.z + this.sunOffset.z,
        )
        // Targeting the focus point directly (not an offset back toward
        // the sun) keeps the orthographic shadow camera centred on the
        // player. The previous `-sunOffset * 0.02` nudge was a holdover
        // from when focus == camera.position and didn't matter; with a
        // real focal point it would shift the frustum off-centre.
        this.sun.target.position.set(focus.x, focus.y, focus.z)
    }

    /** Pick the world-space point the shadow frustum should sit on.
     *  Priority: explicit override (`setFocusPoint`) → camera ray cast
     *  onto y=0 → camera.position as a last resort. */
    private resolveSunFocus(camera: Camera): Vector3 {
        if (this.focusOverrideSet) {
            this.tmpFocus.copy(this.focusOverride)
            return this.tmpFocus
        }
        camera.getWorldDirection(this.tmpForward)
        const dy = this.tmpForward.y
        if (dy < -1e-3 && camera.position.y > 0) {
            const t = camera.position.y / -dy
            this.tmpFocus.copy(camera.position).addScaledVector(this.tmpForward, t)
            return this.tmpFocus
        }
        this.tmpFocus.copy(camera.position)
        return this.tmpFocus
    }
}

interface AmbientFieldParams {
    on: boolean
    count: number
    speed: number
    opacity: number
    color: string
    windX: number
    windZ: number
    sway?: number
}

class AmbientField {
    private readonly material: MeshBasicMaterial
    private readonly mesh: InstancedMesh
    private readonly maxCount: number
    private positions: Float32Array
    private phases: Float32Array
    private active = 0

    constructor(private readonly scene: Scene, kind: 'streak' | 'flake', opts: { maxCount: number; geo: PlaneGeometry }) {
        const tex = kind === 'streak' ? makeAmbientStreak() : makeAmbientFlake()
        // depthTest stays on so blocks above the camera (overhangs,
        // vertical mazes) properly occlude rain/snow streaks. depthWrite
        // is off so transparent particles don't punch holes in the
        // depth buffer for other transparents drawn after them.
        this.material = new MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0.8,
            depthTest: true,
            depthWrite: false,
        })
        this.maxCount = opts.maxCount
        this.mesh = new InstancedMesh(opts.geo, this.material, opts.maxCount)
        this.mesh.frustumCulled = false
        this.mesh.visible = false
        this.mesh.renderOrder = 900
        // Three's InstancedMesh draws `mesh.count` instances regardless of
        // how many matrices were updated. Start at zero so we don't render
        // unmodified zero matrices before the first reseed.
        this.mesh.count = 0
        scene.add(this.mesh)
        this.positions = new Float32Array(opts.maxCount * 3)
        this.phases = new Float32Array(opts.maxCount)
    }

    update(params: AmbientFieldParams, dt: number, elapsed: number, camera: Camera, dummy: Object3D, kind: 'rain' | 'snow'): void {
        if (!params.on) {
            if (this.mesh.visible) this.mesh.visible = false
            return
        }
        this.mesh.visible = true
        if (params.count !== this.active) this.reseed(params.count, camera)
        this.material.color.set(new Color(params.color))
        this.material.opacity = params.opacity

        const fall = params.speed * dt
        const wx = params.windX * dt * 0.6
        const wz = params.windZ * dt * 0.6
        const sway = params.sway ?? 0
        const cx = camera.position.x, cz = camera.position.z

        for (let i = 0; i < this.active; i++) {
            const ix = i * 3
            this.positions[ix]     += wx + (sway ? Math.sin(elapsed * 0.8 + this.phases[i]!) * sway * dt : 0)
            this.positions[ix + 1] -= fall
            this.positions[ix + 2] += wz + (sway ? Math.cos(elapsed * 0.6 + this.phases[i]! * 1.3) * sway * dt * 0.7 : 0)

            let px = this.positions[ix]!, py = this.positions[ix + 1]!, pz = this.positions[ix + 2]!
            if (py < -3) {
                px = cx + (Math.random() - 0.5) * 45
                py = 40 + Math.random() * 15
                pz = cz + (Math.random() - 0.5) * 45
                this.positions[ix] = px; this.positions[ix + 1] = py; this.positions[ix + 2] = pz
            }
            const dxp = px - cx, dzp = pz - cz
            if (Math.abs(dxp) > 25) { px -= Math.sign(dxp) * 50; this.positions[ix] = px }
            if (Math.abs(dzp) > 25) { pz -= Math.sign(dzp) * 50; this.positions[ix + 2] = pz }

            const yaw = Math.atan2(cx - px, cz - pz)
            const spin = kind === 'snow' ? elapsed * 1.6 + this.phases[i]! : 0
            const stretch = kind === 'rain' ? 1 + params.speed * 0.025 : 1
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, spin)
            dummy.scale.set(1, stretch, 1)
            dummy.updateMatrix()
            this.mesh.setMatrixAt(i, dummy.matrix)
        }
        this.mesh.instanceMatrix.needsUpdate = true
    }

    private reseed(count: number, camera: Camera): void {
        const target = clamp(count, 0, this.maxCount)
        for (let i = 0; i < target; i++) {
            this.positions[i * 3]     = camera.position.x + (Math.random() - 0.5) * 50
            this.positions[i * 3 + 1] = 5 + Math.random() * 50
            this.positions[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 50
            this.phases[i] = Math.random() * Math.PI * 2
        }
        this.active = target
        // Pin GPU draw count to the live particle population so unused
        // instances (with stale or zero matrices) don't get rasterised.
        // Without this the InstancedMesh keeps issuing draw calls for
        // every slot up to maxCount; degenerate triangles, but they also
        // confuse transparent sort ordering on certain camera angles.
        this.mesh.count = target
    }

    dispose(): void {
        this.scene.remove(this.mesh)
        ;(this.mesh.geometry as { dispose?: () => void }).dispose?.()
        this.material.dispose()
        if (this.material.map) this.material.map.dispose()
    }
}

class CloudField {
    private readonly sprites: Sprite[] = []
    private readonly textures: CanvasTexture[]
    private readonly rng = makeRng(1)

    constructor(private readonly scene: Scene) {
        this.textures = [0, 1, 2].map((i) => makeAmbientCloud(i + 1))
        for (let i = 0; i < 24; i++) {
            const tex = this.textures[i % this.textures.length]!
            const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.7 })
            const s = new Sprite(mat)
            s.scale.set(rand(this.rng, 22, 36), rand(this.rng, 9, 14), 1)
            s.position.set(rand(this.rng, -110, 110), rand(this.rng, 28, 36), rand(this.rng, -110, 110))
            s.visible = false
            this.sprites.push(s)
            scene.add(s)
        }
    }

    update(dt: number, _elapsed: number, camera: Camera, state: AmbientWeatherState): void {
        const cx = camera.position.x
        const cz = camera.position.z
        const target = Math.round(this.sprites.length * state.cloudCoverage)
        for (let i = 0; i < this.sprites.length; i++) {
            const s = this.sprites[i]!
            s.visible = i < target
            if (!s.visible) continue
            s.position.x += state.windX * dt * 0.4
            s.position.z += state.windZ * dt * 0.4
            if (s.position.x - cx >  120) s.position.x = cx - 120
            if (s.position.x - cx < -120) s.position.x = cx + 120
            if (s.position.z - cz >  120) s.position.z = cz - 120
            if (s.position.z - cz < -120) s.position.z = cz + 120
            const mat = s.material as SpriteMaterial
            mat.color.set(state.ambientColor).lerp(new Color(state.sunColor), 0.35)
            mat.opacity = 0.45 + state.cloudCoverage * 0.4
        }
    }

    dispose(): void {
        for (const s of this.sprites) {
            this.scene.remove(s)
            ;(s.material as { dispose?: () => void }).dispose?.()
        }
        for (const t of this.textures) t.dispose()
    }
}

class LightningTimer {
    private timer = 0
    private nextStrike = 2 + Math.random() * 3
    private flashT = 0
    private readonly flashDuration = 0.55

    update(dt: number, state: AmbientWeatherState, light: PointLight, camera: Camera): void {
        if (!state.lightningOn) {
            light.intensity = 0
            this.timer = 0
            this.nextStrike = 1 / Math.max(state.lightningRate, 0.01) + Math.random() * 2
            return
        }
        this.timer += dt
        if (this.flashT > 0) {
            this.flashT -= dt
            const p = 1 - this.flashT / this.flashDuration
            const pulse = Math.pow(Math.max(0, Math.sin(p * Math.PI * 3.2)), 1.5) * Math.pow(1 - p, 0.5)
            light.intensity = pulse * state.lightningIntensity
            light.color.set(state.lightningColor)
        } else {
            light.intensity = 0
        }
        if (this.timer >= this.nextStrike) {
            this.timer = 0
            this.nextStrike = 1 / Math.max(state.lightningRate, 0.01) + Math.random() * 4
            this.flashT = this.flashDuration
            light.position.set(
                camera.position.x + (Math.random() - 0.5) * 70,
                camera.position.y + 10 + Math.random() * 18,
                camera.position.z + (Math.random() - 0.5) * 70,
            )
        }
    }
}

export function defaultAmbientState(): AmbientWeatherState {
    return {
        mode: 'outdoor',
        cycleEnabled: false,
        cycleSeconds: 600,
        skyTint: [1, 1, 1],
        sunIntensityMul: 1,
        fogDensityMul: 1,
        skyTop: '#7aa9d4',
        skyBottom: '#c9d9e8',
        fogColor: '#b5c6d6',
        fogDensity: 0.012,
        sunIntensity: 1.1,
        sunColor: '#ffe9c4',
        ambientIntensity: 0.5,
        ambientColor: '#8aa3c4',
        timeOfDay: 12.0,
        sunAzimuth: 135,
        rainOn: false,
        rainCount: 4000,
        rainSpeed: 22.0,
        rainOpacity: 0.55,
        rainColor: '#aac8e8',
        snowOn: false,
        snowCount: 2500,
        snowSpeed: 1.8,
        snowSway: 1.2,
        snowOpacity: 0.95,
        windX: 0,
        windZ: 0,
        windGusts: 0.2,
        lightningOn: false,
        lightningRate: 0.25,
        lightningIntensity: 30,
        lightningColor: '#cfe0ff',
        cloudCoverage: 0.0,
    }
}

function sanitizeTint(tint: [number, number, number] | undefined): [number, number, number] {
    if (!tint) return [1, 1, 1]
    return [
        Number.isFinite(tint[0]) ? Math.max(0, tint[0]) : 1,
        Number.isFinite(tint[1]) ? Math.max(0, tint[1]) : 1,
        Number.isFinite(tint[2]) ? Math.max(0, tint[2]) : 1,
    ]
}

function makeAmbientStreak(): CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 8; c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0, 'rgba(220,235,255,0)')
    g.addColorStop(0.3, 'rgba(220,235,255,0.95)')
    g.addColorStop(0.7, 'rgba(220,235,255,0.95)')
    g.addColorStop(1, 'rgba(220,235,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(2, 0, 4, 64)
    const t = new CanvasTexture(c)
    t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false
    return t
}

function makeAmbientFlake(): CanvasTexture {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 14)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 32, 32)
    const t = new CanvasTexture(c)
    t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false
    return t
}

function makeAmbientCloud(seed: number): CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 128
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, 256, 128)
    const rnd = (() => {
        let s = seed * 9301 + 49297
        return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    })()
    for (let i = 0; i < 14; i++) {
        const x = 32 + rnd() * 192
        const y = 32 + rnd() * 64
        const r = 18 + rnd() * 30
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, 'rgba(255,255,255,0.85)')
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 256, 128)
    }
    return new CanvasTexture(c)
}

void MathUtils
