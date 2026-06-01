import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { RailCartConfig } from '../engine/ecs/world'
import type { Zone } from '../engine/ecs/zones'
import type { PistonMechanismConfig } from './mechanisms'
import { STONE_TIER, type StoneFallSpawnerConfig, type StonePlacementConfig } from './moving-objects'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from './sound-sources'
import type { AmbientWeatherRuntimeConfig, WeatherZoneRuntimeConfig } from './weather-config'
import type { EditorProp } from './props/prop-types'
import { normalizeNpcConfig, type NpcConfig } from './npcs/npc-types'
import type { PlayerSettings } from './player-settings'
import type { ScriptEntry } from '../engine/script/types'
import {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    LARGE_TOWN_LEVEL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
} from './procedural-level-ids'
import { defineLevel, interactZone, outdoorDay, terrain } from './level-builder'

export interface CoinPileSpawn {
    position: { x: number; y: number; z: number }
    amount?: number
}

export interface LevelMeta {
    /** Editor-authored level name, or `'demo'` for the procedural fallback.
     *  Surfaced to scripts via the `level.name` binding. */
    name: string
    /** World-space spawn position (X, Y, Z). Y is standing height (one above topmost solid). */
    spawn: { x: number; y: number; z: number }
    /** Player defaults applied when this location starts. Scripts may mutate
     *  the live copy during play. */
    player: PlayerSettings
    /** Falling-stone emitter configs. */
    stoneSpawners: StoneFallSpawnerConfig[]
    /** Direct physics stones spawned when the location starts. */
    stones: StonePlacementConfig[]
    /** Coin pile placements - pickup-system grants gold on contact. */
    coinPiles: CoinPileSpawn[]
    /** Piston / moving-platform configs registered by client.ts. */
    pistons: PistonMechanismConfig[]
    /** Named AABB regions - registered into `world.zones` by client.ts. */
    zones: Zone[]
    /** Static spatial audio emitters registered by client.ts. */
    soundSources: SoundSourceConfig[]
    /** Rideable kinematic carts placed on authored rail blocks. */
    railCarts: RailCartConfig[]
    /** AABB ambient zones that fade audio in/out as the player enters/leaves. */
    soundZones: SoundZoneConfig[]
    /** Level-wide ambient bed (stereo, non-spatial). Optional. */
    environment?: EnvironmentConfig
    /** Local Visual FX zones (rain, fire, magic, lava surface, ...)
     *  paired with optional looped ambient beds. */
    weatherZones: WeatherZoneRuntimeConfig[]
    /** Decorative misc objects authored in the editor (flowers,
     *  bushes, tables, ...). Rendered via `createPropRenderSystem`
     *  in `client.ts`. */
    props: EditorProp[]
    /** Static NPCs authored in the editor. Runtime registers their
     *  visuals, interaction zones, collisions, and per-NPC scripts. */
    npcs: NpcConfig[]
    /** Plain JavaScript scripts run by the script engine. */
    scripts: ScriptEntry[]
    /** Level-wide visual environment snapshot (sky/fog/sun/drifting
     *  rain & snow). Optional - absent means engine defaults. */
    ambientWeather?: AmbientWeatherRuntimeConfig
    /** XZ extent of the generated level, used by the demo to centre the camera. */
    size: number
}

export function levelMetaWithSpawn(meta: LevelMeta, spawn: { x: number; y: number; z: number }): LevelMeta {
    return {
        ...meta,
        spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
    }
}

/**
 * Compact platformer demo level. Authored through the level builder
 * (`src/game/level-builder/`): terrain shapes via `terrain(...)`, the
 * `LevelMeta` record via `defineLevel(...)`. Pieces:
 *
 *  - A 24x24 grass plaza for movement testing.
 *  - A three-step staircase + raised platform for jump testing.
 *  - A short east cliff with two stone spawners dropping pebbles/cobbles.
 *  - A floating island reached by a vertical elevator piston.
 *  - An NPC-led collection quest + three standalone script test objects,
 *    all driven by the editor-loaded `.js` scripts in `examples/scripts/`.
 *
 * The zone ids (`zone.demo.*`), piston ids (`piston.elevator/trap`), and
 * the lantern / shard / shrine coordinates are a contract the example
 * scripts depend on - see those files before moving anything.
 */
