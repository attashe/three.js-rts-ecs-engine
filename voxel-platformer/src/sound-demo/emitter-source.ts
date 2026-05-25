import {
    BufferGeometry,
    Color,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineLoop,
    Mesh,
    MeshStandardMaterial,
    Scene,
    SphereGeometry,
} from 'three'
import type { AudioEngine, SoundHandle, Vec3Like } from '../engine/audio'

/**
 * One placed sound emitter in the demo scene. Visualises the
 * `refDistance` (inner ring) and `maxDistance` (outer ring) so the
 * user can *see* the falloff zone the panner is computing against.
 *
 * Owns one persistent looping `SoundHandle` for ambient sources, or
 * fires one-shots on demand. The handle's position is locked to this
 * marker — moving the marker updates the panner via `setPosition`.
 */
export interface EmitterSourceOpts {
    audio: AudioEngine
    scene: Scene
    assetId: string
    label: string
    position: Vec3Like
    color: string
    /** If true, plays continuously and updates position each frame. */
    loop: boolean
    refDistance: number
    maxDistance: number
    rolloffFactor: number
    panningModel: 'HRTF' | 'equalpower'
}

export class EmitterSource {
    readonly root: Group
    readonly id: string = `emitter-${++idCounter}`
    private assetId: string
    private label: string
    private loop: boolean
    private refDistance: number
    private maxDistance: number
    private rolloffFactor: number
    private panningModel: 'HRTF' | 'equalpower'
    private handle: SoundHandle | null = null
    private active = true

    private readonly orb: Mesh
    private readonly innerRing: LineLoop
    private readonly outerRing: LineLoop
    private readonly material: MeshStandardMaterial
    private readonly innerMat: LineBasicMaterial
    private readonly outerMat: LineBasicMaterial

    constructor(private readonly opts: EmitterSourceOpts) {
        this.assetId = opts.assetId
        this.label = opts.label
        this.loop = opts.loop
        this.refDistance = opts.refDistance
        this.maxDistance = opts.maxDistance
        this.rolloffFactor = opts.rolloffFactor
        this.panningModel = opts.panningModel
        this.root = new Group()
        this.root.name = `Emitter:${opts.label}`
        this.root.position.set(opts.position.x, opts.position.y, opts.position.z)

        this.material = new MeshStandardMaterial({
            color: new Color(opts.color),
            emissive: new Color(opts.color),
            emissiveIntensity: 0.7,
            roughness: 0.5,
        })
        this.orb = new Mesh(new SphereGeometry(0.35, 16, 10), this.material)
        this.orb.position.y = 0.45
        this.root.add(this.orb)

        this.innerMat = new LineBasicMaterial({ color: new Color(opts.color), transparent: true, opacity: 0.95 })
        this.outerMat = new LineBasicMaterial({ color: new Color(opts.color), transparent: true, opacity: 0.35 })
        this.innerRing = new LineLoop(makeRingGeometry(this.refDistance), this.innerMat)
        this.innerRing.rotation.x = -Math.PI / 2
        this.innerRing.position.y = 0.06
        this.outerRing = new LineLoop(makeRingGeometry(this.maxDistance), this.outerMat)
        this.outerRing.rotation.x = -Math.PI / 2
        this.outerRing.position.y = 0.04
        this.root.add(this.innerRing, this.outerRing)

        opts.scene.add(this.root)
    }

    get position(): { x: number; y: number; z: number } {
        return {
            x: this.root.position.x,
            y: this.root.position.y,
            z: this.root.position.z,
        }
    }

    setPosition(x: number, y: number, z: number): void {
        this.root.position.set(x, y, z)
        this.handle?.setPosition({ x, y, z })
    }

    setAsset(assetId: string, label: string): void {
        if (this.assetId === assetId && this.label === label) return
        this.assetId = assetId
        this.label = label
        this.root.name = `Emitter:${label}`
        // Restart playback so the new asset takes effect immediately.
        if (this.handle && this.loop) {
            this.handle.stop(0)
            this.handle = null
            this.play()
        }
    }

    setLoop(loop: boolean): void {
        if (this.loop === loop) return
        this.loop = loop
        if (!loop && this.handle) {
            this.handle.stop(0.1)
            this.handle = null
        } else if (loop && !this.handle) {
            this.play()
        }
    }

    setRefDistance(v: number): void {
        this.refDistance = Math.max(0.1, v)
        this.innerRing.geometry.dispose()
        this.innerRing.geometry = makeRingGeometry(this.refDistance)
        // Existing voice keeps its baked refDistance — we'd need to
        // re-spawn to apply a new value. For loops, restart.
        if (this.loop && this.handle) {
            this.handle.stop(0)
            this.handle = null
            this.play()
        }
    }

    setMaxDistance(v: number): void {
        this.maxDistance = Math.max(this.refDistance + 0.5, v)
        this.outerRing.geometry.dispose()
        this.outerRing.geometry = makeRingGeometry(this.maxDistance)
        if (this.loop && this.handle) {
            this.handle.stop(0)
            this.handle = null
            this.play()
        }
    }

