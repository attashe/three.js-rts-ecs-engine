export type StructureKind = 'tree' | 'house' | 'tower' | 'mixed'
export type TreeStyle = 'mixed' | 'oak' | 'pine' | 'birch' | 'willow' | 'dead'
export type HouseStyle = 'mixed' | 'cottage' | 'timber' | 'stone' | 'workshop'
export type RoofStyle = 'mixed' | 'gable' | 'hip' | 'flat' | 'shed'
export type TowerStyle = 'mixed' | 'round' | 'square' | 'lighthouse' | 'ruined'

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

export interface TreeParams {
    style: TreeStyle
    trunkHeight: number
    trunkRadius: number
    crownRadius: number
    branchDensity: number
    leafNoise: number
    fruitChance: number
}

export interface HouseParams {
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
    style: TowerStyle
    radius: number
    height: number
    wallThickness: number
    taper: number
    windowEvery: number
    ruinAmount: number
    spire: boolean
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
    tower: TowerParams
}

export interface StructureGenerationResult {
    voxels: StructureVoxel[]
    removed: number
    bounds: StructureBounds
    materialCounts: Record<number, number>
    materialNames: Record<number, string>
}

export type PartialStructureGenerationOptions =
    Partial<Omit<StructureGenerationOptions, 'tree' | 'house' | 'tower'>>
    & {
        tree?: Partial<TreeParams>
        house?: Partial<HouseParams>
        tower?: Partial<TowerParams>
    }
