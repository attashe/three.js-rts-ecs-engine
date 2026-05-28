import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { ScriptEntry } from '../engine/script/types'
import { generatePlatformerLevel, type LevelMeta } from './level'
import { defineLevel, outdoorDay, terrain, zoneBox } from './level-builder'
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
    {
        id: 'paid-portal-shrine',
        name: 'paid-portal-shrine.js',
        sourcePath: 'examples/scripts/paid-portal-shrine.js',
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
    const pondWaterY = groundY
    const t = terrain(chunks, { size, groundY })

    t.ground({ top: gardenTopBlock })
        .path({ points: [{ x: 3, z: 10 }, { x: 17, z: 10 }], width: 3, block: BLOCK.sand })
        .path({ points: [{ x: 10, z: 5 }, { x: 10, z: 15 }], width: 3, block: BLOCK.sand })
        .path({ points: [{ x: 4.5, z: 4 }, { x: 4.5, z: 15 }], width: 2.2, block: BLOCK.sand })
        .path({ points: [{ x: 15.5, z: 4 }, { x: 15.5, z: 15 }], width: 2.2, block: BLOCK.sand })
        .pond({
            center: { x: 10, z: 10 },
            radiusX: 3.7,
            radiusZ: 3.2,
            waterY: pondWaterY,
            shoreWidth: 1.5,
            shoreBlock: BLOCK.sand,
            bedBlock: BLOCK.sand,
        })

    t
        // Arrival pad from the demo - outside the return portal so the player
        // doesn't bounce straight back.
        .fill([3, 6], [groundY, groundY], [9, 12], BLOCK.plank)
        .fill([4, 5], [groundY, groundY], [10, 10], BLOCK.door)
        .fill([8, 12], [groundY, groundY], [10, 10], BLOCK.plank)
        .fill([9, 11], [groundY, groundY], [8, 8], BLOCK.plank)
        .fill([9, 11], [groundY, groundY], [12, 12], BLOCK.plank)
        // Return portal pad + two non-lighting marker posts.
        .fill([14, 17], [groundY, groundY], [8, 11], BLOCK.stone)
        .fill([15, 16], [groundY, groundY], [9, 10], BLOCK.door)
        .fill([14, 14], [groundY + 1, groundY + 3], [8, 8], BLOCK.door)
        .fill([17, 17], [groundY + 1, groundY + 3], [11, 11], BLOCK.door)
        // Low wooden rails frame the park without blocking the portal path.
        .fill([2, 2], [groundY + 1, groundY + 1], [5, 14], BLOCK.wood)
        .fill([17, 17], [groundY + 1, groundY + 1], [5, 7], BLOCK.wood)
        .fill([17, 17], [groundY + 1, groundY + 1], [12, 14], BLOCK.wood)

    t.fill([8, 12], [pondWaterY, pondWaterY], [10, 10], BLOCK.plank)
        .fill([9, 11], [pondWaterY, pondWaterY], [8, 8], BLOCK.plank)
        .fill([9, 11], [pondWaterY, pondWaterY], [12, 12], BLOCK.plank)

    const zones: Zone[] = [
        {
            id: TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Arrival from Demo',
            ...zoneBox({ x: 5, z: 11 }, { x: 0.75, z: 0.75 }, groundY + 1, groundY + 2.8),
        },
        {
            id: 'zone.teleport-garden.portal.demo',
            kind: 'portal',
            label: 'Gate back to Demo',
            ...zoneBox({ x: 16, z: 10 }, { x: 1, z: 1 }, groundY + 1, groundY + 3),
            triggerSources: ['player'],
            portal: {
                targetLevelId: DEMO_LEVEL_ID,
                targetArrivalId: DEMO_FROM_GARDEN_ARRIVAL_ID,
            },
        },
    ]

    return defineLevel({
        name: 'Teleport Garden',
        size,
        spawn: t.stand(4.9, 11),
        coinPiles: [
            { position: { x: 10, y: groundY + 2, z: 10 }, amount: 3 },
            { position: { x: 13.8, y: groundY + 1, z: 6.3 }, amount: 1 },
            { position: { x: 6.2, y: groundY + 1, z: 14.8 }, amount: 1 },
        ],
        zones,
        environment: { soundId: 'music.background', volume: 0.24 },
        ambient: outdoorDay({
            timeOfDay: 16.0,
            skyTint: [1, 0.96, 0.9],
            sunIntensityMul: 0.95,
            cloudCoverage: 0.2,
        }),
        weatherZones: [
            {
                id: 'fx.teleport-garden.pond-water',
                label: 'Garden Pond Surface',
                presetId: 'water',
                position: { x: 10, y: groundY + 0.35, z: 10 },
                size: { x: 8, y: 1.4, z: 7 },
                enabled: true,
                addSound: true,
                soundVolume: 0.22,
            },
            {
                id: 'fx.teleport-garden.falling-leaves',
                label: 'Falling Leaves',
                presetId: 'leaves',
                position: { x: 10, y: groundY + 5.2, z: 10 },
                size: { x: 15, y: 5, z: 13 },
                enabled: true,
                addSound: false,
                soundVolume: 0,
            },
        ],
        props: [
            { id: 'teleport-garden:flower:west-a', kind: 'flower', position: t.stand(7.3, 6.4), yaw: 0.2, scale: 1, gridAligned: false },
            { id: 'teleport-garden:flower:east-a', kind: 'flower-2', position: t.stand(12.7, 6.8), yaw: 0.6, scale: 1, gridAligned: false },
            { id: 'teleport-garden:flower:west-b', kind: 'flower-3', position: t.stand(7.5, 14.2), yaw: 1.1, scale: 0.95, gridAligned: false },
            { id: 'teleport-garden:flower:east-b', kind: 'flower-2', position: t.stand(12.8, 14.1), yaw: 2.4, scale: 1.05, gridAligned: false },
            { id: 'teleport-garden:bush:north-west', kind: 'bush', position: t.stand(3.3, 5.2), yaw: 0.4, scale: 1.25, gridAligned: false },
            { id: 'teleport-garden:bush:north-east', kind: 'bush-2', position: t.stand(16.5, 5.4), yaw: 1.4, scale: 1.15, gridAligned: false },
            { id: 'teleport-garden:bush:south-west', kind: 'bush-3', position: t.stand(3.5, 14.4), yaw: 2.1, scale: 1.2, gridAligned: false },
            { id: 'teleport-garden:mushroom:west', kind: 'mushroom', position: t.stand(13.3, 13.6), yaw: 0.1, scale: 0.95, gridAligned: false },
            { id: 'teleport-garden:mushroom:south', kind: 'mushroom-2', position: t.stand(6.9, 13.3), yaw: 0.8, scale: 0.85, gridAligned: false },
            { id: 'teleport-garden:picnic-table', kind: 'table-2', position: t.stand(5.7, 14.8), yaw: Math.PI * 0.5, scale: 1.05, gridAligned: false },
            { id: 'teleport-garden:chair:picnic-a', kind: 'chair-2', position: t.stand(5.6, 13.6), yaw: Math.PI * 0.85, scale: 1, gridAligned: false },
            { id: 'teleport-garden:chair:picnic-b', kind: 'chair', position: t.stand(5.8, 16), yaw: Math.PI * 0.1, scale: 1, gridAligned: false },
            { id: 'teleport-garden:sundial', kind: 'sundial', position: t.stand(15.2, 14.2), yaw: Math.PI * 0.2, scale: 0.9, gridAligned: false },
            { id: 'teleport-garden:book', kind: 'book-2', position: t.stand(5.2, 14.4), yaw: Math.PI * 0.2, scale: 0.9, gridAligned: false },
        ],
    })
}

function gardenTopBlock(x: number, z: number): number {
    const edge = x <= 1 || z <= 1 || x >= 18 || z >= 18
    if (edge) return BLOCK.stone
    if ((x * 13 + z * 7) % 29 === 0) return BLOCK.sand
    return BLOCK.grass
}

function requiredScriptSource(sources: ProceduralScriptSources, sourcePath: string): string {
    const source = sources[sourcePath]
    if (typeof source !== 'string') {
        throw new Error(`Missing procedural script source "${sourcePath}"`)
    }
    return source
}
