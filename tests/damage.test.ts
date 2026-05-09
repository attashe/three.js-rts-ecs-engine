import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { Attackable, Faction, Health } from '../src/client/engine/ecs/components'
import { applyDamagePacket } from '../src/client/engine/ecs/damage'
import { FactionId } from '../src/client/engine/ecs/factions'
import { createGameWorld } from '../src/client/engine/ecs/world'

test('applyDamagePacket reduces health and removes Attackable on death', () => {
    const world = createGameWorld()
    const source = addEntity(world)
    addComponent(world, source, Faction)
    Faction.id[source] = FactionId.Player

    const target = addEntity(world)
    addComponent(world, target, Health)
    addComponent(world, target, Faction)
    addComponent(world, target, Attackable)
    Health.current[target] = 20
    Health.max[target] = 20
    Faction.id[target] = FactionId.Hostile
    world.interactionByEid.set(target, { label: 'Training Dummy', message: '' })

    const result = applyDamagePacket(world, {
        source,
        target,
        amount: 25,
        targetPolicy: 'enemy',
    })

    assert.equal(result.applied, true)
    assert.equal(result.killed, true)
    assert.equal(result.targetLabel, 'Training Dummy')
    assert.equal(Health.current[target], 0)
    assert.equal(hasComponent(world, target, Attackable), false)
})

test('applyDamagePacket rejects enemy-only damage against friends', () => {
    const world = createGameWorld()
    const source = addEntity(world)
    addComponent(world, source, Faction)
    Faction.id[source] = FactionId.Player

    const target = addEntity(world)
    addComponent(world, target, Health)
    addComponent(world, target, Faction)
    Health.current[target] = 30
    Health.max[target] = 30
    Faction.id[target] = FactionId.Player

    const result = applyDamagePacket(world, {
        source,
        target,
        amount: 10,
        targetPolicy: 'enemy',
    })

    assert.equal(result.applied, false)
    assert.equal(result.reason, 'friendly-fire')
    assert.equal(Health.current[target], 30)
})

test('applyDamagePacket allows neutral impact damage with any target policy', () => {
    const world = createGameWorld()
    const target = addEntity(world)
    addComponent(world, target, Health)
    Health.current[target] = 30
    Health.max[target] = 30

    const result = applyDamagePacket(world, {
        target,
        amount: 12.5,
        type: 'impact',
    })

    assert.equal(result.applied, true)
    assert.equal(result.killed, false)
    assert.equal(result.currentHealth, 17.5)
    assert.equal(Health.current[target], 17.5)
})

