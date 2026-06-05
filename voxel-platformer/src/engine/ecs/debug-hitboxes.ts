import { getDebugInfoEnabled } from '../render/render-settings'
import type { DebugHitbox, GameWorld } from './world'

const MAX_DEBUG_HITBOXES = 96

export function debugHitboxesEnabled(): boolean {
    return getDebugInfoEnabled()
}

export function pushDebugHitbox(world: GameWorld, hitbox: DebugHitbox): void {
    if (!debugHitboxesEnabled()) return
    if (hitbox.id) {
        const existing = world.debugHitboxes.findIndex((candidate) => candidate.id === hitbox.id)
        if (existing >= 0) {
            world.debugHitboxes[existing] = hitbox
            return
        }
    }
    world.debugHitboxes.push(hitbox)
    if (world.debugHitboxes.length > MAX_DEBUG_HITBOXES) {
        world.debugHitboxes.splice(0, world.debugHitboxes.length - MAX_DEBUG_HITBOXES)
    }
}

export function clearDebugHitbox(world: GameWorld, id: string): void {
    const index = world.debugHitboxes.findIndex((candidate) => candidate.id === id)
    if (index >= 0) world.debugHitboxes.splice(index, 1)
}
