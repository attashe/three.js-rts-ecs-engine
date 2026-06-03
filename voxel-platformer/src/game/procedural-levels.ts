import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { ScriptEntry } from '../engine/script/types'
import { generatePlatformerLevel, playerSettingsWithHighJumpDisabled, type LevelMeta } from './level'
import {
    HIGH_JUMP_BOOTS_ITEM_ID,
    HIGH_JUMP_BOOTS_ITEM_OPTIONS,
    HIGH_JUMP_BOOTS_NAME,
} from './high-jump-boots'
import { normalizeNpcConfig, type NpcConfig } from './npcs/npc-types'
import { defineLevel, outdoorDay, terrain, zoneBox } from './level-builder'
import type { CameraShot, Cinematic } from './cinematics/cinematic-types'
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
    ARENA_FROM_DEMO_ARRIVAL_ID,
    COMBAT_ARENA_LEVEL_ID,
    DEMO_FROM_ARENA_ARRIVAL_ID,
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
} from './procedural-level-ids'

export {
    ARENA_FROM_DEMO_ARRIVAL_ID,
    COMBAT_ARENA_LEVEL_ID,
    DEMO_FROM_ARENA_ARRIVAL_ID,
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
    {
        id: 'cliff-lift-repair',
        name: 'cliff-lift-repair.js',
        sourcePath: 'examples/scripts/cliff-lift-repair.js',
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
    {
        id: COMBAT_ARENA_LEVEL_ID,
        file: `${COMBAT_ARENA_LEVEL_ID}.vplevel`,
        name: 'Combat Arena',
        generate: generateCombatArenaLevel,
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
 * NPCs on the front lawn. Combat tests live in the separate combat arena, but
 * Sentry Voss keeps one opt-in hostile dialogue branch as a compact systems
 * smoke test.
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
        // 2) Friendly until insulted: a standing sentry that turns hostile on
        //    the wrong dialogue choice.
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
                `    audio.play('music.amb.tension', { fade: 1.5 })`,
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

/**
 * "Garden arrival" — a one-shot establishing cinematic played the first time
 * the player teleports into the garden (the client's `playOnStart` guard keeps
 * it from replaying on return trips). It orbits the camera a full turn around
 * the garden centre while three lines of text fade in over the top, swapping to
 * the hopeful Menu theme for the reveal and crossfading back to the garden bed
 * at the end.
 *
 * The orbit is expressed as discrete camera shots placed on a circle and tweened
 * between — see the "orbit step" enhancement proposal for a cleaner primitive.
 */
function gardenIntroCinematic(size: number, groundY: number): Cinematic {
    const center = { x: size / 2, y: groundY + 1, z: size / 2 }
    const radius = size * 0.95
    const camY = groundY + 11
    const zoom = 0.78
    const shotAt = (deg: number): CameraShot => {
        const a = (deg * Math.PI) / 180
        return {
            position: { x: center.x + Math.cos(a) * radius, y: camY, z: center.z + Math.sin(a) * radius },
            target: { ...center },
            zoom,
        }
    }
    return {
        id: 'garden-intro',
        name: 'Garden arrival',
        playOnStart: true,
        letterbox: true,
        freezePlayer: true,
        steps: [
            // Swap to the reveal theme; restored to the garden bed at the end.
            { id: 'music', type: 'sound', wait: false, soundId: 'music.theme.menu', fade: 1.5 },
            // Establishing move from the spawn view onto the orbit ring, then a
            // full turn. Camera steps block (▶) so the rotation is continuous;
            // subtitles run alongside (‖) so text floats over the moving shot.
            { id: 'cam0', type: 'camera', wait: true, duration: 2.2, ease: 'easeOut', shot: shotAt(20) },
            { id: 'text1', type: 'subtitle', wait: false, duration: 3.5, text: 'The Teleport Garden' },
            { id: 'cam1', type: 'camera', wait: true, duration: 2.6, ease: 'easeInOut', shot: shotAt(92) },
            { id: 'cam2', type: 'camera', wait: true, duration: 2.6, ease: 'easeInOut', shot: shotAt(164) },
            { id: 'text2', type: 'subtitle', wait: false, duration: 4, text: 'A quiet waypoint between worlds.' },
            { id: 'cam3', type: 'camera', wait: true, duration: 2.6, ease: 'easeInOut', shot: shotAt(236) },
            { id: 'cam4', type: 'camera', wait: true, duration: 2.6, ease: 'easeInOut', shot: shotAt(308) },
            { id: 'text3', type: 'subtitle', wait: false, duration: 4, text: 'Rest here — the paths will wait.' },
            { id: 'cam5', type: 'camera', wait: true, duration: 2.6, ease: 'easeInOut', shot: shotAt(380) },
            { id: 'music-restore', type: 'sound', wait: false, soundId: 'music.amb.garden', fade: 2 },
        ],
    }
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
    placePondBorderStairs(chunks, size, pondWaterY)

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
        // Arrival cinematic — plays once, the first time the player teleports in.
        cinematics: [gardenIntroCinematic(size, groundY)],
        // "Verdant" — warm, pastoral piano bed for the garden.
        environment: { soundId: 'music.amb.garden', volume: 0.28 },
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

function placePondBorderStairs(chunks: ChunkManager, size: number, waterY: number): void {
    const cells: Array<{ x: number; z: number }> = []
    for (let z = 1; z < size - 1; z++) {
        for (let x = 1; x < size - 1; x++) {
            if (chunks.getVoxel(x, waterY, z) !== BLOCK.water) continue
            if (!hasNonWaterCardinalNeighbor(chunks, x, waterY, z)) continue
            cells.push({ x, z })
        }
    }
    for (const cell of cells) chunks.setVoxel(cell.x, waterY, cell.z, BLOCK.stairs)
}

function hasNonWaterCardinalNeighbor(chunks: ChunkManager, x: number, y: number, z: number): boolean {
    return (
        isSolidShoreCell(chunks, x + 1, y, z) ||
        isSolidShoreCell(chunks, x - 1, y, z) ||
        isSolidShoreCell(chunks, x, y, z + 1) ||
        isSolidShoreCell(chunks, x, y, z - 1)
    )
}

function isSolidShoreCell(chunks: ChunkManager, x: number, y: number, z: number): boolean {
    const block = chunks.getVoxel(x, y, z)
    return block !== BLOCK.air && block !== BLOCK.water
}

export function generateCombatArenaLevel(chunks: ChunkManager): LevelMeta {
    const size = 36
    const groundY = 4
    const t = terrain(chunks, { size, groundY })

    t.ground({ top: BLOCK.sand })
        .fill([2, 33], [groundY, groundY], [2, 33], BLOCK.stone)
        .fill([4, 31], [groundY, groundY], [4, 31], BLOCK.sand)
        .fill([2, 33], [groundY + 1, groundY + 2], [2, 2], BLOCK.brick)
        .fill([2, 33], [groundY + 1, groundY + 2], [33, 33], BLOCK.brick)
        .fill([2, 2], [groundY + 1, groundY + 2], [2, 33], BLOCK.brick)
        .fill([33, 33], [groundY + 1, groundY + 2], [2, 33], BLOCK.brick)
        .fill([3, 5], [groundY + 1, groundY + 2], [17, 19], BLOCK.air)
        .fill([3, 5], [groundY, groundY], [17, 19], BLOCK.door)
        .fill([13, 16], [groundY, groundY], [24, 27], BLOCK.plank)
        .fill([19, 23], [groundY, groundY], [24, 27], BLOCK.plank)
        .fill([23, 27], [groundY, groundY], [16, 20], BLOCK.stone2)
        .fill([15, 17], [groundY, groundY], [8, 12], BLOCK.plank)

    const zones: Zone[] = [
        {
            id: ARENA_FROM_DEMO_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Arrival from Demo',
            ...zoneBox({ x: 6, z: 18 }, { x: 0.75, z: 0.75 }, groundY + 1, groundY + 2.8),
        },
        {
            id: 'zone.combat-arena.portal.demo',
            kind: 'portal',
            label: 'Gate back to Demo',
            ...zoneBox({ x: 4, z: 18 }, { x: 1, z: 1 }, groundY + 1, groundY + 3),
            triggerSources: ['player'],
            portal: {
                targetLevelId: DEMO_LEVEL_ID,
                targetArrivalId: DEMO_FROM_ARENA_ARRIVAL_ID,
            },
        },
    ]
    const bootsPickupPosition = t.stand(9.5, 18)

    const npcs: NpcConfig[] = [
        normalizeNpcConfig({
            id: 'arena-sword-guard',
            name: 'Arena Sword Guard',
            model: 'keeper',
            position: t.stand(16, 10),
            yaw: Math.PI,
            gridAligned: false,
            collisionEnabled: true,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: 'sword', handL: null },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 7)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 16, y: 5, z: 10 }])`,
                `})`,
            ].join('\n'),
        }),
        normalizeNpcConfig({
            id: 'arena-hammer-guardian',
            name: 'Arena Hammer Guardian',
            model: 'large-troll',
            variant: 'guardian',
            beard: 'full',
            position: t.stand(25, 18),
            yaw: -Math.PI * 0.5,
            scale: 1.05,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.86,
            colliderHeight: 3.35,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: 'battle-hammer', handL: null },
            voice: { preset: 'troll', seed: 'arena-hammer-guardian', volume: 0.66, rate: 0.82 },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 9)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 25, y: 5, z: 18 }])`,
                `})`,
            ].join('\n'),
        }),
        // A hunter that punishes hit-and-run: threat memory makes him chase the
        // player's last-known spot long after losing sight, so sniping or
        // ducking round a corner won't shake him.
        normalizeNpcConfig({
            id: 'arena-long-memory-bob',
            name: 'Long-Memory Bob',
            model: 'keeper',
            position: t.stand(13, 13),
            yaw: Math.PI,
            gridAligned: false,
            collisionEnabled: true,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: 'sword', handL: 'shield' },
            voice: { preset: 'dwarf', seed: 'arena-long-memory-bob', volume: 0.6, rate: 0.95 },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 8)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  // Bob never forgets: he hunts your last-known spot for 8s, so`,
                `  // breaking line of sight or sniping from range won't shake him.`,
                `  npc.setThreatMemory(NPC_ID, 8)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 13, y: 5, z: 13 }])`,
                `})`,
            ].join('\n'),
        }),
        // ── Migrated from the base game ──────────────────────────────
        normalizeNpcConfig({
            id: 'arena-archer',
            name: 'Bandit Archer',
            model: 'archer',
            position: t.stand(28, 8),
            yaw: -Math.PI * 0.75,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.32,
            colliderHeight: 1.7,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: 'bow' },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 13)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 28, y: 5, z: 8 }])`,
                `})`,
            ].join('\n'),
        }),
        normalizeNpcConfig({
            id: 'arena-shield-warrior',
            name: 'Shield Warrior',
            model: 'shield-warrior',
            position: t.stand(10, 14),
            yaw: Math.PI * 0.5,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.36,
            colliderHeight: 1.78,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: 'sword', handL: 'shield' },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 9)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 10, y: 5, z: 14 }])`,
                `})`,
            ].join('\n'),
        }),
        normalizeNpcConfig({
            id: 'arena-shield-spearman',
            name: 'Shield Spearman',
            model: 'shield-spearman',
            position: t.stand(13, 20),
            yaw: -Math.PI * 0.5,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.36,
            colliderHeight: 1.78,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: 'spear', handL: 'shield' },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 9)`,
                `  npc.setHostile(NPC_ID, 'player', true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 13, y: 5, z: 20 }])`,
                `})`,
            ].join('\n'),
        }),
        normalizeNpcConfig({
            id: 'arena-rabbit',
            name: 'Skittish Rabbit',
            model: 'rabbit',
            position: t.stand(8, 28),
            yaw: 0,
            // The rabbit model is authored ~0.4u tall (quadruped, not the
            // humanoid rig), so it reads small without shrinking it further.
            scale: 1.3,
            gridAligned: false,
            collisionEnabled: false,
            colliderRadius: 0.22,
            colliderHeight: 0.6,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: null },
            scriptSource: [
                `on('level-start', () => {`,
                `  npc.setPerceptionRadius(NPC_ID, 8)`,
                `  npc.setFlee(NPC_ID, true)`,
                `  npc.setWaypoints(NPC_ID, [{ x: 8, y: 5, z: 28 }, { x: 13, y: 5, z: 30 }, { x: 9, y: 5, z: 31 }])`,
                `})`,
            ].join('\n'),
        }),
        normalizeNpcConfig({
            id: 'arena-volume-dummy-small',
            name: 'Small Target Dummy',
            model: 'keeper',
            position: t.stand(14, 25),
            yaw: 0,
            gridAligned: false,
            collisionEnabled: true,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: null },
            scriptEnabled: false,
        }),
        normalizeNpcConfig({
            id: 'arena-volume-dummy-large',
            name: 'Large Target Dummy',
            model: 'large-troll',
            variant: 'wise',
            beard: 'pointed',
            position: t.stand(20, 25),
            yaw: 0,
            scale: 1,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.78,
            colliderHeight: 3.2,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: null },
            scriptEnabled: false,
        }),
        normalizeNpcConfig({
            id: 'arena-friendly-fire-a',
            name: 'Arena Bystander A',
            model: 'keeper',
            position: t.stand(24.4, 19.2),
            yaw: -Math.PI * 0.4,
            gridAligned: false,
            collisionEnabled: true,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: null },
            scriptEnabled: false,
        }),
        normalizeNpcConfig({
            id: 'arena-friendly-fire-b',
            name: 'Arena Bystander B',
            model: 'keeper',
            position: t.stand(25.8, 19.2),
            yaw: Math.PI * 0.4,
            gridAligned: false,
            collisionEnabled: true,
            interactionEnabled: false,
            invulnerable: false,
            equipment: { handR: null, handL: null },
            scriptEnabled: false,
        }),
    ]

    return defineLevel({
        name: 'Combat Arena',
        size,
        spawn: t.stand(6, 18),
        player: playerSettingsWithHighJumpDisabled(),
        zones,
        npcs,
        scripts: [combatArenaBootsScript(bootsPickupPosition)],
        environment: { soundId: 'music.amb.tension', volume: 0.22 },
        ambient: outdoorDay({
            timeOfDay: 15.5,
            skyTint: [1, 0.96, 0.88],
            sunIntensityMul: 1.05,
            cloudCoverage: 0.08,
        }),
    })
}

function combatArenaBootsScript(position: { x: number; y: number; z: number }): ScriptEntry {
    const inventoryItem = {
        id: HIGH_JUMP_BOOTS_ITEM_ID,
        ...HIGH_JUMP_BOOTS_ITEM_OPTIONS,
    }
    return {
        id: 'combat-arena-high-jump-boots',
        name: 'combat-arena-high-jump-boots.js',
        source: [
            `const BOOTS_ID = ${JSON.stringify(HIGH_JUMP_BOOTS_ITEM_ID)}`,
            `const PICKUP_ID = 'combat-arena.high-jump-boots'`,
            `const PICKUP_POS = ${JSON.stringify(position)}`,
            `const BOOTS_ITEM = ${JSON.stringify(inventoryItem)}`,
            ``,
            `on('level-start', () => {`,
            `  if (player.inventory.has(BOOTS_ID)) return`,
            `  pickups.spawn(BOOTS_ID, PICKUP_POS, {`,
            `    id: PICKUP_ID,`,
            `    label: ${JSON.stringify(HIGH_JUMP_BOOTS_NAME)},`,
            `    inventoryItem: BOOTS_ITEM,`,
            `  })`,
            `})`,
        ].join('\n'),
    }
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
        { source: prefabSource('dwarf-product-market'), rotation: 0 },
        { source: prefabSource('dwarf-forge-shop'), rotation: 180 },
        { source: prefabSource('dwarf-clothes-store'), rotation: 0 },
        { source: prefabSource('dwarf-alchemy-stall'), rotation: 180 },
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
            variant: 'wise',
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
            invulnerable: false,
            equipment: { handR: null, handL: 'book' },
            voice: { preset: 'troll', seed: 'curator-brannok', volume: 0.62, rate: 0.86 },
            scriptEnabled: true,
            scriptSource: [
                `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {`,
                `  ui.say(NPC_INTERACTION, 'Mind the rail line. Every city keeps its rhythm.', { seconds: 4 })`,
                `})`,
            ].join('\n'),
        }, {
            id: 'large-town:troll-guardian',
            name: 'Guardian Hrogar',
            model: 'large-troll',
            variant: 'guardian',
            beard: 'full',
            position: t.stand(54, roadZ + 5),
            yaw: Math.PI * 0.72,
            scale: 1.05,
            gridAligned: false,
            collisionEnabled: true,
            colliderRadius: 0.86,
            colliderHeight: 3.35,
            interactionEnabled: true,
            interactionRadius: 3.2,
            interactionPrompt: 'Greet',
            invulnerable: false,
            equipment: { handR: 'battle-hammer', handL: null },
            voice: { preset: 'troll', seed: 'guardian-hrogar', volume: 0.66, rate: 0.82 },
            scriptEnabled: true,
            scriptSource: [
                `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {`,
                `  ui.say(NPC_INTERACTION, 'The hammer stays quiet while guests keep the peace.', { seconds: 4 })`,
                `})`,
            ].join('\n'),
        },
        dwarfMerchant(
            'large-town:product-vendor',
            'Mira Redbasket',
            t.stand(152, northZ + 6),
            0,
            { handR: null, handL: 'book' },
            'mira-redbasket',
            [
                `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {`,
                `  ui.say(NPC_INTERACTION, 'Fresh meat, apples, and river fish. For now, the market goods are display stock.', { seconds: 4 })`,
                `})`,
            ].join('\n'),
            'Talk',
        ),
        dwarfMerchant(
            'large-town:forge-smith',
            'Borin Emberhand',
            t.stand(200, southZ - 6),
            Math.PI,
            { handR: 'spear', handL: null },
            'borin-emberhand',
            merchantShopScript('large-town.forge', 'Borin Emberhand', 'Emberhand Forge', [
                {
                    id: 'spear',
                    name: 'Spear',
                    description: 'A long thrusting weapon. Equip it from Tools after purchase.',
                    resource: 'spear',
                    unitSize: 1,
                    buyPrice: 18,
                    sellPrice: 8,
                    stock: 1,
                },
                {
                    id: 'arrows.bundle',
                    name: 'Arrow bundle',
                    description: 'Five hammered arrowheads on straight shafts.',
                    resource: 'arrows',
                    unitSize: 5,
                    buyPrice: 3,
                    sellPrice: 1,
                    stock: 20,
                },
                {
                    id: 'metal-helmet',
                    name: 'Metal Helmet',
                    description: 'A practical iron helmet with a 30% chance to block attack damage.',
                    resource: 'metal-helmet',
                    unitSize: 1,
                    buyPrice: 14,
                    sellPrice: 6,
                    stock: 1,
                },
            ], 'Good steel travels better than gossip.'),
        ),
        dwarfMerchant(
            'large-town:clothier',
            'Tilda Hemstitch',
            t.stand(248, northZ + 6),
            0,
            { handR: null, handL: 'book' },
            'tilda-hemstitch',
            merchantShopScript('large-town.clothes', 'Tilda Hemstitch', 'Hemstitch Clothes', [
                {
                    id: 'hat-ranger',
                    name: 'Ranger Cap',
                    description: 'A green cap that helps arrows fly farther.',
                    resource: 'hat-ranger',
                    unitSize: 1,
                    buyPrice: 16,
                    sellPrice: 7,
                    stock: 1,
                },
                {
                    id: 'hat-arcane',
                    name: 'Arcane Hat',
                    description: 'A tall spellcaster hat for the head slot.',
                    resource: 'hat-arcane',
                    unitSize: 1,
                    buyPrice: 12,
                    sellPrice: 5,
                    stock: 1,
                },
                {
                    id: 'hat-sun',
                    name: 'Sun Crown',
                    description: 'A bright ceremonial crown for the head slot.',
                    resource: 'hat-sun',
                    unitSize: 1,
                    buyPrice: 20,
                    sellPrice: 9,
                    stock: 1,
                },
                {
                    id: 'high-jump-boots',
                    name: 'High Jump Boots',
                    description: 'Spring-soled boots. Equip them from Accessories to enable High Jump.',
                    resource: 'high-jump-boots',
                    unitSize: 1,
                    buyPrice: 10,
                    sellPrice: 5,
                    stock: 1,
                },
                {
                    id: 'high-speed-boots',
                    name: 'Boots of High Speed',
                    description: 'Light courier boots. Equip them from Accessories to increase movement speed.',
                    resource: 'high-speed-boots',
                    unitSize: 1,
                    buyPrice: 12,
                    sellPrice: 6,
                    stock: 1,
                },
            ], 'A good fit makes the road shorter.'),
        ),
        dwarfMerchant(
            'large-town:alchemist',
            'Pella Coppervial',
            t.stand(296, southZ - 6),
            Math.PI,
            { handR: 'staff-crystal', handL: null },
            'pella-coppervial',
            merchantShopScript('large-town.alchemy', 'Pella Coppervial', 'Coppervial Alchemy', [
                {
                    id: 'heal-potion',
                    name: 'Healing Potion',
                    description: 'A sealed red draught for dangerous climbs.',
                    resource: 'heal-potion',
                    unitSize: 1,
                    buyPrice: 5,
                    sellPrice: 2,
                    stock: 12,
                },
                {
                    id: 'mana-potion',
                    name: 'Mana Potion',
                    description: 'A sealed blue draught for spellwork and high jumps.',
                    resource: 'mana-potion',
                    unitSize: 1,
                    buyPrice: 6,
                    sellPrice: 3,
                    stock: 12,
                },
            ], 'Red mends blood; blue mends spellwork. Keep both stoppered.'),
        )],
        coinPiles: [
            { position: { x: 80, y: groundY + 1, z: roadZ }, amount: 3 },
            { position: { x: 240, y: groundY + 1, z: roadZ }, amount: 3 },
            { position: { x: 400, y: groundY + 1, z: roadZ }, amount: 3 },
        ],
        // "Commons" — gentle I–vi–IV–V piano bed for the lived-in town.
        environment: { soundId: 'music.amb.town', volume: 0.24 },
        ambient: outdoorDay({ timeOfDay: 14 }),
    })
}

interface MerchantShopItem {
    id: string
    name: string
    description: string
    resource: string
    unitSize: number
    buyPrice?: number
    sellPrice?: number
    stock?: number
}

function dwarfMerchant(
    id: string,
    name: string,
    position: { x: number; y: number; z: number },
    yaw: number,
    equipment: NpcConfig['equipment'],
    voiceSeed: string,
    scriptSource: string,
    interactionPrompt = 'Trade',
): NpcConfig {
    return {
        id,
        name,
        model: 'keeper',
        variant: 'default',
        beard: 'full',
        position,
        yaw,
        scale: 0.94,
        gridAligned: false,
        collisionEnabled: true,
        colliderRadius: 0.32,
        colliderHeight: 1.48,
        interactionEnabled: true,
        interactionRadius: 2.6,
        interactionPrompt,
        // Shopkeepers can't be harmed and never turn hostile if mishit.
        invulnerable: true,
        unprovokable: true,
        equipment,
        voice: { preset: 'dwarf', seed: voiceSeed, volume: 0.55, rate: 0.95 },
        scriptEnabled: true,
        scriptSource,
    }
}

function merchantShopScript(
    id: string,
    npcName: string,
    title: string,
    items: readonly MerchantShopItem[],
    boughtLine: string,
): string {
    return [
        `const SHOP = {`,
        `  id: ${JSON.stringify(id)},`,
        `  title: ${JSON.stringify(title)},`,
        `  npc: { id: NPC_ID, name: NPC_NAME, avatar: 'keeper', side: 'left', voice: NPC_VOICE },`,
        `  currency: 'gold',`,
        `  items: ${JSON.stringify(items, null, 2).replace(/\n/g, '\n  ')},`,
        `}`,
        ``,
        `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {`,
        `  void openShop()`,
        `})`,
        ``,
        `async function openShop() {`,
        `  const result = await trade.open(SHOP)`,
        `  if (result.status === 'bought') {`,
        `    ui.say(NPC_INTERACTION, ${JSON.stringify(`${npcName}: `)} + result.itemName + '. ${boughtLine}', { seconds: 4 })`,
        `  } else if (result.status === 'sold') {`,
        `    ui.say(NPC_INTERACTION, ${JSON.stringify(`${npcName}: `)} + 'Fair price for ' + result.itemName + '.', { seconds: 4 })`,
        `  } else if (result.status === 'unavailable' && result.reason) {`,
        `    ui.say(NPC_INTERACTION, result.reason, { seconds: 3 })`,
        `  }`,
        `}`,
    ].join('\n')
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
