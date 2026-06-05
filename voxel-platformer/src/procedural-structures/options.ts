import type { PartialStructureGenerationOptions, StructureGenerationOptions, StructureScale } from './types'
import { clamp, clamp01, clampInt, finite } from './math'

export interface HouseScaleDefaults {
    width: number
    depth: number
    floors: number
    floorHeight: number
}

export interface TowerScaleDefaults {
    radius: number
    height: number
    wallThickness: number
    windowEvery: number
    spire: boolean
}

export interface WallScaleDefaults {
    length: number
    height: number
    thickness: number
    foundationDepth: number
}

export const HOUSE_SCALE_DEFAULTS: Record<StructureScale, HouseScaleDefaults> = {
    troll: { width: 20, depth: 16, floors: 1, floorHeight: 6 },
    folk: { width: 10, depth: 8, floors: 1, floorHeight: 3 },
}

export const TOWER_SCALE_DEFAULTS: Record<StructureScale, TowerScaleDefaults> = {
    troll: { radius: 10, height: 36, wallThickness: 2, windowEvery: 8, spire: true },
    folk: { radius: 5, height: 18, wallThickness: 1, windowEvery: 5, spire: false },
}

export const WALL_SCALE_DEFAULTS: Record<StructureScale, WallScaleDefaults> = {
    troll: { length: 30, height: 8, thickness: 3, foundationDepth: 2 },
    folk: { length: 18, height: 5, thickness: 2, foundationDepth: 1 },
}

export const DEFAULT_STRUCTURE_OPTIONS: StructureGenerationOptions = {
    kind: 'house',
    seed: 1337,
    variants: 3,
    spacing: 34,
    detail: 0.72,
    variation: 0.42,
    cleanLoose: true,
    showTerrain: true,
    terrainSize: 92,
    terrainNoise: 0.14,
    tree: {
        style: 'mixed',
        season: 'summer',
        trunkHeight: 16,
        trunkRadius: 2,
        crownRadius: 8,
        branchDensity: 0.62,
        leafNoise: 0.30,
        fruitChance: 0.04,
    },
    house: {
        scale: 'troll',
        style: 'mixed',
        ...HOUSE_SCALE_DEFAULTS.troll,
        roofStyle: 'mixed',
        sideWing: true,
        porch: true,
        chimney: true,
    },
    landmark: {
        scale: 'troll',
    },
    tower: {
        scale: 'troll',
        style: 'mixed',
        radius: TOWER_SCALE_DEFAULTS.troll.radius,
        height: TOWER_SCALE_DEFAULTS.troll.height,
        wallThickness: TOWER_SCALE_DEFAULTS.troll.wallThickness,
        taper: 0.10,
        windowEvery: TOWER_SCALE_DEFAULTS.troll.windowEvery,
        ruinAmount: 0.06,
        spire: TOWER_SCALE_DEFAULTS.troll.spire,
    },
    wall: {
        scale: 'troll',
        style: 'curtain',
        length: WALL_SCALE_DEFAULTS.troll.length,
        height: WALL_SCALE_DEFAULTS.troll.height,
        thickness: WALL_SCALE_DEFAULTS.troll.thickness,
        foundationDepth: WALL_SCALE_DEFAULTS.troll.foundationDepth,
        battlements: true,
        walkway: true,
        gate: 'none',
        terrainMode: 'flat',
        ruinAmount: 0,
    },
}

