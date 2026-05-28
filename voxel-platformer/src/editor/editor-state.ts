import { BLOCK, DEFAULT_PALETTE } from '../engine/voxel/palette'
import { PickupKind } from '../engine/ecs/systems/pickup-system'
import type { VoxelCoord } from '../engine/ecs/world'
import type { ZonePortal, ZoneTriggerSource } from '../engine/ecs/zones'
import type { ScriptEntry } from '../engine/script/types'
import { GameAudio } from '../game/audio'
import type { BrushKind } from './brush'
import type { PistonDirection } from './piston-direction'
import { PROP_KINDS, type EditorProp, type EditorPropKind } from '../game/props/prop-types'
import { DEFAULT_NPC, type NpcConfig, type NpcModelKind } from '../game/npcs/npc-types'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../game/player-settings'
import { DEFAULT_OUTDOOR_FOG_DENSITY_MUL } from '../game/weather-config'
import {
    DEFAULT_STONE_RADIUS,
    DEFAULT_STONE_TIER,
    type StoneFallSpawnerConfig,
    type StonePlacementConfig,
    type StoneSpawnOptions,
    type StoneTierId,
} from '../game/moving-objects'

export type EditorMode =
    | 'select'
    | 'paint'
    | 'erase'
    | 'spawn-pickup'
    | 'place-piston'
    | 'place-spawn'
    | 'place-zone'
    | 'place-sound'
    | 'place-sound-zone'
    | 'place-weather'
    | 'place-prop'
    | 'scatter-props'
    | 'place-npc'
    | 'place-stone'
    | 'place-stone-spawner'

/** Camera view used by the editor. `top-down` enables the working-plane cut;
 *  `orbit` enables free OrbitControls-style scene inspection. */
export type EditorViewMode = 'iso' | 'top-down' | 'orbit'
export type EditorPistonMotion = 'teleport' | 'physical'
export type EditorZoneTriggerMode = ZoneTriggerSource | 'both'
export type PropScatterShape = 'square' | 'circle'

export interface EditorPickup {
    /** World-space pickup position (foot of the visual). Stored in editor
     *  metadata so save/load round-trips preserve the placement. */
    position: { x: number; y: number; z: number }
    /** PickupKind from pickup-system. Only `Gold` for now. */
    kind: number
    /** Gold amount granted on collection. */
    amount: number
    /** Live entity id of the preview mesh in the editor scene, so we can
     *  despawn it when the metadata entry is removed. -1 when not spawned. */
    eid: number
}

/** Editor-side mirror of a `Zone`. Stored in metadata + drives the
 *  zone-render-system. Same shape as the runtime `Zone`, but the editor
 *  generates `id` on placement so the user only worries about kind/label. */
export interface EditorZone {
    id: string
    kind: string
    label?: string
    min: VoxelCoord
    max: VoxelCoord
    triggerSources?: ZoneTriggerSource[]
    portal?: ZonePortal
    interaction?: {
        prompt?: string
        anchor?: VoxelCoord
        radius?: number
    }
    active?: boolean
}

export interface EditorPiston {
    /** Stable script id (`'piston.elevator'`, `'piston-3'`, ...). Auto-
     *  generated on editor placement so every editor-placed piston is
     *  script-targetable by default; absent on pistons loaded from
     *  legacy saves that pre-date the id field. */
    id?: string
    from: VoxelCoord
    to: VoxelCoord
    block: number
    delay: number
    /** Backward-compatible field for old saved metadata. Prefer `delay`. */
    interval?: number
    characterPolicy: 'block' | 'push'
    motion: EditorPistonMotion
    travelTime: number
    /** Asset id to play at the piston's position each time it flips.
     *  Falsy ⇒ no movement sound. Loops are not appropriate here —
     *  the runtime fires one-shots so the cadence matches `delay`. */
    moveSoundId?: string
    /** Per-piston gain multiplier for the move sound (0..1). */
    moveSoundVolume?: number
}

export interface EditorSoundSource {
    id: string
    soundId: string
    label?: string
    position: { x: number; y: number; z: number }
    radius: number
    volume: number
    loop: boolean
    autoplay: boolean
}

