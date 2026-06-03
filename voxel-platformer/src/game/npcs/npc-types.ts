import type { ScriptEntry } from '../../engine/script/types'
import type { Zone } from '../../engine/ecs/zones'
import type { AABB } from '../../engine/voxel/voxel-collide'
import type { NpcImpactState } from '../../engine/ecs/melee-types'
import {
    copyHandLoadout,
    handLoadoutKey,
    isBowEquipmentKind,
    isHammerEquipmentKind,
    isSpearEquipmentKind,
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
    'rabbit',
    'archer',
    'shield-warrior',
    'shield-spearman',
] as const

export type NpcModelKind = (typeof NPC_MODEL_KINDS)[number]

export const NPC_MODEL_LABELS: Record<NpcModelKind, string> = {
    keeper: 'Dwarf',
    'keeper-arlen': 'Keeper Arlen',
    player: 'Player',
    'large-troll': 'Large Troll',
    rabbit: 'Rabbit',
    archer: 'Archer',
    'shield-warrior': 'Shield Warrior',
    'shield-spearman': 'Shield Spearman',
}

export const TROLL_OUTFIT_KINDS = [
    'wise',
    'guardian',
    'king',
    'princess',
    'trader',
    'child',
] as const

export type TrollOutfitKind = (typeof TROLL_OUTFIT_KINDS)[number]
export type NpcVariantKind = 'default' | TrollOutfitKind

export const TROLL_OUTFIT_LABELS: Record<TrollOutfitKind, string> = {
    wise: 'Wise Troll',
    guardian: 'Troll Guardian',
    king: 'Troll King',
    princess: 'Troll Princess',
    trader: 'Troll Trader',
    child: 'Troll Child',
}

export type NpcAttackClip = 'attack' | 'spearAttack' | 'staffAttack' | 'hammerAttack' | 'shoot'

export interface NpcShieldGuardState {
    raised: boolean
    arcCos: number
    minY: number
    maxY: number
    cooldownSeconds?: number
}

export interface NpcConfig {
    id: string
    name: string
    model: NpcModelKind
    /** Model-specific outfit/variant selector. Non-variant models use
     *  `'default'`; large trolls use the `TROLL_OUTFIT_KINDS` set. */
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
    /** When true the NPC never turns hostile from being hit by the player —
     *  it cannot be provoked into combat. Use for essential/quest characters
     *  (e.g. Keeper Arlen) so a stray swing doesn't make them fight back. */
    unprovokable?: boolean
    /** Seconds an aggro'd NPC keeps pursuing a target it has lost sight of —
     *  charging the last-known position (and the shot's origin when sniped from
     *  beyond perception) before giving up. `0` (default) = no memory: the NPC
     *  only engages what's currently in its perception radius. Raise it for a
     *  hunter that punishes hit-and-run / sniping. */
    threatMemorySeconds?: number
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
    /** Prey behaviour: when true the NPC never attacks and instead flees any
     *  perceived threat (the player / hostile ids). Default false. */
    flee?: boolean
    // ── threat memory (only active when `rt.threatMemorySeconds > 0`) ──
    /** Whether `targetId` is currently *perceived* (in range → track live and
     *  attack) vs only *remembered* (lost → walk to `threatPos`, don't attack). */
    targetPerceived: boolean
    /** Countdown of remembered pursuit; while > 0 the NPC keeps chasing a lost
     *  target's `threatPos`. Refreshed on every live sighting; 0 = forget. */
    threatSeconds: number
    /** Last position the target was seen / the attack came from. */
    threatPos: Vec3Like | null
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
    maxHp?: number
    /** Mirrors `NpcConfig.invulnerable`; damage helpers no-op when set. */
    invulnerable: boolean
    /** Mirrors `NpcConfig.unprovokable`; when set, a player hit never flips the
     *  NPC hostile (see `damageNpc`). */
    unprovokable?: boolean
    /** Mirrors `NpcConfig.threatMemorySeconds`; 0/undefined = no pursuit memory.
     *  Read by the behaviour system to chase a lost target's last-known spot. */
    threatMemorySeconds?: number
    requestAttack: boolean
    /** One-shot animation requested by behaviour/scripts. Defaults to the
     *  runtime's configured attack clip when omitted. */
    requestAttackClip?: NpcAttackClip
    requestDie: boolean
    /** One-shot: a non-lethal hit landed this frame. Consumed by npc-render
     *  to fire the hurt sound; lethal hits set `requestDie` instead. */
    requestHurt?: boolean
    /** One-shot: the player landed a (surviving) hit this frame. The behaviour
     *  system consumes it to turn the NPC hostile (`provokeFromPlayerAttack`)
     *  and clears it. Set by `damageNpc`; `unprovokable` NPCs are filtered on
     *  consume, not here. */
    provoked?: boolean
    dying: boolean
    /** Attack style inferred from the authored NPC loadout at registration. */
    attackClip?: NpcAttackClip
    /** Lightweight kinematic knockback/recoil applied by timed melee hits. */
    push?: NpcImpactState
    /** Optional combat stun; default attacks leave it unset/zero. */
    stunSeconds?: number
    /** Raised-front shield guard used by shield spearmen. */
    shieldGuard?: NpcShieldGuardState
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

/** A frozen arrow embedded in an NPC body, tracked so it follows the NPC. */
export interface StuckArrow {
    eid: number
    /** Offset of the arrow from the NPC's foot origin at the moment of impact. */
    ox: number
    oy: number
    oz: number
}

export const NPC_DEFAULT_HP = 2
export const TROLL_DEFAULT_HP = 5
export const RABBIT_DEFAULT_HP = 1
export const SHIELD_WARRIOR_DEFAULT_HP = 4
export const SHIELD_SPEARMAN_DEFAULT_HP = 4

export const NPC_SHIELD_GUARD_ARC_COS = Math.cos((65 * Math.PI) / 180)
export const NPC_SHIELD_GUARD_MIN_Y = -0.2
export const NPC_SHIELD_GUARD_MAX_Y = 1.75

export function npcDefaultHp(npc: Pick<NpcConfig, 'model'>): number {
    switch (npc.model) {
        case 'large-troll': return TROLL_DEFAULT_HP
        case 'rabbit': return RABBIT_DEFAULT_HP
        case 'shield-spearman': return SHIELD_SPEARMAN_DEFAULT_HP
        case 'shield-warrior': return SHIELD_WARRIOR_DEFAULT_HP
        default: return NPC_DEFAULT_HP
    }
}

/** Optional context for a damage application. */
export interface NpcDamageOptions {
    /** The hit came from the player. A provokable NPC (not `unprovokable`,
     *  not prey) turns hostile to the player and fights back. */
    byPlayer?: boolean
}

/**
 * Apply `amount` damage to an NPC, honouring invulnerability. Flags the NPC to
 * die (death anim + despawn) when it drops to 0. The single damage entry point
 * for melee, arrows, spells, and falling stones. Returns true if this hit was
 * lethal.
 *
 * Retaliation: a surviving player-dealt hit (`opts.byPlayer`) only *records*
 * the provocation (`npc.provoked`). Turning the NPC hostile is the behaviour
 * system's job (`provokeFromPlayerAttack`) — this keeps the damage helper a
 * pure data mutation with no AI/brain dependency, and never allocates a brain
 * for an NPC that the same hit kills.
 */
export function damageNpc(npc: NpcRuntimeState, amount: number, opts: NpcDamageOptions = {}): boolean {
    if (npc.invulnerable || npc.dying || !(amount > 0)) return false
    npc.hp -= amount
    if (npc.hp <= 0) {
        npc.requestDie = true
        npc.dying = true
        return true
    }
    npc.requestHurt = true
    if (opts.byPlayer) npc.provoked = true
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
    unprovokable: false,
    threatMemorySeconds: 0,
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
            switch (normalizeNpcVariant(model, variant)) {
                case 'guardian':
                case 'king':
                case 'trader':
                    return 'full'
                case 'child':
                case 'princess':
                    return 'none'
                case 'default':
                case 'wise':
                    return 'pointed'
            }
        case 'player':
        case 'rabbit':
        case 'archer':
            return 'none'
        case 'shield-spearman':
        case 'shield-warrior':
            return 'short'
    }
}

