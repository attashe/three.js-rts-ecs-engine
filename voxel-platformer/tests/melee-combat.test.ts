import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, hasComponent } from 'bitecs'
import { createEntity } from '../src/engine/ecs/entity'
import { BoxCollider, Grounded, Health, PlayerControlled, Position, Rotation, Shield, Stunned, Velocity } from '../src/engine/ecs/components'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { createMeleeAttackSystem } from '../src/engine/ecs/systems/melee-attack-system'
import { createMeleeCombatSystem } from '../src/engine/ecs/systems/melee-combat-system'
import { startMeleeAttack } from '../src/engine/ecs/melee-combat'
import { cloneMeleeAttackDef, MELEE_ATTACK_DEFS, type MeleeAttackDef } from '../src/engine/ecs/melee-types'
import type { NpcRuntimeState } from '../src/game/npcs/npc-types'
import { NPC_TARGET_PLAYER } from '../src/game/npcs/npc-ai'

function onePressAction(): ActionMap {
    let pressed = true
    return {
        consumePressed() {
            const out = pressed
            pressed = false
            return out
        },
    } as unknown as ActionMap
}

function spawnPlayer(world: GameWorld, x = 0, z = 0): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Velocity, BoxCollider, PlayerControlled, Grounded, Health, Shield])
    Position.x[eid] = x
    Position.y[eid] = 1
    Position.z[eid] = z
    Rotation.y[eid] = 0
    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.8
    BoxCollider.z[eid] = 0.35
    Health.current[eid] = 4
    Health.max[eid] = 4
    Shield.raised[eid] = 0
    Shield.perfect[eid] = 0
    Shield.heldSeconds[eid] = 0
    Shield.reloadSeconds[eid] = 0
    Shield.blockArcCos[eid] = Math.cos((60 * Math.PI) / 180)
    Shield.blockYawOffset[eid] = 0
    Shield.minY[eid] = 0
    Shield.maxY[eid] = 1.6
    return eid
}

function spawnNpc(world: GameWorld, id: string, x: number, z: number): NpcRuntimeState {
    const rt: NpcRuntimeState = {
        id,
        position: { x, y: 1, z },
        yaw: 0,
        colliderRadius: 0.35,
        colliderHeight: 1.6,
        hp: 2,
        invulnerable: false,
        requestAttack: false,
        requestDie: false,
        dying: false,
        ai: null,
        zoneId: null,
        obstacleId: null,
    }
    world.npcRuntimeById.set(id, rt)
    return rt
}

function raiseFrontShield(eid: number, perfect = false): void {
    Shield.raised[eid] = 1
    Shield.perfect[eid] = perfect ? 1 : 0
    Shield.blockYawOffset[eid] = 0
    Shield.blockArcCos[eid] = Math.cos((60 * Math.PI) / 180)
    Shield.minY[eid] = 0
    Shield.maxY[eid] = 1.6
}

function raiseLeftShield(eid: number): void {
    Shield.raised[eid] = 1
    Shield.perfect[eid] = 1
    Shield.blockYawOffset[eid] = -Math.PI / 2
    Shield.blockArcCos[eid] = Math.cos((45 * Math.PI) / 180)
    Shield.minY[eid] = 0
    Shield.maxY[eid] = 1.6
}

test('player melee schedules damage for the active window and hits once', () => {
    const world = createGameWorld()
    spawnPlayer(world)
    const target = spawnNpc(world, 'target', 0, 1.5)
    const input = createMeleeAttackSystem(onePressAction())
    const combat = createMeleeCombatSystem()

    input.update(world, 1 / 60)
    assert.equal(target.hp, 2)

    combat.update(world, 0.21)
    assert.equal(target.hp, 2)

    combat.update(world, 0.02)
    assert.equal(target.hp, 1)

    combat.update(world, 0.03)
    assert.equal(target.hp, 1)
})

