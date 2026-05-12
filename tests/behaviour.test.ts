import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent, query } from 'bitecs'
import { Attackable, Behaviour, BoxCollider, Faction, Health, Interactable, MoveAlongPath, MovingObject, Position, Rotation, Velocity, Wanderer } from '../src/client/engine/ecs/components'
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
import { createBehaviourSystem } from '../src/client/engine/ecs/systems/behaviour-system'
import { createArrowHitSystem } from '../src/client/engine/ecs/systems/arrow-hit-system'
import { createPhysicsSystem } from '../src/client/engine/ecs/systems/physics-system'
import { ChunkManager } from '../src/client/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/client/engine/voxel/palette'
import { applyDamagePacket } from '../src/client/engine/ecs/damage'
import { assignAiSchedule, defineAiSchedule, defineAiZone } from '../src/client/engine/ecs/ai'

const HOSTILE = getBehaviourProfile(BehaviourProfileId.HostileMeleeGrunt)!
const WANDERER = getBehaviourProfile(BehaviourProfileId.NeutralWanderer)!
const MERCHANT = getBehaviourProfile(BehaviourProfileId.NeutralMerchant)!
const HUNTER = getBehaviourProfile(BehaviourProfileId.Hunter)!
const RABBIT = getBehaviourProfile(BehaviourProfileId.Rabbit)!
const ARCHER = getBehaviourProfile(BehaviourProfileId.HostileArcher)!

function makeSnapshot(overrides: Partial<BehaviourSnapshot> = {}): BehaviourSnapshot {
    return {
        state: BehaviourStateId.Idle,
        health: 50,
        targetEid: null,
        targetVisible: false,
        distanceToTarget: 0,
        distanceToHome: 0,
        distanceToActivity: 0,
        hasActivity: false,
        stateTime: 0,
        actionReady: true,
        movementBlocked: false,
        hasPath: false,
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
    assert.equal(HUNTER.faction, FactionId.Hunter)
    assert.equal(RABBIT.faction, FactionId.Wildlife)
    assert.equal(ARCHER.faction, FactionId.Hostile)
    assert.equal(ARCHER.attackKind, 'bow')
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

test('decideTransition: blocked combatant with target repositions before continuing chase', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Chase,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange + 1.0,
        distanceToHome: 1,
        movementBlocked: true,
    }))
    assert.equal(next, BehaviourStateId.Reposition)
})

test('decideTransition: recovering actor waits for cooldown, then resumes combat', () => {
    const waiting = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Recover,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange - 0.1,
        distanceToHome: 1,
        actionReady: false,
    }))
    assert.equal(waiting, null)

    const ready = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.Recover,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange - 0.1,
        distanceToHome: 1,
        actionReady: true,
    }))
    assert.equal(ready, BehaviourStateId.Attack)
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

test('decideTransition: ReturnHome ignores visible targets until home is reached', () => {
    const next = decideTransition(HOSTILE, makeSnapshot({
        state: BehaviourStateId.ReturnHome,
        targetVisible: true,
        targetEid: 9,
        distanceToTarget: HOSTILE.attackRange + 1,
        distanceToHome: 2,
    }))
    assert.equal(next, null)
})

test('decideTransition: hunter reaches activity point and starts hunting locally', () => {
    const next = decideTransition(HUNTER, makeSnapshot({
        state: BehaviourStateId.TravelToActivity,
        hasActivity: true,
        distanceToActivity: HUNTER.activityRadius - 0.1,
    }))
    assert.equal(next, BehaviourStateId.Wander)
})

test('decideTransition: hunter returns home to idle after an activity', () => {
    const next = decideTransition(HUNTER, makeSnapshot({
        state: BehaviourStateId.ReturnHome,
        hasActivity: true,
        distanceToHome: 0.2,
    }))
    assert.equal(next, BehaviourStateId.Idle)
})