export function defaultNpcEquipment(model: NpcModelKind, variant: NpcVariantKind = defaultNpcVariant(model)): EquipmentHandLoadout {
    switch (model) {
        case 'keeper':
        case 'keeper-arlen':
            return { handR: 'staff', handL: null }
        case 'large-troll':
            switch (normalizeNpcVariant(model, variant)) {
                case 'guardian':
                    return { handR: 'battle-hammer', handL: null }
                case 'king':
                    return { handR: 'staff-crystal', handL: null }
                case 'trader':
                case 'wise':
                    return { handR: null, handL: 'book' }
                case 'child':
                case 'princess':
                    return { handR: null, handL: null }
                case 'default':
                    return { handR: null, handL: 'book' }
            }
        case 'player':
        case 'rabbit':
            return { handR: null, handL: null }
        case 'archer':
            return { handR: null, handL: 'bow' }
        case 'shield-spearman':
            return { handR: 'spear', handL: 'shield' }
        case 'shield-warrior':
            return { handR: 'sword', handL: 'shield' }
    }
}

export function npcShieldGuardState(npc: Pick<NpcConfig, 'model' | 'equipment' | 'colliderHeight'>): NpcShieldGuardState | undefined {
    // Any NPC carrying a shield in its off-hand fights with the guard up and
    // advances behind it — the spearman, the sword-and-board warrior, and any
    // custom shield loadout alike (mirrors the player's block).
    const carriesShield = npc.equipment.handL === 'shield' || npc.equipment.handR === 'shield'
    if (npc.model !== 'shield-spearman' && !carriesShield) return undefined
    return {
        raised: false,
        arcCos: NPC_SHIELD_GUARD_ARC_COS,
        minY: NPC_SHIELD_GUARD_MIN_Y,
        maxY: Math.min(Math.max(1.2, npc.colliderHeight), NPC_SHIELD_GUARD_MAX_Y),
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
        unprovokable: input.unprovokable ?? DEFAULT_NPC.unprovokable,
        threatMemorySeconds: Number.isFinite(input.threatMemorySeconds)
            ? Math.max(0, input.threatMemorySeconds!)
            : DEFAULT_NPC.threatMemorySeconds,
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
    if (isBowEquipmentKind(npc.equipment.handR) || isBowEquipmentKind(npc.equipment.handL)) return 'shoot'
    if (isHammerEquipmentKind(npc.equipment.handR) || isHammerEquipmentKind(npc.equipment.handL)) return 'hammerAttack'
    if (isStaffEquipmentKind(npc.equipment.handR) || isStaffEquipmentKind(npc.equipment.handL)) return 'staffAttack'
    if (isSpearEquipmentKind(npc.equipment.handR) || isSpearEquipmentKind(npc.equipment.handL)) return 'spearAttack'
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
