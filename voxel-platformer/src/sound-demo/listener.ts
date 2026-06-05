import {
    ConeGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Quaternion,
    Scene,
    Vector3,
} from 'three'
import type { AudioEngine } from '../engine/audio'

/**
 * Visible "ears" avatar for the demo. The listener is a separate
 * entity from the orbital camera so the user can fly the camera
 * around while keeping the listener anchored — that's the only way
 * to *see* spatial sound: by watching emitters change pan/gain
 * relative to a known listener pose.
 *
 * Controls (handled in `attach`):
 *   - WASD: pan on the ground plane
 *   - Q / E: drop / lift along Y
 *   - Arrow keys: rotate yaw (so the forward vector shifts; useful
 *     for HRTF where left/right depends on which way you face)
 */
export class ListenerAvatar {
    readonly root: Group
    private readonly heading = 0 // rotation about Y in radians
    private yaw = 0
    private readonly keys = new Set<string>()
    private readonly pos = new Vector3()
    private readonly fwd = new Vector3(0, 0, -1)
    private readonly up = new Vector3(0, 1, 0)
    private readonly tmpFwd = new Vector3()
    private readonly tmpUp = new Vector3()
    private readonly quat = new Quaternion()
    private speed = 6.0
    private rotSpeed = 2.2

    constructor(private readonly audio: AudioEngine) {
        this.root = new Group()
        this.root.name = 'ListenerAvatar'

        // Cone marker — apex points forward (camera-facing direction).
        const body = new Mesh(
            new ConeGeometry(0.45, 1.1, 18),
            new MeshStandardMaterial({ color: 0x6ad0ff, emissive: 0x1d4d70, emissiveIntensity: 0.4, roughness: 0.4 }),
        )
        body.rotation.x = Math.PI / 2 // lay cone on its side; apex along -Z
        body.position.y = 0.55
        this.root.add(body)

        this.root.position.copy(this.pos)
    }

    attach(scene: Scene, target: Window = window): () => void {
        scene.add(this.root)
        const down = (ev: KeyboardEvent) => this.keys.add(ev.code)
        const upE = (ev: KeyboardEvent) => this.keys.delete(ev.code)
        target.addEventListener('keydown', down)
        target.addEventListener('keyup', upE)
        return () => {
            target.removeEventListener('keydown', down)
            target.removeEventListener('keyup', upE)
            scene.remove(this.root)
        }
    }

    /** Set position directly (used by the "place at click" tool + UI inputs). */
    setPosition(x: number, y: number, z: number): void {
        this.pos.set(x, y, z)
        this.root.position.copy(this.pos)
    }

    setYaw(radians: number): void {
        this.yaw = radians
        this.applyRotation()
    }

    get position(): Vector3 {
        return this.pos
    }

    get yawDegrees(): number {
        return (this.yaw * 180 / Math.PI + 360) % 360
    }

    update(dt: number): void {
        const k = this.keys
        const move = new Vector3(0, 0, 0)
        // Movement is in *world* axes so the user's spatial expectation
        // ("D should go right, no matter how the camera is angled")
        // matches what they hear.
        if (k.has('KeyW')) move.z -= 1
        if (k.has('KeyS')) move.z += 1
        if (k.has('KeyA')) move.x -= 1
        if (k.has('KeyD')) move.x += 1
        if (k.has('KeyQ')) move.y -= 1
        if (k.has('KeyE')) move.y += 1
        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(this.speed * dt)
            this.pos.add(move)
            this.root.position.copy(this.pos)
        }

        let yawDelta = 0
        if (k.has('ArrowLeft'))  yawDelta += 1
        if (k.has('ArrowRight')) yawDelta -= 1
        if (yawDelta !== 0) {
            this.yaw += yawDelta * this.rotSpeed * dt
            this.applyRotation()
        }

        // Push pose into the engine. Forward is the +Z axis of the
        // root after yaw rotation (cone apex faces -Z by default, but
        // we want world-forward semantics — see below).
        this.tmpFwd.copy(this.fwd).applyQuaternion(this.quat)
        this.tmpUp.copy(this.up).applyQuaternion(this.quat)
        this.audio.listener.setPose(this.pos, this.tmpFwd, this.tmpUp)
    }

    /** Snapshot for the diagnostic strip. */
    pose(): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } {
        this.tmpFwd.copy(this.fwd).applyQuaternion(this.quat)
        return {
            position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
            forward: { x: this.tmpFwd.x, y: this.tmpFwd.y, z: this.tmpFwd.z },
        }
    }

    private applyRotation(): void {
        this.quat.setFromAxisAngle(new Vector3(0, 1, 0), this.yaw)
        this.root.quaternion.copy(this.quat)
        // Heading is stored separately for HUD purposes.
        void this.heading
    }

    /** Bake the local 0,0,0 → world position+rotation onto an
     *  Object3D for callers that need the world transform. */
    object3D(): Object3D {
        return this.root
    }
}