test('decideTransition: rabbit flees from visible enemy and resumes wandering after escape', () => {
    const flee = decideTransition(RABBIT, makeSnapshot({
        state: BehaviourStateId.Wander,
        targetVisible: true,
        targetEid: 4,
        distanceToTarget: 3,
    }))
    assert.equal(flee, BehaviourStateId.Flee)

    const recover = decideTransition(RABBIT, makeSnapshot({
        state: BehaviourStateId.Flee,
        targetVisible: false,
    }))
    assert.equal(recover, BehaviourStateId.Wander)
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

test('findNearestEnemy: hunter and wildlife are mutually hostile without making wildlife hostile to player', () => {
    const world = createGameWorld()
    const hunter = addEntity(world)
    addComponent(world, hunter, Position); addComponent(world, hunter, Faction); addComponent(world, hunter, Health)
    Position.x[hunter] = 0; Position.y[hunter] = 0; Position.z[hunter] = 0
    Faction.id[hunter] = FactionId.Hunter
    Health.max[hunter] = 70; Health.current[hunter] = 70

    const rabbit = addEntity(world)
    addComponent(world, rabbit, Position); addComponent(world, rabbit, Faction); addComponent(world, rabbit, Health)
    Position.x[rabbit] = 3; Position.y[rabbit] = 0; Position.z[rabbit] = 0
    Faction.id[rabbit] = FactionId.Wildlife
    Health.max[rabbit] = 12; Health.current[rabbit] = 12

    const player = addEntity(world)
    addComponent(world, player, Position); addComponent(world, player, Faction); addComponent(world, player, Health)
    Position.x[player] = 1; Position.y[player] = 0; Position.z[player] = 0
    Faction.id[player] = FactionId.Player
    Health.max[player] = 100; Health.current[player] = 100

    assert.equal(findNearestEnemy(world, hunter, 10), rabbit)
    assert.equal(findNearestEnemy(world, rabbit, 10), hunter)
    assert.equal(findNearestEnemy(world, player, 10), null)
})

test('findNearestEnemy: skirmish factions fight each other while ignoring neutral player', () => {
    const world = createGameWorld()
    const red = addEntity(world)
    addComponent(world, red, Position); addComponent(world, red, Faction); addComponent(world, red, Health)
    Position.x[red] = 0; Position.y[red] = 0; Position.z[red] = 0
    Faction.id[red] = FactionId.SkirmishRed
    Health.max[red] = 50; Health.current[red] = 50

    const player = addEntity(world)
    addComponent(world, player, Position); addComponent(world, player, Faction); addComponent(world, player, Health)
    Position.x[player] = 2; Position.y[player] = 0; Position.z[player] = 0
    Faction.id[player] = FactionId.Player
    Health.max[player] = 100; Health.current[player] = 100

    const blue = addEntity(world)
    addComponent(world, blue, Position); addComponent(world, blue, Faction); addComponent(world, blue, Health)
    Position.x[blue] = 5; Position.y[blue] = 0; Position.z[blue] = 0
    Faction.id[blue] = FactionId.SkirmishBlue
    Health.max[blue] = 50; Health.current[blue] = 50

    assert.equal(findNearestEnemy(world, red, 8), blue)
    assert.equal(findNearestEnemy(world, blue, 8), red)
    assert.equal(findNearestEnemy(world, player, 8), null)
})

test('BehaviourSystem: hunter returns home immediately after killing a rabbit', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const hunter = addEntity(world)
    addComponent(world, hunter, Position); addComponent(world, hunter, Faction); addComponent(world, hunter, Health); addComponent(world, hunter, Behaviour)
    Position.x[hunter] = 0; Position.y[hunter] = 0; Position.z[hunter] = 0
    Faction.id[hunter] = FactionId.Hunter
    Health.max[hunter] = 70; Health.current[hunter] = 70
    assignBehaviourProfile(world, hunter, BehaviourProfileId.Hunter, { x: -5, y: 0, z: 0 }, {
        activity: { x: 0, y: 0, z: 0 },
    })
    setBehaviourState(world, hunter, BehaviourStateId.Attack)

    const rabbit = addEntity(world)
    addComponent(world, rabbit, Position); addComponent(world, rabbit, Faction); addComponent(world, rabbit, Health); addComponent(world, rabbit, Attackable)
    Position.x[rabbit] = 0.8; Position.y[rabbit] = 0; Position.z[rabbit] = 0
    Faction.id[rabbit] = FactionId.Wildlife
    Health.max[rabbit] = 12; Health.current[rabbit] = 12
    world.interactionByEid.set(rabbit, { label: 'Test Rabbit', message: '' })
    setBehaviourTarget(world, hunter, rabbit)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Health.current[rabbit], 0)
    assert.equal(Behaviour.state[hunter], BehaviourStateId.ReturnHome)
    assert.equal(getBehaviourTarget(hunter), null)
})

