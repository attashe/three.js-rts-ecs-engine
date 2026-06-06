import { query } from 'bitecs'
import { Pickup } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'

const SPIN_CHILD_NAME = 'SpellbookSpin'

export function createSpellbookPickupSpinSystem(): System {
    let time = 0
    return {
        name: 'spellbookPickupSpin',
        order: RenderOrder.animation + 1,
        update(world, dt) {
            time += dt
            const pickups = query(world, [Pickup])
            for (let i = 0; i < pickups.length; i++) {
                const eid = pickups[i]!
                const spin = world.object3DByEid.get(eid)?.getObjectByName(SPIN_CHILD_NAME)
                if (!spin) continue
                spin.rotation.y = time * 1.8
                spin.position.y = 0.58 + Math.sin(time * 3.2 + eid * 0.37) * 0.055
            }
        },
    }
}
