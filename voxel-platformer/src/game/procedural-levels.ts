import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { ScriptEntry } from '../engine/script/types'
import { DEFAULT_OUTDOOR_FOG_DENSITY_MUL } from './weather-config'
import { generatePlatformerLevel, type LevelMeta } from './level'
import { DEFAULT_PLAYER_SETTINGS } from './player-settings'
import {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
} from './procedural-level-ids'

export {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
}

export interface ProceduralLevelScriptFile {
    readonly id: string
    readonly name: string
    readonly sourcePath: string
}

export type ProceduralScriptSources = Partial<Record<string, string>>

export interface ProceduralLevelDefinition {
    readonly id: string
    readonly file: string
    readonly name: string
    generate(chunks: ChunkManager, scripts: ProceduralScriptSources): LevelMeta
}

export const PROCEDURAL_LEVEL_SCRIPT_FILES = [
    {
        id: 'demo-quest',
        name: 'demo-quest.js',
        sourcePath: 'examples/scripts/demo-quest.js',
    },
    {
        id: 'lantern-trial',
        name: 'lantern-trial.js',
        sourcePath: 'examples/scripts/lantern-trial.js',
    },
    {
        id: 'haste-shrine',
        name: 'haste-shrine.js',
        sourcePath: 'examples/scripts/haste-shrine.js',
    },
] as const satisfies readonly ProceduralLevelScriptFile[]

export const PROCEDURAL_LEVEL_DEFINITIONS: readonly ProceduralLevelDefinition[] = [
    {
        id: DEMO_LEVEL_ID,
        file: `${DEMO_LEVEL_ID}.vplevel`,
        name: 'Demo',
        generate: generateDemoProceduralLevel,
    },
    {
        id: TELEPORT_GARDEN_LEVEL_ID,
        file: `${TELEPORT_GARDEN_LEVEL_ID}.vplevel`,
        name: 'Teleport Garden',
        generate: generateTeleportGardenLevel,
    },
]

export const PROCEDURAL_LEVEL_IDS = PROCEDURAL_LEVEL_DEFINITIONS.map((level) => level.id)

export function getProceduralLevelDefinition(id: string): ProceduralLevelDefinition | null {
    return PROCEDURAL_LEVEL_DEFINITIONS.find((level) => level.id === id) ?? null
}

export function generateProceduralLevel(
    id: string,
    chunks: ChunkManager,
    scriptSources: ProceduralScriptSources,
): LevelMeta {
    const definition = getProceduralLevelDefinition(id)
    if (!definition) throw new Error(`Unknown procedural level "${id}"`)
    return definition.generate(chunks, scriptSources)
}

export function generateDemoProceduralLevel(
    chunks: ChunkManager,
    scriptSources: ProceduralScriptSources,
): LevelMeta {
    const meta = generatePlatformerLevel(chunks)
    return {
        ...meta,
        scripts: createDemoScripts(scriptSources),
    }
}

export function createDemoScripts(scriptSources: ProceduralScriptSources): ScriptEntry[] {
    return PROCEDURAL_LEVEL_SCRIPT_FILES.map((file) => ({
        id: file.id,
        name: file.name,
        source: requiredScriptSource(scriptSources, file.sourcePath),
        fromFile: true,
        sourcePath: file.sourcePath,
    }))
}

