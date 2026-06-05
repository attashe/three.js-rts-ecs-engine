import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameWorld } from '../src/engine/ecs/world'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'
import { normalizeNpcConfig } from '../src/game/npcs/npc-types'
import { createWolfHowlSystem, isWolfHowlNightHour } from '../src/game/npcs/wolf-howl-system'

test('wolf howl night window wraps around midnight', () => {
    assert.equal(isWolfHowlNightHour(19.9), false)
    assert.equal(isWolfHowlNightHour(20), true)
    assert.equal(isWolfHowlNightHour(2.5), true)
    assert.equal(isWolfHowlNightHour(5.49), true)
    assert.equal(isWolfHowlNightHour(5.5), false)
    assert.equal(isWolfHowlNightHour(26), true)
})

test('wolf howl system plays only at night from live wolves and rotates the pack', () => {
    const world = createGameWorld()
    registerRuntimeNpcs(world, [
        wolf('wolf-b', 4, 4),
        wolf('wolf-a', 2, 3),
        normalizeNpcConfig({ id: 'spider', model: 'spider', position: { x: 8, y: 1, z: 8 }, interactionEnabled: false }),
    ])

    let hour = 12
    const calls: Array<{ id: string; x: number; z: number }> = []
    const sys = createWolfHowlSystem({
        getHour: () => hour,
        initialDelaySeconds: 0,
        minCooldownSeconds: 1,
        maxCooldownSeconds: 1,
        random: () => 0,
        onHowl: (p, id) => calls.push({ id, x: p.x, z: p.z }),
    })

    sys.update(world, 10)
    assert.equal(calls.length, 0, 'daytime wolves should stay silent')

    hour = 23
    sys.update(world, 0.1) // enters night and arms the initial delay
    sys.update(world, 0)
    assert.deepEqual(calls.at(-1), { id: 'wolf-a', x: 2, z: 3 })

    sys.update(world, 1)
    assert.deepEqual(calls.at(-1), { id: 'wolf-b', x: 4, z: 4 })

    world.npcRuntimeById.get('wolf-a')!.dying = true
    sys.update(world, 1)
    assert.deepEqual(calls.at(-1), { id: 'wolf-b', x: 4, z: 4 }, 'dying wolves should not howl')
})

function wolf(id: string, x: number, z: number) {
    return normalizeNpcConfig({
        id,
        model: 'wolf',
        position: { x, y: 1, z },
        interactionEnabled: false,
    })
}
