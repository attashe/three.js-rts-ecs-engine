import type { GameWorld } from './world'

export type AiPoint = { x: number; y: number; z: number }

export interface AiZone {
    readonly id: string
    readonly label?: string
    readonly center: AiPoint
    readonly radius?: number
    readonly rect?: {
        readonly minX: number
        readonly minZ: number
        readonly maxX: number
        readonly maxZ: number
    }
}

export type AiScheduleStepKind =
    'idle' |
    'travelZone' |
    'wanderZone' |
    'patrolRoute' |
    'assaultZone'

export interface AiScheduleStep {
    readonly id: string
    readonly kind: AiScheduleStepKind
    readonly zoneId?: string
    readonly points?: readonly AiPoint[]
    /** Seconds before advancing to the next step. 0/undefined means hold. */
    readonly duration?: number
}

export interface AiSchedule {
    readonly id: string
    readonly label?: string
    readonly loop?: boolean
    readonly steps: readonly AiScheduleStep[]
}

export interface AiScheduleAssignment {
    scheduleId: string
    stepIndex: number
    elapsed: number
    patrolIndex: number
    zoneSample: AiPoint | null
    zoneSampleKey: string
}

export interface AiScheduleTick {
    assignment: AiScheduleAssignment
    schedule: AiSchedule
    step: AiScheduleStep
}

export function defineAiZone(world: GameWorld, zone: AiZone): void {
    world.aiZones.set(zone.id, zone)
}

export function defineAiSchedule(world: GameWorld, schedule: AiSchedule): void {
    if (schedule.steps.length === 0) {
        throw new Error(`AI schedule "${schedule.id}" must contain at least one step`)
    }
    world.aiSchedules.set(schedule.id, schedule)
}

export function assignAiSchedule(world: GameWorld, eid: number, scheduleId: string): AiScheduleAssignment {
    if (!world.aiSchedules.has(scheduleId)) {
        throw new Error(`Unknown AI schedule id: ${scheduleId}`)
    }
    const assignment: AiScheduleAssignment = {
        scheduleId,
        stepIndex: 0,
        elapsed: 0,
        patrolIndex: 0,
        zoneSample: null,
        zoneSampleKey: '',
    }
    world.aiScheduleByEid.set(eid, assignment)
    return assignment
}

export function clearAiSchedule(world: GameWorld, eid: number): void {
    world.aiScheduleByEid.delete(eid)
}

export function tickAiSchedule(world: GameWorld, eid: number, dt: number): AiScheduleTick | null {
    const assignment = world.aiScheduleByEid.get(eid)
    if (!assignment) return null
    const schedule = world.aiSchedules.get(assignment.scheduleId)
    if (!schedule || schedule.steps.length === 0) return null

    assignment.stepIndex = clampStepIndex(assignment.stepIndex, schedule.steps.length)
    assignment.elapsed += dt

    let step = schedule.steps[assignment.stepIndex]!
    if (step.duration && step.duration > 0 && assignment.elapsed >= step.duration) {
        advanceScheduleStep(assignment, schedule)
        step = schedule.steps[assignment.stepIndex]!
    }

    return { assignment, schedule, step }
}

export function currentAiScheduleStep(world: GameWorld, eid: number): AiScheduleTick | null {
    const assignment = world.aiScheduleByEid.get(eid)
    if (!assignment) return null
    const schedule = world.aiSchedules.get(assignment.scheduleId)
    if (!schedule || schedule.steps.length === 0) return null
    assignment.stepIndex = clampStepIndex(assignment.stepIndex, schedule.steps.length)
    return {
        assignment,
        schedule,
        step: schedule.steps[assignment.stepIndex]!,
    }
}

export function advanceScheduleStep(assignment: AiScheduleAssignment, schedule: AiSchedule): void {
    const next = assignment.stepIndex + 1
    assignment.stepIndex = next >= schedule.steps.length
        ? (schedule.loop === false ? schedule.steps.length - 1 : 0)
        : next
    assignment.elapsed = 0
    assignment.patrolIndex = 0
    assignment.zoneSample = null
    assignment.zoneSampleKey = ''
}

export function advancePatrolPoint(assignment: AiScheduleAssignment, step: AiScheduleStep): void {
    const count = step.points?.length ?? 0
    if (count <= 0) return
    assignment.patrolIndex = (assignment.patrolIndex + 1) % count
}

export function resolveScheduleZonePoint(
    world: GameWorld,
    eid: number,
    assignment: AiScheduleAssignment,
    step: AiScheduleStep,
): AiPoint | null {
    if (!step.zoneId) return null
    const zone = world.aiZones.get(step.zoneId)
    if (!zone) return null
    const sampleKey = `${step.id}|${step.zoneId}|${assignment.stepIndex}`
    if (assignment.zoneSample && assignment.zoneSampleKey === sampleKey) return assignment.zoneSample
    assignment.zoneSample = sampleZonePoint(zone, eid + assignment.stepIndex * 997)
    assignment.zoneSampleKey = sampleKey
    return assignment.zoneSample
}

export function schedulePatrolPoint(assignment: AiScheduleAssignment, step: AiScheduleStep): AiPoint | null {
    const points = step.points
    if (!points || points.length === 0) return null
    assignment.patrolIndex = assignment.patrolIndex % points.length
    return points[assignment.patrolIndex]!
}

export function isPointInZone(zone: AiZone, point: AiPoint): boolean {
    if (zone.rect) {
        return point.x >= zone.rect.minX &&
            point.x <= zone.rect.maxX &&
            point.z >= zone.rect.minZ &&
            point.z <= zone.rect.maxZ
    }
    const radius = zone.radius ?? 0
    const dx = point.x - zone.center.x
    const dz = point.z - zone.center.z
    return dx * dx + dz * dz <= radius * radius
}

export function sampleZonePoint(zone: AiZone, seed: number): AiPoint {
    if (zone.rect) {
        const u = hash01(seed, 17)
        const v = hash01(seed, 29)
        return {
            x: zone.rect.minX + (zone.rect.maxX - zone.rect.minX) * u,
            y: zone.center.y,
            z: zone.rect.minZ + (zone.rect.maxZ - zone.rect.minZ) * v,
        }
    }

    const radius = zone.radius ?? 0
    if (radius <= 0) return { ...zone.center }
    const angle = hash01(seed, 41) * Math.PI * 2
    const distance = Math.sqrt(hash01(seed, 53)) * radius
    return {
        x: zone.center.x + Math.sin(angle) * distance,
        y: zone.center.y,
        z: zone.center.z + Math.cos(angle) * distance,
    }
}

function clampStepIndex(index: number, count: number): number {
    if (count <= 0) return 0
    if (index < 0) return 0
    if (index >= count) return count - 1
    return index
}

function hash01(seed: number, salt: number): number {
    let n = Math.imul(seed ^ salt, 0x45d9f3b)
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
    n ^= n >>> 16
    return (n >>> 0) / 0xffffffff
}
