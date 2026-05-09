import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { FactionId } from '../engine/ecs/factions'
import { BLOCK } from '../engine/voxel/palette'
import type { DoorMechanismConfig, PistonMechanismConfig } from './mechanisms'
import { STONE_TIER, type StoneFallSpawnerConfig } from './moving-objects'

export interface CombatSpawn {
    position: { x: number; y: number; z: number }
    yaw: number
    label?: string
    faction?: FactionId
}

export interface LevelMeta {
    /** World-space spawn position (X, Y, Z). Y is standing height (one above topmost solid). */
    spawn: { x: number; y: number; z: number }
    /** Sample NPC position for visual/demo composition. */
    npc: { x: number; y: number; z: number }
    dummy: { x: number; y: number; z: number }
    wanderers: { x: number; y: number; z: number }[]
    villagers: { x: number; y: number; z: number }[]
    guards: { x: number; y: number; z: number }[]
    hunters: {
        home: { x: number; y: number; z: number }
        huntingGround: { x: number; y: number; z: number }
    }[]
    rabbits: { x: number; y: number; z: number }[]
    pistonTester?: { x: number; y: number; z: number }
    pistonTesterGoal?: { x: number; y: number; z: number }
    /** Hostile melee spawns. Placed near landmarks the player will visit so the
     *  Chase / Attack / ReturnHome loop is observable from the spawn area. */
    hostiles: CombatSpawn[]
    archers: CombatSpawn[]
    stoneSpawners: StoneFallSpawnerConfig[]
    coins: { x: number; y: number; z: number }
    potion: { x: number; y: number; z: number }
    doors: DoorMechanismConfig[]
    pistons: PistonMechanismConfig[]
    /** XZ extent of the generated level, used by the demo to centre the camera. */
    size: number
}

export type LevelId = 'playground' | 'village'

export function generateLevel(chunks: ChunkManager, id: LevelId): LevelMeta {
    return id === 'village'
        ? generateVillageLevel(chunks)
        : generateDemoLevel(chunks)
}

/**
 * Authored demo island built on top of deterministic terrain. The level is
 * split into readable test zones rather than a loose scatter of mechanics:
 *
 * - central plaza: player spawn, air-push/melee pickup readability
 * - village hut: NPC + door interaction
 * - ward garden: no-walk/pathfinding test for neutral wanderers
 * - piston corridor: moving block pathfinding test
 * - hunting meadow: hunter/prey state-machine scenario with fleeing rabbits
 * - combat yard: hostile chase/attack/leash loop
 * - skirmish arena: two autonomous melee/ranged groups fighting each other
 * - cliff valley: falling/stacking stones and impact damage
 *
 * A mutable height map is the source of truth for standing points after pads
 * and roads are carved, so entity metadata stays synchronized with terrain.
 */