test('player thrust hits only the nearest target in its wedge', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const near = spawnNpc(world, 'near', 0, 1.2)
    const far = spawnNpc(world, 'far', 0, 1.8)
    const combat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, MELEE_ATTACK_DEFS['player-thrust']), true)
    combat.update(world, 0.24)

    assert.equal(near.hp, 1)
    assert.equal(far.hp, 2)
})

test('player melee uses target collision volume for reach and vertical overlap', () => {
    const edgeWorld = createGameWorld()
    const edgePlayer = spawnPlayer(edgeWorld)
    const edgeTarget = spawnNpc(edgeWorld, 'edge-target', 0, 2.55)
    const edgeCombat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(edgeWorld, { kind: 'player', eid: edgePlayer }, MELEE_ATTACK_DEFS['player-thrust']), true)
    edgeCombat.update(edgeWorld, MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02)
    assert.equal(edgeTarget.hp, 1, 'target radius should extend melee reach beyond its origin point')

    const highWorld = createGameWorld()
    const highPlayer = spawnPlayer(highWorld)
    const highTarget = spawnNpc(highWorld, 'high-target', 0, 1.4)
    highTarget.position.y = 4
    const highCombat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(highWorld, { kind: 'player', eid: highPlayer }, MELEE_ATTACK_DEFS['player-thrust']), true)
    highCombat.update(highWorld, MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02)
    assert.equal(highTarget.hp, 2, 'target volume should still respect the attack vertical band')
})

test('player swing and staff slam cleave targets in the active wedge', () => {
    for (const id of ['player-swing', 'staff-slam'] as const) {
        const world = createGameWorld()
        const player = spawnPlayer(world)
        const left = spawnNpc(world, `${id}:left`, -0.35, 1.2)
        const right = spawnNpc(world, `${id}:right`, 0.35, 1.2)
        const combat = createMeleeCombatSystem()

        assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, MELEE_ATTACK_DEFS[id]), true)
        combat.update(world, MELEE_ATTACK_DEFS[id].startupSeconds + 0.02)

        assert.equal(left.hp, 1, `${id} should hit the left target`)
        assert.equal(right.hp, 1, `${id} should hit the right target`)
    }
})

test('NPC shield guard blocks frontal player melee but stays open from the side', () => {
    const frontWorld = createGameWorld()
    const frontPlayer = spawnPlayer(frontWorld, 0, 0)
    const frontGuard = spawnNpc(frontWorld, 'spearman-front', 0, 1)
    frontGuard.yaw = Math.PI
    frontGuard.shieldGuard = {
        raised: true,
        arcCos: Math.cos((65 * Math.PI) / 180),
        minY: -0.2,
        maxY: 1.75,
    }
    const blocks: string[] = []
    const frontCombat = createMeleeCombatSystem({ onBlock: (e) => blocks.push(`${e.attackId}:${e.blockKind}`) })
    assert.equal(startMeleeAttack(frontWorld, { kind: 'player', eid: frontPlayer }, MELEE_ATTACK_DEFS['player-thrust']), true)
    frontCombat.update(frontWorld, MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02)

    assert.equal(frontGuard.hp, 2)
    assert.deepEqual(blocks, ['player-thrust:ordinary'])

    const sideWorld = createGameWorld()
    const sidePlayer = spawnPlayer(sideWorld, -1, 1)
    Rotation.y[sidePlayer] = Math.PI / 2
    const sideGuard = spawnNpc(sideWorld, 'spearman-side', 0, 1)
    sideGuard.yaw = Math.PI
    sideGuard.shieldGuard = { ...frontGuard.shieldGuard, raised: true }
    const sideCombat = createMeleeCombatSystem()
    assert.equal(startMeleeAttack(sideWorld, { kind: 'player', eid: sidePlayer }, MELEE_ATTACK_DEFS['player-thrust']), true)
    sideCombat.update(sideWorld, MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02)

    assert.equal(sideGuard.hp, 1, 'side attacks should bypass the raised front shield')

    const attackWorld = createGameWorld()
    const attackPlayer = spawnPlayer(attackWorld, 0, 0)
    const attackingGuard = spawnNpc(attackWorld, 'spearman-attacking', 0, 1)
    attackingGuard.yaw = Math.PI
    attackingGuard.shieldGuard = { ...frontGuard.shieldGuard, raised: false }
    const attackCombat = createMeleeCombatSystem()
    assert.equal(startMeleeAttack(attackWorld, { kind: 'player', eid: attackPlayer }, MELEE_ATTACK_DEFS['player-thrust']), true)
    attackCombat.update(attackWorld, MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02)

    assert.equal(attackingGuard.hp, 1, 'lowered shield during attack should leave the spearman vulnerable')
})

