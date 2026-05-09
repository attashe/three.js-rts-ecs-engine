import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { Behaviour, Faction, Health, Position } from '../src/client/engine/ecs/components'
import {
    BEHAVIOUR_PROFILES,
    BehaviourProfileId,
    BehaviourStateId,
    assignBehaviourProfile,
    behaviourStateName,
    decideTransition,
    findNearestEnemy,
    getBehaviourProfile,
    getBehaviourTarget,
    setBehaviourState,
    setBehaviourTarget,
    type BehaviourSnapshot,
} from '../src/client/engine/ecs/behaviour'
import { FactionId } from '../src/client/engine/ecs/factions'
import { createGameWorld } from '../src/client/engine/ecs/world'

const HOSTILE = getBehaviourProfile(BehaviourProfileId.HostileMeleeGrunt)!
const WANDERER = getBehaviourProfile(BehaviourProfileId.NeutralWanderer)!
const MERCHANT = getBehaviourProfile(BehaviourProfileId.NeutralMerchant)!

function makeSnapshot(overrides: Partial<BehaviourSnapshot> = {}): BehaviourSnapshot {
    return {
        state: BehaviourStateId.Idle,
        health: 50,
        targetEid: null,
        targetVisible: false,
        distanceToTarget: 0,
        distanceToHome: 0,
        ...overrides,
    }
}

test('behaviour profiles cover the demo archetypes with consistent invariants', () => {
    for (const profile of BEHAVIOUR_PROFILES.values()) {
        if (profile.attackRange > 0) {
            assert.ok(profile.attackCooldown > 0, `${profile.key}: combatant must have attackCooldown`)
            assert.ok(profile.attackDamage > 0, `${profile.key}: combatant must have attackDamage`)
            assert.ok(profile.sightRadius > 0, `${profile.key}: combatant must see something`)
            assert.ok(profile.leashRadius >= profile.attackRange,
                `${profile.key}: leashRadius must include attack reach`)
        } else {
            assert.equal(profile.attackCooldown, 0, `${profile.key}: non-combatant should have no attackCooldown`)
            assert.equal(profile.attackDamage, 0, `${profile.key}: non-combatant should have no attackDamage`)
        }
    }
    assert.equal(HOSTILE.faction, FactionId.Hostile)
    assert.equal(WANDERER.faction, FactionId.Neutral)
    assert.equal(MERCHANT.faction, FactionId.Neutral)
})

test('decideTransition: dead overrides everything', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Chase,
        health: 0,
        targetVisible: true,
        targetEid: 7,
        distanceToTarget: 1.0,
        distanceToHome: 2,
    }))
    assert.equal(next, BehaviourStateId.Dead)
})

test('decideTransition: visible target inside leash and in attack range → Attack', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Chase,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange - 0.1,
        distanceToHome: HOSTILE.leashRadius - 1,
    }))
    assert.equal(next, BehaviourStateId.Attack)
})

test('decideTransition: visible target inside leash but out of reach → Chase', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Idle,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange + 1.0,
        distanceToHome: 1,
    }))
    assert.equal(next, BehaviourStateId.Chase)
})

test('decideTransition: visible target past leash → ReturnHome (gives up the chase)', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Chase,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: 2,
        distanceToHome: HOSTILE.leashRadius + 0.5,
    }))
    assert.equal(next, BehaviourStateId.ReturnHome)
})

test('decideTransition: combatant loses sight while chasing → ReturnHome', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Chase,
        targetVisible: false,
        distanceToHome: 4,
    }))
    assert.equal(next, BehaviourStateId.ReturnHome)
})

test('decideTransition: ReturnHome reaches home → Idle for non-wanderer combatants', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.ReturnHome,
        distanceToHome: 0.3,
    }))
    assert.equal(next, BehaviourStateId.Idle)
})

test('decideTransition: idle wanderer enters Wander on its own', () => {
    const next = decideTransition(WANDERER, makeSnapshot({ state: BehaviourStateId.Idle }))
    assert.equal(next, BehaviourStateId.Wander)
})

test('decideTransition: merchant in Idle stays Idle (no wander, no combat)', () => {
    const next = decideTransition(MERCHANT, makeSnapshot({ state: BehaviourStateId.Idle }))
    assert.equal(next, null)
})

test('decideTransition: dead actor stays dead', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({ state: BehaviourStateId.Dead, health: 0 }))
    assert.equal(next, null)
})

