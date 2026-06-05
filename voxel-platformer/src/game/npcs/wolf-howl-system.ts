import type { System } from '../../engine/ecs/systems/system'
import type { GameWorld, VoxelCoord } from '../../engine/ecs/world'

export interface WolfHowlSystemOptions {
    getHour?: () => number
    onHowl?: (position: VoxelCoord, npcId: string) => void
    initialDelaySeconds?: number
    minCooldownSeconds?: number
    maxCooldownSeconds?: number
    random?: () => number
}

const DEFAULT_INITIAL_DELAY = 3
const DEFAULT_MIN_COOLDOWN = 14
const DEFAULT_MAX_COOLDOWN = 24

export function createWolfHowlSystem(opts: WolfHowlSystemOptions = {}): System {
    const initialDelay = safeSeconds(opts.initialDelaySeconds, DEFAULT_INITIAL_DELAY)
    const minCooldown = safeSeconds(opts.minCooldownSeconds, DEFAULT_MIN_COOLDOWN)
    const maxCooldown = Math.max(minCooldown, safeSeconds(opts.maxCooldownSeconds, DEFAULT_MAX_COOLDOWN))
    const random = opts.random ?? Math.random
    let elapsed = 0
    let nextHowlAt = initialDelay
    let wasNight = false
    let cursor = 0

    return {
        name: 'wolfHowls',
        update(world, dt) {
            elapsed += Math.max(0, dt)
            const night = isWolfHowlNightHour(opts.getHour?.() ?? 12)
            if (!night) {
                wasNight = false
                return
            }
            if (!wasNight) {
                wasNight = true
                nextHowlAt = elapsed + initialDelay
                return
            }
            if (elapsed < nextHowlAt) return

            const wolves = [...(world as GameWorld).npcRuntimeById.values()]
                .filter((npc) => npc.model === 'wolf' && !npc.dying)
                .sort((a, b) => a.id.localeCompare(b.id))
            if (wolves.length > 0) {
                const wolf = wolves[cursor % wolves.length]!
                cursor += 1
                opts.onHowl?.({ ...wolf.position }, wolf.id)
            }
            nextHowlAt = elapsed + minCooldown + randomUnit(random) * (maxCooldown - minCooldown)
        },
    }
}

export function isWolfHowlNightHour(hour: number): boolean {
    if (!Number.isFinite(hour)) return false
    const wrapped = ((hour % 24) + 24) % 24
    return wrapped >= 20 || wrapped < 5.5
}

function safeSeconds(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.max(0, value!) : fallback
}

function randomUnit(random: () => number): number {
    const value = random()
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}
