import type { ScriptEntry } from '../../engine/script/types'
import type { Zone } from '../../engine/ecs/zones'
import type { AABB } from '../../engine/voxel/voxel-collide'
import {
    copyHandLoadout,
    handLoadoutKey,
    isHammerEquipmentKind,
    isStaffEquipmentKind,
    normalizeHandLoadout,
    type EquipmentHandLoadout,
} from '../anim/equipment-types'
import { normalizeCharacterBeard, type CharacterBeardKind } from '../character-appearance'
import {
    defaultDialogueVoiceForNpcModel,
    normalizeDialogueVoice,
} from '../dialogue-voice/presets'
import type { DialogueVoiceRef } from '../dialogue-voice/types'

export const NPC_MODEL_KINDS = [
    'keeper',
    'keeper-arlen',
    'player',
    'large-troll',
] as const

export type NpcModelKind = (typeof NPC_MODEL_KINDS)[number]

export const NPC_MODEL_LABELS: Record<NpcModelKind, string> = {
    keeper: 'Dwarf',
    'keeper-arlen': 'Keeper Arlen',
    player: 'Player',
    'large-troll': 'Large Troll',
}

export const TROLL_OUTFIT_KINDS = [
    'wise',
    'guardian',
] as const

export type TrollOutfitKind = (typeof TROLL_OUTFIT_KINDS)[number]
export type NpcVariantKind = 'default' | TrollOutfitKind

export const TROLL_OUTFIT_LABELS: Record<TrollOutfitKind, string> = {
    wise: 'Wise Troll',
    guardian: 'Troll Guardian',
}

export type NpcAttackClip = 'attack' | 'staffAttack' | 'hammerAttack'

export interface NpcConfig {
    id: string
    name: string
    model: NpcModelKind
    /** Model-specific outfit/variant selector. Non-variant models use
     *  `'default'`; large trolls use `'wise'` or `'guardian'`. */
    variant: NpcVariantKind
    beard: CharacterBeardKind
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
    /** When true the NPC ignores all damage (melee, arrows, spells, lava,
     *  falling stones) — useful for essential/quest characters. */
    invulnerable: boolean
    equipment: EquipmentHandLoadout
    voice: DialogueVoiceRef
    scriptEnabled: boolean
    scriptSource: string
}

export interface Vec3Like { x: number; y: number; z: number }

/**
 * Optional, script-driven "brain" for an NPC. Absent (`null`) until a script
 * (or level setup) gives the NPC a patrol/guard post. Deliberately tiny: a list
 * of waypoints to walk (one point = a guard who stands its post), a perception
 * radius, and a script-defined notion of who counts as an enemy. There is no
 * faction matrix — hostility is whatever scripts set.
 */
export interface NpcAiState {
    /** World-space patrol points. Empty = no patrol; 1 = guard/stand there. */
    waypoints: Vec3Like[]
    waypointIndex: number
    /** Post the NPC holds / returns to when not engaging (its spawn by default). */
    home: Vec3Like
    perceptionRadius: number
    /** Whether the player is treated as an enemy. */
    hostileToPlayer: boolean
    /** Other NPC ids treated as enemies. */
    hostileIds: Set<string>
    // ── runtime ── (engaging iff `targetId !== null`; "mode" is derived)
    path: Vec3Like[] | null
    pathIndex: number
    /** Current enemy: the `'player'` sentinel or an NPC id; null when none. */
    targetId: string | null
    /** True once we've emitted `npc-spotted-enemy` for the current engagement. */
    announcedTarget: boolean
    repathCooldown: number
    attackCooldown: number
    thinkCooldown: number
}

/** Per-NPC gameplay/animation runtime state, keyed by NPC id in
 *  `world.npcRuntimeById`. NPCs aren't ECS entities, so this is their combat
 *  state: the melee system + scripts write the request flags; the npc-render
 *  system reads them to drive the AnimationController and despawn on death. */
export interface NpcRuntimeState {
    id: string
    position: { x: number; y: number; z: number }
    /** Facing yaw, updated by the behaviour system as the NPC moves. */
    yaw: number
    /** Collider footprint, mirrored from the config so a moving NPC can keep its
     *  obstacle-registry box (and path-blocker footprint) in sync. */
    colliderRadius: number
    colliderHeight: number
    hp: number
    /** Mirrors `NpcConfig.invulnerable`; damage helpers no-op when set. */
    invulnerable: boolean
    requestAttack: boolean
    /** One-shot animation requested by behaviour/scripts. Defaults to the
     *  runtime's configured attack clip when omitted. */
    requestAttackClip?: NpcAttackClip
    requestDie: boolean
    dying: boolean
    /** Attack style inferred from the authored NPC loadout at registration. */
    attackClip?: NpcAttackClip
    /** Delayed circular impact for heavy overhead attacks. */
    pendingHammerHit?: NpcPendingHammerHit
    /** Patrol/guard brain; null until a script assigns one. */
    ai: NpcAiState | null
    /** Registration handles, so a despawning NPC can free exactly its own zone +
     *  obstacle (see `disposeNpc`). */
    zoneId: string | null
    obstacleId: number | null
    /** Arrows currently embedded in the body. Each entry is the (frozen) arrow
     *  entity id plus its offset from the NPC's foot origin at impact, so the
     *  stuck-arrow system can keep them riding the body as it moves. Lazily
     *  created on the first hit; absent until then. */
    stuckArrows?: StuckArrow[]
}

export interface NpcPendingHammerHit {
    seconds: number
    x: number
    y: number
    z: number
    radius: number
    damage: number
    targetId: string
}