test('BehaviourSystem: attack enters Recover after a non-lethal strike', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const hunter = addEntity(world)
    addComponent(world, hunter, Position); addComponent(world, hunter, Faction); addComponent(world, hunter, Health); addComponent(world, hunter, Behaviour)
    Position.x[hunter] = 0; Position.y[hunter] = 0; Position.z[hunter] = 0
    Faction.id[hunter] = FactionId.Hunter
    Health.max[hunter] = 70; Health.current[hunter] = 70
    assignBehaviourProfile(world, hunter, BehaviourProfileId.Hunter, { x: 0, y: 0, z: 0 }, {
        activity: { x: 0, y: 0, z: 0 },
    })
    setBehaviourState(world, hunter, BehaviourStateId.Attack)

    const rabbit = addEntity(world)
    addComponent(world, rabbit, Position); addComponent(world, rabbit, Faction); addComponent(world, rabbit, Health); addComponent(world, rabbit, Attackable)
    Position.x[rabbit] = 0.8; Position.y[rabbit] = 0; Position.z[rabbit] = 0
    Faction.id[rabbit] = FactionId.Wildlife
    Health.max[rabbit] = 24; Health.current[rabbit] = 24
    world.interactionByEid.set(rabbit, { label: 'Durable Rabbit', message: '' })
    setBehaviourTarget(world, hunter, rabbit)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Health.current[rabbit], 12)
    assert.equal(Behaviour.state[hunter], BehaviourStateId.Recover)
    assert.ok(Behaviour.nextThinkAt[hunter] > 0)
})

test('BehaviourSystem: archer attack launches an owned arrow and enters Recover', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Position); addComponent(world, archer, Rotation)
    addComponent(world, archer, Faction); addComponent(world, archer, Health); addComponent(world, archer, Behaviour)
    Position.x[archer] = 0; Position.y[archer] = 1; Position.z[archer] = 0
    Faction.id[archer] = FactionId.Hostile
    Health.max[archer] = 42; Health.current[archer] = 42
    assignBehaviourProfile(world, archer, BehaviourProfileId.HostileArcher, { x: 0, y: 1, z: 0 })
    setBehaviourState(world, archer, BehaviourStateId.Attack)

    const player = addEntity(world)
    addComponent(world, player, Position); addComponent(world, player, BoxCollider); addComponent(world, player, Velocity)
    addComponent(world, player, Faction); addComponent(world, player, Health)
    Position.x[player] = 0; Position.y[player] = 1; Position.z[player] = 5
    BoxCollider.x[player] = 0.35; BoxCollider.y[player] = 0.9; BoxCollider.z[player] = 0.35
    Velocity.x[player] = 1.5; Velocity.y[player] = 0; Velocity.z[player] = 0
    Faction.id[player] = FactionId.Player
    Health.max[player] = 100; Health.current[player] = 100
    setBehaviourTarget(world, archer, player)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    const arrows = query(world, [MovingObject, Position, Velocity])
    assert.equal(arrows.length, 1)
    assert.equal(world.projectileOwnerByEid.get(arrows[0]!), archer)
    assert.ok(Velocity.x[arrows[0]!] > 0.1, 'archer should lead a moving target')
    assert.ok(Velocity.y[arrows[0]!] > 4, 'archer should launch with enough lift for the physics arc')
    assert.equal(Behaviour.state[archer], BehaviourStateId.Recover)
    assert.ok(Behaviour.nextThinkAt[archer] > 0)
})

