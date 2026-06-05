import { query } from 'bitecs'
import type { Object3D } from 'three'
import { PlayerControlled, Stunned } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'

const BLINK_PERIOD_SECONDS = 0.07

export function createPlayerStunBlinkSystem(): System {
    const timers = new Map<number, number>()
    const blinked = new Set<Object3D>()

    return {
        order: RenderOrder.animation + 1,
        update(world, dt) {
            const gw = world as GameWorld
            const active = new Set<number>()
            for (const eid of query(world, [PlayerControlled, Stunned])) {
                const model = gw.object3DByEid.get(eid)?.getObjectByName('PlayerModel')
                if (!model || Stunned.seconds[eid]! <= 0) continue
                const t = (timers.get(eid) ?? 0) + dt
                timers.set(eid, t)
                model.visible = Math.floor(t / BLINK_PERIOD_SECONDS) % 2 === 0
                blinked.add(model)
                active.add(eid)
            }

            for (const [eid] of timers) {
                if (active.has(eid)) continue
                restoreModel(gw.object3DByEid.get(eid)?.getObjectByName('PlayerModel'))
                timers.delete(eid)
            }
        },
        dispose() {
            for (const model of blinked) model.visible = true
            blinked.clear()
            timers.clear()
        },
    }
}

function restoreModel(model: Object3D | undefined): void {
    if (model) model.visible = true
}
