// The Blender authoring convention, name side only (PURE — no three).
//
// These constants are the contract a Blender-authored .glb must satisfy and the
// spec the code-built reference rig conforms to. The Three-aware validator
// (runtime/blender-validator.ts) reuses these to check loaded assets; keeping
// the name rules here makes them unit-testable without a GPU.

/** Animation clips every character rig must provide. Clip/action names in the
 *  .glb must equal these (which also equal the state ids in the graph). */
export const REQUIRED_CLIP_IDS = ['idle', 'walk', 'run', 'jump', 'fall', 'land'] as const
export type RequiredClipId = (typeof REQUIRED_CLIP_IDS)[number]

/** Full clip set required by the game's combat locomotion graph. Imported rigs
 *  that drive player/NPC gameplay need these in addition to base locomotion. */
export const COMBAT_REQUIRED_CLIP_IDS = [...REQUIRED_CLIP_IDS, 'attack', 'attackWide', 'staffAttack', 'hammerAttack', 'shoot', 'shieldBlock', 'die', 'dead'] as const
export type CombatRequiredClipId = (typeof COMBAT_REQUIRED_CLIP_IDS)[number]

/** Canonical equipment socket bone names. All optional at runtime — a missing
 *  socket simply disables that attachment slot.
 *
 *  NOTE: underscores, not dots. three's glTF loader strips reserved characters
 *  (`.`, `:`, `/`, `[]`) from node names while binding animations, so a bone
 *  named `socket.hand.R` becomes `sockethandR` after import. Underscores survive
 *  unchanged, so the same name resolves in both the code rig and an imported
 *  `.glb`. (Deform bones may still use Blender's `.R`/`.L` — they're addressed
 *  only by the auto-sanitised animation tracks, never looked up by name.) */
export const SOCKET_ID = {
    head: 'socket_head',
    handR: 'socket_hand_R',
    handL: 'socket_hand_L',
    back: 'socket_back',
} as const
export type SocketName = (typeof SOCKET_ID)[keyof typeof SOCKET_ID]
export const SOCKET_NAMES: readonly SocketName[] = Object.values(SOCKET_ID)

/** Logical equipment slots, mapped to socket bone names. Extend here + in
 *  SOCKET_ID to add slots (belt, offhand-back, shield, …). */
export const EQUIP_SLOT = {
    head: 'head',
    handR: 'handR',
    handL: 'handL',
    back: 'back',
} as const
export type EquipSlot = (typeof EQUIP_SLOT)[keyof typeof EQUIP_SLOT]

export const SLOT_TO_SOCKET: Record<EquipSlot, SocketName> = {
    head: SOCKET_ID.head,
    handR: SOCKET_ID.handR,
    handL: SOCKET_ID.handL,
    back: SOCKET_ID.back,
}

export interface NameValidation {
    ok: boolean
    /** Required/canonical names not present. */
    missing: string[]
    /** Present names outside the canonical/required set. */
    extra: string[]
}

/** Required-set check: `ok` is false if any required name is missing. */
export function validateClipNames(
    present: readonly string[],
    required: readonly string[] = REQUIRED_CLIP_IDS,
): NameValidation {
    const presentSet = new Set(present)
    const requiredSet = new Set(required)
    const missing = required.filter((r) => !presentSet.has(r))
    const extra = present.filter((p) => !requiredSet.has(p))
    return { ok: missing.length === 0, missing, extra }
}

/** Socket check. Sockets are optional, so `ok` only reflects whether the full
 *  canonical set is present; callers treat `missing` as disabled slots, not
 *  errors. */
export function validateSocketNames(
    present: readonly string[],
    canonical: readonly string[] = SOCKET_NAMES,
): NameValidation {
    const presentSet = new Set(present)
    const canonicalSet = new Set(canonical)
    const missing = canonical.filter((c) => !presentSet.has(c))
    const extra = present.filter((p) => !canonicalSet.has(p))
    return { ok: missing.length === 0, missing, extra }
}
