export type StructureKind = 'tree' | 'house' | 'market' | 'stable' | 'church' | 'temple' | 'tower' | 'wall'
export type TreeStyle = 'mixed' | 'oak' | 'pine' | 'birch' | 'willow' | 'dead'
export type TreeSeason = 'summer' | 'autumn'
export type HouseStyle = 'mixed' | 'cottage' | 'timber' | 'stone' | 'workshop'
export type RoofStyle = 'mixed' | 'gable' | 'hip' | 'flat' | 'shed'
export type TowerStyle = 'mixed' | 'round' | 'square' | 'lighthouse' | 'ruined'
export type WallStyle = 'curtain' | 'stone' | 'timber' | 'ruined'
export type WallGateMode = 'none' | 'center' | 'auto'
export type WallTerrainMode = 'flat' | 'stepped'
export type StructureScale = 'troll' | 'folk'

export interface StructureVoxel {
    x: number
    y: number
    z: number
    block: number
    tag: string
}

export interface StructureBounds {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
    width: number
    height: number
    depth: number
}

export interface WallPathPoint {
    x: number
    y: number
    z: number
}

export interface WallPath {
    points: WallPathPoint[]
}

export interface TreeParams {
    style: TreeStyle
    season: TreeSeason
    trunkHeight: number
    trunkRadius: number
    crownRadius: number
    branchDensity: number
    leafNoise: number
    fruitChance: number
}

export interface HouseParams {
    scale: StructureScale
    style: HouseStyle
    width: number
    depth: number
    floors: number
    floorHeight: number
    roofStyle: RoofStyle
    sideWing: boolean
    porch: boolean
    chimney: boolean
}

export interface TowerParams {
    scale: StructureScale
    style: TowerStyle
    radius: number
    height: number
    wallThickness: number
    taper: number
    windowEvery: number
    ruinAmount: number
    spire: boolean
}

export interface WallParams {
    scale: StructureScale
    style: WallStyle
    length: number
    height: number
    thickness: number
    foundationDepth: number
    battlements: boolean
    walkway: boolean
    gate: WallGateMode
    terrainMode: WallTerrainMode
    ruinAmount: number
}

export interface LandmarkParams {
    scale: StructureScale
}

export interface StructureGenerationOptions {
    kind: StructureKind
    seed: number
    variants: number
    spacing: number
    detail: number
    variation: number
    cleanLoose: boolean
    showTerrain: boolean
    terrainSize: number
    terrainNoise: number
    tree: TreeParams
    house: HouseParams
    landmark: LandmarkParams
    tower: TowerParams
    wall: WallParams
}

export interface StructureGenerationResult {
    voxels: StructureVoxel[]
    removed: number
    bounds: StructureBounds
    materialCounts: Record<number, number>
    materialNames: Record<number, string>
}

export type PartialStructureGenerationOptions =
    Partial<Omit<StructureGenerationOptions, 'tree' | 'house' | 'landmark' | 'tower' | 'wall'>>
    & {
        tree?: Partial<TreeParams>
        house?: Partial<HouseParams>
        landmark?: Partial<LandmarkParams>
        tower?: Partial<TowerParams>
        wall?: Partial<WallParams>
    }
