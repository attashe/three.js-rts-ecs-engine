import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { ScriptEntry } from '../engine/script/types'
import { generatePlatformerLevel, type LevelMeta } from './level'
import { normalizeNpcConfig, type NpcConfig } from './npcs/npc-types'
import { defineLevel, outdoorDay, terrain, zoneBox } from './level-builder'
import {
    generateStructureAsset,
    placeStructureAsset,
    prefabSource,
    proceduralSource,
    structurePropPlacements,
    type StructureRotation,
    type StructureSource,
} from '../procedural-structures'
import type { EditorProp } from './props/prop-types'
import {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
} from './procedural-level-ids'

export {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
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
    {
        id: LARGE_TOWN_LEVEL_ID,
        file: `${LARGE_TOWN_LEVEL_ID}.vplevel`,
        name: 'Large Town',
        generate: generateLargeTownLevel,
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
        npcs: [...meta.npcs, ...demoNpcs()],
        scripts: createDemoScripts(scriptSources),
    }
}

/**
 * Three NPCs on the front lawn showcasing the script-driven brain (the scripts
 * are injected with NPC_ID / NPC_NAME / NPC_INTERACTION and use the `npc.*` API):
 *   - Maren — a peaceful wanderer who patrols and never fights.
 *   - Patrol Guard — patrols and chases/attacks the player on sight.
 *   - Sentry Voss — stands guard and stays friendly, but turns hostile if you
 *     pick the insulting reply in his dialogue.
 */
function demoNpcs(): NpcConfig[] {
    return [
        // 1) Peaceful patrol: walks a route, hostile to no one.
        normalizeNpcConfig({
            id: 'demo-wanderer',
            name: 'Maren',
            model: 'keeper',
            position: { x: 7, y: 5, z: 10 },
            equipment: { handR: null, handL: null },
            interactionEnabled: false,
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setWaypoints(NPC_ID, [{ x: 4, y: 5, z: 10 }, { x: 11, y: 5, z: 10 }])`,
                `  log(NPC_NAME + ' wanders the lawn, minding its own business.')`,
                `})`,
            ].join('\n'),
        }),
        // 2) Patrol + attack: hostile to the player, chases on sight.
        normalizeNpcConfig({
            id: 'demo-guard',
            name: 'Patrol Guard',
            model: 'keeper',
            position: { x: 8, y: 5, z: 4 }, // grass plane stands at groundY(4)+1
            equipment: { handR: 'sword', handL: null },
            interactionEnabled: false,
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 6)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 6, y: 5, z: 4 }, { x: 11, y: 5, z: 4 }])`,
                `})`,
                `on('npc-spotted-enemy', (e) => {`,
                `  if (e.npcId === NPC_ID) log(NPC_NAME + ' spotted you!')`,
                `})`,
            ].join('\n'),
        }),
        // 3) Friendly until insulted: a standing sentry that turns hostile on the
        //    wrong dialogue choice.
        normalizeNpcConfig({
            id: 'demo-sentry',
            name: 'Sentry Voss',
            model: 'keeper',
            position: { x: 14, y: 5, z: 7 },
            yaw: Math.PI, // face south toward the approaching player
            equipment: { handR: 'sword', handL: null },
            interactionEnabled: true,
            interactionRadius: 2.4,
            interactionPrompt: 'Speak',
            scriptSource: [
                `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {`,
                `  if (!npc.exists(NPC_ID)) return`,
                `  const reply = await ui.dialogue({`,
                `    npc: { name: NPC_NAME, avatar: 'keeper' },`,
                `    lines: [{`,
                `      speaker: 'npc',`,
                `      text: 'State your business, traveller.',`,
                `      choices: [`,
                `        { id: 'polite', text: 'Just passing through, friend.' },`,
                `        { id: 'insult', text: 'Out of my way, fool.' },`,
                `      ],`,
                `    }],`,
                `  })`,
                `  if (reply.choiceId === 'insult') {`,
                `    ui.say(NPC_INTERACTION, 'You will regret that.', { seconds: 2 })`,
                `    npc.setPerceptionRadius(NPC_ID, 8)`,
                `    npc.setHostile(NPC_ID, 'player', true)`,
                `  } else {`,
                `    ui.say(NPC_INTERACTION, 'Safe travels, then.', { seconds: 2 })`,
                `  }`,
                `})`,
            ].join('\n'),
        }),
    ]
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
            radiusX: 4.6,
            radiusZ: 3.9,
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
        // Return portal pad + two non-lighting marker posts.
        .fill([14, 17], [groundY, groundY], [8, 11], BLOCK.stone)
        .fill([15, 16], [groundY, groundY], [9, 10], BLOCK.door)
        .fill([14, 14], [groundY + 1, groundY + 3], [8, 8], BLOCK.door)
        .fill([17, 17], [groundY + 1, groundY + 3], [11, 11], BLOCK.door)
        // Low wooden rails frame the park without blocking the portal path.
        .fill([2, 2], [groundY + 1, groundY + 1], [5, 14], BLOCK.wood)
        .fill([17, 17], [groundY + 1, groundY + 1], [5, 7], BLOCK.wood)
        .fill([17, 17], [groundY + 1, groundY + 1], [12, 14], BLOCK.wood)

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

