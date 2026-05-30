import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState, EditorWallEndpointMode } from '../editor-state'
import type { CommandStack } from '../history'
import { STRUCTURE_PREFABS } from '../../procedural-structures/prefabs'
import { rotatedSize, type StructureAnchor, type StructureRotation } from '../../procedural-structures/asset'
import type {
    HouseStyle,
    RoofStyle,
    StructureKind,
    StructureScale,
    TowerStyle,
    TreeSeason,
    TreeStyle,
    WallGateMode,
    WallStyle,
    WallTerrainMode,
} from '../../procedural-structures/types'
import { HOUSE_SCALE_DEFAULTS, TOWER_SCALE_DEFAULTS, WALL_SCALE_DEFAULTS } from '../../procedural-structures/options'
import { resolveStructureAsset } from '../structure-asset-cache'
import { sectionEl, type RefreshableElement } from './common'

export interface StructuresTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

const PROCEDURAL_KINDS: StructureKind[] = ['house', 'market', 'stable', 'church', 'temple', 'tree', 'tower', 'wall']
const TREE_STYLES: TreeStyle[] = ['mixed', 'oak', 'pine', 'birch', 'willow', 'dead']
const TREE_SEASONS: TreeSeason[] = ['summer', 'autumn']
const STRUCTURE_SCALES: StructureScale[] = ['troll', 'folk']
const HOUSE_STYLES: HouseStyle[] = ['mixed', 'cottage', 'timber', 'stone', 'workshop']
const ROOF_STYLES: RoofStyle[] = ['mixed', 'gable', 'hip', 'flat', 'shed']
const TOWER_STYLES: TowerStyle[] = ['mixed', 'round', 'square', 'lighthouse', 'ruined']
const WALL_STYLES: WallStyle[] = ['curtain', 'stone', 'timber', 'ruined']
const WALL_GATES: WallGateMode[] = ['none', 'center', 'auto']
const WALL_TERRAIN_MODES: WallTerrainMode[] = ['flat', 'stepped']
const WALL_ENDPOINT_MODES: { id: EditorWallEndpointMode; label: string }[] = [
    { id: 'free', label: 'Free points' },
    { id: 'tower-socket', label: 'Tower centers' },
]
const ROTATIONS: StructureRotation[] = [0, 90, 180, 270]
const ANCHORS: { id: StructureAnchor; label: string }[] = [
    { id: 'bottom-center', label: 'Bottom centre' },
    { id: 'center', label: 'Centre' },
    { id: 'min-corner', label: 'Min corner' },
]

/**
 * Structures tab — configures and places multi-block structures. Two
 * source kinds share one placement flow:
 *  - **Prefab** — hand-authored set-pieces (portal gate, well, ...).
 *  - **Procedural** — seeded tree / building / tower / wall generators.
 *
 * A live size readout shows the exact bounding box + voxel count for the
 * current configuration, and the 3D preview (structure-preview system)
 * mirrors it on the cursor. Placement bakes the voxels into the level as
 * one undoable edit.
 */