test('player melee keeps locked yaw and origin through active hit', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const front = spawnNpc(world, 'front', 0, 1.4)
    const behind = spawnNpc(world, 'behind', 0, -1.4)
    const combat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, MELEE_ATTACK_DEFS['player-thrust']), true)
    combat.update(world, 0.18)

    Rotation.y[player] = Math.PI
    Position.x[player] = 5
    combat.update(world, 0.06)

    assert.equal(front.hp, 1)
    assert.equal(behind.hp, 2)
    assert.equal(Rotation.y[player], 0)
})

test('NPC melee damages and pushes the player at active time', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0, 1)
    spawnNpc(world, 'guard', 0, 0)
    const combat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)

    combat.update(world, 0.31)

    assert.equal(Health.current[player], 3)
    assert.ok(Velocity.z[player] > 0, `expected player pushback, got vz=${Velocity.z[player]}`)
    assert.equal(hasComponent(world, player, Stunned), false)
})

test('NPC hammer slam uses the player target volume for circle hits', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0, 2.85)
    spawnNpc(world, 'guardian', 0, 0)
    const combat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guardian' },
        MELEE_ATTACK_DEFS['hammer-slam'],
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['hammer-slam'].startupSeconds + 0.02)

    assert.equal(Health.current[player], 3, 'player collider radius should extend the hammer circle hit')
})

test('ordinary shield block staggers the defender and enters reload', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const guard = spawnNpc(world, 'guard', 0, 1)
    guard.yaw = Math.PI
    raiseFrontShield(player, false)
    const blocks: string[] = []
    const stuns: string[] = []
    const combat = createMeleeCombatSystem({
        onBlock: (e) => blocks.push(e.blockKind),
        onStun: (e) => stuns.push(e.reason),
    })

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['npc-slash'].startupSeconds + 0.02)

    assert.equal(Health.current[player], 4)
    assert.deepEqual(blocks, ['ordinary'])
    assert.deepEqual(stuns, ['ordinary-block'])
    assert.equal(hasComponent(world, player, Stunned), true)
    assert.ok(Velocity.z[player] < 0, `expected defender pushback, got vz=${Velocity.z[player]}`)
    assert.ok(Shield.reloadSeconds[player]! > 0.5)
    assert.equal(Shield.raised[player], 0)

    const secondGuard = spawnNpc(world, 'second-guard', 0, 1)
    secondGuard.yaw = Math.PI
    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'second-guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)
    combat.update(world, MELEE_ATTACK_DEFS['npc-slash'].startupSeconds + 0.02)
    assert.equal(Health.current[player], 3, 'shield reload should leave the player open to the next hit')
})

