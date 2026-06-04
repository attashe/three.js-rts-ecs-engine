import type { BLOCK } from '../../engine/voxel/palette'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { LevelMeta } from '../level'

export type EngineBlockKey = keyof typeof BLOCK

export type WorldgenWorldType = 'surface' | 'underground' | 'hybrid'
export type WorldgenStatus = 'ok' | 'warning' | 'failed'

export type Vec2Tuple = [number, number]
export type Vec3Tuple = [number, number, number]

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

export type MaterialAliasMap = Record<string, string>
export type NormalizedMaterialAliasMap = Record<string, EngineBlockKey>

export interface WorldSpec {
    version: 1
    world: WorldSpecHeader
    defs?: Record<string, unknown>
    materials?: MaterialAliasMap
    terrain?: SurfaceSpec
    volume?: VolumeSpec
    carvers?: CarverSpec[]
    connectors?: ConnectorSpec[]
    paths?: PathSpec[]
    anchors?: AnchorSpec[]
    structures?: StructurePlacementSpec[]
    scatter?: ScatterSpec[]
    content?: ContentSpec
    validation?: ValidationSpec
}

export interface NormalizedWorldSpec extends Omit<WorldSpec, 'materials'> {
    materials?: NormalizedMaterialAliasMap
}

export interface WorldSpecHeader {
    id: string
    name: string
    type: WorldgenWorldType
    seed: string
    size: Vec3Tuple
    defaultGroundY?: number
}

export interface SurfaceSpec {
    base_height?: number
    noise?: Record<string, unknown>
    features?: SurfaceFeatureSpec[]
}

export interface SurfaceFeatureSpec extends IdSpec {
    type: 'mountain_peak' | 'flatten_disc' | 'cliff_band' | 'road_spline' | string
    material?: string
    [key: string]: unknown
}

export interface VolumeSpec {
    initial?: 'solid' | string
    default_material?: string
    strata?: VolumeStratumSpec[]
    [key: string]: unknown
}

export interface VolumeStratumSpec {
    y: string | Vec2Tuple
    material: string
    [key: string]: unknown
}

export interface CarverSpec extends IdSpec {
    type: 'vertical_shaft' | 'chamber_ellipsoid' | 'rect_room' | 'dwarf_room' | 'mine_tunnel_network' | 'underground_canyon' | string
    material?: string
    floor_material?: string
    [key: string]: unknown
}

export interface ConnectorSpec extends IdSpec {
    type: 'noise_tube' | string
    material?: string
    floor_material?: string
    [key: string]: unknown
}

export interface PathSpec extends IdSpec {
    type?: string
    material?: string
    floor_block?: string
    [key: string]: unknown
}

export interface AnchorSpec extends IdSpec {
    [key: string]: unknown
}

export interface StructurePlacementSpec extends IdSpec {
    type?: 'group' | string
    asset?: string
    items?: StructureGroupItemSpec[]
    required?: boolean
    material?: string
    [key: string]: unknown
}

export interface StructureGroupItemSpec extends IdSpec {
    asset: string
    offset_xz?: Vec2Tuple
    required?: boolean
    material?: string
    [key: string]: unknown
}

export interface ScatterAssetSpec {
    asset: string
    weight?: number
    [key: string]: unknown
}

export interface ScatterSpec extends IdSpec {
    asset?: string
    assets?: ScatterAssetSpec[]
    material?: string
    [key: string]: unknown
}

export interface ContentSpec {
    npcs?: ContentEntrySpec[]
    zones?: ContentEntrySpec[]
    quests?: ContentEntrySpec[]
    shops?: ContentEntrySpec[]
    pickups?: ContentEntrySpec[]
    props?: ContentEntrySpec[]
    scripts?: ContentEntrySpec[]
    cinematics?: ContentEntrySpec[]
    environment?: Record<string, unknown>
    travel?: ContentEntrySpec[]
    [key: string]: unknown
}

export interface ContentEntrySpec {
    id?: string
    type?: string
    [key: string]: unknown
}

export interface ValidationSpec {
    require_paths?: ValidationPathSpec[]
    [key: string]: unknown
}

export interface ValidationPathSpec {
    id?: string
    from: string
    to: string
    actor?: string
    optional?: boolean
    [key: string]: unknown
}

export interface IdSpec {
    id: string
}

export type WorldgenDiagnosticCode =
    | 'invalid_spec'
    | 'invalid_version'
    | 'missing_world'
    | 'missing_world_field'
    | 'invalid_world_field'
    | 'invalid_section'
    | 'missing_id'
    | 'invalid_world_type'
    | 'invalid_world_size'
    | 'invalid_id'
    | 'duplicate_id'
    | 'invalid_material'
    | 'unsupported_ref'
    | 'unsupported_world_type'
    | 'unsupported_world_shape'
    | 'unsupported_feature'
    | 'invalid_feature'
    | 'invalid_anchor'
    | 'missing_reference'
    | 'unsupported_structure_asset'
    | 'placement_failed'
    | 'validation_failed'
    | 'surface_clamped'

export interface WorldgenDiagnostic {
    code: WorldgenDiagnosticCode | string
    message: string
    path?: string
    details?: unknown
}

export type WorldgenWarning = WorldgenDiagnostic
export type WorldgenError = WorldgenDiagnostic

export interface WorldgenMetrics {
    size?: Vec3Tuple
    chunkCount: number
    writtenVoxels: number
    anchorCount: number
    terrainFeatureCount: number
    carverCount: number
    connectorCount: number
    pathCount: number
    structureCount: number
    scatterRuleCount: number
    validationRuleCount: number
    npcCount: number
    zoneCount: number
    scriptCount: number
}

export interface WorldgenPlacementReport {
    id?: string
    kind: string
    [key: string]: unknown
}

export interface WorldgenValidationReport {
    rule: string
    ok: boolean
    [key: string]: unknown
}

export interface WorldgenReport {
    specId?: string
    specHash: string
    worldHash?: string
    status: WorldgenStatus
    warnings: WorldgenWarning[]
    errors: WorldgenError[]
    metrics: WorldgenMetrics
    resolvedAnchors: Record<string, VoxelCoord>
    resolvedObjects: Record<string, VoxelCoord>
    placements: WorldgenPlacementReport[]
    validation: WorldgenValidationReport[]
}

export type WorldgenNormalizeResult =
    | { ok: true; spec: NormalizedWorldSpec; report: WorldgenReport }
    | { ok: false; report: WorldgenReport }

export interface WorldgenCompileResult {
    chunks: ChunkManager
    meta: LevelMeta
    report: WorldgenReport
}

export interface WorldgenCompileOptions {
    chunks?: ChunkManager
    failFast?: boolean
}

export type WorldgenSurfaceCompileOptions = WorldgenCompileOptions
