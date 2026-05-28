import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { PistonMechanismConfig } from './mechanisms'
import { STONE_TIER, type StoneFallSpawnerConfig, type StonePlacementConfig } from './moving-objects'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from './sound-sources'
import { DEFAULT_OUTDOOR_FOG_DENSITY_MUL, type AmbientWeatherRuntimeConfig, type WeatherZoneRuntimeConfig } from './weather-config'
import type { EditorProp } from './props/prop-types'
import type { NpcConfig } from './npcs/npc-types'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from './player-settings'
import type { ScriptEntry } from '../engine/script/types'
import {
    DEMO_FROM_GARDEN_ARRIVAL_ID,
    TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID,
    TELEPORT_GARDEN_LEVEL_ID,
} from './procedural-level-ids'

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
    /** Coin pile placements — pickup-system grants gold on contact. */
    coinPiles: CoinPileSpawn[]
    /** Piston / moving-platform configs registered by client.ts. */
    pistons: PistonMechanismConfig[]
    /** Named AABB regions — registered into `world.zones` by client.ts. */
    zones: Zone[]
    /** Static spatial audio emitters registered by client.ts. */
    soundSources: SoundSourceConfig[]
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
     *  rain & snow). Optional — absent ⇒ engine defaults. */
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
 * Compact platformer demo level. Three pieces:
 *
 *  - A 24×24 grass plaza for movement testing.
 *  - A two-step staircase + raised platform for jump testing (needs to clear
 *    a 1-block step at minimum).
 *  - A short cliff with two stone spawners that drop pebbles and cobbles into
 *    the plaza so the physics is observable.
 *
 * Includes a small NPC-led collection quest driven by the script engine.
 */
