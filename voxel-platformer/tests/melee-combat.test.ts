import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, hasComponent } from 'bitecs'
import { createEntity } from '../src/engine/ecs/entity'
import { Grounded, Health, PlayerControlled, Position, Rotation, Stunned, Velocity } from '../src/engine/ecs/components'
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
    addComponents(world, eid, [Position, Rotation, Velocity, PlayerControlled, Grounded, Health])
    Position.x[eid] = x
    Position.y[eid] = 1
    Position.z[eid] = z
    Rotation.y[eid] = 0
    Health.current[eid] = 4
    Health.max[eid] = 4
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