export function generateDemoLevel(chunks: ChunkManager): LevelMeta {
    const size = 56
    const half = size / 2
    const heights = new Int16Array(size * size)

    const baseHeightAt = (x: number, z: number): number => {
        const n1 = Math.sin(x * 0.13) * Math.cos(z * 0.17)
        const n2 = Math.sin((x + z) * 0.21) * 0.5
        const radial = Math.hypot(x - half, z - half) / half
        const island = Math.max(0, 1 - radial * 1.15)
        return Math.floor(n1 * 0.6 + n2 * 0.6 + island * 4 + 1)
    }
    const heightAt = (x: number, z: number): number => topAt(heights, size, x, z)

    // Terrain.
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const top = baseHeightAt(x, z)
            heights[indexOf(size, x, z)] = top
            writeTerrainColumn(chunks, x, z, top, top <= 1 ? BLOCK.sand : BLOCK.grass)
        }
    }

    carveDemoZones(chunks, heights, size)

    // Trees frame the zones without hiding the functional test areas.
    placeTree(chunks, heightAt, 6, 19)
    placeTree(chunks, heightAt, 11, 43)
    placeTree(chunks, heightAt, 46, 10)
    placeTree(chunks, heightAt, 51, 47)
    placeTree(chunks, heightAt, 31, 18)
    placeTree(chunks, heightAt, 20, 39)

    const door = placeHut(chunks, heightAt, 25, 39)
    const trapPiston = placePistonDemo(chunks, heightAt, 30, 28, true)
    const corridor = placePistonCorridor(chunks, 39, 12)
    const stoneSpawners = placeStoneCliff(chunks, heights, size, 8, 18)
    placeNoWalkZone(chunks, heightAt)

    const sx = half
    const sz = half
    const sy = heightAt(sx, sz) + 1

    const nx = 27
    const nz = 36
    const ny = heightAt(nx, nz) + 1
    const dummy = standingPoint(heightAt, 40, 28)
    const wanderers = [
        standingPoint(heightAt, 16, 29),
        standingPoint(heightAt, 18, 31),
        standingPoint(heightAt, 19, 28),
        standingPoint(heightAt, 15, 33),
    ]
    const coins = standingPoint(heightAt, 33, 27)
    const potion = standingPoint(heightAt, 36, 30)
    const hunters = [{
        home: standingPoint(heightAt, 25, 36),
        huntingGround: standingPoint(heightAt, 44, 41),
    }]
    const rabbits = [
        standingPoint(heightAt, 42, 39),
        standingPoint(heightAt, 46, 40),
        standingPoint(heightAt, 44, 44),
        standingPoint(heightAt, 48, 42),
    ]

    // Hostile spawns. The east-island marauder lives away from the spawn so
    // the player has to walk into its sight cone — that visit demonstrates
    // Chase, and walking back toward spawn pulls them past the leash radius
    // and triggers ReturnHome. The cliff valley grunt is placed where falling
    // stones will sometimes finish it off, exercising impact damage routing
    // through the same Health pipeline.
    const hostiles = [
        { position: standingPoint(heightAt, 45, 28), yaw: Math.PI, label: 'Yard Marauder' },
        { position: standingPoint(heightAt, 16, 22), yaw: -Math.PI * 0.5, label: 'Valley Brute' },
        { position: standingPoint(heightAt, 9, 9), yaw: Math.PI * 0.5, label: 'Red Fighter 1', faction: FactionId.SkirmishRed },
        { position: standingPoint(heightAt, 9, 12), yaw: Math.PI * 0.5, label: 'Red Fighter 2', faction: FactionId.SkirmishRed },
        { position: standingPoint(heightAt, 17, 9), yaw: -Math.PI * 0.5, label: 'Blue Fighter 1', faction: FactionId.SkirmishBlue },
        { position: standingPoint(heightAt, 17, 12), yaw: -Math.PI * 0.5, label: 'Blue Fighter 2', faction: FactionId.SkirmishBlue },
    ]
    const archers = [
        { position: standingPoint(heightAt, 47, 31), yaw: Math.PI, label: 'Yard Archer' },
        { position: standingPoint(heightAt, 8, 11), yaw: Math.PI * 0.5, label: 'Red Bowman', faction: FactionId.SkirmishRed },
        { position: standingPoint(heightAt, 18, 10), yaw: -Math.PI * 0.5, label: 'Blue Bowman', faction: FactionId.SkirmishBlue },
    ]

    return {
        spawn: { x: sx + 0.5, y: sy, z: sz + 0.5 },
        npc: { x: nx + 0.5, y: ny, z: nz + 0.5 },
        dummy,
        wanderers,
        villagers: [],
        guards: [],
        hunters,
        rabbits,
        pistonTester: corridor.npc,
        pistonTesterGoal: corridor.goal,
        hostiles,
        archers,
        stoneSpawners,
        coins,
        potion,
        doors: [door],
        pistons: [trapPiston, ...corridor.pistons],
        size,
    }
}

