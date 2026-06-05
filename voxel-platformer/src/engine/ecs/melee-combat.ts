import type { GameWorld } from './world'
import {
    meleeActorKey,
    meleeAttackTotalSeconds,
    type ActiveMeleeAttack,
    type MeleeActorRef,
    type MeleeAttackDef,
} from './melee-types'

export interface StartMeleeAttackOptions {
    targetId?: string
}

export function startMeleeAttack(
    world: GameWorld,
    attacker: MeleeActorRef,
    def: MeleeAttackDef,
    opts: StartMeleeAttackOptions = {},
): boolean {
    const key = meleeActorKey(attacker)
    if (world.meleeAttacks.has(key)) return false
    world.meleeAttacks.set(key, {
        attacker,
        def,
        elapsedSeconds: 0,
        lockedYaw: null,
        lockedOrigin: null,
        targetId: opts.targetId,
        hitTargets: new Set<string>(),
        recoilApplied: false,
    })
    return true
}

export function hasActiveMeleeAttack(world: GameWorld, attacker: MeleeActorRef): boolean {
    return world.meleeAttacks.has(meleeActorKey(attacker))
}

export function isMeleeActorLocked(world: GameWorld, attacker: MeleeActorRef): boolean {
    const attack = world.meleeAttacks.get(meleeActorKey(attacker))
    return attack !== undefined && isActiveMeleeAttackLocked(attack)
}

export function isActiveMeleeAttackLocked(attack: ActiveMeleeAttack): boolean {
    return attack.lockedYaw !== null && attack.elapsedSeconds < meleeAttackTotalSeconds(attack.def)
}
