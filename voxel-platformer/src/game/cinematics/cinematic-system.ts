import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { CinematicDirector } from './cinematic-director'

/**
 * Render-step driver that advances the cinematic director once per frame. Runs
 * just after the camera-follow system (which yields while a cinematic is
 * active) so the director's camera writes are authoritative and smooth. Used by
 * both the game and the editor preview.
 */
export function createCinematicSystem(director: CinematicDirector): System {
    return {
        name: 'cinematic',
        order: RenderOrder.cameraFollow + 1,
        update(_world, dt) {
            director.update(dt)
        },
    }
}