export function generateVillageLevel(chunks: ChunkManager): LevelMeta {
    const size = 64
    const top = 4
    const heights = new Int16Array(size * size)
    const heightAt = (x: number, z: number): number => topAt(heights, size, x, z)

    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            heights[indexOf(size, x, z)] = top
            writeTerrainColumn(chunks, x, z, top, BLOCK.grass)
        }
    }

    // Village square, homes, roads, guard posts, and hunting fields.
    flattenRect(chunks, heights, size, 24, 24, 40, 40, top, BLOCK.grass)
    flattenRect(chunks, heights, size, 29, 29, 35, 35, top, BLOCK.plank)
    flattenRect(chunks, heights, size, 14, 30, 50, 34, top, BLOCK.plank)
    flattenRect(chunks, heights, size, 30, 14, 34, 50, top, BLOCK.plank)
    flattenRect(chunks, heights, size, 42, 20, 58, 44, top, BLOCK.grass)
    flattenRect(chunks, heights, size, 46, 24, 56, 40, top, BLOCK.plank)
    flattenRect(chunks, heights, size, 6, 24, 18, 40, top, BLOCK.grass)

    const doors = [
        placeHut(chunks, heightAt, 22, 25),
        placeHut(chunks, heightAt, 22, 39),
        placeHut(chunks, heightAt, 36, 25),
        placeHut(chunks, heightAt, 36, 39),
        placeHut(chunks, heightAt, 14, 33),
    ]

    placeFence(chunks, 43, top + 1, 21, 59, 45)
    placeGateGap(chunks, 44, top + 1, 32, 45, 32)
    placeGateGap(chunks, 44, top + 1, 33, 45, 33)
    placeTreesAroundVillage(chunks, heightAt)

    const spawn = standingPoint(heightAt, 32, 32)
    const villagers = [
        standingPoint(heightAt, 27, 31),
        standingPoint(heightAt, 31, 28),
        standingPoint(heightAt, 35, 36),
        standingPoint(heightAt, 26, 37),
        standingPoint(heightAt, 38, 30),
        standingPoint(heightAt, 29, 39),
    ]
    const guards = [
        standingPoint(heightAt, 31, 22),
        standingPoint(heightAt, 42, 32),
        standingPoint(heightAt, 20, 32),
    ]
    const hunters = [
        { home: standingPoint(heightAt, 22, 28), huntingGround: standingPoint(heightAt, 51, 30) },
        { home: standingPoint(heightAt, 36, 28), huntingGround: standingPoint(heightAt, 52, 36) },
        { home: standingPoint(heightAt, 15, 32), huntingGround: standingPoint(heightAt, 49, 26) },
    ]
    const rabbits = [
        standingPoint(heightAt, 49, 26),
        standingPoint(heightAt, 53, 28),
        standingPoint(heightAt, 51, 34),
        standingPoint(heightAt, 55, 38),
        standingPoint(heightAt, 47, 39),
        standingPoint(heightAt, 57, 31),
    ]
    const hostiles = [
        { position: standingPoint(heightAt, 8, 30), yaw: Math.PI * 0.5, label: 'Forest Raider' },
        { position: standingPoint(heightAt, 9, 36), yaw: Math.PI * 0.5, label: 'Road Bandit' },
    ]
    const archers = [
        { position: standingPoint(heightAt, 12, 26), yaw: Math.PI * 0.5, label: 'Road Archer' },
        { position: standingPoint(heightAt, 12, 39), yaw: Math.PI * 0.5, label: 'Forest Archer' },
    ]

    return {
        spawn,
        npc: standingPoint(heightAt, 30, 34),
        dummy: standingPoint(heightAt, 34, 30),
        wanderers: [],
        villagers,
        guards,
        hunters,
        rabbits,
        pistonTester: undefined,
        pistonTesterGoal: undefined,
        hostiles,
        archers,
        stoneSpawners: [],
        coins: standingPoint(heightAt, 33, 33),
        potion: standingPoint(heightAt, 31, 33),
        doors,
        pistons: [],
        size,
    }
}

