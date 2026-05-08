import { vertexColor } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export interface VoxelVertexColorOpts {
    /** PBR roughness. 0 = mirror, 1 = chalky. Default 0.85. */
    roughness?: number
    /** PBR metalness. Default 0. Voxels are usually non-metallic. */
    metalness?: number
    /** Per-face shading (no smoothing across vertex normals). Default true — typical voxel look. */
    flatShading?: boolean
}

// PBR-lit material whose color comes from the geometry's per-vertex `color`
// attribute. The Phase 3 greedy mesher will emit one vertex color per face
// from the level palette; this material is the consumer.
export function createVoxelVertexColor(opts: VoxelVertexColorOpts = {}): MeshStandardNodeMaterial {
    const m = new MeshStandardNodeMaterial({
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.0,
        flatShading: opts.flatShading ?? true,
    })
    m.colorNode = vertexColor()
    return m
}
