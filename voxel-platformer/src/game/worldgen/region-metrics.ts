import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { VoxelCoord, WorldgenChunkBounds, WorldgenRegionMetrics } from './spec-types'

export const WORLDGEN_REGION_SIZE_CHUNKS = 8

export interface WorldgenChunkMetrics {
    chunkBounds?: WorldgenChunkBounds
    chunkCount: number
    writtenVoxels: number
    regionSizeChunks: number
    regionCount: number
    regions: WorldgenRegionMetrics[]
}

interface RegionAccumulator {
    key: string
    rx: number
    rz: number
    chunkCount: number
    nonAirVoxels: number
    min: VoxelCoord
    max: VoxelCoord
}

export function collectWorldgenChunkMetrics(
    chunks: ChunkManager,
    regionSizeChunks = WORLDGEN_REGION_SIZE_CHUNKS,
): WorldgenChunkMetrics {
    let chunkCount = 0
    let writtenVoxels = 0
    let worldMin: VoxelCoord | null = null
    let worldMax: VoxelCoord | null = null
    const regions = new Map<string, RegionAccumulator>()

    for (const chunk of chunks.allChunks()) {
        chunkCount += 1
        writtenVoxels += chunk.nonAirCount
        worldMin = minCoord(worldMin, chunk.cx, chunk.cy, chunk.cz)
        worldMax = maxCoord(worldMax, chunk.cx, chunk.cy, chunk.cz)

        const rx = regionCoord(chunk.cx, regionSizeChunks)
        const rz = regionCoord(chunk.cz, regionSizeChunks)
        const key = `${rx},${rz}`
        let region = regions.get(key)
        if (!region) {
            region = {
                key,
                rx,
                rz,
                chunkCount: 0,
                nonAirVoxels: 0,
                min: { x: chunk.cx, y: chunk.cy, z: chunk.cz },
                max: { x: chunk.cx, y: chunk.cy, z: chunk.cz },
            }
            regions.set(key, region)
        }
        region.chunkCount += 1
        region.nonAirVoxels += chunk.nonAirCount
        region.min = minCoord(region.min, chunk.cx, chunk.cy, chunk.cz)
        region.max = maxCoord(region.max, chunk.cx, chunk.cy, chunk.cz)
    }

    const outRegions = [...regions.values()]
        .sort((a, b) => a.rx - b.rx || a.rz - b.rz)
        .map((region) => ({
            key: region.key,
            rx: region.rx,
            rz: region.rz,
            chunkCount: region.chunkCount,
            nonAirVoxels: region.nonAirVoxels,
            chunkBounds: { min: region.min, max: region.max },
        }))

    return {
        ...(worldMin && worldMax ? { chunkBounds: { min: worldMin, max: worldMax } } : {}),
        chunkCount,
        writtenVoxels,
        regionSizeChunks,
        regionCount: outRegions.length,
        regions: outRegions,
    }
}

function regionCoord(chunkCoord: number, regionSizeChunks: number): number {
    return Math.floor(chunkCoord / regionSizeChunks)
}

function minCoord(current: VoxelCoord | null, x: number, y: number, z: number): VoxelCoord {
    if (!current) return { x, y, z }
    return {
        x: Math.min(current.x, x),
        y: Math.min(current.y, y),
        z: Math.min(current.z, z),
    }
}

function maxCoord(current: VoxelCoord | null, x: number, y: number, z: number): VoxelCoord {
    if (!current) return { x, y, z }
    return {
        x: Math.max(current.x, x),
        y: Math.max(current.y, y),
        z: Math.max(current.z, z),
    }
}