export function generateTeleportGardenLevel(chunks: ChunkManager): LevelMeta {
    const size = 20
    const groundY = 4

    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < groundY; y++) {
                chunks.setVoxel(x, y, z, y === groundY - 1 ? BLOCK.dirt : BLOCK.stone)
            }
            chunks.setVoxel(x, groundY, z, gardenTopBlock(x, z))
        }
    }

    // A simple path between the incoming arrival pad and the return portal.
    for (let x = 3; x <= 17; x++) {
        for (let z = 9; z <= 11; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.sand)
        }
    }
    for (let z = 6; z <= 14; z++) {
        for (let x = 9; x <= 11; x++) {
            chunks.setVoxel(x, groundY, z, BLOCK.sand)
        }
    }

    // Shallow water garden to make the destination visually distinct and to
    // exercise non-blocking water movement when the level is opened directly.
    for (let z = 6; z <= 14; z++) {
        for (let x = 7; x <= 13; x++) {
            const dx = x - 10
            const dz = z - 10
            if (dx * dx + dz * dz <= 12.25) {
                chunks.setVoxel(x, groundY + 1, z, BLOCK.water)
            }
        }
    }

    // Arrival pad from the demo. It is intentionally outside the return
    // portal volume so the player does not bounce back immediately.
    for (let x = 3; x <= 6; x++) {
        for (let z = 9; z <= 12; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.plank)
        }
    }
    chunks.setVoxel(4, groundY, 10, BLOCK.door)
    chunks.setVoxel(5, groundY, 10, BLOCK.door)

    // Return portal pad and two glowing posts.
    for (let x = 14; x <= 17; x++) {
        for (let z = 8; z <= 11; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.stone)
        }
    }
    for (let x = 15; x <= 16; x++) {
        for (let z = 9; z <= 10; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.door)
        }
    }
    for (let y = groundY + 1; y <= groundY + 3; y++) {
        chunks.setVoxel(14, y, 8, BLOCK.door)
        chunks.setVoxel(17, y, 11, BLOCK.door)
    }

    const zones: Zone[] = [
        {
            id: TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Arrival from Demo',
            min: { x: 4.25, y: groundY + 1, z: 10.25 },
            max: { x: 5.75, y: groundY + 2.8, z: 11.75 },
        },
        {
            id: 'zone.teleport-garden.portal.demo',
            kind: 'portal',
            label: 'Gate back to Demo',
            min: { x: 15, y: groundY + 1, z: 9 },
            max: { x: 17, y: groundY + 3, z: 11 },
            triggerSources: ['player'],
            portal: {
                targetLevelId: DEMO_LEVEL_ID,
                targetArrivalId: DEMO_FROM_GARDEN_ARRIVAL_ID,
            },
        },
    ]

    return {
        name: 'Teleport Garden',
        spawn: { x: 4.9, y: groundY + 1, z: 11 },
        player: DEFAULT_PLAYER_SETTINGS,
        stoneSpawners: [],
        coinPiles: [
            { position: { x: 10, y: groundY + 2, z: 10 }, amount: 5 },
        ],
        pistons: [],
        zones,
        soundSources: [],
        soundZones: [],
        environment: { soundId: 'music.background', volume: 0.24 },
        ambientWeather: {
            presetId: 'clear',
            state: {
                mode: 'outdoor',
                timeOfDay: 16.0,
                cycleEnabled: true,
                cycleSeconds: 420,
                skyTint: [1, 0.96, 0.9],
                sunIntensityMul: 0.95,
                fogDensityMul: DEFAULT_OUTDOOR_FOG_DENSITY_MUL,
                cloudCoverage: 0.2,
                rainOn: false,
                snowOn: false,
                lightningOn: false,
            },
        },
        weatherZones: [],
        props: [
            {
                id: 'teleport-garden:bush:west',
                kind: 'bush',
                position: { x: 6.5, y: groundY + 1, z: 6.5 },
                yaw: 0.4,
                scale: 1.25,
                gridAligned: false,
            },
            {
                id: 'teleport-garden:bush:east',
                kind: 'bush-2',
                position: { x: 13.3, y: groundY + 1, z: 13.2 },
                yaw: -0.6,
                scale: 1.1,
                gridAligned: false,
            },
            {
                id: 'teleport-garden:flower:ring-a',
                kind: 'flower',
                position: { x: 8.2, y: groundY + 1, z: 13.5 },
                yaw: 0.1,
                scale: 1,
                gridAligned: false,
            },
            {
                id: 'teleport-garden:flower:ring-b',
                kind: 'flower-2',
                position: { x: 12.4, y: groundY + 1, z: 6.5 },
                yaw: 0.9,
                scale: 1,
                gridAligned: false,
            },
            {
                id: 'teleport-garden:mushroom:path',
                kind: 'mushroom-3',
                position: { x: 7.6, y: groundY + 1, z: 9.4 },
                yaw: -0.35,
                scale: 0.9,
                gridAligned: false,
            },
        ],
        npcs: [],
        scripts: [],
        size,
    }
}

function gardenTopBlock(x: number, z: number): number {
    const edge = x <= 1 || z <= 1 || x >= 18 || z >= 18
    if (edge) return BLOCK.stone
    if ((x + z) % 7 === 0) return BLOCK.sand
    return BLOCK.grass
}

function requiredScriptSource(sources: ProceduralScriptSources, sourcePath: string): string {
    const source = sources[sourcePath]
    if (typeof source !== 'string') {
        throw new Error(`Missing procedural script source "${sourcePath}"`)
    }
    return source
}