function carveDemoZones(chunks: ChunkManager, heights: Int16Array, size: number): void {
    // Central arrival plaza with enough flat space to read air push, pickups,
    // and player/NPC body blocking without terrain noise.
    flattenRect(chunks, heights, size, 23, 23, 33, 33, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 26, 26, 30, 30, 5, BLOCK.plank)
    placeLowMarker(chunks, 23, 6, 23)
    placeLowMarker(chunks, 33, 6, 23)
    placeLowMarker(chunks, 23, 6, 33)
    placeLowMarker(chunks, 33, 6, 33)

    // Village pad and a broad road from spawn to the door.
    flattenRect(chunks, heights, size, 21, 34, 31, 45, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 25, 31, 28, 38, 5, BLOCK.plank)

    // Ward garden: mostly flat, with non-pathable blocks forming obstacles
    // that make wandering/repathing behaviour easy to inspect.
    flattenRect(chunks, heights, size, 11, 25, 23, 36, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 16, 28, 20, 32, 5, BLOCK.plank)
    flattenRect(chunks, heights, size, 20, 25, 27, 27, 5, BLOCK.plank)

    // Combat yard on the east side. The road deliberately narrows at the
    // plaza edge so body blocking and Air Push have useful test cases.
    flattenRect(chunks, heights, size, 35, 23, 49, 34, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 32, 27, 42, 29, 5, BLOCK.plank)
    flattenRect(chunks, heights, size, 40, 25, 43, 31, 5, BLOCK.plank)

    // Hunting meadow: the hunter starts at the village door, walks through
    // this road, then searches the meadow for rabbits that flee on sight.
    flattenRect(chunks, heights, size, 34, 36, 50, 46, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 28, 36, 43, 40, 5, BLOCK.plank)
    flattenRect(chunks, heights, size, 42, 39, 46, 43, 5, BLOCK.grass)

    // Approach to the fixed-height piston corridor.
    flattenRect(chunks, heights, size, 31, 16, 40, 20, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 34, 19, 37, 27, 5, BLOCK.plank)

    // Trail to the cliff valley; still flat while player step-assist is not
    // implemented, but kept visually separate from the plank roads.
    flattenRect(chunks, heights, size, 12, 20, 24, 24, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 20, 24, 24, 28, 5, BLOCK.grass)

    // Skirmish arena: two neutral-to-player combat squads start in sight of
    // one another so faction targeting, melee, archery, death, and corpse
    // cleanup are visible without the player needing to trigger anything.
    flattenRect(chunks, heights, size, 5, 5, 21, 15, 5, BLOCK.grass)
    flattenRect(chunks, heights, size, 8, 8, 18, 13, 5, BLOCK.plank)
    placeLowMarker(chunks, 5, 6, 5)
    placeLowMarker(chunks, 21, 6, 5)
    placeLowMarker(chunks, 5, 6, 15)
    placeLowMarker(chunks, 21, 6, 15)
}

function flattenRect(
    chunks: ChunkManager,
    heights: Int16Array,
    size: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    top: number,
    surface: number,
): void {
    for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
            if (!inBounds(size, x, z)) continue
            heights[indexOf(size, x, z)] = top
            writeTerrainColumn(chunks, x, z, top, surface)
            clearColumn(chunks, x, z, top + 1, top + 10)
        }
    }
}

function writeTerrainColumn(chunks: ChunkManager, x: number, z: number, top: number, surface: number): void {
    for (let y = 0; y <= top; y++) {
        let block: number = BLOCK.stone
        if (y === top) block = surface
        else if (y > top - 3) block = BLOCK.dirt
        chunks.setVoxel(x, y, z, block)
    }
}

function clearColumn(chunks: ChunkManager, x: number, z: number, y0: number, y1: number): void {
    for (let y = y0; y <= y1; y++) chunks.setVoxel(x, y, z, BLOCK.air)
}