export interface EditorPropScatterItem {
    id: string
    kind: EditorPropKind
    enabled: boolean
    /** Expected number of props per brush cell for each scatter stroke. */
    density: number
    /** Base uniform scale for this scatter item. */
    scale: number
    /** Random scale delta as a fraction of `scale`, e.g. 0.25 => ±25%. */
    scaleVariation: number
    /** Base yaw in radians. */
    yaw: number
    /** Random yaw delta in radians around `yaw`. */
    yawVariation: number
}

/**
 * Level-wide ambient bed — a single stereo (non-spatial) sound that
 * plays as long as the player is in the level. Pairs with the
 * music track. Set `soundId` to `null` to skip.
 */
export interface EditorEnvironment {
    soundId: string | null
    volume: number
}

/**
 * Sound zone — an AABB region whose configured sound fades in while
 * the player is inside the box and fades out when they leave.
 * Unlike `EditorSoundSource` (point-source spatial emitter) and
 * `EditorEnvironment` (always-on stereo bed), sound zones are
 * "biome" audio that swaps based on the player's location.
 */
export interface EditorSoundZone {
    id: string
    label?: string
    min: VoxelCoord
    max: VoxelCoord
    soundId: string
    volume: number
    /** Crossfade in seconds applied on enter / leave. */
    fadeTime: number
}

/**
 * Visual FX particle zone — AABB volume that spawns one of the FX
 * package's emitter strategies (rain, fire, magic, lava surface, ...).
 *
 * The runtime translates `presetId` through `ZONE_PRESETS` to fill in
 * colour/count/lifetime/etc., so the editor only stores the slots the
 * user actually edits (preset, position, size, paired sound).
 *
 *  - `position` is the AABB **centre** (matches the FX system).
 *  - `size` is full XYZ extents centred on `position`.
 *  - `addSound = true` plays a looped ambient bed at the zone's
 *    position; `defaultSoundForPreset` picks a default unless the
 *    author overrides `soundId`.
 */
export interface EditorWeatherZone {
    id: string
    label?: string
    presetId: string
    position: { x: number; y: number; z: number }
    size: { x: number; y: number; z: number }
    /** Starts live by default. Scripts can toggle authored zones. */
    enabled?: boolean
    /** "Add sound" checkbox — default on. */
    addSound: boolean
    /** Override paired sound id. Empty / undefined ⇒ use preset default. */
    soundId?: string
    /** Per-zone paired-sound gain (0..1). */
    soundVolume: number
}

/**
 * Level-wide visual environment — sky dome, fog, sun, lightning, drifting
 * rain/snow that follow the camera. Stored as a *snapshot* of every
 * `AmbientWeatherState` field plus the source preset id for re-applying
 * a clean preset in the editor without losing user overrides.
 *
 * Authoring path:
 *   1. Pick a `presetId` from `WEATHER_PRESETS` → state seeds from
 *      `preset.apply` (every field gets a definitive value).
 *   2. Override any field via the editor knobs; the snapshot stores the
 *      *effective* state, not the deltas.
 *   3. Save/load round-trips `presetId` + the snapshot so the editor
 *      remembers which preset card to highlight.
 *
 * `enabled = false` ⇒ runtime skips the ambient pass entirely (the
 * scene uses whatever sky/fog it built — same as the editor when no
 * weather is authored).
 */
export interface EditorAmbientWeather {
    enabled: boolean
    presetId: string
    /** Snapshot of every AmbientWeatherState field. Stored verbatim so
     *  the editor's knobs don't have to recompute deltas vs. a preset. */
    state: AmbientWeatherStateSnapshot
}

/** See `EnvironmentMode` in `engine/fx/core/types.ts`. Duplicated here
 *  to keep the editor → engine import direction one-way. */
export type EditorEnvironmentMode = 'outdoor' | 'indoor' | 'custom'

/** Mirror of `AmbientWeatherState` from `engine/fx/core/types.ts`.
 *  Duplicated here to avoid a `engine → editor` import direction. */
export interface AmbientWeatherStateSnapshot {
    mode: EditorEnvironmentMode
    cycleEnabled: boolean
    cycleSeconds: number
    skyTint: [number, number, number]
    sunIntensityMul: number
    fogDensityMul: number
    skyTop: string
    skyBottom: string
    fogColor: string
    fogDensity: number
    sunIntensity: number
    sunColor: string
    ambientIntensity: number
    ambientColor: string
    timeOfDay: number
    sunAzimuth: number
    rainOn: boolean
    rainCount: number
    rainSpeed: number
    rainOpacity: number
    rainColor: string
    snowOn: boolean
    snowCount: number
    snowSpeed: number
    snowSway: number
    snowOpacity: number
    windX: number
    windZ: number
    windGusts: number
    lightningOn: boolean
    lightningRate: number
    lightningIntensity: number
    lightningColor: string
    cloudCoverage: number
}

