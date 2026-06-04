import { hasComponent, query } from 'bitecs'
import { ClimbingLadder, Grounded, PlayerControlled, Position, Rotation, Stunned } from '../engine/ecs/components'
import type { ActionId, ActionMap } from '../engine/input/actions'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../engine/ecs/world'
import { spawnElectricOrb, spawnMagicBolt } from './moving-objects'
import { spendMana } from './mana'
import { isStaffEquipmentKind } from './anim/equipment-types'

/** A castable spell. `cast` runs the gameplay effect; `anim` is the combat
 *  overlay param played on the caster; `castLog` is the flavour line. */
export interface Spell {
    id: string
    label: string
    hint: string
    /** Integer half-orb units. 1 = half a mana orb. */
    manaCost: number
    /** Combat overlay param to trigger on the caster's rig. */
    anim: 'shoot' | 'staffAttack' | 'attackWide'
    castLog: string
    cast(world: GameWorld, player: number): void
}

const BOLT_SPEED = 11
const ORB_SPEED = 7
const ORB_LIFT = 4
const NOVA_RADIUS = 4.2
const NOVA_VERTICAL = 2.5
const NOVA_DAMAGE = 1
// Wavefront expansion speed (units/s). Deliberately slow so the ring — and the
// hits it lands as it passes through enemies — is easy to read.
const NOVA_SPEED = 6
// Linger after the front reaches its max so the ring can fade out.
const NOVA_FADE = 0.3

export const SPELLS: readonly Spell[] = [
    {
        id: 'bolt',
        label: 'Arcane Bolt',
        hint: 'A single bolt of force fired where you aim.',
        manaCost: 1,
        anim: 'shoot',
        castLog: 'A bolt of force leaps from the staff.',
        cast(world, player) {
            const yaw = Rotation.y[player]!
            const fx = Math.sin(yaw)
            const fz = Math.cos(yaw)
            spawnMagicBolt(
                world,
                { x: Position.x[player]! + fx * 0.55, y: Position.y[player]! + 1.05, z: Position.z[player]! + fz * 0.55 },
                { x: fx * BOLT_SPEED, y: 0, z: fz * BOLT_SPEED },
            )
        },
    },
    {
        id: 'nova',
        label: 'Frost Nova',
        hint: 'A slow ring of frost that chills every enemy it rolls over.',
        manaCost: 3,
        anim: 'attackWide',
        castLog: 'A ring of frost rolls outward.',
        cast(world, player) {
            // Spawn an expanding wave rather than dealing instant, invisible
            // damage — the spell-effect system grows the ring and lands a hit
            // on each enemy as the front passes through it.
            world.spellEffects.push({
                x: Position.x[player]!,
                y: Position.y[player]!,
                z: Position.z[player]!,
                radius: 0,
                maxRadius: NOVA_RADIUS,
                speed: NOVA_SPEED,
                damage: NOVA_DAMAGE,
                vertical: NOVA_VERTICAL,
                age: 0,
                ttl: NOVA_RADIUS / NOVA_SPEED + NOVA_FADE,
                hit: [],
            })
        },
    },
    {
        id: 'orb',
        label: 'Electric Orb',
        hint: 'A crackling orb that arcs and ricochets, zapping what it touches.',
        manaCost: 2,
        anim: 'shoot',
        castLog: 'An electric orb leaps from the staff, crackling.',
        cast(world, player) {
            const yaw = Rotation.y[player]!
            const fx = Math.sin(yaw)
            const fz = Math.cos(yaw)
            spawnElectricOrb(
                world,
                { x: Position.x[player]! + fx * 0.6, y: Position.y[player]! + 1.05, z: Position.z[player]! + fz * 0.6 },
                { x: fx * ORB_SPEED, y: ORB_LIFT, z: fz * ORB_SPEED },
            )
        },
    },
]

const SPELL_BY_ID = new Map(SPELLS.map((spell) => [spell.id, spell]))

export const DEFAULT_SPELL_ID = SPELLS[0]!.id

export function getSpell(id: string): Spell {
    return SPELL_BY_ID.get(id) ?? SPELLS[0]!
}

export interface SpellCastOptions {
    actionId?: ActionId
    /** Gate the cast (e.g. only in the magic stance). */
    canUse?: (world: GameWorld, player: number) => boolean
    /** Fired after a successful cast, with the spell that was cast. */
    onCast?: (spell: Spell) => void
}

/**
 * Casts the currently-selected spell (`world.selectedSpell`) on the cast
 * action. The spell list lives in {@link SPELLS}; the Tab menu sets which one is
 * active. Mirrors the weapon launchers: grounded, stance-gated, plays a combat
 * overlay pose, and is rate-limited by the action's cooldown.
 */
export function createSpellCastSystem(actions: ActionMap, opts: SpellCastOptions = {}): System {
    const actionId = opts.actionId ?? 'spell.cast'
    return {
        fixed: true,
        order: FixedOrder.input + 24,
        update(world) {
            const gw = world as GameWorld
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]!
            if (opts.canUse && !opts.canUse(gw, player)) return
            if (hasComponent(world, player, Stunned)) return
            if (hasComponent(world, player, ClimbingLadder)) return
            if (!hasComponent(world, player, Grounded)) return
            if (!actions.consumePressed(actionId, player)) return
            if (!activeLoadoutUsesStaff(gw)) {
                pushLog(gw, 'No staff equipped.')
                return
            }

            const spell = getSpell(gw.selectedSpell)
            if (!spendMana(player, spell.manaCost)) {
                pushLog(gw, 'Not enough mana.')
                return
            }
            spell.cast(gw, player)
            gw.animControllerByEid.get(player)?.machine.setParam(spell.anim, 1)
            pushLog(gw, spell.castLog)
            opts.onCast?.(spell)
        },
    }
}

function activeLoadoutUsesStaff(world: GameWorld): boolean {
    const loadout = world.playerSettings.equipment[world.weaponStance]
    return isStaffEquipmentKind(loadout.handR) || isStaffEquipmentKind(loadout.handL)
}