export function generatePlatformerLevel(chunks: ChunkManager): LevelMeta {
    const size = 24
    const groundY = 4
    const platformTop = groundY + 4
    const cliffTop = groundY + 4

    const t = terrain(chunks, { size, groundY })

    t.ground({ top: BLOCK.grass })
        // Three-step staircase climbing +Z along x in [16,20].
        .stairs({ x: [16, 20], startZ: 8, steps: 3, depth: 2, block: BLOCK.plank, fillUnder: BLOCK.stone })
        // Raised 5x5 grass island north of the staircase.
        .platform({ x: [14, 22], z: [16, 20], topY: platformTop, top: BLOCK.grass, fill: BLOCK.stone })
        // West wall - gives arrows something to stick into.
        .fill([2, 2], [groundY + 1, groundY + 3], [2, 8], BLOCK.brick)
        // East cliff: dirt body capped with stone; hosts the stone spawners.
        .fill([22, 23], [groundY + 1, cliffTop - 1], [2, 6], BLOCK.dirt)
        .fill([22, 23], [cliffTop, cliffTop], [2, 6], BLOCK.stone)
        // Contact hazard for the lava block surface and player death path.
        .pond({
            center: { x: 16.5, z: 4.5 },
            radiusX: 2.6,
            radiusZ: 1.8,
            waterY: groundY,
            shoreWidth: 1.0,
            shoreBlock: BLOCK.stone,
            bedBlock: BLOCK.stone,
            waterBlock: BLOCK.lava,
        })
        // Travel-test gate pad + frame, kept clear of the quest objects so an
        // exported editor file can validate level-to-level travel in isolation.
        .fill([4, 7], [groundY, groundY], [16, 19], BLOCK.stone)
        .fill([5, 6], [groundY, groundY], [17, 18], BLOCK.door)
        .fill([4, 4], [groundY + 1, groundY + 3], [16, 16], BLOCK.door)
        .fill([7, 7], [groundY + 1, groundY + 3], [19, 19], BLOCK.door)
        // Floating island for the elevator-target coin pile. Leave the piston
        // shaft open at (8, groundY+3, 21) so the elevator can extend into it.
        .fill([7, 9], [groundY + 3, groundY + 3], [20, 22], BLOCK.stone)
        .clear(8, groundY + 3, 21)
        // Quest lantern: starts cold/dark. demo-quest.js swaps it to a lit
        // torch when the player returns all three Sun Shards to Keeper Arlen.
        .set(9, groundY + 1, 9, BLOCK.unlitLantern)

    const stoneSpawners: StoneFallSpawnerConfig[] = [
        {
            position: { x: 22.4, y: cliffTop + 0.6, z: 3.5 },
            velocity: { x: -2.6, y: 0.2, z: 0.3 },
            interval: 1.6,
            jitter: 0.3,
            options: STONE_TIER.pebble,
        },
        {
            position: { x: 22.4, y: cliffTop + 0.6, z: 5.5 },
            velocity: { x: -2.4, y: 0.1, z: -0.2 },
            interval: 2.4,
            jitter: 0.25,
            options: STONE_TIER.cobble,
        },
    ]

    // Coin piles giving the player reasons to traverse: the raised platform
    // (needs the staircase or high-jump), the cliff base (in the stone-fall
    // path), behind the west wall, and the elevator-only floating island.
    const coinPiles: CoinPileSpawn[] = [
        { position: { x: 18, y: platformTop + 1, z: 18 }, amount: 20 },
        { position: { x: 20, y: groundY + 1, z: 4 }, amount: 12 },
        { position: { x: 4, y: groundY + 1, z: 5 }, amount: 8 },
        { position: { x: 8, y: groundY + 4, z: 21 }, amount: 25 },
    ]

    // Vertical elevator (carries a rider up to the island) + a horizontal
    // trap piston that shoves the player aside. Both addressable by script id.
    const pistons: PistonMechanismConfig[] = [
        {
            id: 'piston.elevator',
            from: { x: 8, y: groundY + 1, z: 21 },
            to: { x: 8, y: groundY + 3, z: 21 },
            block: BLOCK.plank,
            delay: 3,
            characterPolicy: 'push',
        },
        {
            id: 'piston.trap',
            from: { x: 12, y: groundY + 1, z: 12 },
            to: { x: 13, y: groundY + 1, z: 12 },
            block: BLOCK.brick,
            delay: 1.4,
            characterPolicy: 'push',
        },
    ]

    // Walk-in gate to the Large Town (the mesh-streaming demo location).
    // Keep it just south of the raised platform; the platform's stone fill
    // occupies y=groundY+1..groundY+3 at z<=20.
    t.fill([19, 22], [groundY, groundY], [21, 23], BLOCK.stone)
        .fill([19, 19], [groundY + 1, groundY + 3], [23, 23], BLOCK.brick)
        .fill([22, 22], [groundY + 1, groundY + 3], [21, 21], BLOCK.brick)

    // Quest / test zones. The interact spots derive their AABB + prompt
    // anchor from a single center (= the matching prop's position); the
    // trigger / portal / arrival volumes stay explicit min/max regions.
    const zones: Zone[] = [
        interactZone({
            id: 'zone.demo.keeper',
            label: 'Keeper Arlen',
            center: { x: 10.5, z: 9.5 },
            half: { x: 1.25, z: 1.25 },
            yLo: groundY + 1,
            yHi: groundY + 3,
            prompt: 'Interaction',
            anchorDy: 1.16,
            radius: 2.45,
        }),
        {
            id: 'zone.demo.stairs',
            kind: 'trigger',
            label: 'Staircase top',
            min: { x: 16, y: groundY + 3, z: 12 },
            max: { x: 21, y: groundY + 5, z: 14 },
        },
        {
            id: 'zone.demo.island',
            kind: 'trigger',
            label: 'Floating island',
            min: { x: 7, y: groundY + 4, z: 20 },
            max: { x: 10, y: groundY + 6, z: 23 },
        },
        interactZone({
            // Lantern Trial side quest's Sundial, centered on the island prop.
            id: 'zone.demo.sundial',
            label: 'Floating Sundial',
            center: { x: 8.5, z: 21.3 },
            half: { x: 0.8, z: 0.7 },
            yLo: groundY + 4,
            yHi: groundY + 6,
            prompt: 'Read Sundial',
            anchorDy: 0.8,
            radius: 2.4,
        }),
        interactZone({
            // Standalone script test: haste-shrine.js patches moveSpeed for 10s.
            id: 'zone.demo.haste-shrine',
            label: 'Shrine of Haste',
            center: { x: 14.5, z: 9.5 },
            half: { x: 1.25, z: 1.25 },
            yLo: groundY + 1,
            yHi: groundY + 3,
            prompt: 'Invoke Haste',
            anchorDy: 1.35,
            radius: 2.55,
        }),
        interactZone({
            // Paid portal shrine: spends a coin to open the garden gate + FX.
            id: 'zone.demo.portal-shrine',
            label: 'Portal Shrine',
            center: { x: 4.3, z: 19.8 },
            half: { x: 0.95, z: 0.95 },
            yLo: groundY + 1,
            yHi: groundY + 3,
            prompt: 'Pay 1 Coin',
            anchorDy: 1.35,
            radius: 2.35,
        }),
        {
            // Hidden vault beneath the plaza, activated by the Lantern Trial.
            id: 'zone.demo.vault',
            kind: 'trigger',
            label: 'Plaza Vault',
            min: { x: 4, y: groundY + 1, z: 4 },
            max: { x: 7, y: groundY + 3, z: 7 },
            active: false,
        },
        {
            id: 'zone.demo.portal.teleport-garden',
            kind: 'portal',
            label: 'Gate to Teleport Garden',
            min: { x: 5, y: groundY + 1, z: 17 },
            max: { x: 7, y: groundY + 3, z: 19 },
            triggerSources: ['player'],
            portal: {
                targetLevelId: TELEPORT_GARDEN_LEVEL_ID,
                targetArrivalId: TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
            },
            active: false,
        },
        {
            id: DEMO_FROM_GARDEN_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Return from Teleport Garden',
            min: { x: 8.25, y: groundY + 1, z: 16.75 },
            max: { x: 9.75, y: groundY + 2.8, z: 18.25 },
        },
        {
            // Walk-in portal to the Large Town — active by default (no script
            // gate), so it's a direct way to exercise mesh streaming.
            id: 'zone.demo.portal.large-town',
            kind: 'portal',
            label: 'Gate to the Large Town',
            min: { x: 20, y: groundY + 1, z: 21 },
            max: { x: 22, y: groundY + 3, z: 23 },
            triggerSources: ['player'],
            portal: {
                targetLevelId: LARGE_TOWN_LEVEL_ID,
                targetArrivalId: TOWN_FROM_DEMO_ARRIVAL_ID,
            },
        },
        {
            id: DEMO_FROM_TOWN_ARRIVAL_ID,
            kind: 'arrival',
            label: 'Return from the Large Town',
            min: { x: 18.25, y: groundY + 1, z: 21.25 },
            max: { x: 19.75, y: groundY + 2.8, z: 22.75 },
        },
    ]

    const npcs: NpcConfig[] = [
        normalizeNpcConfig({
            id: 'demo-keeper-arlen',
            name: 'Keeper Arlen',
            model: 'keeper-arlen',
            position: t.stand(10.5, 9.5),
            yaw: Math.PI * 0.18,
            scale: 1.05,
            gridAligned: false,
            collisionEnabled: false,
            interactionEnabled: false,
            // Essential quest-giver — cannot be harmed.
            invulnerable: true,
            scriptEnabled: false,
        }),
    ]

    const props: EditorProp[] = [
        {
            // Sundial on the floating island - the Lantern Trial's interactable.
            id: 'demo:sundial',
            kind: 'sundial',
            position: t.surface(8.5, 21.3, 4),
            yaw: -Math.PI * 0.18,
            scale: 1.4,
            gridAligned: false,
        },
        {
            // By the spawn plaza for quick script-driven player-param testing.
            id: 'demo:haste-shrine',
            kind: 'haste-shrine',
            position: t.stand(14.5, 9.5),
            yaw: Math.PI * 0.08,
            scale: 1.35,
            gridAligned: false,
        },
        {
            // Beside the inactive travel gate; paid-portal-shrine.js opens it.
            id: 'demo:portal-shrine',
            kind: 'portal-shrine',
            position: t.stand(4.3, 19.8),
            yaw: -Math.PI * 0.22,
            scale: 1.25,
            gridAligned: false,
        },
        // Decorative flora in the open corners of the plaza.
        {
            id: 'demo:flora:west',
            kind: 'bush',
            position: t.stand(3.4, 11.6),
            yaw: 0.4,
            scale: 1.1,
            gridAligned: false,
        },
        {
            id: 'demo:flora:south',
            kind: 'flower',
            position: t.stand(11.6, 3.4),
            yaw: 0.85,
            scale: 1,
            gridAligned: false,
        },
        {
            id: 'demo:flora:east',
            kind: 'flower-2',
            position: t.stand(20.5, 12.5),
            yaw: -0.5,
            scale: 1,
            gridAligned: false,
        },
    ]

    const railY = groundY + 1
    for (let x = 3; x <= 8; x++) {
        chunks.setVoxel(x, railY, 9, BLOCK.rail)
        chunks.setVoxel(x, railY, 14, BLOCK.rail)
    }
    for (let z = 9; z <= 14; z++) {
        chunks.setVoxel(3, railY, z, BLOCK.rail)
        chunks.setVoxel(8, railY, z, BLOCK.rail)
    }

    return defineLevel({
        name: 'demo',
        size,
        spawn: t.stand(size / 2, size / 2),
        stoneSpawners,
        coinPiles,
        pistons,
        zones,
        props,
        npcs,
        railCarts: [{
            id: 'demo:rail-cart',
            railCell: { x: 3, y: railY, z: 9 },
            front: 'east',
            speed: 4,
            interactionRadius: 1.75,
            enabled: true,
        }],
        // Demo spawn uses the calm, intriguing "Threshold" ambient bed;
        // editor-authored levels start with no environment and pick a
        // track from the Sound tab.
        environment: { soundId: 'music.amb.start', volume: 0.36 },
        ambient: outdoorDay(),
        weatherZones: [
            {
                id: 'fx.demo.portal.magic',
                label: 'Portal Magic',
                presetId: 'magic',
                position: { x: 6, y: groundY + 2.2, z: 18 },
                size: { x: 4.2, y: 4.8, z: 4.2 },
                enabled: false,
                addSound: true,
                soundVolume: 0.45,
            },
        ],
    })
}