/** A frozen arrow embedded in an NPC body, tracked so it follows the NPC. */
export interface StuckArrow {
    eid: number
    /** Offset of the arrow from the NPC's foot origin at the moment of impact. */
    ox: number
    oy: number
    oz: number
}

export const NPC_DEFAULT_HP = 2

/**
 * Apply `amount` damage to an NPC, honouring invulnerability. Flags the NPC to
 * die (death anim + despawn) when it drops to 0. The single damage entry point
 * for melee, arrows, spells, and falling stones. Returns true if this hit was
 * lethal.
 */
export function damageNpc(npc: NpcRuntimeState, amount: number): boolean {
    if (npc.invulnerable || npc.dying || !(amount > 0)) return false
    npc.hp -= amount
    if (npc.hp <= 0) {
        npc.requestDie = true
        npc.dying = true
        return true
    }
    return false
}

/** Outright kill an NPC (e.g. lava), honouring invulnerability. */
export function killNpc(npc: NpcRuntimeState): void {
    if (npc.invulnerable || npc.dying) return
    npc.hp = 0
    npc.requestDie = true
    npc.dying = true
}

export const DEFAULT_NPC: Omit<NpcConfig, 'id' | 'position'> = {
    name: 'NPC',
    model: 'keeper',
    variant: defaultNpcVariant('keeper'),
    beard: defaultNpcBeard('keeper'),
    yaw: 0,
    scale: 1,
    gridAligned: true,
    collisionEnabled: true,
    colliderRadius: 0.35,
    colliderHeight: 1.6,
    interactionEnabled: true,
    interactionRadius: 2.2,
    interactionPrompt: 'Interaction',
    invulnerable: false,
    equipment: defaultNpcEquipment('keeper'),
    voice: defaultNpcVoice('keeper'),
    scriptEnabled: true,
    scriptSource: '',
}

export function defaultNpcVariant(model: NpcModelKind): NpcVariantKind {
    return model === 'large-troll' ? 'wise' : 'default'
}

export function normalizeNpcVariant(model: NpcModelKind, value: unknown): NpcVariantKind {
    if (model !== 'large-troll') return 'default'
    return (TROLL_OUTFIT_KINDS as readonly string[]).includes(String(value))
        ? value as TrollOutfitKind
        : 'wise'
}

export function defaultNpcBeard(model: NpcModelKind, variant: NpcVariantKind = defaultNpcVariant(model)): CharacterBeardKind {
    switch (model) {
        case 'keeper':
        case 'keeper-arlen':
            return 'full'
        case 'large-troll':
            return normalizeNpcVariant(model, variant) === 'guardian' ? 'full' : 'pointed'
        case 'player':
            return 'none'
    }
}

export function defaultNpcEquipment(model: NpcModelKind, variant: NpcVariantKind = defaultNpcVariant(model)): EquipmentHandLoadout {
    switch (model) {
        case 'keeper':
        case 'keeper-arlen':
            return { handR: 'staff', handL: null }
        case 'large-troll':
            return normalizeNpcVariant(model, variant) === 'guardian'
                ? { handR: 'battle-hammer', handL: null }
                : { handR: null, handL: 'book' }
        case 'player':
            return { handR: null, handL: null }
    }
}

export function defaultNpcVoice(model: NpcModelKind): DialogueVoiceRef {
    return compactNpcVoice(normalizeDialogueVoice(defaultDialogueVoiceForNpcModel(model)))
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
        `const NPC_VOICE = ${JSON.stringify(npc.voice)}`,
        npc.scriptSource,
    ].join('\n')
}

export function copyNpcConfig(npc: NpcConfig): NpcConfig {
    return {
        ...npc,
        position: { ...npc.position },
        equipment: copyHandLoadout(npc.equipment),
        voice: { ...npc.voice },
    }
}

export function normalizeNpcConfig(input: Partial<NpcConfig> & Pick<NpcConfig, 'id' | 'position'>): NpcConfig {
    const model = (NPC_MODEL_KINDS as readonly string[]).includes(String(input.model))
        ? input.model as NpcModelKind
        : DEFAULT_NPC.model
    const variant = normalizeNpcVariant(model, input.variant)
    return {
        id: sanitizeNpcId(input.id || 'npc'),
        name: input.name || DEFAULT_NPC.name,
        model,
        variant,
        beard: normalizeCharacterBeard(input.beard, defaultNpcBeard(model, variant)),
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
        invulnerable: input.invulnerable ?? DEFAULT_NPC.invulnerable,
        equipment: normalizeHandLoadout(input.equipment, defaultNpcEquipment(model, variant)),
        voice: compactNpcVoice(normalizeDialogueVoice(input.voice, defaultNpcVoice(model))),
        scriptEnabled: input.scriptEnabled ?? DEFAULT_NPC.scriptEnabled,
        scriptSource: input.scriptSource ?? DEFAULT_NPC.scriptSource,
    }
}

export function npcEquipmentKey(npc: Pick<NpcConfig, 'equipment'>): string {
    return handLoadoutKey(npc.equipment)
}

export function npcAttackClip(npc: Pick<NpcConfig, 'equipment'>): NpcAttackClip {
    if (isHammerEquipmentKind(npc.equipment.handR) || isHammerEquipmentKind(npc.equipment.handL)) return 'hammerAttack'
    if (isStaffEquipmentKind(npc.equipment.handR) || isStaffEquipmentKind(npc.equipment.handL)) return 'staffAttack'
    return 'attack'
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

function compactNpcVoice(voice: DialogueVoiceRef): DialogueVoiceRef {
    return {
        preset: voice.preset,
        seed: voice.seed,
        enabled: voice.enabled,
        volume: voice.volume,
        rate: voice.rate,
        pitchOffset: voice.pitchOffset,
    }
}