test('BehaviourSystem: archer shot can land on another archer at duel range', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Position); addComponent(world, archer, Rotation)
    addComponent(world, archer, Faction); addComponent(world, archer, Health); addComponent(world, archer, Behaviour)
    Position.x[archer] = 0; Position.y[archer] = 1; Position.z[archer] = 0
    Faction.id[archer] = FactionId.SkirmishRed
    Health.max[archer] = 42; Health.current[archer] = 42
    assignBehaviourProfile(world, archer, BehaviourProfileId.HostileArcher, { x: 0, y: 1, z: 0 })
    setBehaviourState(world, archer, BehaviourStateId.Attack)

    const target = addEntity(world)
    addComponent(world, target, Position); addComponent(world, target, BoxCollider)
    addComponent(world, target, Faction); addComponent(world, target, Health)
    Position.x[target] = 0; Position.y[target] = 1; Position.z[target] = 8
    BoxCollider.x[target] = 0.35; BoxCollider.y[target] = 0.9; BoxCollider.z[target] = 0.35
    Faction.id[target] = FactionId.SkirmishBlue
    Health.max[target] = 100; Health.current[target] = 100
    setBehaviourTarget(world, archer, target)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    const hitSystem = createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 })
    const physicsSystem = createPhysicsSystem(chunks)
    for (let i = 0; i < 90 && Health.current[target] === 100; i++) {
        hitSystem.update(world, 1 / 60)
        physicsSystem.update(world, 1 / 60)
    }

    assert.equal(Health.current[target], 90)
})

test('BehaviourSystem: damaged villager flees from a neutral attacker via threat memory', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const attacker = addEntity(world)
    addComponent(world, attacker, Position); addComponent(world, attacker, Faction); addComponent(world, attacker, Health)
    Position.x[attacker] = 0; Position.y[attacker] = 1; Position.z[attacker] = 0
    Faction.id[attacker] = FactionId.Player
    Health.max[attacker] = 100; Health.current[attacker] = 100

    const villager = addEntity(world)
    addComponent(world, villager, Position); addComponent(world, villager, Faction); addComponent(world, villager, Health); addComponent(world, villager, Behaviour)
    Position.x[villager] = 1; Position.y[villager] = 1; Position.z[villager] = 0
    Faction.id[villager] = FactionId.Neutral
    Health.max[villager] = 45; Health.current[villager] = 45
    assignBehaviourProfile(world, villager, BehaviourProfileId.Villager, { x: 1, y: 1, z: 0 })

    const result = applyDamagePacket(world, {
        source: attacker,
        target: villager,
        amount: 5,
        type: 'physical',
    })
    assert.equal(result.applied, true)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[villager], BehaviourStateId.Flee)
    assert.equal(world.behaviourByEid.get(villager)?.threatEid, attacker)
})

test('BehaviourSystem: death leaves a corpse visual and removes actor blocking tags', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const actor = addEntity(world)
    addComponent(world, actor, Position); addComponent(world, actor, Rotation); addComponent(world, actor, Velocity)
    addComponent(world, actor, Faction); addComponent(world, actor, Health); addComponent(world, actor, Behaviour)
    addComponent(world, actor, Attackable); addComponent(world, actor, Wanderer); addComponent(world, actor, Interactable)
    Position.x[actor] = 0; Position.y[actor] = 1; Position.z[actor] = 0
    Faction.id[actor] = FactionId.Hostile
    Health.max[actor] = 10; Health.current[actor] = 0
    Velocity.x[actor] = 1; Velocity.y[actor] = -1; Velocity.z[actor] = 1
    assignBehaviourProfile(world, actor, BehaviourProfileId.HostileMeleeGrunt, { x: 0, y: 1, z: 0 })

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[actor], BehaviourStateId.Dead)
    assert.equal(hasComponent(world, actor, Attackable), false)
    assert.equal(hasComponent(world, actor, Wanderer), false)
    assert.equal(hasComponent(world, actor, Interactable), false)
    assert.ok(Math.abs(Rotation.x[actor] - Math.PI * 0.5) < 1e-5)
    assert.equal(Velocity.x[actor], 0)
    assert.equal(Velocity.y[actor], 0)
    assert.equal(Velocity.z[actor], 0)
})