export interface EditorState {
    /** Currently-selected palette index for paint mode. */
    activeBlock: number
    /** Currently-selected brush. */
    brush: BrushKind
    /** Drag-brush anchor cell while a drag brush stroke is active. */
    brushDragAnchor: VoxelCoord | null
    /** What clicks do. */
    mode: EditorMode
    /** Last cell the mouse raycast hit (in voxel coords). null when no hit. */
    cursor: VoxelCoord | null
    /** Spawn position the saved level reports back to the game loader. */
    spawn: { x: number; y: number; z: number }
    /** Player defaults applied at this level's spawn. */
    player: PlayerSettings

    /** Pickups placed in the editor — serialised into the level metadata. */
    pickups: EditorPickup[]
    /** Pickup type for spawn-pickup mode. */
    pickupKind: number
    /** Pickup stack amount applied to placed gold piles. */
    pickupAmount: number

    /** Pistons placed in the editor — serialised into the level metadata. */
    pistons: EditorPiston[]
    /** Direction for the next piston placement. */
    pistonDirection: PistonDirection
    /** Cell-count travelled by the next piston (from → to). */
    pistonDistance: number
    /** Seconds a piston waits at each endpoint before moving/flipping. */
    pistonDelay: number
    /** Piston movement implementation for the next placement. */
    pistonMotion: EditorPistonMotion
    /** Seconds a physical piston spends moving between endpoints. */
    pistonTravelTime: number
    /** Character handling on flip — see PistonMechanism.characterPolicy. */
    pistonPolicy: 'block' | 'push'
    /** Sound played on each flip. `null` = no movement sound. Applies
     *  to the *next* piston placement; per-piston overrides live on
     *  the `EditorPiston.moveSound*` fields and on the list panel. */
    pistonMoveSoundId: string | null
    pistonMoveSoundVolume: number

    /** Zones placed in the editor — serialised into the level metadata. */
    zones: EditorZone[]
    /** Kind tag applied to the next placed zone. Free-form string; the
     *  game side decides what it means. */
    zoneKind: string
    /** Optional human-readable label applied to the next placed zone. */
    zoneLabel: string
    /** XZ extent in cells for the next placed zone (centred on the cursor). */
    zoneSize: number
    /** Y extent in cells for the next placed zone (starting at the working plane). */
    zoneHeight: number
    /** Collision source that activates the next placed trigger zone. */
    zoneTriggerMode: EditorZoneTriggerMode
    /** Portal destination applied when the next placed zone has
     *  `kind === "portal"`. */
    portalTargetLevelId: string
    /** Optional destination-zone id inside `portalTargetLevelId`. */
    portalArrivalId: string

    /** Sound sources placed in the editor — serialised into the level metadata. */
    soundSources: EditorSoundSource[]
    /** Currently selected placed sound source for tab-side editing. */
    selectedSoundSourceId: string | null
    /** Sound id applied to the next placed source. */
    soundSourceSoundId: string
    /** Optional label applied to the next placed source. */
    soundSourceLabel: string
    /** Hearing radius / spatial max distance for the next placed source. */
    soundSourceRadius: number
    /** Per-source gain multiplier for the next placed source. */
    soundSourceVolume: number
    /** Whether the next placed source loops. */
    soundSourceLoop: boolean
    /** Whether the next placed source starts during playtest. */
    soundSourceAutoplay: boolean

    /** Level-wide ambient bed (stereo, non-spatial). */
    environment: EditorEnvironment

    /** Sound zones placed in the editor — fade ambient sound in/out
     *  based on player position. */
    soundZones: EditorSoundZone[]
    selectedSoundZoneId: string | null
    /** Sound id applied to the next placed sound zone. */
    soundZoneSoundId: string
    soundZoneLabel: string
    /** XZ extent in cells, centred on the cursor. */
    soundZoneSize: number
    /** Y extent in cells, starting at the working plane. */
    soundZoneHeight: number
    soundZoneVolume: number
    /** Crossfade time for enter/leave. */
    soundZoneFadeTime: number