function placeLowMarker(chunks: ChunkManager, x: number, y: number, z: number): void {
    chunks.setVoxel(x, y, z, BLOCK.wood)
    chunks.setVoxel(x, y + 1, z, BLOCK.glow)
}

function placeFence(chunks: ChunkManager, x0: number, y: number, z0: number, x1: number, z1: number): void {
    for (let x = x0; x <= x1; x++) {
        chunks.setVoxel(x, y, z0, BLOCK.wood)
        chunks.setVoxel(x, y, z1, BLOCK.wood)
    }
    for (let z = z0; z <= z1; z++) {
        chunks.setVoxel(x0, y, z, BLOCK.wood)
        chunks.setVoxel(x1, y, z, BLOCK.wood)
    }
}

function placeGateGap(chunks: ChunkManager, x0: number, y: number, z0: number, x1: number, z1: number): void {
    for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) chunks.setVoxel(x, y, z, BLOCK.air)
    }
}

function placeTreesAroundVillage(chunks: ChunkManager, heightAt: (x: number, z: number) => number): void {
    for (const [x, z] of [
        [8, 12],
        [16, 16],
        [48, 12],
        [56, 17],
        [8, 48],
        [18, 52],
        [48, 52],
        [58, 48],
    ] as const) {
        placeTree(chunks, heightAt, x, z)
    }
}

function topAt(heights: Int16Array, size: number, x: number, z: number): number {
    const ix = Math.max(0, Math.min(size - 1, Math.floor(x)))
    const iz = Math.max(0, Math.min(size - 1, Math.floor(z)))
    return heights[indexOf(size, ix, iz)]
}

function indexOf(size: number, x: number, z: number): number {
    return z * size + x
}

function inBounds(size: number, x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < size && z < size
}

function placeStoneCliff(
    chunks: ChunkManager,
    heights: Int16Array,
    size: number,
    x0: number,
    z0: number,
): StoneFallSpawnerConfig[] {
    const cliffTop = 9
    const valleyTop = 5
    const width = 7

    for (let x = x0 - 2; x <= x0 + 3; x++) {
        for (let z = z0 - 2; z <= z0 + width + 1; z++) {
            if (inBounds(size, x, z)) heights[indexOf(size, x, z)] = cliffTop
            for (let y = 0; y <= cliffTop; y++) chunks.setVoxel(x, y, z, y === cliffTop ? BLOCK.stone : BLOCK.dirt)
            for (let y = cliffTop + 1; y <= cliffTop + 4; y++) chunks.setVoxel(x, y, z, BLOCK.air)
        }
    }

    for (let x = x0 + 4; x <= x0 + 12; x++) {
        for (let z = z0 - 2; z <= z0 + width + 1; z++) {
            if (inBounds(size, x, z)) heights[indexOf(size, x, z)] = valleyTop
            for (let y = 0; y <= valleyTop; y++) chunks.setVoxel(x, y, z, y === valleyTop ? BLOCK.grass : BLOCK.dirt)
            for (let y = valleyTop + 1; y <= cliffTop + 3; y++) chunks.setVoxel(x, y, z, BLOCK.air)
        }
    }

    // Low side lips keep the demo stones in the readable test area without forming stairs.
    for (let x = x0 + 1; x <= x0 + 12; x++) {
        chunks.setVoxel(x, valleyTop + 1, z0 - 2, BLOCK.noWalk)
        chunks.setVoxel(x, valleyTop + 1, z0 + width + 1, BLOCK.noWalk)
    }

    // Diverse cliff: pebbles patter constantly, the occasional boulder lands
    // hard. Spawners are spread along the cliff edge (varying z) so debris
    // arrives at different points in the valley.
    return [
        {
            position: { x: x0 + 2.6, y: cliffTop + 1.1, z: z0 + 0.6 },
            velocity: { x: 3.6, y: 0.1, z: 0.4 },
            interval: 1.0,
            jitter: 0.35,
            options: STONE_TIER.pebble,
        },
        {
            position: { x: x0 + 2.1, y: cliffTop + 1.1, z: z0 + 2.1 },
            velocity: { x: 3.0, y: 0.3, z: 0.2 },
            interval: 1.65,
            jitter: 0.3,
            options: STONE_TIER.cobble,
        },
        {
            position: { x: x0 + 2.5, y: cliffTop + 1.1, z: z0 + 3.5 },
            velocity: { x: 3.2, y: 0.2, z: 0.25 },
            interval: 2.25,
            jitter: 0.35,
            options: STONE_TIER.stone,
        },
        {
            position: { x: x0 + 1.8, y: cliffTop + 1.1, z: z0 + 4.8 },
            velocity: { x: 2.7, y: 0.3, z: -0.15 },
            interval: 3.1,
            jitter: 0.25,
            options: STONE_TIER.stone,
        },
        {
            position: { x: x0 + 2.2, y: cliffTop + 1.2, z: z0 + 6.0 },
            velocity: { x: 3.5, y: 0.0, z: -0.3 },
            interval: 3.6,
            jitter: 0.3,
            options: STONE_TIER.rock,
        },
        {
            position: { x: x0 + 2.4, y: cliffTop + 1.4, z: z0 + 2.8 },
            velocity: { x: 3.8, y: -0.1, z: 0.05 },
            interval: 5.5,
            jitter: 0.2,
            options: STONE_TIER.boulder,
        },
    ]
}

