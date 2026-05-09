export interface AvoidanceActor {
    eid: number
    x: number
    y: number
    z: number
    radius: number
}

export interface AvoidanceOptions {
    padding?: number
    verticalTolerance?: number
    lateralStrength?: number
    separationStrength?: number
    maxTurnRadians?: number
}

export interface AvoidanceResult {
    x: number
    z: number
    avoided: boolean
}

const EPS = 1e-6

export function steerAroundActors(
    self: AvoidanceActor,
    desiredX: number,
    desiredZ: number,
    actors: readonly AvoidanceActor[],
    opts: AvoidanceOptions = {},
): AvoidanceResult {
    const desiredLen = Math.hypot(desiredX, desiredZ)
    if (desiredLen <= EPS) return { x: 0, z: 0, avoided: false }

    const padding = opts.padding ?? 0.18
    const verticalTolerance = opts.verticalTolerance ?? 1.15
    const lateralStrength = opts.lateralStrength ?? 0.85
    const separationStrength = opts.separationStrength ?? 0.5
    const maxTurn = opts.maxTurnRadians ?? Math.PI * 0.42

    const dirX = desiredX / desiredLen
    const dirZ = desiredZ / desiredLen
    let steerX = 0
    let steerZ = 0

    for (const other of actors) {
        if (other.eid === self.eid) continue
        if (Math.abs(other.y - self.y) > verticalTolerance) continue

        const toX = other.x - self.x
        const toZ = other.z - self.z
        const distSq = toX * toX + toZ * toZ
        const minDist = self.radius + other.radius + padding
        const influenceDist = minDist + 0.55
        if (distSq > influenceDist * influenceDist) continue

        const dist = Math.sqrt(Math.max(distSq, EPS))
        const awayX = -toX / dist
        const awayZ = -toZ / dist
        const closeness = Math.max(0, 1 - dist / influenceDist)
        const ahead = (toX / dist) * dirX + (toZ / dist) * dirZ

        if (ahead > -0.15) {
            let side = -Math.sign(dirX * toZ - dirZ * toX)
            if (side === 0) side = (self.eid + other.eid) % 2 === 0 ? 1 : -1
            steerX += -dirZ * side * closeness * lateralStrength
            steerZ += dirX * side * closeness * lateralStrength
        }

        if (dist < minDist) {
            const penetration = 1 - dist / Math.max(minDist, EPS)
            steerX += awayX * penetration * separationStrength
            steerZ += awayZ * penetration * separationStrength
        }
    }

    const steerLen = Math.hypot(steerX, steerZ)
    if (steerLen <= EPS) return { x: dirX * desiredLen, z: dirZ * desiredLen, avoided: false }

    const candidateX = dirX + steerX
    const candidateZ = dirZ + steerZ
    const candidateLen = Math.hypot(candidateX, candidateZ)
    if (candidateLen <= EPS) return { x: dirX * desiredLen, z: dirZ * desiredLen, avoided: false }

    const turned = clampTurn(dirX, dirZ, candidateX / candidateLen, candidateZ / candidateLen, maxTurn)
    return { x: turned.x * desiredLen, z: turned.z * desiredLen, avoided: true }
}

function clampTurn(fromX: number, fromZ: number, toX: number, toZ: number, maxRadians: number): { x: number; z: number } {
    const dot = Math.max(-1, Math.min(1, fromX * toX + fromZ * toZ))
    const angle = Math.acos(dot)
    if (angle <= maxRadians) return { x: toX, z: toZ }

    const cross = fromX * toZ - fromZ * toX
    const side = cross >= 0 ? 1 : -1
    const cos = Math.cos(maxRadians)
    const sin = Math.sin(maxRadians) * side
    return {
        x: fromX * cos - fromZ * sin,
        z: fromX * sin + fromZ * cos,
    }
}
