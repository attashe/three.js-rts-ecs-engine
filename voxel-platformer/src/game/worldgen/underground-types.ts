import type { Vec3Tuple } from './spec-types'

export interface UndergroundFeature {
    id: string
    cells: Set<string>
    floor: Set<string>
    wall: Set<string>
    ceiling: Set<string>
    bounds: Bounds3 | null
    meta: {
        type?: string
        center?: Vec3Tuple
        bottom?: Vec3Tuple
        floorY?: number
        size?: Vec3Tuple
        spline?: Vec3Tuple[]
    }
}

export interface UndergroundState {
    features: Map<string, UndergroundFeature>
}

export interface Bounds3 {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
}

export interface SurfaceCandidate {
    x: number
    y: number
    z: number
    kind: string
    score: number
    normal?: { x: number; z: number }
}

export function createUndergroundState(): UndergroundState {
    return { features: new Map() }
}