    /** Local Visual FX particle zones placed in the editor. */
    weatherZones: EditorWeatherZone[]
    selectedWeatherZoneId: string | null
    /** Preset id applied to the next placed effect zone. */
    weatherPresetId: string
    weatherZoneLabel: string
    /** XZ extent in cells, centred on the cursor. */
    weatherZoneSize: number
    /** Y extent in cells, starting at the working plane. */
    weatherZoneHeight: number
    /** "Add sound" checkbox draft — default true. */
    weatherZoneAddSound: boolean
    /** Sound id override for the next placed effect zone. Empty =>
     *  use the preset default from `defaultSoundForPreset`. */
    weatherZoneSoundId: string
    weatherZoneSoundVolume: number

    /** Decorative props placed in the editor (flowers, bushes,
     *  tables, ...). Authoring data only — the runtime system reads
     *  this array directly to drive InstancedMesh slots. */
    props: EditorProp[]
    /** Currently selected prop for tab-side editing. */
    selectedPropId: string | null
    /** Prop kind applied to the next placed prop. */
    propKind: EditorPropKind
    /** Whether the next placed prop snaps to the voxel grid (XZ to
     *  cell centre, Y to surface top). Off = free-float at the raycast
     *  hit point. */
    propGridAlign: boolean
    /** Yaw rotation (radians) applied to the next placed prop. */
    propYaw: number
    /** Uniform scale applied to the next placed prop. */
    propScale: number
    /** Prop scatter brush shape. */
    propScatterShape: PropScatterShape
    /** Scatter brush diameter / side length in cells. */
    propScatterSize: number
    /** Editor-only recipe list used by scatter mode. Scatter strokes emit
     *  ordinary `props`, so this list does not need runtime persistence. */
    propScatterItems: EditorPropScatterItem[]

    /** Static NPCs placed in the editor. Unlike decorative props, NPCs
     *  own interaction/collision/script metadata. */
    npcs: NpcConfig[]
    selectedNpcId: string | null
    npcName: string
    npcModel: NpcModelKind
    npcGridAlign: boolean
    npcYaw: number
    npcScale: number
    npcCollisionEnabled: boolean
    npcColliderRadius: number
    npcColliderHeight: number
    npcInteractionEnabled: boolean
    npcInteractionRadius: number
    npcInteractionPrompt: string
    npcScriptEnabled: boolean
    npcScriptSource: string

    /** Direct physics stones placed in the editor. They spawn at level start. */
    stones: StonePlacementConfig[]
    selectedStoneId: string | null
    stoneTier: StoneTierId
    stoneSize: number
    stoneVelocity: { x: number; y: number; z: number }

    /** Plain JavaScript scripts persisted with the level and run in playtest. */
    scripts: ScriptEntry[]
    /** Falling-stone hazard emitters placed in the editor. */
    stoneSpawners: StoneFallSpawnerConfig[]
    selectedStoneSpawnerId: string | null
    stoneSpawnerTier: StoneTierId
    stoneSpawnerSize: number
    stoneSpawnerVelocity: { x: number; y: number; z: number }
    stoneSpawnerInterval: number
    stoneSpawnerDelay: number
    stoneSpawnerMaxLive: number
    stoneSpawnerJitter: number
    stoneSpawnerEnabled: boolean

    /** Level-wide visual environment (sky / fog / sun / drifting rain
     *  & snow / lightning). Disabled by default. */
    ambientWeather: EditorAmbientWeather

    /** Y-row of the working plane. Used by the cursor system as the placement
     *  Y when no voxel is hit, and (when planeLock is on) overrides voxel
     *  hits so the user can paint a specific layer through existing geometry. */
    workingPlaneY: number
    /** When true, the cursor always uses workingPlaneY regardless of voxel hits. */
    planeLock: boolean

    /** Camera view. In `top-down` mode the camera looks straight down and
     *  the near plane clips everything above `workingPlaneY`; in `orbit`
     *  mode mouse navigation is handled by OrbitControls. */
    viewMode: EditorViewMode
}

/**
 * Default `AmbientWeatherStateSnapshot` — matches the FX package's
 * `defaultAmbientState()` so a freshly-created level looks identical
 * with ambient enabled vs disabled (modulo the sky dome + fog).
 */