/**
 * Large Town — a 512-cell boulevard lined with procedural + prefab
 * structures. Its job is to exercise the chunk renderer's mesh streaming:
 * at 512 cells long it far exceeds the in-game mesh window, so walking its
 * length visibly streams chunks in ahead of the player and out behind.
 * Doubles as a showcase for the structure-asset placement API
 * (`placeStructureAsset`) — the same one the editor's Structures tab uses.
 */
export function generateLargeTownLevel(chunks: ChunkManager): LevelMeta {
    const length = 512 // X span — longer than the mesh window so it streams
    const depth = 48 // Z span — a 2-chunk-deep strip
    const groundY = 4
    const roadZ = 24
    const t = terrain(chunks, { size: length, groundY })

    // Ground strip (dirt body + grass top) running the length of the boulevard.
    t.fill([0, length - 1], [0, groundY - 1], [0, depth - 1], BLOCK.dirt)
        .fill([0, length - 1], [groundY, groundY], [0, depth - 1], BLOCK.grass)
        .path({ points: [{ x: 4, z: roadZ }, { x: length - 4, z: roadZ }], width: 6, block: BLOCK.sand })

    // Structures lining the avenue, alternating north / south. Stamped through
    // the same asset-placement API the editor uses, so footprints are
    // predictable and the street reads as built-up.
    const northZ = 10
    const southZ = depth - 12
    const plots: Array<{ source: StructureSource; rotation: StructureRotation }> = [
        { source: proceduralSource('house', 1011), rotation: 0 },
        { source: prefabSource('well'), rotation: 0 },
        { source: proceduralSource('tower', 1022), rotation: 0 },
        { source: prefabSource('campfire'), rotation: 0 },
        { source: proceduralSource('house', 1033), rotation: 90 },
        { source: prefabSource('banner-arch'), rotation: 90 },
        { source: proceduralSource('tower', 1044), rotation: 0 },
        { source: proceduralSource('house', 1055), rotation: 180 },
        { source: prefabSource('well'), rotation: 0 },
        { source: proceduralSource('house', 1066), rotation: 270 },
    ]
    // Each structure is stamped as solid voxels, but its ground plantings are
    // recovered as real flower / mushroom prop meshes (`structurePropPlacements`)
    // instead of the flat cubes the generator emits — so the verges read as
    // planted, not pixelated.
    const props: EditorProp[] = []
    let plotX = 56
    for (let i = 0; i < plots.length; i++) {
        const plot = plots[i]!
        const z = i % 2 === 0 ? northZ : southZ
        const asset = generateStructureAsset(plot.source, { palette: chunks.palette, structuralOnly: true })
        const transform = {
            origin: { x: plotX, y: groundY + 1, z },
            rotation: plot.rotation,
            anchor: 'bottom-center' as const,
        }
        placeStructureAsset(chunks, asset, transform)
        props.push(...structurePropPlacements(asset, transform, `large-town:plot-${i}`))
        plotX += 48
    }

    // West-end plaza: a stone pad, a return portal gate, and the portal volume.
    t.fill([4, 14], [groundY, groundY], [roadZ - 4, roadZ + 4], BLOCK.stone)
    const gate = generateStructureAsset(prefabSource('portal-gate'), { palette: chunks.palette })
    placeStructureAsset(chunks, gate, {
        origin: { x: 8, y: groundY + 1, z: roadZ },
        rotation: 90,
        anchor: 'bottom-center',
    })

    const railY = groundY + 1
    const railZ = roadZ + 2
    for (let x = 18; x <= length - 18; x++) {
        chunks.setVoxel(x, railY, railZ, BLOCK.rail)
    }
    // A compact embankment gives the boulevard cart an explicit uphill/downhill
    // section for testing terrain-following rails in the large streaming level.
    const railHillStart = 128
    const railHillEnd = 138
    t.fill([railHillStart, railHillEnd], [railY, railY], [railZ - 1, railZ + 1], BLOCK.grass)
    for (let x = railHillStart; x <= railHillEnd; x++) {
        chunks.setVoxel(x, railY + 1, railZ, BLOCK.rail)
    }
    // Small station pads make the rail readable from the arrival portal and
    // near the far end without blocking the sand boulevard.
    t.fill([16, 22], [groundY, groundY], [railZ - 1, railZ + 1], BLOCK.plank)
        .fill([length - 24, length - 16], [groundY, groundY], [railZ - 1, railZ + 1], BLOCK.plank)

    const zones: Zone[] = [
        {
            id: TOWN_FROM_DEMO_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Arrival from Demo',
            ...zoneBox({ x: 16, z: roadZ }, { x: 1, z: 1 }, groundY + 1, groundY + 2.8),
        },
        {
            id: 'zone.large-town.portal.demo',
            kind: 'portal',
            label: 'Gate back to Demo',
            ...zoneBox({ x: 8, z: roadZ }, { x: 1.5, z: 1.5 }, groundY + 1, groundY + 3),
            triggerSources: ['player'],
            portal: {
                targetLevelId: DEMO_LEVEL_ID,
                targetArrivalId: DEMO_FROM_TOWN_ARRIVAL_ID,
            },
        },
    ]

    return defineLevel({
        name: 'Large Town',
        size: length,
        spawn: t.stand(16, roadZ),
        props,
        zones,
        railCarts: [{
            id: 'large-town:boulevard-cart',
            railCell: { x: 20, y: railY, z: railZ },
            front: 'east',
            speed: 8,
            interactionRadius: 2.25,
            enabled: true,
        }],
        npcs: [{
            id: 'large-town:large-troll-curator',
            name: 'Curator Brannok',
            model: 'large-troll',
            beard: 'pointed',
            position: t.stand(34, roadZ - 6),
            yaw: 0,
            scale: 1,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.72,
            colliderHeight: 3.2,
            interactionEnabled: true,
            interactionRadius: 3.4,
            interactionPrompt: 'Greet',
            equipment: { handR: null, handL: 'book' },
            voice: { preset: 'troll', seed: 'curator-brannok', volume: 0.62, rate: 0.86 },
            scriptEnabled: true,
            scriptSource: [
                `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {`,
                `  ui.say(NPC_INTERACTION, 'Mind the rail line. Every city keeps its rhythm.', { seconds: 4 })`,
                `})`,
            ].join('\n'),
        }],
        coinPiles: [
            { position: { x: 80, y: groundY + 1, z: roadZ }, amount: 3 },
            { position: { x: 240, y: groundY + 1, z: roadZ }, amount: 3 },
            { position: { x: 400, y: groundY + 1, z: roadZ }, amount: 3 },
        ],
        environment: { soundId: 'music.background', volume: 0.2 },
        ambient: outdoorDay({ timeOfDay: 14 }),
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