export function normalizeStructureOptions(opts: PartialStructureGenerationOptions = {}): StructureGenerationOptions {
    const houseScale = normalizeScale(opts.house?.scale)
    const houseDefaults = HOUSE_SCALE_DEFAULTS[houseScale]
    const landmarkScale = normalizeScale(opts.landmark?.scale)
    const towerScale = normalizeScale(opts.tower?.scale)
    const towerDefaults = TOWER_SCALE_DEFAULTS[towerScale]
    const wallScale = normalizeScale(opts.wall?.scale)
    const wallDefaults = WALL_SCALE_DEFAULTS[wallScale]
    return {
        ...DEFAULT_STRUCTURE_OPTIONS,
        ...opts,
        kind: opts.kind ?? DEFAULT_STRUCTURE_OPTIONS.kind,
        seed: Math.floor(finite(opts.seed, DEFAULT_STRUCTURE_OPTIONS.seed)),
        variants: clampInt(opts.variants, 1, 8, DEFAULT_STRUCTURE_OPTIONS.variants),
        spacing: clampInt(opts.spacing, 14, 64, DEFAULT_STRUCTURE_OPTIONS.spacing),
        detail: clamp01(finite(opts.detail, DEFAULT_STRUCTURE_OPTIONS.detail)),
        variation: clamp01(finite(opts.variation, DEFAULT_STRUCTURE_OPTIONS.variation)),
        terrainSize: clampInt(opts.terrainSize, 28, 160, DEFAULT_STRUCTURE_OPTIONS.terrainSize),
        terrainNoise: clamp01(finite(opts.terrainNoise, DEFAULT_STRUCTURE_OPTIONS.terrainNoise)),
        tree: {
            ...DEFAULT_STRUCTURE_OPTIONS.tree,
            ...opts.tree,
            season: opts.tree?.season === 'autumn' ? 'autumn' : DEFAULT_STRUCTURE_OPTIONS.tree.season,
            trunkHeight: clampInt(opts.tree?.trunkHeight, 6, 36, DEFAULT_STRUCTURE_OPTIONS.tree.trunkHeight),
            trunkRadius: clampInt(opts.tree?.trunkRadius, 1, 6, DEFAULT_STRUCTURE_OPTIONS.tree.trunkRadius),
            crownRadius: clampInt(opts.tree?.crownRadius, 3, 18, DEFAULT_STRUCTURE_OPTIONS.tree.crownRadius),
            branchDensity: clamp01(finite(opts.tree?.branchDensity, DEFAULT_STRUCTURE_OPTIONS.tree.branchDensity)),
            leafNoise: clamp01(finite(opts.tree?.leafNoise, DEFAULT_STRUCTURE_OPTIONS.tree.leafNoise)),
            fruitChance: clamp(finite(opts.tree?.fruitChance, DEFAULT_STRUCTURE_OPTIONS.tree.fruitChance), 0, 0.35),
        },
        house: {
            ...DEFAULT_STRUCTURE_OPTIONS.house,
            ...opts.house,
            scale: houseScale,
            width: clampInt(opts.house?.width, houseScale === 'folk' ? 6 : 10, houseScale === 'folk' ? 18 : 38, houseDefaults.width),
            depth: clampInt(opts.house?.depth, houseScale === 'folk' ? 6 : 10, houseScale === 'folk' ? 16 : 34, houseDefaults.depth),
            floors: clampInt(opts.house?.floors, 1, houseScale === 'folk' ? 2 : 3, houseDefaults.floors),
            floorHeight: clampInt(opts.house?.floorHeight, houseScale === 'folk' ? 3 : 5, houseScale === 'folk' ? 5 : 9, houseDefaults.floorHeight),
        },
        landmark: {
            ...DEFAULT_STRUCTURE_OPTIONS.landmark,
            ...opts.landmark,
            scale: landmarkScale,
        },
        tower: {
            ...DEFAULT_STRUCTURE_OPTIONS.tower,
            ...opts.tower,
            scale: towerScale,
            radius: clampInt(opts.tower?.radius, towerScale === 'folk' ? 4 : 5, towerScale === 'folk' ? 9 : 18, towerDefaults.radius),
            height: clampInt(opts.tower?.height, towerScale === 'folk' ? 12 : 18, towerScale === 'folk' ? 32 : 72, towerDefaults.height),
            wallThickness: clampInt(opts.tower?.wallThickness, 1, towerScale === 'folk' ? 2 : 5, towerDefaults.wallThickness),
            taper: clamp(finite(opts.tower?.taper, DEFAULT_STRUCTURE_OPTIONS.tower.taper), 0, 0.35),
            windowEvery: clampInt(opts.tower?.windowEvery, towerScale === 'folk' ? 4 : 5, towerScale === 'folk' ? 10 : 18, towerDefaults.windowEvery),
            ruinAmount: clamp(finite(opts.tower?.ruinAmount, DEFAULT_STRUCTURE_OPTIONS.tower.ruinAmount), 0, 0.65),
        },
        wall: {
            ...DEFAULT_STRUCTURE_OPTIONS.wall,
            ...opts.wall,
            scale: wallScale,
            style: normalizeWallStyle(opts.wall?.style),
            length: clampInt(opts.wall?.length, wallScale === 'folk' ? 6 : 10, wallScale === 'folk' ? 80 : 120, wallDefaults.length),
            height: clampInt(opts.wall?.height, wallScale === 'folk' ? 3 : 4, wallScale === 'folk' ? 16 : 32, wallDefaults.height),
            thickness: clampInt(opts.wall?.thickness, 1, wallScale === 'folk' ? 4 : 8, wallDefaults.thickness),
            foundationDepth: clampInt(opts.wall?.foundationDepth, 0, 8, wallDefaults.foundationDepth),
            gate: normalizeWallGate(opts.wall?.gate),
            terrainMode: opts.wall?.terrainMode === 'stepped' ? 'stepped' : 'flat',
            ruinAmount: clamp(finite(opts.wall?.ruinAmount, DEFAULT_STRUCTURE_OPTIONS.wall.ruinAmount), 0, 0.85),
        },
    }
}

function normalizeScale(scale: unknown): StructureScale {
    return scale === 'folk' ? 'folk' : 'troll'
}

function normalizeWallStyle(style: unknown): StructureGenerationOptions['wall']['style'] {
    return style === 'stone' || style === 'timber' || style === 'ruined'
        ? style
        : 'curtain'
}

function normalizeWallGate(gate: unknown): StructureGenerationOptions['wall']['gate'] {
    return gate === 'center' || gate === 'auto' ? gate : 'none'
}