export const DEFAULT_AMBIENT_WEATHER: AmbientWeatherStateSnapshot = {
    mode: 'outdoor',
    cycleEnabled: false,
    cycleSeconds: 600,
    skyTint: [1, 1, 1],
    sunIntensityMul: 1,
    fogDensityMul: DEFAULT_OUTDOOR_FOG_DENSITY_MUL,
    skyTop: '#7aa9d4',
    skyBottom: '#c9d9e8',
    fogColor: '#b5c6d6',
    fogDensity: 0.012,
    sunIntensity: 1.1,
    sunColor: '#ffe9c4',
    ambientIntensity: 0.5,
    ambientColor: '#8aa3c4',
    timeOfDay: 12,
    sunAzimuth: 135,
    rainOn: false,
    rainCount: 4000,
    rainSpeed: 22,
    rainOpacity: 0.55,
    rainColor: '#aac8e8',
    snowOn: false,
    snowCount: 2500,
    snowSpeed: 1.8,
    snowSway: 1.2,
    snowOpacity: 0.95,
    windX: 0,
    windZ: 0,
    windGusts: 0.2,
    lightningOn: false,
    lightningRate: 0.25,
    lightningIntensity: 30,
    lightningColor: '#cfe0ff',
    cloudCoverage: 0,
}

export function createEditorState(spawn: { x: number; y: number; z: number }): EditorState {
    // Default to grass (index 1) since it's the most common surface and
    // makes the cursor outline immediately readable.
    const grass = Math.max(1, DEFAULT_PALETTE.entries.findIndex((entry) => entry.name === 'grass'))
    return {
        activeBlock: grass,
        brush: 'single',
        brushDragAnchor: null,
        mode: 'paint',
        cursor: null,
        spawn,
        player: copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        pickups: [],
        pickupKind: PickupKind.Gold,
        pickupAmount: 12,
        pistons: [],
        pistonDirection: 'up',
        pistonDistance: 2,
        pistonDelay: 2,
        pistonMotion: 'teleport',
        pistonTravelTime: 1,
        pistonPolicy: 'push',
        zones: [],
        zoneKind: 'generic',
        zoneLabel: '',
        zoneSize: 4,
        zoneHeight: 3,
        zoneTriggerMode: 'player',
        portalTargetLevelId: '',
        portalArrivalId: '',
        soundSources: [],
        selectedSoundSourceId: null,
        soundSourceSoundId: GameAudio.AmbFire,
        soundSourceLabel: '',
        soundSourceRadius: 12,
        soundSourceVolume: 0.75,
        soundSourceLoop: true,
        soundSourceAutoplay: true,
        environment: { soundId: null, volume: 0.4 },
        soundZones: [],
        selectedSoundZoneId: null,
        soundZoneSoundId: GameAudio.AmbWind,
        soundZoneLabel: '',
        soundZoneSize: 6,
        soundZoneHeight: 4,
        soundZoneVolume: 0.5,
        soundZoneFadeTime: 1.2,
        weatherZones: [],
        selectedWeatherZoneId: null,
        weatherPresetId: 'rain',
        weatherZoneLabel: '',
        weatherZoneSize: 12,
        weatherZoneHeight: 8,
        weatherZoneAddSound: true,
        weatherZoneSoundId: '',
        weatherZoneSoundVolume: 0.5,
        props: [],
        selectedPropId: null,
        propKind: PROP_KINDS[0],
        propGridAlign: true,
        propYaw: 0,
        propScale: 1,
        propScatterShape: 'circle',
        propScatterSize: 5,
        propScatterItems: [],
        npcs: [],
        selectedNpcId: null,
        npcName: DEFAULT_NPC.name,
        npcModel: DEFAULT_NPC.model,
        npcGridAlign: DEFAULT_NPC.gridAligned,
        npcYaw: DEFAULT_NPC.yaw,
        npcScale: DEFAULT_NPC.scale,
        npcCollisionEnabled: DEFAULT_NPC.collisionEnabled,
        npcColliderRadius: DEFAULT_NPC.colliderRadius,
        npcColliderHeight: DEFAULT_NPC.colliderHeight,
        npcInteractionEnabled: DEFAULT_NPC.interactionEnabled,
        npcInteractionRadius: DEFAULT_NPC.interactionRadius,
        npcInteractionPrompt: DEFAULT_NPC.interactionPrompt,
        npcScriptEnabled: DEFAULT_NPC.scriptEnabled,
        npcScriptSource: DEFAULT_NPC.scriptSource,
        stones: [],
        selectedStoneId: null,
        stoneTier: DEFAULT_STONE_TIER,
        stoneSize: DEFAULT_STONE_RADIUS,
        stoneVelocity: { x: 0, y: 0, z: 0 },
        scripts: [],
        stoneSpawners: [],
        selectedStoneSpawnerId: null,
        stoneSpawnerTier: DEFAULT_STONE_TIER,
        stoneSpawnerSize: DEFAULT_STONE_RADIUS,
        stoneSpawnerVelocity: { x: 0, y: -4, z: 0 },
        stoneSpawnerInterval: 2,
        stoneSpawnerDelay: 0,
        stoneSpawnerMaxLive: 4,
        stoneSpawnerJitter: 0,
        stoneSpawnerEnabled: true,
        ambientWeather: {
            // Default to enabled now that an Outdoor mode "just works"
            // without the author hand-picking sky/fog/sun colours — the
            // day-cycle table fills them in at the chosen time.
            enabled: true,
            presetId: 'clear',
            state: { ...DEFAULT_AMBIENT_WEATHER, skyTint: [...DEFAULT_AMBIENT_WEATHER.skyTint] as [number, number, number] },
        },
        pistonMoveSoundId: null,
        pistonMoveSoundVolume: 0.5,
        workingPlaneY: Math.floor(spawn.y),
        planeLock: false,
        viewMode: 'iso',
    }
}

