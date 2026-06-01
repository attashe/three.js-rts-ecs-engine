import { hasComponent } from 'bitecs'
import { Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { GameWorld } from '../engine/ecs/world'

/**
 * Keeps arrows embedded in NPC bodies riding along as the NPC moves. The
 * arrow-hit system freezes a struck arrow into a static visual and records its
 * offset from the NPC's foot origin on `npc.stuckArrows`. Frozen arrows carry
 * `StaticRenderable`, so render-sync no longer touches them — this system moves
 * their Object3D (and Position, so pickup still works) to track the body.
 *
 * Runs in the render phase just after npc-render has placed the bodies, so the
 * arrows land on the same position the NPC is drawn at this frame. When an
 * arrow is collected (despawned) or its NPC dies (runtime removed) the entry is
 * pruned; an arrow on a dead/gone NPC simply freezes where it last sat.
 */
export function createStuckArrowSystem(): System {
    return {
        name: 'stuckArrows',
        order: RenderOrder.worldRender + 5,
        update(world) {
            const gw = world as GameWorld
            for (const npc of gw.npcRuntimeById.values()) {
                const stuck = npc.stuckArrows
                if (!stuck || stuck.length === 0) continue
                for (let i = stuck.length - 1; i >= 0; i--) {
                    const { eid, ox, oy, oz } = stuck[i]!
                    const obj = gw.object3DByEid.get(eid)
                    if (!obj || !hasComponent(world, eid, Position)) {
                        // Collected or otherwise gone — stop tracking it.
                        stuck.splice(i, 1)
                        continue
                    }
                    const x = npc.position.x + ox
                    const y = npc.position.y + oy
                    const z = npc.position.z + oz
                    Position.x[eid] = x
                    Position.y[eid] = y
                    Position.z[eid] = z
                    obj.position.set(x, y, z)
                }
            }
        },
    }
}