export function buildStructuresTab(opts: StructuresTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // Mode toggle.
    const modeSection = sectionEl('Mode')
    const placeBtn = button('Place Structure', 'LMB stamps structures. Wall mode uses first click = start, second click = end. RMB rerolls or clears wall start.')
    placeBtn.onclick = () => {
        if (state.mode === 'place-structure') {
            state.mode = 'select'
            state.structureWallStart = null
        } else {
            state.mode = 'place-structure'
        }
        refresh()
    }
    modeSection.appendChild(placeBtn)
    root.appendChild(modeSection)

    // Source kind.
    const sourceSection = sectionEl('Source')
    const sourceRow = document.createElement('div')
    sourceRow.className = 'vpe-row'
    const prefabBtn = button('Prefab', 'Hand-authored set-pieces.')
    const proceduralBtn = button('Procedural', 'Seeded generators.')
    prefabBtn.onclick = () => { state.structureSourceKind = 'prefab'; state.structureWallStart = null; refresh() }
    proceduralBtn.onclick = () => { state.structureSourceKind = 'procedural'; refresh() }
    sourceRow.append(prefabBtn, proceduralBtn)
    sourceSection.appendChild(sourceRow)
    root.appendChild(sourceSection)

    // Prefab picker.
    const prefabSection = sectionEl('Prefab')
    const prefabSelect = selectField(
        'Structure',
        STRUCTURE_PREFABS.map((p) => ({ value: p.id, label: p.label })),
        state.structurePrefabId,
        (value) => { state.structurePrefabId = value; refresh() },
    )
    const prefabHint = hint('')
    prefabSection.append(prefabSelect.field, prefabHint)
    root.appendChild(prefabSection)

    // Procedural controls.
    const procSection = sectionEl('Procedural')
    const kindSelect = selectField(
        'Kind',
        PROCEDURAL_KINDS.map((k) => ({ value: k, label: capitalize(k) })),
        state.structureKind,
        (value) => { state.structureKind = value as StructureKind; state.structureWallStart = null; refresh() },
    )
    const seedRow = document.createElement('div')
    seedRow.className = 'vpe-row'
    const seedInput = numberField('Seed', state.structureSeed, 0, 999999, 1, (v) => {
        state.structureSeed = Math.max(0, Math.floor(v))
        refresh()
    })
    const randomBtn = smallButton('Random', 'Pick a random seed.')
    randomBtn.onclick = () => {
        state.structureSeed = Math.floor(Math.random() * 999999)
        refresh()
    }
    seedRow.append(seedInput, randomBtn)
    const structuralOnly = checkboxField('Structural only', state.structureStructuralOnly, (value) => {
        state.structureStructuralOnly = value
        refresh()
    })
    const cleanLoose = checkboxField('Clean loose voxels', state.structureCleanLoose, (value) => {
        state.structureCleanLoose = value
        refresh()
    })
    const detailField = numberField('Detail', state.structureDetail, 0, 1, 0.05, (v) => { state.structureDetail = v; refresh() })
    const variationField = numberField('Variation', state.structureVariation, 0, 1, 0.05, (v) => { state.structureVariation = v; refresh() })
    const generatorFields = fieldGroup('Generator Params', [
        detailField,
        variationField,
        cleanLoose,
        structuralOnly,
    ])

    const treeStyleSelect = selectField(
        'Species',
        TREE_STYLES.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureTreeStyle,
        (value) => { state.structureTreeStyle = value as TreeStyle; refresh() },
    )
    const treeSeasonSelect = selectField(
        'Season',
        TREE_SEASONS.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureTreeSeason,
        (value) => { state.structureTreeSeason = value as TreeSeason; refresh() },
    )
    const treeTrunkHeightField = numberField('Trunk H', state.structureTreeTrunkHeight, 6, 36, 1, (v) => { state.structureTreeTrunkHeight = Math.floor(v); refresh() })
    const treeTrunkRadiusField = numberField('Trunk R', state.structureTreeTrunkRadius, 1, 6, 1, (v) => { state.structureTreeTrunkRadius = Math.floor(v); refresh() })
    const treeCrownRadiusField = numberField('Crown R', state.structureTreeCrownRadius, 3, 18, 1, (v) => { state.structureTreeCrownRadius = Math.floor(v); refresh() })
    const treeBranchDensityField = numberField('Branches', state.structureTreeBranchDensity, 0, 1, 0.05, (v) => { state.structureTreeBranchDensity = v; refresh() })
    const treeLeafNoiseField = numberField('Leaf Noise', state.structureTreeLeafNoise, 0, 1, 0.05, (v) => { state.structureTreeLeafNoise = v; refresh() })
    const treeFruitChanceField = numberField('Fruit', state.structureTreeFruitChance, 0, 0.35, 0.01, (v) => { state.structureTreeFruitChance = v; refresh() })
    const treeSection = fieldGroup('Tree Params', [
        treeStyleSelect.field,
        treeSeasonSelect.field,
        treeTrunkHeightField,
        treeTrunkRadiusField,
        treeCrownRadiusField,
        treeBranchDensityField,
        treeLeafNoiseField,
        treeFruitChanceField,
    ])

    const houseScaleSelect = selectField(
        'Scale',
        STRUCTURE_SCALES.map((s) => ({ value: s, label: scaleLabel(s) })),
        state.structureHouseScale,
        (value) => {
            state.structureHouseScale = value as StructureScale
            applyHouseScaleDefaults(state)
            refresh()
        },
    )
    const houseStyleSelect = selectField(
        'Style',
        HOUSE_STYLES.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureHouseStyle,
        (value) => { state.structureHouseStyle = value as HouseStyle; refresh() },
    )
    const houseWidthField = numberField('Width', state.structureHouseWidth, 6, 38, 1, (v) => { state.structureHouseWidth = Math.floor(v); clampHouseStateToScale(state); refresh() })
    const houseDepthField = numberField('Depth', state.structureHouseDepth, 6, 34, 1, (v) => { state.structureHouseDepth = Math.floor(v); clampHouseStateToScale(state); refresh() })
    const houseFloorsField = numberField('Floors', state.structureHouseFloors, 1, 3, 1, (v) => { state.structureHouseFloors = Math.floor(v); clampHouseStateToScale(state); refresh() })
    const houseFloorHeightField = numberField('Floor H', state.structureHouseFloorHeight, 3, 9, 1, (v) => { state.structureHouseFloorHeight = Math.floor(v); clampHouseStateToScale(state); refresh() })
    const houseRoofSelect = selectField(
        'Roof',
        ROOF_STYLES.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureHouseRoofStyle,
        (value) => { state.structureHouseRoofStyle = value as RoofStyle; refresh() },
    )
    const houseSideWingField = checkboxField('Side wing', state.structureHouseSideWing, (value) => { state.structureHouseSideWing = value; refresh() })
    const housePorchField = checkboxField('Porch and garden', state.structureHousePorch, (value) => { state.structureHousePorch = value; refresh() })
    const houseChimneyField = checkboxField('Chimney smoke', state.structureHouseChimney, (value) => { state.structureHouseChimney = value; refresh() })
    const houseSection = fieldGroup('House Params', [
        houseScaleSelect.field,
        houseStyleSelect.field,
        houseWidthField,
        houseDepthField,
        houseFloorsField,
        houseFloorHeightField,
        houseRoofSelect.field,
        houseSideWingField,
        housePorchField,
        houseChimneyField,
    ])

    const landmarkScaleSelect = selectField(
        'Scale',
        STRUCTURE_SCALES.map((s) => ({ value: s, label: scaleLabel(s) })),
        state.structureLandmarkScale,
        (value) => {
            state.structureLandmarkScale = value as StructureScale
            refresh()
        },
    )
    const landmarkSection = fieldGroup('Building Params', [
        landmarkScaleSelect.field,
        hint('Market, stable, and church can be troll-town or small-folk scale. Temple is always a large troll-town civic structure.'),
    ])

    const towerScaleSelect = selectField(
        'Scale',
        STRUCTURE_SCALES.map((s) => ({ value: s, label: scaleLabel(s) })),
        state.structureTowerScale,
        (value) => {
            state.structureTowerScale = value as StructureScale
            applyTowerScaleDefaults(state)
            refresh()
        },
    )
    const towerStyleSelect = selectField(
        'Style',
        TOWER_STYLES.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureTowerStyle,
        (value) => { state.structureTowerStyle = value as TowerStyle; refresh() },
    )
    const towerRadiusField = numberField('Radius', state.structureTowerRadius, 4, 18, 1, (v) => { state.structureTowerRadius = Math.floor(v); clampTowerStateToScale(state); refresh() })
    const towerHeightField = numberField('Height', state.structureTowerHeight, 12, 72, 1, (v) => { state.structureTowerHeight = Math.floor(v); clampTowerStateToScale(state); refresh() })
    const towerWallField = numberField('Wall', state.structureTowerWallThickness, 1, 5, 1, (v) => { state.structureTowerWallThickness = Math.floor(v); clampTowerStateToScale(state); refresh() })
    const towerTaperField = numberField('Taper', state.structureTowerTaper, 0, 0.35, 0.01, (v) => { state.structureTowerTaper = v; refresh() })
    const towerWindowsField = numberField('Windows', state.structureTowerWindowEvery, 4, 18, 1, (v) => { state.structureTowerWindowEvery = Math.floor(v); clampTowerStateToScale(state); refresh() })
    const towerRuinField = numberField('Ruin', state.structureTowerRuinAmount, 0, 0.65, 0.01, (v) => { state.structureTowerRuinAmount = v; refresh() })
    const towerSpireField = checkboxField('Spire', state.structureTowerSpire, (value) => { state.structureTowerSpire = value; refresh() })
    const towerSection = fieldGroup('Tower Params', [
        towerScaleSelect.field,
        towerStyleSelect.field,
        towerRadiusField,
        towerHeightField,
        towerWallField,
        towerTaperField,
        towerWindowsField,
        towerRuinField,
        towerSpireField,
    ])

    const wallScaleSelect = selectField(
        'Scale',
        STRUCTURE_SCALES.map((s) => ({ value: s, label: scaleLabel(s) })),
        state.structureWallScale,
        (value) => {
            state.structureWallScale = value as StructureScale
            applyWallScaleDefaults(state)
            refresh()
        },
    )
    const wallEndpointSelect = selectField(
        'Endpoints',
        WALL_ENDPOINT_MODES.map((mode) => ({ value: mode.id, label: mode.label })),
        state.structureWallEndpointMode,
        (value) => { state.structureWallEndpointMode = value as EditorWallEndpointMode; state.structureWallStart = null; refresh() },
    )
    const wallTowerRadiusField = numberField('Tower R', state.structureWallTowerRadius, 1, 24, 1, (v) => {
        state.structureWallTowerRadius = Math.floor(v)
        state.structureWallStart = null
        refresh()
    })
    const wallStyleSelect = selectField(
        'Style',
        WALL_STYLES.map((s) => ({ value: s, label: capitalize(s) })),
        state.structureWallStyle,
        (value) => { state.structureWallStyle = value as WallStyle; refresh() },
    )
    const wallLengthField = numberField('Sample L', state.structureWallLength, 6, 120, 1, (v) => { state.structureWallLength = Math.floor(v); clampWallStateToScale(state); refresh() })
    const wallHeightField = numberField('Height', state.structureWallHeight, 3, 32, 1, (v) => { state.structureWallHeight = Math.floor(v); clampWallStateToScale(state); refresh() })
    const wallThicknessField = numberField('Thick', state.structureWallThickness, 1, 8, 1, (v) => { state.structureWallThickness = Math.floor(v); clampWallStateToScale(state); refresh() })
    const wallFoundationField = numberField('Foundation', state.structureWallFoundationDepth, 0, 8, 1, (v) => { state.structureWallFoundationDepth = Math.floor(v); refresh() })
    const wallGateSelect = selectField(
        'Gate',
        WALL_GATES.map((g) => ({ value: g, label: g === 'none' ? 'None' : g === 'center' ? 'Center' : 'Auto' })),
        state.structureWallGate,
        (value) => { state.structureWallGate = value as WallGateMode; refresh() },
    )
    const wallTerrainSelect = selectField(
        'Terrain',
        WALL_TERRAIN_MODES.map((m) => ({ value: m, label: capitalize(m) })),
        state.structureWallTerrainMode,
        (value) => { state.structureWallTerrainMode = value as WallTerrainMode; refresh() },
    )
    const wallBattlementsField = checkboxField('Battlements', state.structureWallBattlements, (value) => { state.structureWallBattlements = value; refresh() })
    const wallWalkwayField = checkboxField('Walkway', state.structureWallWalkway, (value) => { state.structureWallWalkway = value; refresh() })
    const wallRuinField = numberField('Ruin', state.structureWallRuinAmount, 0, 0.85, 0.01, (v) => { state.structureWallRuinAmount = v; refresh() })
    const wallSection = fieldGroup('Wall Params', [
        wallScaleSelect.field,
        wallEndpointSelect.field,
        wallTowerRadiusField,
        wallStyleSelect.field,
        wallLengthField,
        wallHeightField,
        wallThicknessField,
        wallFoundationField,
        wallGateSelect.field,
        wallTerrainSelect.field,
        wallBattlementsField,
        wallWalkwayField,
        wallRuinField,
        hint('Two-click placement: free mode uses exact cells; tower-center mode offsets both endpoints to the facing tower edges. Sample length is used by the standalone asset readout.'),
    ])

    procSection.append(kindSelect.field, seedRow, generatorFields, treeSection, houseSection, landmarkSection, towerSection, wallSection)
    root.appendChild(procSection)

    // Transform (shared by both source kinds).
    const xfSection = sectionEl('Transform')
    const rotationRow = document.createElement('div')
    rotationRow.className = 'vpe-row'
    const rotLabel = document.createElement('span')
    rotLabel.className = 'vpe-field-label'
    rotLabel.textContent = 'Rotate'
    rotationRow.appendChild(rotLabel)
    const rotButtons = ROTATIONS.map((r) => {
        const b = smallButton(`${r}°`, `Rotate ${r}° about Y.`)
        b.onclick = () => { state.structureRotation = r; refresh() }
        rotationRow.appendChild(b)
        return { r, b }
    })
    const anchorSelect = selectField(
        'Anchor',
        ANCHORS.map((a) => ({ value: a.id, label: a.label })),
        state.structureAnchor,
        (value) => { state.structureAnchor = value as StructureAnchor; refresh() },
    )
    xfSection.append(rotationRow, anchorSelect.field)
    root.appendChild(xfSection)

    // Live size readout.
    const sizeSection = sectionEl('Size')
    const sizeReadout = document.createElement('div')
    sizeReadout.className = 'vpe-hint'
    sizeReadout.style.lineHeight = '1.5'
    sizeSection.appendChild(sizeReadout)
    root.appendChild(sizeSection)

    root.appendChild(hint('LMB places · RMB rerolls seed · the cursor preview shows the bounding box.'))

    function refresh(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-structure')
        prefabBtn.classList.toggle('active', state.structureSourceKind === 'prefab')
        proceduralBtn.classList.toggle('active', state.structureSourceKind === 'procedural')
        prefabSection.style.display = state.structureSourceKind === 'prefab' ? '' : 'none'
        procSection.style.display = state.structureSourceKind === 'procedural' ? '' : 'none'
        treeSection.style.display = state.structureKind === 'tree' ? '' : 'none'
        houseSection.style.display = state.structureKind === 'house' ? '' : 'none'
        landmarkSection.style.display = hasBuildingParams(state.structureKind) ? '' : 'none'
        landmarkScaleSelect.field.style.display = isScalableLandmarkKind(state.structureKind) ? '' : 'none'
        towerSection.style.display = state.structureKind === 'tower' ? '' : 'none'
        wallSection.style.display = state.structureKind === 'wall' ? '' : 'none'
        xfSection.style.display = state.structureSourceKind === 'procedural' && state.structureKind === 'wall' ? 'none' : ''

        syncSelect(prefabSelect.select, state.structurePrefabId)
        syncSelect(kindSelect.select, state.structureKind)
        syncSelect(anchorSelect.select, state.structureAnchor)
        const seedField = seedInput.querySelector('input') as HTMLInputElement
        if (document.activeElement !== seedField) seedField.value = String(state.structureSeed)
        syncNumber(detailField, state.structureDetail)
        syncNumber(variationField, state.structureVariation)
        syncSelect(treeStyleSelect.select, state.structureTreeStyle)
        syncSelect(treeSeasonSelect.select, state.structureTreeSeason)
        syncNumber(treeTrunkHeightField, state.structureTreeTrunkHeight)
        syncNumber(treeTrunkRadiusField, state.structureTreeTrunkRadius)
        syncNumber(treeCrownRadiusField, state.structureTreeCrownRadius)
        syncNumber(treeBranchDensityField, state.structureTreeBranchDensity)
        syncNumber(treeLeafNoiseField, state.structureTreeLeafNoise)
        syncNumber(treeFruitChanceField, state.structureTreeFruitChance)
        syncSelect(houseScaleSelect.select, state.structureHouseScale)
        syncSelect(houseStyleSelect.select, state.structureHouseStyle)
        syncNumber(houseWidthField, state.structureHouseWidth)
        syncNumber(houseDepthField, state.structureHouseDepth)
        syncNumber(houseFloorsField, state.structureHouseFloors)
        syncNumber(houseFloorHeightField, state.structureHouseFloorHeight)
        syncSelect(houseRoofSelect.select, state.structureHouseRoofStyle)
        syncCheckbox(houseSideWingField, state.structureHouseSideWing)
        syncCheckbox(housePorchField, state.structureHousePorch)
        syncCheckbox(houseChimneyField, state.structureHouseChimney)
        syncSelect(landmarkScaleSelect.select, state.structureLandmarkScale)
        syncSelect(towerScaleSelect.select, state.structureTowerScale)
        syncSelect(towerStyleSelect.select, state.structureTowerStyle)
        syncNumber(towerRadiusField, state.structureTowerRadius)
        syncNumber(towerHeightField, state.structureTowerHeight)
        syncNumber(towerWallField, state.structureTowerWallThickness)
        syncNumber(towerTaperField, state.structureTowerTaper)
        syncNumber(towerWindowsField, state.structureTowerWindowEvery)
        syncNumber(towerRuinField, state.structureTowerRuinAmount)
        syncCheckbox(towerSpireField, state.structureTowerSpire)
        syncSelect(wallScaleSelect.select, state.structureWallScale)
        syncSelect(wallEndpointSelect.select, state.structureWallEndpointMode)
        syncNumber(wallTowerRadiusField, state.structureWallTowerRadius)
        syncSelect(wallStyleSelect.select, state.structureWallStyle)
        syncNumber(wallLengthField, state.structureWallLength)
        syncNumber(wallHeightField, state.structureWallHeight)
        syncNumber(wallThicknessField, state.structureWallThickness)
        syncNumber(wallFoundationField, state.structureWallFoundationDepth)
        syncSelect(wallGateSelect.select, state.structureWallGate)
        syncSelect(wallTerrainSelect.select, state.structureWallTerrainMode)
        syncCheckbox(wallBattlementsField, state.structureWallBattlements)
        syncCheckbox(wallWalkwayField, state.structureWallWalkway)
        syncNumber(wallRuinField, state.structureWallRuinAmount)
        wallTowerRadiusField.style.display = state.structureWallEndpointMode === 'tower-socket' ? '' : 'none'
        ;(cleanLoose.querySelector('input') as HTMLInputElement).checked = state.structureCleanLoose
        ;(structuralOnly.querySelector('input') as HTMLInputElement).checked = state.structureStructuralOnly
        for (const { r, b } of rotButtons) b.classList.toggle('active', state.structureRotation === r)

        const prefab = STRUCTURE_PREFABS.find((p) => p.id === state.structurePrefabId)
        prefabHint.textContent = prefab?.description ?? ''

        updateSizeReadout()
    }

    function updateSizeReadout(): void {
        try {
            const asset = resolveStructureAsset(state, opts.chunks.palette)
            const size = rotatedSize(asset, state.structureRotation)
            const lines = [
                `Footprint <b>${size.width} × ${size.depth}</b>`,
                `Height <b>${size.height}</b>`,
                `<b>${asset.stats.voxelCount.toLocaleString()}</b> voxels`,
            ]
            if (state.structureSourceKind === 'procedural' && state.structureKind === 'wall') {
                lines.unshift(state.structureWallStart
                    ? `Wall start <b>${state.structureWallStart.x}, ${state.structureWallStart.y}, ${state.structureWallStart.z}</b>`
                    : 'Wall start <b>not set</b>')
                lines.unshift(`Endpoints <b>${state.structureWallEndpointMode === 'tower-socket' ? 'tower centers' : 'free points'}</b>`)
            }
            sizeReadout.innerHTML = lines.join('<br>')
        } catch (err) {
            sizeReadout.textContent = err instanceof Error ? err.message : String(err)
        }
    }

    refresh()
    return { element: root, refresh }
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function scaleLabel(scale: StructureScale): string {
    return scale === 'folk' ? 'Small folk' : 'Troll town'
}

function hasBuildingParams(kind: StructureKind): boolean {
    return isScalableLandmarkKind(kind) || kind === 'temple'
}

function isScalableLandmarkKind(kind: StructureKind): boolean {
    return kind === 'market' || kind === 'stable' || kind === 'church'
}

function applyHouseScaleDefaults(state: EditorState): void {
    const d = HOUSE_SCALE_DEFAULTS[state.structureHouseScale]
    state.structureHouseWidth = d.width
    state.structureHouseDepth = d.depth
    state.structureHouseFloors = d.floors
    state.structureHouseFloorHeight = d.floorHeight
}

function applyTowerScaleDefaults(state: EditorState): void {
    const d = TOWER_SCALE_DEFAULTS[state.structureTowerScale]
    state.structureTowerRadius = d.radius
    state.structureTowerHeight = d.height
    state.structureTowerWallThickness = d.wallThickness
    state.structureTowerWindowEvery = d.windowEvery
    state.structureTowerSpire = d.spire
}

function applyWallScaleDefaults(state: EditorState): void {
    const d = WALL_SCALE_DEFAULTS[state.structureWallScale]
    state.structureWallLength = d.length
    state.structureWallHeight = d.height
    state.structureWallThickness = d.thickness
    state.structureWallFoundationDepth = d.foundationDepth
    state.structureWallTowerRadius = TOWER_SCALE_DEFAULTS[state.structureWallScale].radius
}

function clampHouseStateToScale(state: EditorState): void {
    const folk = state.structureHouseScale === 'folk'
    state.structureHouseWidth = clampInt(state.structureHouseWidth, folk ? 6 : 10, folk ? 18 : 38)
    state.structureHouseDepth = clampInt(state.structureHouseDepth, folk ? 6 : 10, folk ? 16 : 34)
    state.structureHouseFloors = clampInt(state.structureHouseFloors, 1, folk ? 2 : 3)
    state.structureHouseFloorHeight = clampInt(state.structureHouseFloorHeight, folk ? 3 : 5, folk ? 5 : 9)
}

function clampTowerStateToScale(state: EditorState): void {
    const folk = state.structureTowerScale === 'folk'
    state.structureTowerRadius = clampInt(state.structureTowerRadius, folk ? 4 : 5, folk ? 9 : 18)
    state.structureTowerHeight = clampInt(state.structureTowerHeight, folk ? 12 : 18, folk ? 32 : 72)
    state.structureTowerWallThickness = clampInt(state.structureTowerWallThickness, 1, folk ? 2 : 5)
    state.structureTowerWindowEvery = clampInt(state.structureTowerWindowEvery, folk ? 4 : 5, folk ? 10 : 18)
}

function clampWallStateToScale(state: EditorState): void {
    const folk = state.structureWallScale === 'folk'
    state.structureWallLength = clampInt(state.structureWallLength, folk ? 6 : 10, folk ? 80 : 120)
    state.structureWallHeight = clampInt(state.structureWallHeight, folk ? 3 : 4, folk ? 16 : 32)
    state.structureWallThickness = clampInt(state.structureWallThickness, 1, folk ? 4 : 8)
}

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)))
}