/**
 * Shape of the JSON metadata blob saved inside the level binary. The game's
 * level loader reads this to reconstruct spawn, pickups, pistons, zones, and
 * sound sources on load.
 */
export interface EditorLevelMeta {
    name: string
    spawn: { x: number; y: number; z: number }
    player?: PlayerSettings
    stones?: StonePlacementConfig[]
    stoneSpawners?: StoneFallSpawnerConfig[]
    pickups: Array<{
        position: { x: number; y: number; z: number }
        kind: number
        amount: number
    }>
    pistons: EditorPiston[]
    zones?: EditorZone[]
    soundSources?: EditorSoundSource[]
    /** Level-wide ambient bed. Absent / `soundId: null` ⇒ no env sound. */
    environment?: EditorEnvironment
    /** AABB sound zones that fade ambient audio in/out as the player
     *  enters/leaves them. */
    soundZones?: EditorSoundZone[]
    /** Local Visual FX particle zones (rain, fire, magic, lava surface, ...). */
    weatherZones?: EditorWeatherZone[]
    /** Decorative misc objects (flowers, tables, books, ...). Absent
     *  / empty ⇒ no props in the level. */
    props?: EditorProp[]
    /** Static NPCs with interaction/collision/script metadata. */
    npcs?: NpcConfig[]
    /** Level-wide visual environment snapshot. Absent / `enabled: false`
     *  ⇒ playtest uses the engine's default lighting + sky. */
    ambientWeather?: EditorAmbientWeather
    /** Plain JavaScript scripts run by the script engine during playtest. */
    scripts?: ScriptEntry[]
}

