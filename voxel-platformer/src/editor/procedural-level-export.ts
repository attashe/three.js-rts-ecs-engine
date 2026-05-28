import { PickupKind } from '../engine/ecs/systems/pickup-system'
import { ChunkManager } from '../engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../engine/voxel/palette'
import { serializeLevel } from '../engine/voxel/level-serializer'
import {
    DEFAULT_AMBIENT_WEATHER,
    copyScriptEntry,
    copyStoneSpawner,
    copyZoneScriptAction,
    type EditorLevelMeta,
} from './editor-state'
import {
    generateProceduralLevel,
    getProceduralLevelDefinition,
    type ProceduralScriptSources,
} from '../game/procedural-levels'
import type { LevelMeta } from '../game/level'
import { copyPlayerSettings } from '../game/player-settings'

export interface ProceduralEditorLevel {
    readonly id: string
    readonly file: string
    readonly name: string
    readonly chunks: ChunkManager
    readonly runtimeMeta: LevelMeta
    readonly editorMeta: EditorLevelMeta
    readonly buffer: ArrayBuffer
}

export function createProceduralEditorLevel(
    id: string,
    scriptSources: ProceduralScriptSources,
): ProceduralEditorLevel {
    const definition = getProceduralLevelDefinition(id)
    if (!definition) throw new Error(`Unknown procedural level "${id}"`)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const runtimeMeta = generateProceduralLevel(definition.id, chunks, scriptSources)
    const editorMeta = editorMetaFromRuntimeLevel(runtimeMeta)
    const buffer = serializeLevel(chunks, editorMeta)
    return {
        id: definition.id,
        file: definition.file,
        name: definition.name,
        chunks,
        runtimeMeta,
        editorMeta,
        buffer,
    }
}

/*
 * Procedural demos are authored as runtime LevelMeta so they can use systems
 * the editor cannot place yet. This adapter snapshots them into a normal
 * .vplevel payload so project-library loading, travel, and playtest all
 * exercise the same save/load path.
 */
export function editorMetaFromRuntimeLevel(meta: LevelMeta): EditorLevelMeta {
    return {
        name: meta.name,
        spawn: { ...meta.spawn },
        player: copyPlayerSettings(meta.player),
        stoneSpawners: meta.stoneSpawners.map(copyStoneSpawner),
        pickups: meta.coinPiles.map((pile) => ({
            position: { ...pile.position },
            kind: PickupKind.Gold,
            amount: pile.amount ?? 1,
        })),
        pistons: meta.pistons.map((piston) => ({
            id: piston.id,
            from: { ...piston.from },
            to: { ...piston.to },
            block: piston.block,
            delay: piston.delay ?? piston.interval ?? 2,
            motion: piston.motion ?? 'teleport',
            travelTime: piston.travelTime ?? 1,
            characterPolicy: piston.characterPolicy ?? 'block',
            moveSoundId: piston.moveSoundId,
            moveSoundVolume: piston.moveSoundVolume,
        })),
        zones: meta.zones.map((zone) => ({
            id: zone.id,
            kind: zone.kind,
            label: zone.label,
            min: { ...zone.min },
            max: { ...zone.max },
            triggerSources: zone.triggerSources ? [...zone.triggerSources] : undefined,
            script: zone.script ? {
                actions: zone.script.actions.map(copyZoneScriptAction),
            } : undefined,
            portal: zone.portal ? { ...zone.portal } : undefined,
            interaction: zone.interaction ? {
                prompt: zone.interaction.prompt,
                anchor: zone.interaction.anchor ? { ...zone.interaction.anchor } : undefined,
                radius: zone.interaction.radius,
            } : undefined,
            active: zone.active,
        })),
        soundSources: meta.soundSources.map((source) => ({
            id: source.id,
            soundId: source.soundId,
            label: source.label,
            position: { ...source.position },
            radius: source.radius,
            volume: source.volume,
            loop: source.loop,
            autoplay: source.autoplay,
        })),
        environment: meta.environment ? { ...meta.environment } : undefined,
        soundZones: meta.soundZones.map((zone) => ({
            id: zone.id,
            label: zone.label,
            min: { ...zone.min },
            max: { ...zone.max },
            soundId: zone.soundId,
            volume: zone.volume,
            fadeTime: zone.fadeTime,
        })),
        weatherZones: meta.weatherZones.map((zone) => ({
            id: zone.id,
            label: zone.label,
            presetId: zone.presetId,
            position: { ...zone.position },
            size: { ...zone.size },
            ...(zone.enabled === false ? { enabled: false } : {}),
            addSound: zone.addSound,
            soundId: zone.soundId,
            soundVolume: zone.soundVolume,
        })),
        props: meta.props.map((prop) => ({
            id: prop.id,
            kind: prop.kind,
            position: { ...prop.position },
            yaw: prop.yaw,
            scale: prop.scale,
            gridAligned: prop.gridAligned,
        })),
        npcs: meta.npcs.map((npc) => ({
            ...npc,
            position: { ...npc.position },
        })),
        ambientWeather: meta.ambientWeather ? {
            enabled: true,
            presetId: meta.ambientWeather.presetId ?? 'clear',
            state: {
                ...DEFAULT_AMBIENT_WEATHER,
                ...meta.ambientWeather.state,
                skyTint: cloneSkyTint(meta.ambientWeather.state.skyTint),
            },
        } : undefined,
        scripts: meta.scripts.map(copyScriptEntry),
    }
}

function cloneSkyTint(value: unknown): [number, number, number] {
    if (!Array.isArray(value) || value.length < 3) {
        return [...DEFAULT_AMBIENT_WEATHER.skyTint] as [number, number, number]
    }
    const r = Number(value[0])
    const g = Number(value[1])
    const b = Number(value[2])
    return [
        Number.isFinite(r) ? r : 1,
        Number.isFinite(g) ? g : 1,
        Number.isFinite(b) ? b : 1,
    ]
}