function selectField(
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
): { field: HTMLLabelElement; select: HTMLSelectElement } {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const select = document.createElement('select')
    select.className = 'vpe-input'
    for (const opt of options) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        select.appendChild(o)
    }
    select.value = value
    select.onchange = () => onChange(select.value)
    field.append(labelEl, select)
    return { field, select }
}

function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.flex = '1 1 70px'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.onchange = () => {
        const next = Number(input.value)
        if (!Number.isFinite(next)) {
            input.value = String(value)
            return
        }
        onChange(Math.min(max, Math.max(min, next)))
    }
    field.append(labelEl, input)
    return field
}

function fieldGroup(title: string, fields: HTMLElement[]): HTMLElement {
    const group = document.createElement('div')
    group.className = 'vpe-section'
    group.style.marginTop = '6px'
    const heading = document.createElement('h3')
    heading.textContent = title
    group.appendChild(heading)
    for (const field of fields) group.appendChild(field)
    return group
}

function checkboxField(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.cursor = 'pointer'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    field.append(labelEl, input)
    return field
}

function button(text: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'vpe-button'
    btn.textContent = text
    btn.title = title
    return btn
}

function smallButton(text: string, title: string): HTMLButtonElement {
    const btn = button(text, title)
    btn.style.padding = '2px 6px'
    btn.style.flex = '0 0 auto'
    return btn
}

function hint(text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'vpe-hint'
    el.textContent = text
    return el
}

function syncSelect(select: HTMLSelectElement, value: string): void {
    if (select.value !== value) select.value = value
}

function syncNumber(field: HTMLElement, value: number): void {
    const input = field.querySelector('input')
    if (!(input instanceof HTMLInputElement) || document.activeElement === input) return
    input.value = String(value)
}

function syncCheckbox(field: HTMLElement, value: boolean): void {
    const input = field.querySelector('input')
    if (input instanceof HTMLInputElement) input.checked = value
}