function placeNoWalkZone(chunks: ChunkManager, heightAt: (x: number, z: number) => number): void {
    for (let z = 27; z <= 31; z++) {
        for (let x = 20; x <= 22; x++) {
            const top = heightAt(x, z)
            chunks.setVoxel(x, top + 1, z, BLOCK.noWalk)
        }
    }
    for (let x = 14; x <= 18; x++) {
        const z = 25
        const top = heightAt(x, z)
        chunks.setVoxel(x, top + 1, z, BLOCK.noWalk)
    }
}

function standingPoint(heightAt: (x: number, z: number) => number, x: number, z: number): { x: number; y: number; z: number } {
    return { x: x + 0.5, y: heightAt(x, z) + 1, z: z + 0.5 }
}

function placeTree(
    chunks: ChunkManager,
    heightAt: (x: number, z: number) => number,
    cx: number,
    cz: number,
): void {
    const ground = heightAt(cx, cz)
    for (let y = 1; y <= 4; y++) chunks.setVoxel(cx, ground + y, cz, BLOCK.wood)
    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = 0; dy < 2; dy++) {
                if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && dy === 1) continue  // round corners
                chunks.setVoxel(cx + dx, ground + 4 + dy, cz + dz, BLOCK.leaf)
            }
        }
    }
    chunks.setVoxel(cx, ground + 6, cz, BLOCK.leaf)  // top puff
}

function placeHut(
    chunks: ChunkManager,
    heightAt: (x: number, z: number) => number,
    cx: number,
    cz: number,
): DoorMechanismConfig {
    const ground = heightAt(cx, cz)
    const yFloor = ground
    // 5×5 plank floor replaces the pad surface so it stays walkable by the
    // current kinematic player controller (no stair-step assist yet).
    for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
            chunks.setVoxel(cx + dx, yFloor, cz + dz, BLOCK.plank)
        }
    }
    // Walls 3 voxels tall around the floor; door is a 1-wide × 2-tall opening on the -Z side at dx=0.
    for (let dy = 1; dy <= 3; dy++) {
        for (let i = -2; i <= 2; i++) {
            const isDoor = i === 0 && dy <= 2
            if (!isDoor) chunks.setVoxel(cx + i, yFloor + dy, cz - 2, BLOCK.brick)
            chunks.setVoxel(cx + i, yFloor + dy, cz + 2, BLOCK.brick)
            chunks.setVoxel(cx - 2, yFloor + dy, cz + i, BLOCK.brick)
            chunks.setVoxel(cx + 2, yFloor + dy, cz + i, BLOCK.brick)
        }
    }
    // Plank roof (flat).
    for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
            chunks.setVoxel(cx + dx, yFloor + 4, cz + dz, BLOCK.plank)
        }
    }
    // Glow lantern hanging from the centre of the roof.
    chunks.setVoxel(cx, yFloor + 3, cz, BLOCK.glow)

    const blocks = [
        { pos: { x: cx, y: yFloor + 1, z: cz - 2 }, block: BLOCK.door },
        { pos: { x: cx, y: yFloor + 2, z: cz - 2 }, block: BLOCK.door },
    ]
    for (const { pos, block } of blocks) chunks.setVoxel(pos.x, pos.y, pos.z, block)
    return {
        position: { x: cx, y: yFloor + 1, z: cz - 2 },
        blocks,
    }
}