export function generatePlatformerLevel(chunks: ChunkManager): LevelMeta {
    const size = 24
    const groundY = 4
    const keeperLantern = { x: 9, y: groundY + 1, z: 9 }

    // Grass plaza floor — one block thick, dirt under it for visual fringe at
    // the cliff cut.
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < groundY; y++) {
                chunks.setVoxel(x, y, z, y === groundY - 1 ? BLOCK.dirt : BLOCK.stone)
            }
            chunks.setVoxel(x, groundY, z, BLOCK.grass)
        }
    }

    // Three-step staircase climbing south to north along x=18.
    for (let step = 0; step < 3; step++) {
        const stepY = groundY + 1 + step
        const stepZ = 8 + step * 2
        for (let x = 16; x <= 20; x++) {
            for (let z = stepZ; z < stepZ + 2; z++) {
                chunks.setVoxel(x, stepY, z, BLOCK.plank)
                // Fill underneath so the steps are solid all the way down.
                for (let y = groundY + 1; y < stepY; y++) {
                    chunks.setVoxel(x, y, z, BLOCK.stone)
                }
            }
        }
    }

    // Raised platform north of the staircase — a 5×5 grass island at y=8.
    const platformTop = groundY + 4
    for (let x = 14; x <= 22; x++) {
        for (let z = 16; z <= 20; z++) {
            for (let y = groundY + 1; y < platformTop; y++) {
                chunks.setVoxel(x, y, z, BLOCK.stone)
            }
            chunks.setVoxel(x, platformTop, z, BLOCK.grass)
        }
    }

    // A short wall on the west edge to give arrows somewhere to stick.
    for (let z = 2; z <= 8; z++) {
        for (let y = groundY + 1; y <= groundY + 3; y++) {
            chunks.setVoxel(2, y, z, BLOCK.brick)
        }
    }

    // Quest lantern: starts cold and dark. The demo quest script
    // swaps this special unlit prop-block to BLOCK.torch when the
    // player returns all three Sun Shards to Keeper Arlen.
    chunks.setVoxel(keeperLantern.x, keeperLantern.y, keeperLantern.z, BLOCK.unlitLantern)

    // Travel-test gate. The pad is kept outside the main quest objects so
    // exported editor files can validate level-to-level travel without
    // interfering with the collection quest flow.
    for (let x = 4; x <= 7; x++) {
        for (let z = 16; z <= 19; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.stone)
        }
    }
    // Use non-light-emitting marker blocks here. BLOCK.glow spawns one
    // PointLight per voxel, and BLOCK.noWalk is reserved for invisible
    // border authoring.
    for (let x = 5; x <= 6; x++) {
        for (let z = 17; z <= 18; z++) {
            chunks.setVoxel(x, groundY, z, BLOCK.door)
        }
    }
    for (let y = groundY + 1; y <= groundY + 3; y++) {
        chunks.setVoxel(4, y, 16, BLOCK.door)
        chunks.setVoxel(7, y, 19, BLOCK.door)
    }

    // Cliff with two stone spawners on the east side of the plaza.
    const cliffTop = groundY + 4
    for (let x = 22; x < size; x++) {
        for (let z = 2; z <= 6; z++) {
            for (let y = groundY + 1; y <= cliffTop; y++) {
                chunks.setVoxel(x, y, z, y === cliffTop ? BLOCK.stone : BLOCK.dirt)
            }
        }
    }

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

    // A handful of coin piles to give the player a reason to traverse the
    // demo: one on the raised platform (needs the staircase OR a high-jump),
    // one near the cliff base (in the path of falling stones), one tucked
    // behind the wall, one isolated on a small island reachable only by the
    // vertical elevator piston below.
    const coinPiles = [
        { position: { x: 18, y: platformTop + 1, z: 18 }, amount: 20 },
        { position: { x: 20, y: groundY + 1, z: 4 }, amount: 12 },
        { position: { x: 4, y: groundY + 1, z: 5 }, amount: 8 },
        { position: { x: 8, y: groundY + 4, z: 21 }, amount: 25 },
    ]

    // Carve a small floating island to host the elevator-target coin pile.
    // The island has no stairs, so the player must ride the vertical piston
    // up to it (or use high-jump if they can clear ~3 m).
    //
    // Leave a hole at the piston target cell (8, groundY+3, 21) — that's
    // where the elevator block extends to, and if we paved over it the
    // piston could never flip (target permanently solid).
    for (let x = 7; x <= 9; x++) {
        for (let z = 20; z <= 22; z++) {
            if (x === 8 && z === 21) continue
            chunks.setVoxel(x, groundY + 3, z, BLOCK.stone)
        }
    }

    // Pistons:
    //  - Vertical elevator at (8, groundY+1..groundY+3, 21): a plank block
    //    that swaps between the ground-floor cell and the floating-island
    //    cell. characterPolicy 'push' so a player standing on it gets
    //    carried up. delay 3s gives the player time to step on and ride.
    //  - Horizontal piston near the centre: a brick block that alternates
    //    between two adjacent cells. characterPolicy 'push' so the block
    //    shoves the player aside when they're standing in the target spot —
    //    matching the parent engine's trap-piston feel and demoing the
    //    push behaviour on the horizontal axis.
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

    // Quest trigger zones. These are AABB regions on top of the
    // level's existing terrain. They have no `script` field — the
    // legacy `ZoneScriptAction` surface is empty — but the script
    // engine emits `zone-enter` / `zone-exit` for them so
    // editor-authored .js scripts can react.
    //
    // See `voxel-platformer/examples/scripts/demo-quest.js` for the
    // canonical script that consumes these events.
    const zones: Zone[] = [
        {
            id: 'zone.demo.keeper',
            kind: 'interact',
            label: 'Keeper Arlen',
            // Conversation range around the keeper NPC. It is deliberately an
            // interact zone, not an automatic trigger, so the quest advances
            // only when the player presses E near the NPC.
            min: { x: 9.25, y: groundY + 1, z: 8.25 },
            max: { x: 11.75, y: groundY + 3, z: 10.75 },
            interaction: {
                prompt: 'Interaction',
                anchor: { x: 10.5, y: groundY + 2.16, z: 9.5 },
                radius: 2.45,
            },
        },
        {
            id: 'zone.demo.stairs',
            kind: 'trigger',
            label: 'Staircase top',
            // Sits on top of the topmost plank step (y = groundY + 3,
            // step depth z∈[12,14]). Goes one cell above so the
            // player-AABB triggers it.
            min: { x: 16, y: groundY + 3, z: 12 },
            max: { x: 21, y: groundY + 5, z: 14 },
        },
        {
            id: 'zone.demo.island',
            kind: 'trigger',
            label: 'Floating island',
            // The piston-target island top is y = groundY + 3. The
            // standing cell is y = groundY + 4. We span both so the
            // event fires whether the player rides up or jumps.
            min: { x: 7, y: groundY + 4, z: 20 },
            max: { x: 10, y: groundY + 6, z: 23 },
        },
        {
            // Lantern Trial side quest: the Sundial on the floating
            // island. Distinct interact zone from `zone.demo.island`
            // (a trigger) so the prompt only shows up at the dial
            // itself, not anywhere on the island top.
            id: 'zone.demo.sundial',
            kind: 'interact',
            label: 'Floating Sundial',
            min: { x: 7.6, y: groundY + 4, z: 20.6 },
            max: { x: 9.2, y: groundY + 6, z: 22.0 },
            interaction: {
                prompt: 'Read Sundial',
                anchor: { x: 8.5, y: groundY + 4.8, z: 21.3 },
                radius: 2.4,
            },
        },
        {
            // Standalone script-system test object. Interacting with
            // the shrine temporarily patches `player.moveSpeed` via
            // examples/scripts/haste-shrine.js, then restores it after
            // ten seconds.
            id: 'zone.demo.haste-shrine',
            kind: 'interact',
            label: 'Shrine of Haste',
            min: { x: 13.25, y: groundY + 1, z: 8.25 },
            max: { x: 15.75, y: groundY + 3, z: 10.75 },
            interaction: {
                prompt: 'Invoke Haste',
                anchor: { x: 14.5, y: groundY + 2.35, z: 9.5 },
                radius: 2.55,
            },
        },
        {
            // Paid portal shrine: spends one coin to temporarily open
            // the Teleport Garden gate and its magic FX volume.
            id: 'zone.demo.portal-shrine',
            kind: 'interact',
            label: 'Portal Shrine',
            min: { x: 3.35, y: groundY + 1, z: 18.85 },
            max: { x: 5.25, y: groundY + 3, z: 20.75 },
            interaction: {
                prompt: 'Pay 1 Coin',
                anchor: { x: 4.3, y: groundY + 2.35, z: 19.8 },
                radius: 2.35,
            },
        },
        {
            // Hidden vault beneath the plaza. The trial activates this
            // when the player collects the fourth hour stone; entering
            // closes the trial out. Inactive by default so it doesn't
            // fire for players who haven't started the side quest.
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
    ]

    return {
        name: 'demo',
        spawn: { x: size / 2, y: groundY + 1, z: size / 2 },
        player: DEFAULT_PLAYER_SETTINGS,
        stoneSpawners,
        stones: [],
        coinPiles,
        pistons,
        zones,
        soundSources: [],
        soundZones: [],
        // Demo level keeps the existing background music bed. Editor-
        // authored levels start with `environment: undefined` and the
        // user picks (or clears) the track from the Sound tab.
        environment: { soundId: 'music.background', volume: 0.36 },
        ambientWeather: {
            presetId: 'clear',
            state: {
                mode: 'outdoor',
                timeOfDay: 8.0,
                cycleEnabled: true,
                cycleSeconds: 420,
                skyTint: [1, 1, 1],
                sunIntensityMul: 1,
                fogDensityMul: DEFAULT_OUTDOOR_FOG_DENSITY_MUL,
                cloudCoverage: 0.12,
                rainOn: false,
                snowOn: false,
                lightningOn: false,
            },
        },
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
        props: [
            {
                id: 'demo:npc:keeper',
                kind: 'npc-keeper',
                position: { x: 10.5, y: groundY + 1, z: 9.5 },
                yaw: Math.PI * 0.18,
                scale: 1.2,
                gridAligned: true,
            },
            {
                // Sundial on the floating island — the Lantern Trial's
                // interactable. Placed at the centre of the island so
                // the player can reach it via the elevator piston.
                id: 'demo:sundial',
                kind: 'sundial',
                position: { x: 8.5, y: groundY + 4, z: 21.3 },
                yaw: -Math.PI * 0.18,
                scale: 1.4,
                gridAligned: false,
            },
            {
                // Near the spawn plaza so the player can immediately
                // test script-driven player parameter changes.
                id: 'demo:haste-shrine',
                kind: 'haste-shrine',
                position: { x: 14.5, y: groundY + 1, z: 9.5 },
                yaw: Math.PI * 0.08,
                scale: 1.35,
                gridAligned: false,
            },
            {
                // Beside the inactive travel gate; the paid-portal
                // shrine script opens the gate for a short test window.
                id: 'demo:portal-shrine',
                kind: 'portal-shrine',
                position: { x: 4.3, y: groundY + 1, z: 19.8 },
                yaw: -Math.PI * 0.22,
                scale: 1.25,
                gridAligned: false,
            },
        ],
        npcs: [],
        scripts: [],
        size,
    }
}
