import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createGameWorld } from '../src/engine/ecs/world'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { levelMetaFromEditor } from '../src/game/level-from-meta'
import { nearestChestInteractionTarget, openLootChest, type LootChestConfig } from '../src/game/chests'

test('loot chests grant loot once and switch to the open block', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const chest: LootChestConfig = {
        id: 'supply-cache',
        cell: { x: 2, y: 1, z: 2 },
        prompt: 'Open supply cache',
        interactionRadius: 1.4,
        loot: [
            { id: 'gold', quantity: 7 },
            { id: 'arrows', quantity: 3 },
            { id: 'mana-potion', quantity: 2, name: 'Mana Potion', category: 'consumables', icon: 'mana-potion' },
        ],
    }
    chunks.setVoxel(2, 1, 2, BLOCK.chest)

    const player = { eid: 1, x: 2.6, y: 1.1, z: 2.5 }
    const target = nearestChestInteractionTarget(world, player, chunks, [chest])
    assert.equal(target?.id, 'chest:supply-cache')
    assert.equal(target?.prompt, 'Open supply cache')

    assert.ok(target)
    target.interact(world, player)
    assert.equal(chunks.getVoxel(2, 1, 2), BLOCK.openChest)
    assert.equal(world.inventory.gold, 7)
    assert.equal(world.inventory.arrows, 3)
    assert.equal(world.inventory.items['mana-potion']?.quantity, 2)
    assert.equal(world.playerSettings.inventory.gold, 7)
    assert.equal(world.playerSettings.inventory.arrows, 3)
    assert.equal(world.playerSettings.inventory.items['mana-potion']?.quantity, 2)
    assert.match(world.log[world.log.length - 1] ?? '', /Chest loot: 7 gold, 3 arrows, 2 Mana Potion\./)
    assert.deepEqual(world.popupMessages.at(-1), {
        id: 1,
        targetId: 'chest:supply-cache',
        anchor: { x: 2.5, y: 2.1, z: 2.5 },
        message: 'Looted: 7 gold, 3 arrows, 2 Mana Potion.',
        seconds: 3,
    })

    assert.equal(nearestChestInteractionTarget(world, player, chunks, [chest]), null)
    assert.equal(openLootChest(world, chunks, chest), false)
    assert.equal(world.inventory.gold, 7, 'open chests should not pay out again')
})

test('empty loot chests show an empty chest popup', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const chest: LootChestConfig = {
        id: 'empty-cache',
        cell: { x: 1, y: 2, z: 3 },
        loot: [],
    }
    chunks.setVoxel(1, 2, 3, BLOCK.chest)

    assert.equal(openLootChest(world, chunks, chest), true)
    assert.equal(world.log.at(-1), 'Opened an empty chest.')
    assert.deepEqual(world.popupMessages.at(-1), {
        id: 1,
        targetId: 'chest:empty-cache',
        anchor: { x: 1.5, y: 3.1, z: 3.5 },
        message: 'Chest is empty.',
        seconds: 3,
    })
})

test('looted chests stay empty after a travel snapshot round-trip', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const chest: LootChestConfig = {
        id: 'return-cache',
        cell: { x: 3, y: 1, z: 3 },
        loot: [{ id: 'gold', quantity: 5 }],
    }
    chunks.setVoxel(3, 1, 3, BLOCK.chest)

    assert.equal(openLootChest(world, chunks, chest), true)
    assert.equal(chunks.getVoxel(3, 1, 3), BLOCK.openChest)
    assert.equal(world.inventory.gold, 5)

    // Travel captures the live chunk state (serializeLevel) when leaving a
    // location and restores it on return — so the opened-chest voxel persists.
    const meta = toLevelMeta(createEditorState({ x: 0, y: 1, z: 0 }), 'return-test')
    const buffer = serializeLevel(chunks, meta)
    const restoredChunks = new ChunkManager(DEFAULT_PALETTE)
    const returnWorld = createGameWorld()
    loadLevelFromBuffer(buffer, returnWorld, restoredChunks, createEditorState({ x: 0, y: 1, z: 0 }))

    // Back in the location, the chest is still open: not offered, not re-lootable.
    assert.equal(restoredChunks.getVoxel(3, 1, 3), BLOCK.openChest)
    const player = { eid: 1, x: 3.6, y: 1.1, z: 3.5 }
    assert.equal(nearestChestInteractionTarget(returnWorld, player, restoredChunks, [chest]), null)
    assert.equal(openLootChest(returnWorld, restoredChunks, chest), false)
    assert.equal(returnWorld.inventory.gold, 0, 'returning to a looted chest pays out nothing')
})

test('loot chests survive editor save-load and runtime metadata conversion', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const state = createEditorState({ x: 0, y: 1, z: 0 })
    state.chests.push({
        id: 'deep-cache',
        cell: { x: 5, y: 6, z: 7 },
        prompt: 'Open cache',
        interactionRadius: 2,
        loot: [{ id: 'dynamite', quantity: 1, category: 'consumables', icon: 'dynamite' }],
    })

    const meta = toLevelMeta(state, 'chest-test')
    assert.deepEqual(meta.chests, state.chests)

    const restored = createEditorState({ x: 0, y: 1, z: 0 })
    const buffer = serializeLevel(chunks, meta)
    loadLevelFromBuffer(buffer, createGameWorld(), new ChunkManager(DEFAULT_PALETTE), restored)
    assert.deepEqual(restored.chests, state.chests)

    const runtime = levelMetaFromEditor(toLevelMeta(restored, 'chest-test'))
    assert.deepEqual(runtime.chests, state.chests)
})
