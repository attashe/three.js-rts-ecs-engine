import { BLOCK, type ChunkManager } from '../engine/voxel'
import type { DoorMechanismConfig, PistonMechanismConfig } from './mechanisms'
import type { StoneFallSpawnerConfig } from './moving-objects'

export interface LevelMeta {
    /** World-space spawn position (X, Y, Z). Y is standing height (one above topmost solid). */
    spawn: { x: number; y: number; z: number }
    /** Sample NPC position for visual/demo composition. */
    npc: { x: number; y: number; z: number }
    dummy: { x: number; y: number; z: number }
    wanderers: { x: number; y: number; z: number }[]
    pistonTester: { x: number; y: number; z: number }
    pistonTesterGoal: { x: number; y: number; z: number }
    stoneSpawners: StoneFallSpawnerConfig[]
    coins: { x: number; y: number; z: number }
    potion: { x: number; y: number; z: number }
    doors: DoorMechanismConfig[]
    pistons: PistonMechanismConfig[]
    /** XZ extent of the generated level, used by the demo to centre the camera. */
    size: number
}

/**
 * Procedural island for the Phase 3 playable demo. ~48×48 of varied terrain
 * with stone/dirt/grass layering, sandy fringe, scattered trees, a small
 * brick-and-plank hut with a glowstone lantern, and a flat spawn at the
 * island centre.
 *
 * The generator uses two cheap sine-product "noise" terms plus a radial
 * bump for the island shape — fully deterministic, no PRNG seed needed.
 * Swap for real Perlin/simplex when level variety matters.
 */
export function generateDemoLevel(chunks: ChunkManager): LevelMeta {
    const size = 48
    const half = size / 2

    const heightAt = (x: number, z: number): number => {
        const n1 = Math.sin(x * 0.13) * Math.cos(z * 0.17)
        const n2 = Math.sin((x + z) * 0.21) * 0.5
        const radial = Math.hypot(x - half, z - half) / half
        const island = Math.max(0, 1 - radial * 1.15)
        return Math.floor(n1 * 0.6 + n2 * 0.6 + island * 4 + 1)
    }

    // Terrain.
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const top = heightAt(x, z)
            for (let y = 0; y <= top; y++) {
                let block: number = BLOCK.stone
                if (y === top) {
                    block = top <= 1 ? BLOCK.sand : BLOCK.grass
                } else if (y > top - 3) {
                    block = BLOCK.dirt
                }
                chunks.setVoxel(x, y, z, block)
            }
        }
    }

    // Trees scattered at non-trivial positions.
    placeTree(chunks, heightAt, 8, 8)
    placeTree(chunks, heightAt, 12, 35)
    placeTree(chunks, heightAt, 38, 12)
    placeTree(chunks, heightAt, 35, 38)
    placeTree(chunks, heightAt, 30, 22)

    // Hut at (24, ?, 32): door faces south (-Z), glowstone lantern inside.
    const door = placeHut(chunks, heightAt, 24, 32)
    const trapPiston = placePistonDemo(chunks, heightAt, 27, 24, true)
    const corridor = placePistonCorridor(chunks, 34, 16)
    const stoneSpawners = placeStoneCliff(chunks, 8, 18)
    placeNoWalkZone(chunks, heightAt)

    // Spawn at the island centre.
    const sx = half
    const sz = half
    const sy = heightAt(sx, sz) + 1

    const nx = 27
    const nz = 25
    const ny = heightAt(nx, nz) + 1
    const dummy = standingPoint(heightAt, 22, 25)
    const wanderers = [
        standingPoint(heightAt, 16, 28),
        standingPoint(heightAt, 17, 30),
        standingPoint(heightAt, 18, 27),
        standingPoint(heightAt, 15, 31),
    ]
    const coins = standingPoint(heightAt, 25, 22)
    const potion = standingPoint(heightAt, 29, 27)

    return {
        spawn: { x: sx + 0.5, y: sy, z: sz + 0.5 },
        npc: { x: nx + 0.5, y: ny, z: nz + 0.5 },
        dummy,
        wanderers,
        pistonTester: corridor.npc,
        pistonTesterGoal: corridor.goal,
        stoneSpawners,
        coins,
        potion,
        doors: [door],
        pistons: [trapPiston, ...corridor.pistons],
        size,
    }
}

function placeStoneCliff(
    chunks: ChunkManager,
    x0: number,
    z0: number,
): StoneFallSpawnerConfig[] {
    const cliffTop = 9
    const valleyTop = 3
    const width = 7

    for (let x = x0 - 2; x <= x0 + 3; x++) {
        for (let z = z0 - 2; z <= z0 + width + 1; z++) {
            for (let y = 0; y <= cliffTop; y++) chunks.setVoxel(x, y, z, y === cliffTop ? BLOCK.stone : BLOCK.dirt)
            for (let y = cliffTop + 1; y <= cliffTop + 4; y++) chunks.setVoxel(x, y, z, BLOCK.air)
        }
    }

    for (let x = x0 + 4; x <= x0 + 12; x++) {
        for (let z = z0 - 2; z <= z0 + width + 1; z++) {
            for (let y = 0; y <= valleyTop; y++) chunks.setVoxel(x, y, z, y === valleyTop ? BLOCK.grass : BLOCK.dirt)
            for (let y = valleyTop + 1; y <= cliffTop + 3; y++) chunks.setVoxel(x, y, z, BLOCK.air)
        }
    }

    // Low side lips keep the demo stones in the readable test area without forming stairs.
    for (let x = x0 + 1; x <= x0 + 12; x++) {
        chunks.setVoxel(x, valleyTop + 1, z0 - 2, BLOCK.noWalk)
        chunks.setVoxel(x, valleyTop + 1, z0 + width + 1, BLOCK.noWalk)
    }

    return [
        {
            position: { x: x0 + 2.5, y: cliffTop + 1.1, z: z0 + 1.5 },
            velocity: { x: 3.2, y: 0.2, z: 0.25 },
            interval: 2.25,
            jitter: 0.35,
        },
        {
            position: { x: x0 + 1.8, y: cliffTop + 1.1, z: z0 + 4.8 },
            velocity: { x: 2.7, y: 0.3, z: -0.15 },
            interval: 3.1,
            jitter: 0.25,
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
    const yFloor = ground + 1
    // 5×5 plank floor, raised one above terrain.
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
    const floorY = 6
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
