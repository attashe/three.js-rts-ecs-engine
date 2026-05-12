import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'
import { Health, PlayerControlled, PlayerResources, Position } from '../src/client/engine/ecs/components'
import { createHealSpellSystem } from '../src/client/engine/ecs/systems/heal-spell-system'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { populateDefaultPlayerLoadout } from '../src/client/game/items'

class FakeInput implements ActionInputSource {
    pressed = true
    isKeyDown(): boolean { return false }
    hasBufferedKeyPressed(): boolean { return this.pressed }
    consumeBufferedKeyPressed(): boolean {
        if (!this.pressed) return false
        this.pressed = false
        return true
    }
}

const definitions: readonly ActionDefinition[] = [{
    id: 'spell.heal',
    label: 'Restore',
    bindings: [{ keys: ['KeyF'] }],
    bufferMs: 160,
}]

function setupPlayer(world: ReturnType<typeof createGameWorld>, health: number, mana: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, PlayerControlled)
    addComponent(world, eid, Position)
    addComponent(world, eid, Health)
    addComponent(world, eid, PlayerResources)
    Health.max[eid] = 100
    Health.current[eid] = health
    PlayerResources.maxMana[eid] = 60
    PlayerResources.mana[eid] = mana
    return eid
}

test('HealSpell consumes mana and restores health, capped at maxHealth', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // Slot 4 doesn't exist by default; equip restore into weaponSlots[0].
    const restore = world.playerLoadout.spellSlots.find((slot) => slot.id === 'restore')
    if (!restore) throw new Error('expected restore spell in default loadout')
    world.playerLoadout.weaponSlots[0] = {
        kind: 'heal',
        label: restore.label,
        icon: restore.icon,
        item: { ...restore },
    }
    world.playerLoadout.activeSlot = 0

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })
    const player = setupPlayer(world, 50, 60)

    createHealSpellSystem(actions, {}).update(world, 1 / 60)

    assert.equal(PlayerResources.mana[player], 35, 'expected 60 - 25 = 35 mana after one cast')
    assert.equal(Health.current[player], 80, 'expected 50 + 30 = 80 HP after one cast')
})

test('HealSpell caps at maxHealth even when the heal value would overshoot', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    const restore = world.playerLoadout.spellSlots.find((slot) => slot.id === 'restore')!
    world.playerLoadout.weaponSlots[0] = {
        kind: 'heal', label: restore.label, icon: restore.icon, item: { ...restore },
    }
    world.playerLoadout.activeSlot = 0

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })
    const player = setupPlayer(world, 90, 60)

    createHealSpellSystem(actions, {}).update(world, 1 / 60)

    assert.equal(Health.current[player], 100, 'overheal should clamp at maxHealth')
    assert.equal(PlayerResources.mana[player], 35, 'mana still spent because the cast healed something')
})

test('HealSpell refuses to fire at full health and does not waste mana', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    const restore = world.playerLoadout.spellSlots.find((slot) => slot.id === 'restore')!
    world.playerLoadout.weaponSlots[0] = {
        kind: 'heal', label: restore.label, icon: restore.icon, item: { ...restore },
    }
    world.playerLoadout.activeSlot = 0

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })
    const player = setupPlayer(world, 100, 60)

    createHealSpellSystem(actions, {}).update(world, 1 / 60)

    assert.equal(Health.current[player], 100, 'health stays full')
    assert.equal(PlayerResources.mana[player], 60, 'mana must not be debited when the cast is rejected')
})

test('HealSpell refuses to cast when mana is insufficient', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    const restore = world.playerLoadout.spellSlots.find((slot) => slot.id === 'restore')!
    world.playerLoadout.weaponSlots[0] = {
        kind: 'heal', label: restore.label, icon: restore.icon, item: { ...restore },
    }
    world.playerLoadout.activeSlot = 0

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })
    const player = setupPlayer(world, 50, 10)

    createHealSpellSystem(actions, {}).update(world, 1 / 60)

    assert.equal(Health.current[player], 50, 'no heal applied on rejection')
    assert.equal(PlayerResources.mana[player], 10, 'mana untouched on rejection')
})