test('BehaviourSystem: travel paths route around dynamic actor blockers', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x <= 6; x++) {
        for (let z = 0; z <= 4; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.plank)
        }
    }

    const hunter = addEntity(world)
    addComponent(world, hunter, Position); addComponent(world, hunter, Behaviour)
    Position.x[hunter] = 0.5; Position.y[hunter] = 1; Position.z[hunter] = 2.5
    assignBehaviourProfile(world, hunter, BehaviourProfileId.Hunter, { x: 0.5, y: 1, z: 2.5 }, {
        activity: { x: 6.5, y: 1, z: 2.5 },
    })

    const blocker = addEntity(world)
    addComponent(world, blocker, Position); addComponent(world, blocker, BoxCollider); addComponent(world, blocker, Wanderer)
    Position.x[blocker] = 3.5; Position.y[blocker] = 1; Position.z[blocker] = 2.5
    BoxCollider.x[blocker] = 0.34; BoxCollider.y[blocker] = 0.9; BoxCollider.z[blocker] = 0.34

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[hunter], BehaviourStateId.TravelToActivity)
    assert.equal(hasComponent(world, hunter, MoveAlongPath), true)
    const path = world.pathByEid.get(hunter)
    assert.ok(path, 'hunter should receive a travel path')
    assert.equal(path.points.some((p) => Math.floor(p.x) === 3 && Math.floor(p.z) === 2), false)
})

test('BehaviourSystem: scheduled actor travels toward a zone sample', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x <= 8; x++) {
        for (let z = 0; z <= 4; z++) chunks.setVoxel(x, 0, z, BLOCK.plank)
    }
    defineAiZone(world, {
        id: 'workshop',
        center: { x: 7.5, y: 1, z: 2.5 },
        radius: 0,
    })
    defineAiSchedule(world, {
        id: 'worker-day',
        steps: [{ id: 'go-work', kind: 'travelZone', zoneId: 'workshop' }],
    })

    const worker = addEntity(world)
    addComponent(world, worker, Position); addComponent(world, worker, Behaviour)
    Position.x[worker] = 0.5; Position.y[worker] = 1; Position.z[worker] = 2.5
    assignBehaviourProfile(world, worker, BehaviourProfileId.NeutralWanderer, { x: 0.5, y: 1, z: 2.5 })
    assignAiSchedule(world, worker, 'worker-day')

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[worker], BehaviourStateId.TravelToActivity)
    assert.equal(hasComponent(world, worker, MoveAlongPath), true)
    assert.deepEqual(world.behaviourByEid.get(worker)?.activity, { x: 7.5, y: 1, z: 2.5 })
})

test('BehaviourSystem: scheduled patrol actor follows authored route points', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x <= 8; x++) {
        for (let z = 0; z <= 4; z++) chunks.setVoxel(x, 0, z, BLOCK.plank)
    }
    defineAiSchedule(world, {
        id: 'guard-route',
        steps: [{
            id: 'patrol',
            kind: 'patrolRoute',
            points: [
                { x: 2.5, y: 1, z: 2.5 },
                { x: 7.5, y: 1, z: 2.5 },
            ],
        }],
    })

    const guard = addEntity(world)
    addComponent(world, guard, Position); addComponent(world, guard, Behaviour)
    Position.x[guard] = 0.5; Position.y[guard] = 1; Position.z[guard] = 2.5
    assignBehaviourProfile(world, guard, BehaviourProfileId.Guard, { x: 0.5, y: 1, z: 2.5 })
    assignAiSchedule(world, guard, 'guard-route')

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[guard], BehaviourStateId.Patrol)
    assert.equal(hasComponent(world, guard, MoveAlongPath), true)
    const path = world.pathByEid.get(guard)
    assert.ok(path)
    assert.ok(path.points.some((p) => Math.floor(p.x) === 2 && Math.floor(p.z) === 2))
})