    setRolloffFactor(v: number): void {
        this.rolloffFactor = Math.max(0, v)
        if (this.loop && this.handle) {
            this.handle.stop(0)
            this.handle = null
            this.play()
        }
    }

    setPanningModel(model: 'HRTF' | 'equalpower'): void {
        if (this.panningModel === model) return
        this.panningModel = model
        if (this.loop && this.handle) {
            this.handle.stop(0)
            this.handle = null
            this.play()
        }
    }

    setColor(css: string): void {
        const c = new Color(css)
        this.material.color.copy(c)
        this.material.emissive.copy(c)
        this.innerMat.color.copy(c)
        this.outerMat.color.copy(c)
    }

    /** Wait this many seconds before the next `play()` actually fires
     *  the voice. Useful for composition timing tests. */
    setPlayDelay(seconds: number): void {
        this.playDelay = Math.max(0, seconds)
    }

    /**
     * Start a fresh voice for this emitter. If `playDelay` is set,
     * defers the actual play via `setTimeout` and returns a handle
     * that's bound only once the voice exists. The handle's `stop`
     * cancels the timer if called before the deferred play fires.
     */
    play(): SoundHandle {
        if (this.playDelay <= 0) return this.playNow()
        // Deferred play — return an in-flight placeholder that
        // resolves into the real handle when the timer fires.
        const placeholder = new DeferredHandle(this.assetId, true)
        this.handle = placeholder as unknown as SoundHandle
        const timer = setTimeout(() => {
            if (placeholder.cancelled) return
            const real = this.playNow()
            placeholder.attachReal(real)
        }, this.playDelay * 1000)
        placeholder.onCancel(() => clearTimeout(timer))
        return placeholder as unknown as SoundHandle
    }

    private playNow(): SoundHandle {
        const handle = this.opts.audio.playSpatial(this.assetId, this.position, {
            loop: this.loop,
            refDistance: this.refDistance,
            maxDistance: this.maxDistance,
            rolloffFactor: this.rolloffFactor,
            panningModel: this.panningModel,
        })
        this.handle = handle
        // Clear the cached handle when the voice ends naturally so
        // `setLoop(true)` can revive it cleanly.
        handle.ended.then(() => {
            if (this.handle === handle) this.handle = null
        })
        return handle
    }

    private playDelay = 0

    stop(): void {
        this.handle?.stop(0.1)
        this.handle = null
    }

    setSelected(selected: boolean): void {
        this.material.emissiveIntensity = selected ? 1.4 : 0.7
        this.outerMat.opacity = selected ? 0.55 : 0.35
    }

    dispose(): void {
        if (!this.active) return
        this.active = false
        this.stop()
        this.opts.scene.remove(this.root)
        this.orb.geometry.dispose()
        this.material.dispose()
        this.innerRing.geometry.dispose()
        this.outerRing.geometry.dispose()
        this.innerMat.dispose()
        this.outerMat.dispose()
    }

    /** Snapshot for the inspector. */
    snapshot() {
        return {
            id: this.id,
            assetId: this.assetId,
            label: this.label,
            position: this.position,
            loop: this.loop,
            refDistance: this.refDistance,
            maxDistance: this.maxDistance,
            rolloffFactor: this.rolloffFactor,
            panningModel: this.panningModel,
            playing: this.handle !== null && !this.handle.stopped,
        }
    }
}

let idCounter = 0

/**
 * Bridge handle returned by `EmitterSource.play()` when a delay is
 * set. Behaves like a `SoundHandle` immediately (the inspector can
 * call `.stop()` to cancel the pending play before it fires), and
 * proxies all calls through to the real handle once the timer fires
 * and the voice exists.
 */
class DeferredHandle implements SoundHandle {
    cancelled = false
    private real: SoundHandle | null = null
    private cancelCb: (() => void) | null = null
    private resolveEnded!: () => void
    readonly ended: Promise<void>

    constructor(readonly id: string, readonly spatial: boolean) {
        this.ended = new Promise<void>((resolve) => { this.resolveEnded = resolve })
    }

    get stopped(): boolean { return this.cancelled || (this.real?.stopped ?? false) }

    stop(fadeOut = 0): void {
        if (this.cancelled) return
        this.cancelled = true
        this.cancelCb?.()
        if (this.real) this.real.stop(fadeOut)
        else this.resolveEnded()
    }

    setVolume(volume: number, ramp = 0): void { this.real?.setVolume(volume, ramp) }
    setPosition(position: { x: number; y: number; z: number }): void { this.real?.setPosition(position) }

    onCancel(cb: () => void): void { this.cancelCb = cb }
    attachReal(handle: SoundHandle): void {
        this.real = handle
        handle.ended.then(() => this.resolveEnded())
    }
}

function makeRingGeometry(radius: number): BufferGeometry {
    const segments = 96
    const positions = new Float32Array(segments * 3)
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * Math.PI * 2
        positions[i * 3]     = Math.cos(t) * radius
        positions[i * 3 + 1] = 0
        positions[i * 3 + 2] = Math.sin(t) * radius
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    // Avoid TS unused warning for an import that's only used in
    // material defaults elsewhere.
    void DoubleSide
    return geo
}
