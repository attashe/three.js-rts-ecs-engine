import type { Zone } from '../../engine/ecs/zones'
import type { Cinematic } from '../cinematics/cinematic-types'
import { cloneCinematic } from '../cinematics/cinematic-types'
import type { ContentEntrySpec, ContentSpec, Vec3Tuple, VoxelCoord } from './spec-types'
import { WorldgenCompileContext } from './compile-context'
import type { WorldgenLevelDraft } from './level-draft'
import {
    contentDiagnostic,
    contentEntryRequired,
    contentId,
    finiteNumber,
    isRecord,
    positiveNumber,
    readOptionalVec2,
    readOptionalVec3,
    readRequiredString,
    readString,
    resolveContentPosition,
    type WorldgenContentResolveOptions,
} from './content-common'

export function resolveContentMetadata(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    content: ContentSpec,
    opts: WorldgenContentResolveOptions,
): void {
    resolveEnvironment(ctx, draft, content.environment)
    resolveCinematics(ctx, draft, content.cinematics ?? [])
    resolveTravel(ctx, draft, content.travel ?? [], opts)
}

function resolveEnvironment(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, value: unknown): void {
    if (value === undefined) return
    if (!isRecord(value)) {
        ctx.error({ code: 'invalid_feature', message: '$.content.environment must be an object.', path: '$.content.environment', details: { value } })
        return
    }
    const soundId = readString(value.soundId ?? value.sound_id, '')
    if (soundId) {
        draft.environment = {
            soundId,
            volume: clamp01(finiteNumber(value.volume, 0.28)),
        }
        ctx.report.placements.push({ id: 'environment', kind: 'content_environment', soundId })
    }

    const ambientWeather = value.ambientWeather ?? value.ambient_weather ?? value.weather
    if (isRecord(ambientWeather)) {
        const state = isRecord(ambientWeather.state) ? ambientWeather.state : {}
        draft.ambientWeather = {
            ...(typeof ambientWeather.presetId === 'string' ? { presetId: ambientWeather.presetId } : {}),
            ...(typeof ambientWeather.preset_id === 'string' ? { presetId: ambientWeather.preset_id } : {}),
            state,
        }
        ctx.report.placements.push({ id: 'ambient_weather', kind: 'content_ambient_weather', presetId: draft.ambientWeather.presetId })
    }

    resolveSoundSources(ctx, draft, value.soundSources ?? value.sound_sources)
    resolveSoundZones(ctx, draft, value.soundZones ?? value.sound_zones)
    resolveWeatherZones(ctx, draft, value.weatherZones ?? value.weather_zones)
}

function resolveCinematics(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, cinematics: readonly ContentEntrySpec[]): void {
    for (let i = 0; i < cinematics.length; i += 1) {
        const spec = cinematics[i]!
        const path = `$.content.cinematics[${i}]`
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
        if (!id) continue
        if (!Array.isArray(spec.steps)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.steps must be an array of cinematic steps.`,
                path: `${path}.steps`,
                details: { id },
            })
            continue
        }
        const cinematic: Cinematic = {
            id,
            name: readString(spec.name, id),
            ...(typeof spec.playOnStart === 'boolean' ? { playOnStart: spec.playOnStart } : {}),
            ...(typeof spec.play_on_start === 'boolean' ? { playOnStart: spec.play_on_start } : {}),
            ...(typeof spec.letterbox === 'boolean' ? { letterbox: spec.letterbox } : {}),
            ...(typeof spec.freezePlayer === 'boolean' ? { freezePlayer: spec.freezePlayer } : {}),
            ...(typeof spec.freeze_player === 'boolean' ? { freezePlayer: spec.freeze_player } : {}),
            steps: spec.steps as Cinematic['steps'],
        }
        draft.cinematics = [...(draft.cinematics ?? []), cloneCinematic(cinematic)]
        ctx.report.placements.push({ id, kind: 'content_cinematic', stepCount: cinematic.steps.length })
    }
}

function resolveTravel(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    travel: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < travel.length; i += 1) {
        const spec = travel[i]!
        const path = `$.content.travel[${i}]`
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
        if (!id) continue
        const hasPortalTarget = typeof spec.targetLevelId === 'string' || typeof spec.target_level_id === 'string'
        const type = readString(spec.type ?? spec.kind, hasPortalTarget ? 'portal' : 'arrival')
        if (type !== 'arrival' && type !== 'portal') {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.type must be "arrival" or "portal".`,
                path: `${path}.type`,
                details: { id, type },
            })
            continue
        }
        const center = resolveContentPosition(ctx, spec, path, required, opts)
        if (!center) continue
        const half = readOptionalVec2(ctx, spec.half_xz ?? spec.half, `${path}.half_xz`) ?? [1, 1]
        const height = positiveNumber(spec.height, 2.2)
        const baseZone = {
            id,
            kind: type,
            label: typeof spec.label === 'string' ? spec.label : undefined,
            min: { x: center.x - half[0], y: finiteNumber(spec.y_min, center.y), z: center.z - half[1] },
            max: { x: center.x + half[0], y: finiteNumber(spec.y_max, center.y + height), z: center.z + half[1] },
            ...(typeof spec.active === 'boolean' ? { active: spec.active } : {}),
        }
        let zone: Zone = baseZone
        if (type === 'portal') {
            const targetLevelId = readRequiredString(ctx, spec.targetLevelId ?? spec.target_level_id, `${path}.targetLevelId`, required)
            if (!targetLevelId) continue
            zone = {
                ...baseZone,
                portal: {
                    targetLevelId,
                    ...(typeof spec.targetArrivalId === 'string' ? { targetArrivalId: spec.targetArrivalId } : {}),
                    ...(typeof spec.target_arrival_id === 'string' ? { targetArrivalId: spec.target_arrival_id } : {}),
                },
            }
        }
        draft.zones.push(zone)
        ctx.resolveObject(id, center)
        ctx.report.placements.push({ id, kind: 'content_travel', travelKind: type, x: center.x, y: center.y, z: center.z })
    }
}

