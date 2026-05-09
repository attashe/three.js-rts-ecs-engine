import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { Attackable, Behaviour, Faction, Health, Position } from '../src/client/engine/ecs/components'
import { applyDamagePacket } from '../src/client/engine/ecs/damage'
import { areEntitiesEnemies, FactionId } from '../src/client/engine/ecs/factions'
import { createGameWorld } from '../src/client/engine/ecs/world'
import {
    BehaviourProfileId,
    BehaviourStateId,
    assignBehaviourProfile,
    getBehaviourTarget,
} from '../src/client/engine/ecs/behaviour'

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

test('applyDamagePacket makes damaged neutral actors personally hostile to the player', () => {
    const world = createGameWorld()
    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, Faction)
    Position.x[player] = 0
    Position.y[player] = 1
    Position.z[player] = 0
    Faction.id[player] = FactionId.Player

    const villager = addEntity(world)
    addComponent(world, villager, Position)
    addComponent(world, villager, Health)
    addComponent(world, villager, Faction)
    addComponent(world, villager, Behaviour)
    Position.x[villager] = 1
    Position.y[villager] = 1
    Position.z[villager] = 0
    Health.current[villager] = 30
    Health.max[villager] = 30
    Faction.id[villager] = FactionId.Neutral
    assignBehaviourProfile(world, villager, BehaviourProfileId.Villager, { x: 1, y: 1, z: 0 })

    const result = applyDamagePacket(world, {
        source: player,
        target: villager,
        amount: 5,
        type: 'physical',
    })

    assert.equal(result.applied, true)
    assert.equal(areEntitiesEnemies(world, villager, player), true)
    assert.equal(areEntitiesEnemies(world, player, villager), false)
})

test('applyDamagePacket alerts nearby village defenders when a villager is attacked', () => {
    const world = createGameWorld()
    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, Faction)
    Position.x[player] = 0
    Position.y[player] = 1
    Position.z[player] = 0
    Faction.id[player] = FactionId.Player

    const villager = addEntity(world)
    addComponent(world, villager, Position)
    addComponent(world, villager, Health)
    addComponent(world, villager, Faction)
    Position.x[villager] = 1
    Position.y[villager] = 1
    Position.z[villager] = 0
    Health.current[villager] = 30
    Health.max[villager] = 30
    Faction.id[villager] = FactionId.Neutral

    const guard = addDefender(world, BehaviourProfileId.Guard, FactionId.Neutral, 4, 1, 0)
    const hunter = addDefender(world, BehaviourProfileId.Hunter, FactionId.Hunter, 6, 1, 0)
    const farGuard = addDefender(world, BehaviourProfileId.Guard, FactionId.Neutral, 40, 1, 0)

    const result = applyDamagePacket(world, {
        source: player,
        target: villager,
        amount: 5,
        type: 'physical',
    })

    assert.equal(result.applied, true)
    assert.equal(areEntitiesEnemies(world, guard, player), true)
    assert.equal(areEntitiesEnemies(world, hunter, player), true)
    assert.equal(areEntitiesEnemies(world, farGuard, player), false)
    assert.equal(Behaviour.state[guard], BehaviourStateId.Chase)
    assert.equal(Behaviour.state[hunter], BehaviourStateId.Chase)
    assert.equal(getBehaviourTarget(guard), player)
    assert.equal(getBehaviourTarget(hunter), player)
})

function addDefender(
    world: ReturnType<typeof createGameWorld>,
    profile: BehaviourProfileId,
    faction: FactionId,
    x: number,
    y: number,
    z: number,
): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, Health)
    addComponent(world, eid, Faction)
    addComponent(world, eid, Behaviour)
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    Health.current[eid] = 80
    Health.max[eid] = 80
    Faction.id[eid] = faction
    assignBehaviourProfile(world, eid, profile, { x, y, z })
    return eid
}
