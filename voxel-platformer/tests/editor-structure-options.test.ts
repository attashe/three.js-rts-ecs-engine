import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState } from '../src/editor/editor-state'
import { structureSourceFromState, wallPlacementEditsFromState } from '../src/editor/structure-asset-cache'

test('editor structure state feeds procedural generator parameters', () => {
    const state = createEditorState({ x: 0, y: 4, z: 0 })
    state.structureSourceKind = 'procedural'
    state.structureKind = 'tree'
    state.structureSeed = 42
    state.structureDetail = 0.35
    state.structureVariation = 0.2
    state.structureCleanLoose = false
    state.structureTreeStyle = 'oak'
    state.structureTreeSeason = 'autumn'
    state.structureTreeTrunkHeight = 22
    state.structureHouseScale = 'folk'
    state.structureLandmarkScale = 'folk'
    state.structureTowerScale = 'folk'
    state.structureWallScale = 'folk'
    state.structureWallStyle = 'timber'
    state.structureWallHeight = 6
    state.structureWallThickness = 2
    state.structureWallGate = 'center'

    const source = structureSourceFromState(state)
    assert.equal(source.kind, 'procedural')
    assert.equal(source.options.kind, 'tree')
    assert.equal(source.options.seed, 42)
    assert.equal(source.options.detail, 0.35)
    assert.equal(source.options.variation, 0.2)
    assert.equal(source.options.cleanLoose, false)
    assert.equal(source.options.tree?.style, 'oak')
    assert.equal(source.options.tree?.season, 'autumn')
    assert.equal(source.options.tree?.trunkHeight, 22)
    assert.equal(source.options.house?.scale, 'folk')
    assert.equal(source.options.landmark?.scale, 'folk')
    assert.equal(source.options.tower?.scale, 'folk')
    assert.equal(source.options.wall?.scale, 'folk')
    assert.equal(source.options.wall?.style, 'timber')
    assert.equal(source.options.wall?.height, 6)
    assert.equal(source.options.wall?.thickness, 2)
    assert.equal(source.options.wall?.gate, 'center')
})

test('editor temple source is fixed to troll scale', () => {
    const state = createEditorState({ x: 0, y: 4, z: 0 })
    state.structureSourceKind = 'procedural'
    state.structureKind = 'temple'
    state.structureLandmarkScale = 'folk'

    const source = structureSourceFromState(state)

    assert.equal(source.kind, 'procedural')
    assert.equal(source.options.kind, 'temple')
    assert.equal(source.options.landmark?.scale, 'troll')
})

test('editor wall tower-center mode offsets endpoints to tower sockets', () => {
    const state = createEditorState({ x: 0, y: 4, z: 0 })
    state.structureWallEndpointMode = 'tower-socket'
    state.structureWallTowerRadius = 4
    state.structureWallHeight = 3
    state.structureWallThickness = 1
    state.structureWallBattlements = false
    state.structureWallFoundationDepth = 0

    const edits = wallPlacementEditsFromState(
        state,
        { x: 0, y: 2, z: 0 },
        { x: 20, y: 2, z: 0 },
    )
    const xs = edits.map((e) => e.x)

    assert.equal(Math.min(...xs), 4)
    assert.equal(Math.max(...xs), 16)
    assert.equal(edits.some((e) => e.x === 0 || e.x === 20), false)
})
