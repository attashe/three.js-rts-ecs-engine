import { Vector3 } from 'three'
import type { AudioEngine } from '../../audio'
import type { System } from './system'
import { RenderOrder } from './orders'

/**
 * Per-frame sync from ECS entity transforms to attached audio
 * emitters. Picks up every handle that was registered with
 * `audio.attachToEntity(handle, eid, offset?)` and forwards the
 * entity's current world position into the spatial panner.
 *
 * Detached / finished handles fall out of the iteration set
 * automatically — the engine cleans them up on voice-end.
 */
export function createAudioEmitterSystem(audio: AudioEngine): System {
    const worldPos = new Vector3()
    return {
        name: 'audioEmitter',
        // After meshes have their world positions set this frame.
        order: RenderOrder.renderSync + 1,
        update(world) {
            for (const emitter of audio.iterateAttached()) {
                const obj = world.object3DByEid.get(emitter.entityId)
                if (!obj) continue
                obj.getWorldPosition(worldPos)
                emitter.handle.setPosition({
                    x: worldPos.x + emitter.offset.x,
                    y: worldPos.y + emitter.offset.y,
                    z: worldPos.z + emitter.offset.z,
                })
            }
        },
    }
}
