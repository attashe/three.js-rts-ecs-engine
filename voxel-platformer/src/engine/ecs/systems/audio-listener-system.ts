import { hasComponent, query } from 'bitecs'
import { Quaternion, Vector3, type Camera } from 'three'
import type { AudioEngine } from '../../audio'
import { BoxCollider, PlayerControlled, Position } from '../components'
import type { GameWorld } from '../world'
import type { System } from './system'
import { RenderOrder } from './orders'

export interface AudioListenerSystemOptions {
    /** Optional world-space listener-position override. Return true
     *  when `out` was populated; false falls back to the camera. */
    resolvePosition?: (world: GameWorld, camera: Camera, out: Vector3) => boolean
}

/**
 * Syncs the FX listener pose once per render frame.
 *
 * Web Audio's listener is the "ears" of the world — every panner node
 * resolves attenuation + binaural panning relative to it. We update it
 * on the render bucket (not fixed-step) because the camera moves with
 * the renderer and we want audio to track the visible frame, not the
 * simulation frame.
 *
 * The `cameraProvider` is still used for listener orientation so
 * left/right matches the visible isometric view. Callers can override
 * the listener position — playtest uses the player as the listening
 * point because the character is who hears the world, not the camera.
 */
export function createAudioListenerSystem(
    audio: AudioEngine,
    cameraProvider: () => Camera,
    opts: AudioListenerSystemOptions = {},
): System {
    const pos = new Vector3()
    const cameraPos = new Vector3()
    const fwd = new Vector3()
    const up = new Vector3(0, 1, 0)
    const localUp = new Vector3(0, 1, 0)
    const quat = new Quaternion()

    return {
        name: 'audioListener',
        // Run after cameraFollow so a player-cam already has its final
        // pose for the frame before the listener reads it.
        order: RenderOrder.cameraFollow + 1,
        update(world) {
            const camera = cameraProvider()
            camera.getWorldPosition(cameraPos)
            if (!opts.resolvePosition?.(world, camera, pos)) {
                pos.copy(cameraPos)
            }
            camera.getWorldDirection(fwd)  // already world-space, points along view direction
            camera.getWorldQuaternion(quat)
            up.copy(localUp).applyQuaternion(quat)
            audio.listener.setPose(pos, fwd, up)
        },
    }
}

export function createPlayerAudioListenerSystem(
    audio: AudioEngine,
    cameraProvider: () => Camera,
    opts: { fallbackHeight?: number } = {},
): System {
    const fallbackHeight = opts.fallbackHeight ?? 1.25
    return createAudioListenerSystem(audio, cameraProvider, {
        resolvePosition(world, _camera, out) {
            const players = query(world, [Position, PlayerControlled])
            const eid = players[0]
            if (eid === undefined) return false
            const height = hasComponent(world, eid, BoxCollider)
                ? Math.max(0.6, BoxCollider.y[eid]! * 1.55)
                : fallbackHeight
            out.set(Position.x[eid]!, Position.y[eid]! + height, Position.z[eid]!)
            return true
        },
    })
}
