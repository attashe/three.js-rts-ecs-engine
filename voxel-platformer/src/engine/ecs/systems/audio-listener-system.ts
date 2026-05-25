import { Quaternion, Vector3, type Camera } from 'three'
import type { AudioEngine } from '../../audio'
import type { System } from './system'
import { RenderOrder } from './orders'

/**
 * Syncs the FX listener pose to a camera once per render frame.
 *
 * Web Audio's listener is the "ears" of the world — every panner node
 * resolves attenuation + binaural panning relative to it. We update it
 * on the render bucket (not fixed-step) because the camera moves with
 * the renderer and we want audio to track the visible frame, not the
 * simulation frame.
 *
 * The `cameraProvider` is a thunk so the caller can swap cameras
 * (e.g. playtest vs editor) without rebuilding the system.
 */
export function createAudioListenerSystem(audio: AudioEngine, cameraProvider: () => Camera): System {
    const pos = new Vector3()
    const fwd = new Vector3()
    const up = new Vector3(0, 1, 0)
    const localUp = new Vector3(0, 1, 0)
    const quat = new Quaternion()

    return {
        name: 'audioListener',
        // Run after cameraFollow so a player-cam already has its final
        // pose for the frame before the listener reads it.
        order: RenderOrder.cameraFollow + 1,
        update() {
            const camera = cameraProvider()
            camera.getWorldPosition(pos)
            camera.getWorldDirection(fwd)  // already world-space, points along view direction
            camera.getWorldQuaternion(quat)
            up.copy(localUp).applyQuaternion(quat)
            audio.listener.setPose(pos, fwd, up)
        },
    }
}
