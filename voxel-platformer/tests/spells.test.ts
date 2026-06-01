import test from 'node:test'
import assert from 'node:assert/strict'
import { query } from 'bitecs'
import { createGameWorld } from '../src/engine/ecs/world'
import { createEntity } from '../src/engine/ecs/entity'
import { MovingObject, Position, Rotation } from '../src/engine/ecs/components'
import { MovingObjectKind } from '../src/game/moving-objects'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createArrowHitSystem } from '../src/engine/ecs/systems/arrow-hit-system'
import { createMovingObjectSystem } from '../src/engine/ecs/systems/moving-object-system'
import { SPELLS, getSpell, DEFAULT_SPELL_ID } from '../src/game/spells'
import { advanceSpellWaves } from '../src/game/spell-effect-system'
import type { NpcRuntimeState } from '../src/game/npcs/npc-types'

function makeNpc(id: string, x: number, z: number, hp = 2): NpcRuntimeState {
    return {
        id,
        position: { x, y: 0, z },
        yaw: 0,
        colliderRadius: 0.35,
        colliderHeight: 1.6,
        hp,
        invulnerable: false,
        requestAttack: false,
        requestDie: false,
        dying: false,
        ai: null,
        zoneId: null,
        obstacleId: null,
    }
}

test('spell registry has at least two distinct variants and a stable default', () => {
    assert.ok(SPELLS.length >= 2, 'expected multiple spells to choose between')
    const ids = new Set(SPELLS.map((s) => s.id))
    assert.equal(ids.size, SPELLS.length, 'spell ids are unique')
    assert.equal(getSpell(DEFAULT_SPELL_ID).id, DEFAULT_SPELL_ID)
    assert.equal(getSpell('does-not-exist').id, SPELLS[0]!.id, 'unknown id falls back to first spell')
})

test('Arcane Bolt cast spawns a magic-bolt projectile', () => {
    const world = createGameWorld()
    const player = createEntity(world)
    Position.x[player] = 4; Position.y[player] = 1; Position.z[player] = 4
    Rotation.y[player] = 0

    getSpell('bolt').cast(world, player)

    const movers = query(world, [MovingObject, Position])
    const bolts = [...movers].filter((eid) => MovingObject.kind[eid] === MovingObjectKind.MagicBolt)
    assert.equal(bolts.length, 1, 'one bolt spawned')
})

test('Arcane Bolt flies kinematically and damages an NPC in its path', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE) // no walls
    const world = createGameWorld()
    const player = createEntity(world)
    // Player and NPC feet level (as in-game), so the chest-height bolt is within
    // the NPC's body AABB.
    Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = 0
    Rotation.y[player] = 0 // forward = +Z

    const target = makeNpc('t', 0, 5, 2)
    world.npcRuntimeById.set(target.id, target)

    getSpell('bolt').cast(world, player)

    const arrowHit = createArrowHitSystem(chunks)
    const mover = createMovingObjectSystem()
    const dt = 1 / 60
    // arrow-hit owns collision and runs before the kinematic move each tick.
    for (let i = 0; i < 120 && target.hp === 2; i++) {
        arrowHit.update(world, dt)
        mover.update(world, dt)
    }
    assert.equal(target.hp, 1, 'bolt reached and damaged the NPC')
    const remaining = [...query(world, [MovingObject])].filter((eid) => MovingObject.kind[eid] === MovingObjectKind.MagicBolt)
    assert.equal(remaining.length, 0, 'bolt despawned on impact')
})

test('Frost Nova spawns an expanding wave whose front damages enemies it reaches', () => {
    const world = createGameWorld()
    const player = createEntity(world)
    Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = 0
    Rotation.y[player] = 0

    const near = makeNpc('near', 1.5, 0)
    const far = makeNpc('far', 20, 0)
    world.npcRuntimeById.set(near.id, near)
    world.npcRuntimeById.set(far.id, far)

    getSpell('nova').cast(world, player)
    assert.equal(world.spellEffects.length, 1, 'cast spawns a wave, not instant damage')
    assert.equal(near.hp, 2, 'wave has not reached the near enemy yet')

    // Advance the wave well past the near enemy (radius grows at NOVA_SPEED).
    advanceSpellWaves(world, 0.5)
    assert.equal(near.hp, 1, 'wavefront reached and chilled the near enemy')
    assert.equal(far.hp, 2, 'distant enemy out of range')

    // The near enemy is only hit once, even as the wave keeps expanding.
    advanceSpellWaves(world, 0.5)
    assert.equal(near.hp, 1, 'each enemy is hit at most once per wave')
})