function placePistonDemo(
    chunks: ChunkManager,
    heightAt: (x: number, z: number) => number,
    x: number,
    z: number,
    trap = false,
): PistonMechanismConfig {
    const y = Math.max(heightAt(x, z), heightAt(x + 1, z)) + 1
    chunks.setVoxel(x, y - 1, z, BLOCK.plank)
    chunks.setVoxel(x + 1, y - 1, z, BLOCK.plank)
    chunks.setVoxel(x, y, z, BLOCK.brick)
    return {
        from: { x, y, z },
        to: { x: x + 1, y, z },
        block: BLOCK.brick,
        interval: trap ? 1.6 : 2.4,
        characterPolicy: trap ? 'push' : 'block',
    }
}

function placePistonCorridor(
    chunks: ChunkManager,
    x0: number,
    z0: number,
): {
    npc: { x: number; y: number; z: number }
    goal: { x: number; y: number; z: number }
    pistons: PistonMechanismConfig[]
} {
    const length = 12
    const width = 3
    const floorY = 5
    const standY = floorY + 1
    const pistons: PistonMechanismConfig[] = []

    for (let x = x0 - 1; x <= x0 + length; x++) {
        for (let z = z0 - 1; z <= z0 + width; z++) {
            chunks.setVoxel(x, floorY, z, BLOCK.plank)
            for (let y = standY; y <= standY + 2; y++) chunks.setVoxel(x, y, z, BLOCK.air)
        }
    }

    for (let x = x0 - 1; x <= x0 + length; x++) {
        for (let y = standY; y <= standY + 1; y++) {
            chunks.setVoxel(x, y, z0 - 1, BLOCK.brick)
            chunks.setVoxel(x, y, z0 + width, BLOCK.brick)
        }
    }
    for (let z = z0; z < z0 + width; z++) {
        chunks.setVoxel(x0 - 1, standY, z, BLOCK.glow)
        chunks.setVoxel(x0 + length, standY, z, BLOCK.glow)
    }

    const pistonSpecs = [
        { from: { x: x0 + 3, y: standY, z: z0 - 1 }, to: { x: x0 + 3, y: standY, z: z0 }, interval: 1.15 },
        { from: { x: x0 + 6, y: standY, z: z0 + width }, to: { x: x0 + 6, y: standY, z: z0 + width - 1 }, interval: 1.45 },
        { from: { x: x0 + 9, y: standY, z: z0 - 1 }, to: { x: x0 + 9, y: standY, z: z0 }, interval: 1.75 },
    ]

    for (const spec of pistonSpecs) {
        chunks.setVoxel(spec.from.x, spec.from.y, spec.from.z, BLOCK.brick)
        pistons.push({
            from: spec.from,
            to: spec.to,
            block: BLOCK.brick,
            interval: spec.interval,
            characterPolicy: 'block',
        })
    }

    return {
        npc: { x: x0 + 0.5, y: standY, z: z0 + 1.5 },
        goal: { x: x0 + length - 1 + 0.5, y: standY, z: z0 + 1.5 },
        pistons,
    }
}
