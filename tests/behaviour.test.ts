import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { Behaviour } from '../src/client/engine/ecs/components'
import {
    BehaviourProfileId,
    BehaviourStateId,
    assignBehaviourProfile,
    behaviourStateName,
    getBehaviourProfile,
    setBehaviourState,
} from '../src/client/engine/ecs/behaviour'
import { FactionId } from '../src/client/engine/ecs/factions'
import { createGameWorld } from '../src/client/engine/ecs/world'

test('behaviour profiles expose stable first-pass NPC archetypes', () => {
    const merchant = getBehaviourProfile(BehaviourProfileId.NeutralMerchant)
    assert.equal(merchant.faction, FactionId.Neutral)
    assert.equal(merchant.initialState, BehaviourStateId.Idle)
    assert.deepEqual(merchant.actions, ['world.interact'])

    const hostile = getBehaviourProfile(BehaviourProfileId.HostileMeleeGrunt)
    assert.equal(hostile.faction, FactionId.Hostile)
    assert.equal(hostile.initialState, BehaviourStateId.Idle)
    assert.equal(hostile.attackRange > 0, true)
})

test('assignBehaviourProfile initializes ECS fields and blackboard together', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Behaviour)

    const blackboard = assignBehaviourProfile(
        world,
        eid,
        BehaviourProfileId.NeutralWanderer,
        { x: 2, y: 3, z: 4 },
    )

    assert.equal(Behaviour.profileId[eid], BehaviourProfileId.NeutralWanderer)
    assert.equal(Behaviour.state[eid], BehaviourStateId.Wander)
    assert.equal(Behaviour.previousState[eid], BehaviourStateId.Wander)
    assert.deepEqual(blackboard.home, { x: 2, y: 3, z: 4 })
    assert.equal(world.behaviourByEid.get(eid), blackboard)
})

test('setBehaviourState keeps previous state and side-table blackboard in sync', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Behaviour)
    assignBehaviourProfile(world, eid, BehaviourProfileId.NeutralWanderer, { x: 0, y: 0, z: 0 })

    setBehaviourState(world, eid, BehaviourStateId.Alert)

    assert.equal(Behaviour.previousState[eid], BehaviourStateId.Wander)
    assert.equal(Behaviour.state[eid], BehaviourStateId.Alert)
    assert.equal(world.behaviourByEid.get(eid)?.previousState, BehaviourStateId.Wander)
    assert.equal(world.behaviourByEid.get(eid)?.state, BehaviourStateId.Alert)
})

test('behaviourStateName names all foundation states', () => {
    assert.equal(behaviourStateName(BehaviourStateId.Dormant), 'dormant')
    assert.equal(behaviourStateName(BehaviourStateId.Attack), 'attack')
    assert.equal(behaviourStateName(BehaviourStateId.ReturnHome), 'return')
    assert.equal(behaviourStateName(999), 'unknown')
})

