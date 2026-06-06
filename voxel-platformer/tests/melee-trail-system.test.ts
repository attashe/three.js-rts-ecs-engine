import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents } from 'bitecs'
import { Mesh, Scene } from 'three'
import { createEntity } from '../src/engine/ecs/entity'
import { Position, Rotation } from '../src/engine/ecs/components'
import { createGameWorld } from '../src/engine/ecs/world'
import { startMeleeAttack } from '../src/engine/ecs/melee-combat'
import { meleeActorKey } from '../src/engine/ecs/melee-types'
import { MELEE_ATTACK_DEFS, type ActiveMeleeAttack, type MeleeAttackId } from '../src/engine/ecs/melee-types'
import {
    createMeleeTrailRenderSystem,
    meleeTrailStyleForAttack,
    meleeTrailTiming,
} from '../src/game/melee-trail-system'

function attackAt(id: MeleeAttackId, elapsedSeconds: number): ActiveMeleeAttack {
    return {
        attacker: { kind: 'player', eid: 1 },
        def: MELEE_ATTACK_DEFS[id],
        elapsedSeconds,
        lockedYaw: 0,
        lockedOrigin: { x: 0, y: 1, z: 0 },
        hitTargets: new Set<string>(),
        recoilApplied: false,
    }
}

test('melee trail styles cover every current attack pattern', () => {
    const expectedKinds: Record<MeleeAttackId, string> = {
        'player-thrust': 'thrust',
        'player-spear-thrust': 'thrust',
        'player-swing': 'sweep',
        'staff-slam': 'sweep',
        'npc-slash': 'sweep',
        'npc-spear-thrust': 'thrust',
        'hammer-slam': 'slam',
    }

    for (const id of Object.keys(MELEE_ATTACK_DEFS) as MeleeAttackId[]) {
        const style = meleeTrailStyleForAttack(id)
        assert.equal(style.kind, expectedKinds[id], `${id} trail kind`)
        assert.ok(style.opacity > 0 && style.opacity <= 1, `${id} should use a visible bounded opacity`)
        assert.notEqual(style.color, style.edgeColor, `${id} should have a readable edge accent`)
    }
})

test('melee trail timing appears around active impact and fades after it', () => {
    const hidden = meleeTrailTiming(attackAt('player-swing', 0))
    assert.equal(hidden.visible, false)

    const activeStart = MELEE_ATTACK_DEFS['player-swing'].startupSeconds
    const active = meleeTrailTiming(attackAt('player-swing', activeStart + 0.02))
    assert.equal(active.visible, true)
    assert.ok(active.phase > 0.35, 'swing trail should already be moving as damage becomes active')
    assert.ok(active.alpha > 0.35, 'active trail should be readable')

    const total = MELEE_ATTACK_DEFS['player-swing'].startupSeconds +
        MELEE_ATTACK_DEFS['player-swing'].activeSeconds +
        MELEE_ATTACK_DEFS['player-swing'].recoverySeconds
    const done = meleeTrailTiming(attackAt('player-swing', total + 0.02))
    assert.equal(done.visible, false)
})

test('hammer slam trail uses delayed shock-ring timing', () => {
    const startup = MELEE_ATTACK_DEFS['hammer-slam'].startupSeconds
    const windup = meleeTrailTiming(attackAt('hammer-slam', startup - 0.02))
    const impact = meleeTrailTiming(attackAt('hammer-slam', startup + 0.04))

    assert.equal(windup.visible, true)
    assert.ok(windup.phase < 0.25, 'hammer windup should not show a full ring before impact')
    assert.equal(impact.visible, true)
    assert.ok(impact.phase > windup.phase, 'hammer ring should expand after impact')
    assert.ok(impact.alpha > windup.alpha, 'impact should read stronger than the windup hint')
})

test('melee trail render system draws from the locked attack pose and hides stale trails', () => {
    const scene = new Scene()
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, Rotation])
    Position.x[player] = 5
    Position.y[player] = 1
    Position.z[player] = 5
    Rotation.y[player] = Math.PI * 0.25

    assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, MELEE_ATTACK_DEFS['player-swing']), true)
    const key = meleeActorKey({ kind: 'player', eid: player })
    const attack = world.meleeAttacks.get(key)!
    attack.elapsedSeconds = MELEE_ATTACK_DEFS['player-swing'].startupSeconds + 0.02
    attack.lockedOrigin = { x: 2, y: 1, z: 3 }
    attack.lockedYaw = 0

    const system = createMeleeTrailRenderSystem(scene)
    system.update(world, 1 / 60)

    const root = scene.children.find((obj) => obj.name === `${key}:MeleeTrail`)
    assert.ok(root)
    assert.equal(root!.visible, true)
    const fill = root!.getObjectByName(`${key}:MeleeTrailFill`)
    assert.ok(fill instanceof Mesh)
    assert.ok((fill.geometry.getAttribute('position')?.count ?? 0) > 0)
    assert.equal(fill.geometry.index, null, 'trail fill must stay non-indexed for WebGPU')

    world.meleeAttacks.clear()
    system.update(world, 1 / 60)
    assert.equal(root!.visible, false)
    system.dispose?.()
    assert.equal(scene.children.includes(root!), false)
})

test('melee trail render system reuses one large WebGPU-safe vertex buffer across thrust and wide swing', () => {
    const scene = new Scene()
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, Rotation])
    Position.x[player] = 0
    Position.y[player] = 1
    Position.z[player] = 0
    Rotation.y[player] = 0

    const key = meleeActorKey({ kind: 'player', eid: player })
    assert.equal(startMeleeAttack(world, { kind: 'player', eid: player }, MELEE_ATTACK_DEFS['player-thrust']), true)
    const attack = world.meleeAttacks.get(key)!
    attack.lockedOrigin = { x: 0, y: 1, z: 0 }
    attack.lockedYaw = 0
    attack.elapsedSeconds = MELEE_ATTACK_DEFS['player-thrust'].startupSeconds + 0.02

    const system = createMeleeTrailRenderSystem(scene)
    system.update(world, 1 / 60)
    const root = scene.children.find((obj) => obj.name === `${key}:MeleeTrail`)
    const fill = root?.getObjectByName(`${key}:MeleeTrailFill`)
    assert.ok(fill instanceof Mesh)
    const firstAttribute = fill.geometry.getAttribute('position')
    const thrustDrawCount = fill.geometry.drawRange.count
    assert.equal(fill.geometry.index, null)
    assert.equal(firstAttribute.count >= thrustDrawCount, true)

    attack.def = MELEE_ATTACK_DEFS['player-swing']
    attack.elapsedSeconds = MELEE_ATTACK_DEFS['player-swing'].startupSeconds + 0.02
    system.update(world, 1 / 60)

    const secondAttribute = fill.geometry.getAttribute('position')
    assert.equal(secondAttribute, firstAttribute, 'wide swing should update the existing GPU-sized attribute')
    assert.equal(fill.geometry.index, null)
    assert.ok(fill.geometry.drawRange.count > thrustDrawCount, 'wide swing should draw more trail vertices than thrust')
    assert.equal(secondAttribute.count >= fill.geometry.drawRange.count, true, 'draw range must fit inside the bound vertex buffer')

    system.dispose?.()
})
