import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { Zone } from '../engine/ecs/zones'
import type { PistonMechanismConfig } from './mechanisms'
import { STONE_TIER, type StoneFallSpawnerConfig } from './moving-objects'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from './sound-sources'
import type { AmbientWeatherRuntimeConfig, WeatherZoneRuntimeConfig } from './weather-config'
import type { EditorProp } from './props/prop-types'
import type { ScriptEntry } from '../engine/script/types'

export interface CoinPileSpawn {
    position: { x: number; y: number; z: number }
    amount?: number
}

export interface LevelMeta {
    /** World-space spawn position (X, Y, Z). Y is standing height (one above topmost solid). */
    spawn: { x: number; y: number; z: number }
    /** Falling-stone emitter configs. */
    stoneSpawners: StoneFallSpawnerConfig[]
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
    /** Plain JavaScript scripts run by the script engine. */
    scripts: ScriptEntry[]
    /** Level-wide visual environment snapshot (sky/fog/sun/drifting
     *  rain & snow). Optional — absent ⇒ engine defaults. */
    ambientWeather?: AmbientWeatherRuntimeConfig
    /** XZ extent of the generated level, used by the demo to centre the camera. */
    size: number
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
            from: { x: 8, y: groundY + 1, z: 21 },
            to: { x: 8, y: groundY + 3, z: 21 },
            block: BLOCK.plank,
            delay: 3,
            characterPolicy: 'push',
        },
        {
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
                prompt: 'Examine',
                anchor: { x: 8.5, y: groundY + 4.8, z: 21.3 },
                radius: 2.4,
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
    ]

    return {
        spawn: { x: size / 2, y: groundY + 1, z: size / 2 },
        stoneSpawners,
        coinPiles,
        pistons,
        zones,
        soundSources: [],
        soundZones: [],
        // Demo level keeps the existing background music bed. Editor-
        // authored levels start with `environment: undefined` and the
        // user picks (or clears) the track from the Sound tab.
        environment: { soundId: 'music.background', volume: 0.36 },
        weatherZones: [],
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
        ],
        scripts: [],
        size,
    }
}
