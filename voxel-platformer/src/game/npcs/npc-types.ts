import type { ScriptEntry } from '../../engine/script/types'
import type { Zone } from '../../engine/ecs/zones'
import type { AABB } from '../../engine/voxel/voxel-collide'

export const NPC_MODEL_KINDS = [
    'keeper',
    'player',
] as const

export type NpcModelKind = (typeof NPC_MODEL_KINDS)[number]

export const NPC_MODEL_LABELS: Record<NpcModelKind, string> = {
    keeper: 'Keeper',
    player: 'Player',
}

export interface NpcConfig {
    id: string
    name: string
    model: NpcModelKind
    position: { x: number; y: number; z: number }
    yaw: number
    scale: number
    gridAligned: boolean
    collisionEnabled: boolean
    colliderRadius: number
    colliderHeight: number
    interactionEnabled: boolean
    interactionRadius: number
    interactionPrompt: string
    scriptEnabled: boolean
    scriptSource: string
}

export const DEFAULT_NPC: Omit<NpcConfig, 'id' | 'position'> = {
    name: 'NPC',
    model: 'keeper',
    yaw: 0,
    scale: 1,
    gridAligned: true,
    collisionEnabled: true,
    colliderRadius: 0.35,
    colliderHeight: 1.6,
    interactionEnabled: true,
    interactionRadius: 2.2,
    interactionPrompt: 'Interaction',
    scriptEnabled: true,
    scriptSource: '',
}

export function npcInteractionZoneId(npc: Pick<NpcConfig, 'id'>): string {
    return `npc.${npc.id}.interact`
}

export function npcInteractionZone(npc: NpcConfig): Zone | null {
    if (!npc.interactionEnabled) return null
    const radius = safePositive(npc.interactionRadius, DEFAULT_NPC.interactionRadius)
    const height = Math.max(safePositive(npc.colliderHeight, DEFAULT_NPC.colliderHeight), 1.2)
    return {
        id: npcInteractionZoneId(npc),
        kind: 'interact',
        label: npc.name || npc.id,
        min: {
            x: npc.position.x - radius,
            y: npc.position.y,
            z: npc.position.z - radius,
        },
        max: {
            x: npc.position.x + radius,
            y: npc.position.y + height,
            z: npc.position.z + radius,
        },
        interaction: {
            prompt: npc.interactionPrompt || DEFAULT_NPC.interactionPrompt,
            anchor: {
                x: npc.position.x,
                y: npc.position.y + height,
                z: npc.position.z,
            },
            radius,
        },
    }
}

export function npcCollisionAabb(npc: NpcConfig): AABB | null {
    if (!npc.collisionEnabled) return null
    const radius = safePositive(npc.colliderRadius, DEFAULT_NPC.colliderRadius)
    const height = safePositive(npc.colliderHeight, DEFAULT_NPC.colliderHeight)
    return {
        minX: npc.position.x - radius,
        minY: npc.position.y,
        minZ: npc.position.z - radius,
        maxX: npc.position.x + radius,
        maxY: npc.position.y + height,
        maxZ: npc.position.z + radius,
    }
}

export function npcObstacleId(npc: Pick<NpcConfig, 'id'>, index = 0): number {
    // Negative ids cannot collide with bitecs entity ids. Keep them
    // deterministic so repeated registrations replace the same obstacle.
    let hash = 2166136261
    for (let i = 0; i < npc.id.length; i++) {
        hash ^= npc.id.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return -10_000_000 - ((hash >>> 0) % 8_000_000) - index
}

export function npcScriptEntries(npcs: readonly NpcConfig[]): ScriptEntry[] {
    return npcs
        .filter((npc) => npc.scriptEnabled && npc.scriptSource.trim().length > 0)
        .map((npc) => ({
            id: `npc-script:${npc.id}`,
            name: `${npc.name || npc.id}.npc.js`,
            source: npcScriptSource(npc),
        }))
}

export function npcScriptSource(npc: NpcConfig): string {
    return [
        `const NPC_ID = ${JSON.stringify(npc.id)}`,
        `const NPC_NAME = ${JSON.stringify(npc.name || npc.id)}`,
        `const NPC_INTERACTION = ${JSON.stringify(npcInteractionZoneId(npc))}`,
        `const NPC_ZONE = NPC_INTERACTION`,
        npc.scriptSource,
    ].join('\n')
}

export function copyNpcConfig(npc: NpcConfig): NpcConfig {
    return {
        ...npc,
        position: { ...npc.position },
    }
}

export function normalizeNpcConfig(input: Partial<NpcConfig> & Pick<NpcConfig, 'id' | 'position'>): NpcConfig {
    const model = (NPC_MODEL_KINDS as readonly string[]).includes(String(input.model))
        ? input.model as NpcModelKind
        : DEFAULT_NPC.model
    return {
        id: sanitizeNpcId(input.id || 'npc'),
        name: input.name || DEFAULT_NPC.name,
        model,
        position: { ...input.position },
        yaw: Number.isFinite(input.yaw) ? input.yaw! : DEFAULT_NPC.yaw,
        scale: safePositive(input.scale, DEFAULT_NPC.scale),
        gridAligned: input.gridAligned ?? DEFAULT_NPC.gridAligned,
        collisionEnabled: input.collisionEnabled ?? DEFAULT_NPC.collisionEnabled,
        colliderRadius: safePositive(input.colliderRadius, DEFAULT_NPC.colliderRadius),
        colliderHeight: safePositive(input.colliderHeight, DEFAULT_NPC.colliderHeight),
        interactionEnabled: input.interactionEnabled ?? DEFAULT_NPC.interactionEnabled,
        interactionRadius: safePositive(input.interactionRadius, DEFAULT_NPC.interactionRadius),
        interactionPrompt: input.interactionPrompt || DEFAULT_NPC.interactionPrompt,
        scriptEnabled: input.scriptEnabled ?? DEFAULT_NPC.scriptEnabled,
        scriptSource: input.scriptSource ?? DEFAULT_NPC.scriptSource,
    }
}

export function sanitizeNpcId(value: string): string {
    const cleaned = value.trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return cleaned || 'npc'
}

function safePositive(value: unknown, fallback: number): number {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
}