test('BehaviourSystem: assault schedule keeps attacker moving to zone before ranged combat', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x <= 14; x++) {
        for (let z = 0; z <= 4; z++) chunks.setVoxel(x, 0, z, BLOCK.plank)
    }
    defineAiZone(world, {
        id: 'village',
        center: { x: 12.5, y: 1, z: 2.5 },
        rect: { minX: 10, minZ: 1, maxX: 14, maxZ: 4 },
    })
    defineAiSchedule(world, {
        id: 'assault',
        loop: false,
        steps: [
            { id: 'push-in', kind: 'assaultZone', zoneId: 'village' },
            { id: 'raid', kind: 'wanderZone', zoneId: 'village' },
        ],
    })

    const archer = addEntity(world)
    addComponent(world, archer, Position); addComponent(world, archer, Behaviour)
    addComponent(world, archer, Faction); addComponent(world, archer, Health)
    Position.x[archer] = 0.5; Position.y[archer] = 1; Position.z[archer] = 2.5
    Faction.id[archer] = FactionId.Hostile
    Health.max[archer] = 42; Health.current[archer] = 42
    assignBehaviourProfile(world, archer, BehaviourProfileId.HostileArcher, { x: 0.5, y: 1, z: 2.5 })
    assignAiSchedule(world, archer, 'assault')
    setBehaviourState(world, archer, BehaviourStateId.Attack)

    const villager = addEntity(world)
    addComponent(world, villager, Position); addComponent(world, villager, Faction); addComponent(world, villager, Health)
    Position.x[villager] = 8.5; Position.y[villager] = 1; Position.z[villager] = 2.5
    Faction.id[villager] = FactionId.Neutral
    Health.max[villager] = 45; Health.current[villager] = 45
    setBehaviourTarget(world, archer, villager)

    createBehaviourSystem(chunks).update(world, 1 / 60)

    assert.equal(Behaviour.state[archer], BehaviourStateId.TravelToActivity)
    assert.equal(getBehaviourTarget(archer), null)
    assert.deepEqual(world.behaviourByEid.get(archer)?.activity, { x: 12.5, y: 1, z: 2.5 })
    assert.equal(hasComponent(world, archer, MoveAlongPath), true)
})

test('behaviourStateName names every supported state and returns "unknown" for unknowns', () => {
    assert.equal(behaviourStateName(BehaviourStateId.Idle), 'idle')
    assert.equal(behaviourStateName(BehaviourStateId.Wander), 'wander')
    assert.equal(behaviourStateName(BehaviourStateId.Chase), 'chase')
    assert.equal(behaviourStateName(BehaviourStateId.Attack), 'attack')
    assert.equal(behaviourStateName(BehaviourStateId.ReturnHome), 'return')
    assert.equal(behaviourStateName(BehaviourStateId.Dead), 'dead')
    assert.equal(behaviourStateName(BehaviourStateId.TravelToActivity), 'travel')
    assert.equal(behaviourStateName(BehaviourStateId.Flee), 'flee')
    assert.equal(behaviourStateName(BehaviourStateId.Reposition), 'reposition')
    assert.equal(behaviourStateName(BehaviourStateId.Recover), 'recover')
    assert.equal(behaviourStateName(BehaviourStateId.Patrol), 'patrol')
    assert.equal(behaviourStateName(99), 'unknown')
})
