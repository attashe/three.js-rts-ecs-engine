import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/client/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE, isPathSurface } from '../src/client/engine/voxel/palette'
import { generateDemoLevel, generateVillageLevel, type LevelMeta } from '../src/client/game/level'
import { FactionId } from '../src/client/engine/ecs/factions'

test('generateDemoLevel places actors and pickups on walkable clear cells', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generateDemoLevel(chunks)
    assert.ok(meta.hostiles.filter((spawn) => spawn.faction === FactionId.SkirmishRed).length >= 2)
    assert.ok(meta.hostiles.filter((spawn) => spawn.faction === FactionId.SkirmishBlue).length >= 2)
    assert.ok(meta.archers.some((spawn) => spawn.faction === FactionId.SkirmishRed))
    assert.ok(meta.archers.some((spawn) => spawn.faction === FactionId.SkirmishBlue))
    assertWalkableMeta(chunks, meta)
})

test('generateVillageLevel places village actors on walkable clear cells', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generateVillageLevel(chunks)
    assert.ok(meta.villagers.length >= 6)
    assert.ok(meta.guards.length >= 3)
    assert.ok(meta.hunters.length >= 3)
    assert.ok(meta.rabbits.length >= 6)
    assert.equal(meta.doors.length, 0)
    assert.equal(meta.villagerSchedules.length, meta.villagers.length)
    for (let i = 0; i < meta.villagerSchedules.length; i++) {
        const home = meta.villagerSchedules[i]!.home
        assert.equal(
            chunks.getVoxel(Math.floor(home.x), Math.floor(home.y + 3), Math.floor(home.z)),
            BLOCK.air,
            `villager ${i} home should not have a roof over the center`,
        )
    }
    assertWalkableMeta(chunks, meta)
})

function assertWalkableMeta(chunks: ChunkManager, meta: LevelMeta): void {
    const points = [
        ['spawn', meta.spawn],
        ['npc', meta.npc],
        ['dummy', meta.dummy],
        ['coins', meta.coins],
        ['potion', meta.potion],
        ...(meta.pistonTester ? [['pistonTester', meta.pistonTester] as const] : []),
        ...(meta.pistonTesterGoal ? [['pistonTesterGoal', meta.pistonTesterGoal] as const] : []),
        ...meta.wanderers.map((point, i) => [`wanderer ${i}`, point] as const),
        ...meta.villagers.map((point, i) => [`villager ${i}`, point] as const),
        ...meta.villagerSchedules.flatMap((schedule, i) => [
            [`villager ${i} home zone`, schedule.home] as const,
            [`villager ${i} work zone`, schedule.work] as const,
        ]),
        ...meta.guards.map((point, i) => [`guard ${i}`, point] as const),
        ...meta.hunters.flatMap((hunter, i) => [
            [`hunter ${i} home`, hunter.home] as const,
            [`hunter ${i} ground`, hunter.huntingGround] as const,
        ]),
        ...meta.rabbits.map((point, i) => [`rabbit ${i}`, point] as const),
        ...meta.hostiles.map((hostile, i) => [`hostile ${i}`, hostile.position] as const),
        ...meta.archers.map((archer, i) => [`archer ${i}`, archer.position] as const),
    ] as const

    for (const [label, point] of points) {
        const x = Math.floor(point.x)
        const y = Math.floor(point.y)
        const z = Math.floor(point.z)
        const floor = chunks.getVoxel(x, y - 1, z)
        const foot = chunks.getVoxel(x, y, z)

        assert.ok(isPathSurface(DEFAULT_PALETTE, floor), `${label} floor should be pathable`)
        assert.equal(foot, BLOCK.air, `${label} foot cell should be clear`)
    }
}
