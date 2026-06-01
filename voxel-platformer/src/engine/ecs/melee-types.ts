import { HUMANOID_ANIM_TIMINGS } from '../../game/anim/clip-timings'
import { HALF_HEART } from './combat'

export type MeleeActorRef =
    | { kind: 'player'; eid: number }
    | { kind: 'npc'; id: string }

export interface MeleeVec3 {
    x: number
    y: number
    z: number
}

export type MeleeTargetMode = 'nearest' | 'cleave' | 'target'

export type MeleeShape =
    | {
        kind: 'wedge'
        range: number
        arcRadians: number
        minY: number
        maxY: number
    }
    | {
        kind: 'circle'
        radius: number
        centerForwardOffset: number
        minY: number
        maxY: number
    }

export interface MeleeAttackDef {
    id: string
    startupSeconds: number
    activeSeconds: number
    recoverySeconds: number
    shape: MeleeShape
    targetMode: MeleeTargetMode
    damage: number
    targetPushSpeed: number
    targetPushSeconds: number
    recoilSpeed: number
    recoilSeconds: number
    stunSeconds: number
    debugColor: readonly [number, number, number]
}

export interface ActiveMeleeAttack {
    attacker: MeleeActorRef
    def: MeleeAttackDef
    elapsedSeconds: number
    lockedYaw: number | null
    lockedOrigin: MeleeVec3 | null
    targetId?: string
    hitTargets: Set<string>
    recoilApplied: boolean
}

export interface NpcImpactState {
    vx: number
    vz: number
    seconds: number
}

export const MELEE_LOCK_LEAD_SECONDS = 0.05

export const DEFAULT_TARGET_PUSH_SPEED = 4.2
export const DEFAULT_TARGET_PUSH_SECONDS = 0.12

export const PLAYER_MELEE_REACH_ABOVE = 2.2
export const PLAYER_MELEE_REACH_BELOW = 1.2
export const NPC_MELEE_REACH_ABOVE = 2.0
export const NPC_MELEE_REACH_BELOW = 1.0
export const HAMMER_IMPACT_VERTICAL = 1.8

export const MELEE_ATTACK_DEFS = {
    'player-thrust': {
        id: 'player-thrust',
        startupSeconds: 0.22,
        activeSeconds: 0.08,
        recoverySeconds: 0.14,
        shape: {
            kind: 'wedge',
            range: 2.3,
            arcRadians: Math.acos(0.6) * 2,
            minY: -PLAYER_MELEE_REACH_BELOW,
            maxY: PLAYER_MELEE_REACH_ABOVE,
        },
        targetMode: 'nearest',
        damage: 1,
        targetPushSpeed: DEFAULT_TARGET_PUSH_SPEED,
        targetPushSeconds: DEFAULT_TARGET_PUSH_SECONDS,
        recoilSpeed: 0,
        recoilSeconds: 0,
        stunSeconds: 0,
        debugColor: [1.0, 0.28, 0.22],
    },
    'player-swing': {
        id: 'player-swing',
        startupSeconds: 0.32,
        activeSeconds: 0.10,
        recoverySeconds: 0.14,
        shape: {
            kind: 'wedge',
            range: 1.8,
            arcRadians: Math.PI,
            minY: -PLAYER_MELEE_REACH_BELOW,
            maxY: PLAYER_MELEE_REACH_ABOVE,
        },
        targetMode: 'cleave',
        damage: 1,
        targetPushSpeed: DEFAULT_TARGET_PUSH_SPEED,
        targetPushSeconds: DEFAULT_TARGET_PUSH_SECONDS,
        recoilSpeed: 0,
        recoilSeconds: 0,
        stunSeconds: 0,
        debugColor: [1.0, 0.58, 0.18],
    },
    'staff-slam': {
        id: 'staff-slam',
        startupSeconds: 0.36,
        activeSeconds: 0.10,
        recoverySeconds: 0.18,
        shape: {
            kind: 'wedge',
            range: 2.65,
            arcRadians: Math.acos(0.25) * 2,
            minY: -PLAYER_MELEE_REACH_BELOW,
            maxY: PLAYER_MELEE_REACH_ABOVE,
        },
        targetMode: 'cleave',
        damage: 1,
        targetPushSpeed: DEFAULT_TARGET_PUSH_SPEED,
        targetPushSeconds: DEFAULT_TARGET_PUSH_SECONDS,
        recoilSpeed: 0,
        recoilSeconds: 0,
        stunSeconds: 0,
        debugColor: [0.88, 0.48, 1.0],
    },
    'npc-slash': {
        id: 'npc-slash',
        startupSeconds: 0.30,
        activeSeconds: 0.08,
        recoverySeconds: 0.22,
        shape: {
            kind: 'wedge',
            range: 1.7,
            arcRadians: Math.acos(0.35) * 2,
            minY: -NPC_MELEE_REACH_BELOW,
            maxY: NPC_MELEE_REACH_ABOVE,
        },
        targetMode: 'target',
        damage: HALF_HEART,
        targetPushSpeed: DEFAULT_TARGET_PUSH_SPEED,
        targetPushSeconds: DEFAULT_TARGET_PUSH_SECONDS,
        recoilSpeed: 0,
        recoilSeconds: 0,
        stunSeconds: 0,
        debugColor: [1.0, 0.32, 0.16],
    },
    'hammer-slam': {
        id: 'hammer-slam',
        startupSeconds: HUMANOID_ANIM_TIMINGS.hammerImpact,
        activeSeconds: 0.12,
        recoverySeconds: Math.max(0, HUMANOID_ANIM_TIMINGS.hammerAttack - HUMANOID_ANIM_TIMINGS.hammerImpact - 0.12),
        shape: {
            kind: 'circle',
            radius: 1.15,
            centerForwardOffset: 1.35,
            minY: -HAMMER_IMPACT_VERTICAL,
            maxY: HAMMER_IMPACT_VERTICAL,
        },
        targetMode: 'cleave',
        damage: HALF_HEART,
        targetPushSpeed: DEFAULT_TARGET_PUSH_SPEED,
        targetPushSeconds: DEFAULT_TARGET_PUSH_SECONDS,
        recoilSpeed: 0,
        recoilSeconds: 0,
        stunSeconds: 0.25,
        debugColor: [1.0, 0.22, 0.1],
    },
} satisfies Record<string, MeleeAttackDef>

export type MeleeAttackId = keyof typeof MELEE_ATTACK_DEFS

export function meleeActorKey(actor: MeleeActorRef): string {
    return actor.kind === 'player' ? `player:${actor.eid}` : `npc:${actor.id}`
}

export function meleeAttackTotalSeconds(def: MeleeAttackDef): number {
    return def.startupSeconds + def.activeSeconds + def.recoverySeconds
}

export function meleeAttackActiveEndSeconds(def: MeleeAttackDef): number {
    return def.startupSeconds + def.activeSeconds
}

export function meleeAttackLockSeconds(def: MeleeAttackDef): number {
    return Math.max(0, def.startupSeconds - MELEE_LOCK_LEAD_SECONDS)
}

export function cloneMeleeAttackDef(def: MeleeAttackDef): MeleeAttackDef {
    return {
        ...def,
        shape: { ...def.shape },
    }
}