test('setBehaviourTarget round-trips through the +1 sentinel and clears', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Behaviour)
    assignBehaviourProfile(world, eid, BehaviourProfileId.HostileMeleeGrunt, { x: 0, y: 0, z: 0 })

    setBehaviourTarget(world, eid, 0)
    assert.equal(getBehaviourTarget(eid), 0, 'eid 0 must be a valid target — sentinel uses +1')
    assert.equal(world.behaviourByEid.get(eid)?.targetEid, 0)

    setBehaviourTarget(world, eid, 12)
    assert.equal(getBehaviourTarget(eid), 12)

    setBehaviourTarget(world, eid, null)
    assert.equal(getBehaviourTarget(eid), null)
    assert.equal(world.behaviourByEid.get(eid)?.targetEid, null)
})

test('assignBehaviourProfile + setBehaviourState keep ECS arrays and blackboard in sync', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Behaviour)
    assignBehaviourProfile(world, eid, BehaviourProfileId.NeutralWanderer, { x: 2, y: 3, z: 4 })

    assert.equal(Behaviour.profileId[eid], BehaviourProfileId.NeutralWanderer)
    assert.equal(Behaviour.state[eid], BehaviourStateId.Wander)
    assert.deepEqual(world.behaviourByEid.get(eid)?.home, { x: 2, y: 3, z: 4 })

    setBehaviourState(world, eid, BehaviourStateId.Chase)
    assert.equal(Behaviour.state[eid], BehaviourStateId.Chase)
    assert.equal(Behaviour.previousState[eid], BehaviourStateId.Wander)
    assert.equal(world.behaviourByEid.get(eid)?.state, BehaviourStateId.Chase)
    assert.equal(world.behaviourByEid.get(eid)?.previousState, BehaviourStateId.Wander)
})

test('findNearestEnemy: faction-filtered radius scan picks the closest enemy', () => {
    const world = createGameWorld()
    const seeker = addEntity(world)
    addComponent(world, seeker, Position); addComponent(world, seeker, Faction); addComponent(world, seeker, Health)
    Position.x[seeker] = 0; Position.y[seeker] = 0; Position.z[seeker] = 0
    Faction.id[seeker] = FactionId.Hostile
    Health.max[seeker] = 50; Health.current[seeker] = 50

    const friendly = addEntity(world)
    addComponent(world, friendly, Position); addComponent(world, friendly, Faction); addComponent(world, friendly, Health)
    Position.x[friendly] = 1; Position.y[friendly] = 0; Position.z[friendly] = 0
    Faction.id[friendly] = FactionId.Hostile
    Health.max[friendly] = 50; Health.current[friendly] = 50

    const farPlayer = addEntity(world)
    addComponent(world, farPlayer, Position); addComponent(world, farPlayer, Faction); addComponent(world, farPlayer, Health)
    Position.x[farPlayer] = 20; Position.y[farPlayer] = 0; Position.z[farPlayer] = 0
    Faction.id[farPlayer] = FactionId.Player
    Health.max[farPlayer] = 100; Health.current[farPlayer] = 100

    const closePlayer = addEntity(world)
    addComponent(world, closePlayer, Position); addComponent(world, closePlayer, Faction); addComponent(world, closePlayer, Health)
    Position.x[closePlayer] = 5; Position.y[closePlayer] = 0; Position.z[closePlayer] = 0
    Faction.id[closePlayer] = FactionId.Player
    Health.max[closePlayer] = 100; Health.current[closePlayer] = 100

    // Sight covers both players: should pick closer one, ignore friendly hostile.
    assert.equal(findNearestEnemy(world, seeker, 25), closePlayer)
    // Sight excludes the close player: still no false positive on the hostile ally.
    assert.equal(findNearestEnemy(world, seeker, 4), null)
    // Dead enemy is filtered out; should fall through to the far player.
    Health.current[closePlayer] = 0
    assert.equal(findNearestEnemy(world, seeker, 25), farPlayer)
})

test('behaviourStateName names every supported state and returns "unknown" for unknowns', () => {
    assert.equal(behaviourStateName(BehaviourStateId.Idle), 'idle')
    assert.equal(behaviourStateName(BehaviourStateId.Wander), 'wander')
    assert.equal(behaviourStateName(BehaviourStateId.Chase), 'chase')
    assert.equal(behaviourStateName(BehaviourStateId.Attack), 'attack')
    assert.equal(behaviourStateName(BehaviourStateId.ReturnHome), 'return')
    assert.equal(behaviourStateName(BehaviourStateId.Dead), 'dead')
    assert.equal(behaviourStateName(99), 'unknown')
})
