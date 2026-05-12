import { hasComponent, removeComponent } from 'bitecs'
import { Attackable, Health, PlayerControlled } from './components'
import { areEntitiesEnemies } from './factions'
import { applyDamageSocialResponse } from './social'
import type { GameWorld } from './world'

/** Minimum damage that gets through full armor — defense never trivializes a
 *  hit to 0, otherwise certain encounters become unloseable. */
const MIN_PLAYER_DAMAGE = 1

export type DamageType = 'physical' | 'impact' | 'fire' | 'cold' | 'lightning' | 'poison' | 'force' | 'arcane'
export type DamageTargetPolicy = 'any' | 'enemy'

export interface DamagePacket {
    readonly source?: number
    readonly target: number
    readonly amount: number
    readonly type?: DamageType
    readonly targetPolicy?: DamageTargetPolicy
    readonly removeAttackableOnDeath?: boolean
}

export interface DamageResult {
    readonly applied: boolean
    readonly killed: boolean
    readonly amount: number
    readonly previousHealth: number
    readonly currentHealth: number
    readonly targetLabel: string
    readonly reason?: 'missing-health' | 'dead' | 'friendly-fire' | 'invalid-amount'
}

export function applyDamagePacket(world: GameWorld, packet: DamagePacket): DamageResult {
    const target = packet.target
    const incoming = Math.max(0, packet.amount)
    const label = targetLabel(world, target)

    if (!hasComponent(world, target, Health)) {
        return rejected(label, 'missing-health')
    }
    const previousHealth = Health.current[target]
    if (previousHealth <= 0) {
        return rejected(label, 'dead', previousHealth)
    }
    if (incoming <= 0) {
        return rejected(label, 'invalid-amount', previousHealth)
    }
    if (!passesTargetPolicy(world, packet)) {
        return rejected(label, 'friendly-fire', previousHealth)
    }

    // Player armor reduction. Cached aggregate lives on world.playerStats and
    // is recomputed by recomputePlayerStats whenever the loadout mutates.
    const amount = hasComponent(world, target, PlayerControlled)
        ? Math.max(MIN_PLAYER_DAMAGE, incoming - world.playerStats.defense)
        : incoming

    const currentHealth = Math.max(0, previousHealth - amount)
    Health.current[target] = currentHealth
    const killed = currentHealth <= 0
    if (packet.source !== undefined && packet.source !== target) {
        applyDamageSocialResponse(world, { source: packet.source, target })
    }
    if (killed && packet.removeAttackableOnDeath !== false && hasComponent(world, target, Attackable)) {
        removeComponent(world, target, Attackable)
    }
    return {
        applied: true,
        killed,
        amount,
        previousHealth,
        currentHealth,
        targetLabel: label,
    }
}

export function targetLabel(world: GameWorld, target: number): string {
    const interaction = world.interactionByEid.get(target)
    if (interaction) return interaction.label
    return 'target'
}

function passesTargetPolicy(world: GameWorld, packet: DamagePacket): boolean {
    if (packet.targetPolicy !== 'enemy') return true
    if (packet.source === undefined) return false
    return areEntitiesEnemies(world, packet.source, packet.target)
}

function rejected(
    targetLabel: string,
    reason: DamageResult['reason'],
    health = 0,
): DamageResult {
    return {
        applied: false,
        killed: false,
        amount: 0,
        previousHealth: health,
        currentHealth: health,
        targetLabel,
        reason,
    }
}
