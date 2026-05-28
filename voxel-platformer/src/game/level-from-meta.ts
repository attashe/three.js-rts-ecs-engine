import { copyScriptEntry, copyStoneSpawner, copyZoneScriptAction, type EditorLevelMeta } from '../editor/editor-state'
import type { Zone } from '../engine/ecs/zones'
import type { LevelMeta, CoinPileSpawn } from './level'
import type { PistonMechanismConfig } from './mechanisms'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from './sound-sources'
import type { AmbientWeatherRuntimeConfig, WeatherZoneRuntimeConfig } from './weather-config'
import { normalizeNpcConfig } from './npcs/npc-types'
import { normalizePlayerSettings } from './player-settings'

/**
 * Translate an editor-authored level (`EditorLevelMeta` + already-deserialized
 * chunks) into the runtime `LevelMeta` the game's `client.ts` expects. Only
 * the editor-authored bits map across — there are no editor controls for
 * stone spawners yet, so that array comes back empty. Levels played via the
 * editor's "Playtest" button therefore have no falling-stone hazards, which
 * is the right default while the editor doesn't expose spawner placement.
 */
export function levelMetaFromEditor(meta: EditorLevelMeta, fallbackSize: number = 32): LevelMeta {
    const coinPiles: CoinPileSpawn[] = meta.pickups.map((p) => ({
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        amount: p.amount,
    }))

    const pistons: PistonMechanismConfig[] = meta.pistons.map((p) => ({
        from: { x: p.from.x, y: p.from.y, z: p.from.z },
        to: { x: p.to.x, y: p.to.y, z: p.to.z },
        block: p.block,
        delay: p.delay ?? p.interval ?? 2,
        characterPolicy: p.characterPolicy,
        motion: p.motion ?? 'teleport',
        travelTime: p.travelTime ?? 1,
        moveSoundId: p.moveSoundId || undefined,
        moveSoundVolume: clamp(p.moveSoundVolume ?? 1, 0, 1, 1),
    }))

    const zones: Zone[] = (meta.zones ?? []).map((z) => ({
        id: z.id,
        kind: z.kind ?? 'generic',
        label: z.label,
        min: { ...z.min },
        max: { ...z.max },
        triggerSources: z.triggerSources ? [...z.triggerSources] : undefined,
        script: z.script ? {
            actions: z.script.actions.map(copyZoneScriptAction),
        } : undefined,
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
    }))

    const soundSources: SoundSourceConfig[] = (meta.soundSources ?? []).map((s) => ({
        id: s.id,
        soundId: s.soundId,
        label: s.label,
        position: { ...s.position },
        radius: clamp(s.radius, 0.5, 200, 12),
        volume: clamp(s.volume, 0, 1, 1),
        loop: s.loop ?? true,
        autoplay: s.autoplay ?? true,
    }))

    const soundZones: SoundZoneConfig[] = (meta.soundZones ?? []).map((z) => ({
        id: z.id,
        label: z.label,
        min: { ...z.min },
        max: { ...z.max },
        soundId: z.soundId,
        volume: clamp(z.volume, 0, 1, 0.5),
        fadeTime: clamp(z.fadeTime, 0, 10, 1.2),
    }))

    const environment: EnvironmentConfig | undefined = meta.environment?.soundId
        ? { soundId: meta.environment.soundId, volume: clamp(meta.environment.volume, 0, 1, 0.4) }
        : undefined

    const weatherZones: WeatherZoneRuntimeConfig[] = (meta.weatherZones ?? []).map((z) => ({
        id: z.id,
        label: z.label,
        presetId: z.presetId,
        position: { ...z.position },
        size: { ...z.size },
        addSound: z.addSound ?? true,
        soundId: z.soundId,
        soundVolume: clamp(z.soundVolume, 0, 1, 0.5),
    }))

    const ambientWeather: AmbientWeatherRuntimeConfig | undefined = meta.ambientWeather?.enabled
        ? {
            presetId: meta.ambientWeather.presetId,
            state: { ...meta.ambientWeather.state },
        }
        : undefined

    const props = (meta.props ?? []).map((p) => ({
        id: p.id,
        kind: p.kind,
        position: { ...p.position },
        yaw: p.yaw,
        scale: p.scale,
        gridAligned: p.gridAligned,
    }))

    const npcs = (meta.npcs ?? []).map((npc) => normalizeNpcConfig({
        ...npc,
        position: { ...npc.position },
    }))

    return {
        name: meta.name?.trim() || 'untitled',
        spawn: { x: meta.spawn.x, y: meta.spawn.y, z: meta.spawn.z },
        player: normalizePlayerSettings(meta.player),
        stoneSpawners: (meta.stoneSpawners ?? []).map(copyStoneSpawner),
        coinPiles,
        pistons,
        zones,
        soundSources,
        soundZones,
        environment,
        weatherZones,
        props,
        npcs,
        scripts: (meta.scripts ?? []).map(copyScriptEntry),
        ambientWeather,
        size: fallbackSize,
    }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback
    return Math.max(min, Math.min(max, value))
}