test('perfect shield block staggers the attacker with reduced defender pushback', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const guard = spawnNpc(world, 'guard', 0, 1)
    guard.yaw = Math.PI
    raiseFrontShield(player, true)
    const blocks: string[] = []
    const stuns: string[] = []
    const combat = createMeleeCombatSystem({
        onBlock: (e) => blocks.push(e.blockKind),
        onStun: (e) => stuns.push(`${e.reason}:${e.target}`),
    })

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['npc-slash'].startupSeconds + 0.02)

    assert.equal(Health.current[player], 4)
    assert.deepEqual(blocks, ['perfect'])
    assert.deepEqual(stuns, ['perfect-block:npc'])
    assert.ok((guard.stunSeconds ?? 0) > 0, 'attacker should be staggered')
    assert.ok(guard.push && guard.push.vz > 0, 'attacker should be pushed away from the defender')
    assert.ok(Velocity.z[player] < 0 && Velocity.z[player] > -1, `expected small defender pushback, got vz=${Velocity.z[player]}`)
    assert.equal(Shield.reloadSeconds[player], 0)
    assert.equal(hasComponent(world, player, Stunned), false)
})

test('passive shield block is ordinary even if the perfect flag is stale', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const guard = spawnNpc(world, 'guard', -1, 0)
    guard.yaw = Math.PI / 2
    raiseLeftShield(player)
    const blocks: string[] = []
    const combat = createMeleeCombatSystem({ onBlock: (e) => blocks.push(e.blockKind) })

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['npc-slash'].startupSeconds + 0.02)

    assert.equal(Health.current[player], 4)
    assert.deepEqual(blocks, ['ordinary'])
    assert.equal((guard.stunSeconds ?? 0), 0)
})

test('default hammer slam stuns the player briefly', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0, 1.35)
    spawnNpc(world, 'guardian', 0, 0)
    const combat = createMeleeCombatSystem()

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guardian' },
        MELEE_ATTACK_DEFS['hammer-slam'],
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['hammer-slam'].startupSeconds + 0.02)

    assert.equal(hasComponent(world, player, Stunned), true)
    assert.ok(Stunned.seconds[player]! > 0)

    combat.update(world, MELEE_ATTACK_DEFS['hammer-slam'].stunSeconds + 0.02)
    assert.equal(hasComponent(world, player, Stunned), false)
})

test('blocked hammer slam does not apply attack stun but heavily staggers ordinary block', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0, 1)
    const guardian = spawnNpc(world, 'guardian', 0, 0)
    guardian.yaw = 0
    raiseFrontShield(player, false)
    const stuns: string[] = []
    const combat = createMeleeCombatSystem({ onStun: (e) => stuns.push(`${e.attackId}:${e.reason}`) })

    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guardian' },
        MELEE_ATTACK_DEFS['hammer-slam'],
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['hammer-slam'].startupSeconds + 0.02)

    assert.equal(Health.current[player], 4)
    assert.ok(!stuns.includes('hammer-slam:attack'), 'hammer stun feedback should not fire for a blocked hammer hit')
    assert.ok(stuns.includes('hammer-slam:ordinary-block'), 'ordinary hammer block should still emit a block stagger event')
    assert.ok(Stunned.seconds[player]! > 1, `ordinary hammer block should heavily stagger the defender, got ${Stunned.seconds[player]}`)
})

test('configured melee recoil, NPC push, and NPC stun are applied', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const target = spawnNpc(world, 'target', 0, 1.2)
    const combat = createMeleeCombatSystem()
    const def: MeleeAttackDef = {
        ...cloneMeleeAttackDef(MELEE_ATTACK_DEFS['player-thrust']),
        id: 'test-impact-response',
        startupSeconds: 0,
        activeSeconds: 0.05,
        recoverySeconds: 0.05,
        damage: 0,
        targetPushSpeed: 3,
        targetPushSeconds: 0.2,
        recoilSpeed: 2,
        recoilSeconds: 0.1,
        stunSeconds: 0.25,
    }

    assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, def), true)
    combat.update(world, 0.01)

    assert.ok(target.push && target.push.vz > 0, 'NPC target should receive kinematic push')
    assert.ok((target.stunSeconds ?? 0) > 0, 'NPC target should receive configured stun')
    assert.ok(Velocity.z[player] < 0, `expected attacker recoil, got vz=${Velocity.z[player]}`)

    combat.update(world, 0.10)
    assert.ok(target.position.z > 1.2, 'NPC push runtime should move the target')
})