function resolveSoundSources(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, value: unknown): void {
    if (value === undefined) return
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: '$.content.environment.soundSources must be an array.', path: '$.content.environment.soundSources', details: { value } })
        return
    }
    for (let i = 0; i < value.length; i += 1) {
        const path = `$.content.environment.soundSources[${i}]`
        const spec = value[i]
        if (!isRecord(spec)) {
            ctx.error({ code: 'invalid_feature', message: `${path} must be an object.`, path, details: { value: spec } })
            continue
        }
        const id = readRequiredString(ctx, spec.id, `${path}.id`, true)
        const soundId = readRequiredString(ctx, spec.soundId ?? spec.sound_id, `${path}.soundId`, true)
        const position = readMetadataPosition(ctx, spec, path)
        if (!id || !soundId || !position) continue
        draft.soundSources.push({
            id,
            soundId,
            ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
            position,
            radius: positiveNumber(spec.radius, 12),
            volume: clamp01(finiteNumber(spec.volume, 0.4)),
            loop: spec.loop !== false,
            autoplay: spec.autoplay !== false,
        })
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_sound_source', soundId, x: position.x, y: position.y, z: position.z })
    }
}

function resolveSoundZones(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, value: unknown): void {
    if (value === undefined) return
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: '$.content.environment.soundZones must be an array.', path: '$.content.environment.soundZones', details: { value } })
        return
    }
    for (let i = 0; i < value.length; i += 1) {
        const path = `$.content.environment.soundZones[${i}]`
        const spec = value[i]
        if (!isRecord(spec)) {
            ctx.error({ code: 'invalid_feature', message: `${path} must be an object.`, path, details: { value: spec } })
            continue
        }
        const id = readRequiredString(ctx, spec.id, `${path}.id`, true)
        const soundId = readRequiredString(ctx, spec.soundId ?? spec.sound_id, `${path}.soundId`, true)
        const center = readMetadataPosition(ctx, spec, path)
        if (!id || !soundId || !center) continue
        const size = readSize(ctx, spec.size, `${path}.size`, [6, 4, 6])
        draft.soundZones.push({
            id,
            ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
            min: { x: center.x - size[0] / 2, y: center.y - size[1] / 2, z: center.z - size[2] / 2 },
            max: { x: center.x + size[0] / 2, y: center.y + size[1] / 2, z: center.z + size[2] / 2 },
            soundId,
            volume: clamp01(finiteNumber(spec.volume, 0.35)),
            fadeTime: positiveNumber(spec.fadeTime ?? spec.fade_time, 0.5),
        })
        ctx.resolveObject(id, center)
        ctx.report.placements.push({ id, kind: 'content_sound_zone', soundId, x: center.x, y: center.y, z: center.z })
    }
}

function resolveWeatherZones(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, value: unknown): void {
    if (value === undefined) return
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: '$.content.environment.weatherZones must be an array.', path: '$.content.environment.weatherZones', details: { value } })
        return
    }
    for (let i = 0; i < value.length; i += 1) {
        const path = `$.content.environment.weatherZones[${i}]`
        const spec = value[i]
        if (!isRecord(spec)) {
            ctx.error({ code: 'invalid_feature', message: `${path} must be an object.`, path, details: { value: spec } })
            continue
        }
        const id = readRequiredString(ctx, spec.id, `${path}.id`, true)
        const presetId = readRequiredString(ctx, spec.presetId ?? spec.preset_id, `${path}.presetId`, true)
        const position = readMetadataPosition(ctx, spec, path)
        if (!id || !presetId || !position) continue
        draft.weatherZones.push({
            id,
            ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
            presetId,
            position,
            size: vec3ToObject(readSize(ctx, spec.size, `${path}.size`, [6, 4, 6])),
            ...(typeof spec.enabled === 'boolean' ? { enabled: spec.enabled } : {}),
            addSound: spec.addSound !== false && spec.add_sound !== false,
            ...(typeof spec.soundId === 'string' ? { soundId: spec.soundId } : {}),
            ...(typeof spec.sound_id === 'string' ? { soundId: spec.sound_id } : {}),
            soundVolume: clamp01(finiteNumber(spec.soundVolume ?? spec.sound_volume, 0.35)),
        })
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_weather_zone', presetId, x: position.x, y: position.y, z: position.z })
    }
}

function readMetadataPosition(ctx: WorldgenCompileContext, spec: Record<string, unknown>, path: string): VoxelCoord | null {
    if (isRecord(spec.position) && typeof spec.position.x === 'number' && typeof spec.position.y === 'number' && typeof spec.position.z === 'number') {
        return { x: spec.position.x, y: spec.position.y, z: spec.position.z }
    }
    const tuple = readOptionalVec3(ctx, spec.position, `${path}.position`)
    if (tuple) return { x: tuple[0], y: tuple[1], z: tuple[2] }
    return resolveContentPosition(ctx, spec as ContentEntrySpec, path, true, {})
}

function readSize(ctx: WorldgenCompileContext, value: unknown, path: string, fallback: Vec3Tuple): Vec3Tuple {
    const tuple = readOptionalVec3(ctx, value, path)
    if (!tuple) return fallback
    return [
        Math.max(0.1, tuple[0]),
        Math.max(0.1, tuple[1]),
        Math.max(0.1, tuple[2]),
    ]
}

function vec3ToObject(value: Vec3Tuple): { x: number; y: number; z: number } {
    return { x: value[0], y: value[1], z: value[2] }
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}