export function toLevelMeta(state: EditorState, name: string): EditorLevelMeta {
    return {
        name,
        spawn: { ...state.spawn },
        player: copyPlayerSettings(state.player),
        stones: state.stones.length === 0 ? undefined : state.stones.map(copyStonePlacement),
        stoneSpawners: state.stoneSpawners.map(copyStoneSpawner),
        pickups: state.pickups.map((p) => ({
            position: { ...p.position },
            kind: p.kind,
            amount: p.amount,
        })),
        pistons: state.pistons.map((p) => ({
            id: p.id,
            from: { ...p.from },
            to: { ...p.to },
            block: p.block,
            delay: p.delay ?? p.interval ?? 2,
            characterPolicy: p.characterPolicy,
            motion: p.motion ?? 'teleport',
            travelTime: p.travelTime ?? 1,
            moveSoundId: p.moveSoundId,
            moveSoundVolume: p.moveSoundVolume,
        })),
        zones: state.zones.map((z) => ({
            id: z.id,
            kind: z.kind,
            label: z.label,
            min: { ...z.min },
            max: { ...z.max },
            triggerSources: z.triggerSources ? [...z.triggerSources] : undefined,
            portal: z.portal ? {
                targetLevelId: z.portal.targetLevelId,
                targetArrivalId: z.portal.targetArrivalId,
            } : undefined,
            interaction: z.interaction ? {
                prompt: z.interaction.prompt,
                anchor: z.interaction.anchor ? { ...z.interaction.anchor } : undefined,
                radius: z.interaction.radius,
            } : undefined,
            active: z.active,
        })),
        soundSources: state.soundSources.map((s) => ({
            id: s.id,
            soundId: s.soundId,
            label: s.label,
            position: { ...s.position },
            radius: s.radius,
            volume: s.volume,
            loop: s.loop,
            autoplay: s.autoplay,
        })),
        environment: state.environment.soundId
            ? { soundId: state.environment.soundId, volume: state.environment.volume }
            : undefined,
        soundZones: state.soundZones.map((z) => ({
            id: z.id,
            label: z.label,
            min: { ...z.min },
            max: { ...z.max },
            soundId: z.soundId,
            volume: z.volume,
            fadeTime: z.fadeTime,
        })),
        weatherZones: state.weatherZones.map((z) => ({
            id: z.id,
            label: z.label,
            presetId: z.presetId,
            position: { ...z.position },
            size: { ...z.size },
            ...(z.enabled === false ? { enabled: false } : {}),
            addSound: z.addSound,
            soundId: z.soundId,
            soundVolume: z.soundVolume,
        })),
        props: state.props.length === 0 ? undefined : state.props.map((p) => ({
            id: p.id,
            kind: p.kind,
            position: { ...p.position },
            yaw: p.yaw,
            scale: p.scale,
            gridAligned: p.gridAligned,
        })),
        npcs: state.npcs.length === 0 ? undefined : state.npcs.map((npc) => ({
            ...npc,
            position: { ...npc.position },
        })),
        scripts: state.scripts.length === 0 ? undefined : state.scripts.map(copyScriptEntry),
        ambientWeather: state.ambientWeather.enabled
            ? {
                enabled: true,
                presetId: state.ambientWeather.presetId,
                state: { ...state.ambientWeather.state },
            }
            : undefined,
    }
}

export function copyStoneSpawner(spawner: StoneFallSpawnerConfig): StoneFallSpawnerConfig {
    const out: StoneFallSpawnerConfig = {
        position: { ...spawner.position },
        velocity: { ...spawner.velocity },
        interval: spawner.interval,
    }
    if (spawner.id !== undefined) out.id = spawner.id
    if (spawner.enabled !== undefined) out.enabled = spawner.enabled
    if (spawner.delay !== undefined) out.delay = spawner.delay
    if (spawner.maxLive !== undefined) out.maxLive = spawner.maxLive
    if (spawner.jitter !== undefined) out.jitter = spawner.jitter
    if (spawner.tier !== undefined) out.tier = spawner.tier
    if (spawner.size !== undefined) out.size = spawner.size
    if (spawner.options) out.options = copyStoneSpawnOptions(spawner.options)
    return out
}

export function copyStonePlacement(stone: StonePlacementConfig): StonePlacementConfig {
    const out: StonePlacementConfig = {
        position: { ...stone.position },
    }
    if (stone.id !== undefined) out.id = stone.id
    if (stone.velocity !== undefined) out.velocity = { ...stone.velocity }
    if (stone.enabled !== undefined) out.enabled = stone.enabled
    if (stone.tier !== undefined) out.tier = stone.tier
    if (stone.size !== undefined) out.size = stone.size
    if (stone.options) out.options = copyStoneSpawnOptions(stone.options)
    return out
}

function copyStoneSpawnOptions(options: StoneSpawnOptions): StoneSpawnOptions {
    return { ...options }
}

export function copyScriptEntry(entry: ScriptEntry): ScriptEntry {
    const out: ScriptEntry = {
        id: entry.id,
        name: entry.name,
        source: entry.source,
    }
    if (entry.fromFile !== undefined) out.fromFile = entry.fromFile
    if (entry.sourcePath !== undefined) out.sourcePath = entry.sourcePath
    if (entry.enabled !== undefined) out.enabled = entry.enabled
    return out
}

/** Re-export so editor-ui only needs editor-state to know default block ids. */
export { BLOCK }
