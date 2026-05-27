import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { createEditorState } from '../src/editor/editor-state'
import { createPropPlaceSystem, scatterBrushCells } from '../src/editor/systems/prop-place-system'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ClickEvent, Input } from '../src/engine/input/input'
import type { IsometricCamera } from '../src/engine/render/isometric-camera'

function fakeInput(clicks: ClickEvent[]): Input {
    let pending = clicks
    return {
        consumeClicks: () => {
            const out = pending
            pending = []
            return out
        },
        getPointer: () => null,
    } as unknown as Input
}

function withBrowserViewport(run: () => void): void {
    const oldWindow = (globalThis as { window?: unknown }).window
    const oldDOMRect = (globalThis as { DOMRect?: unknown }).DOMRect
    const oldElement = (globalThis as { Element?: unknown }).Element
    ;(globalThis as { window?: unknown }).window = { innerWidth: 100, innerHeight: 100 }
    ;(globalThis as { Element?: unknown }).Element = class {}
    ;(globalThis as { DOMRect?: unknown }).DOMRect = class {
        x: number
        y: number
        width: number
        height: number
        left: number
        top: number
        right: number
        bottom: number
        constructor(x = 0, y = 0, width = 0, height = 0) {
            this.x = x
            this.y = y
            this.width = width
            this.height = height
            this.left = x
            this.top = y
            this.right = x + width
            this.bottom = y + height
        }
    }
    try {
        run()
    } finally {
        ;(globalThis as { window?: unknown }).window = oldWindow
        ;(globalThis as { DOMRect?: unknown }).DOMRect = oldDOMRect
        ;(globalThis as { Element?: unknown }).Element = oldElement
    }
}

test('prop placement uses editor cursor for grid-aligned placement without requiring a ray hit', () => {
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    state.mode = 'place-prop'
    state.cursor = { x: 2, y: 4, z: 6 }
    state.propKind = 'mushroom'
    state.propGridAlign = true
    state.propYaw = 0.7
    state.propScale = 1.25

    const system = createPropPlaceSystem(
        fakeInput([{ x: 10, y: 10, button: 0 }]),
        {} as IsometricCamera,
        new ChunkManager(DEFAULT_PALETTE),
        state,
    )
    system.update(createGameWorld(), 0)

    assert.equal(state.props.length, 1)
    assert.deepEqual(state.props[0], {
        id: 'prop-mushroom-1',
        kind: 'mushroom',
        position: { x: 2.5, y: 4, z: 6.5 },
        yaw: 0.7,
        scale: 1.25,
        gridAligned: true,
    })
    assert.equal(state.selectedPropId, 'prop-mushroom-1')
})

test('free prop placement uses click coordinates and falls back to the working plane', () => {
    withBrowserViewport(() => {
        const state = createEditorState({ x: 0, y: 0, z: 0 })
        state.mode = 'place-prop'
        state.cursor = { x: 20, y: 4, z: 20 }
        state.workingPlaneY = 4
        state.propKind = 'flower'
        state.propGridAlign = false

        const camera = new PerspectiveCamera(60, 1, 0.1, 100)
        camera.position.set(0, 10, 10)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld(true)

        const system = createPropPlaceSystem(
            fakeInput([{ x: 50, y: 50, button: 0 }]),
            { camera } as unknown as IsometricCamera,
            new ChunkManager(DEFAULT_PALETTE),
            state,
        )
        system.update(createGameWorld(), 0)

        assert.equal(state.props.length, 1)
        const prop = state.props[0]!
        assert.equal(prop.gridAligned, false)
        assert.equal(prop.position.y, 4)
        assert.ok(Math.abs(prop.position.x) < 1e-6, `expected x near 0, got ${prop.position.x}`)
        assert.ok(Math.abs(prop.position.z - 4) < 1e-6, `expected z near 4, got ${prop.position.z}`)
    })
})

test('right-click prop removal also works from the editor cursor without a ray hit', () => {
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    state.mode = 'place-prop'
    state.cursor = { x: 2, y: 4, z: 6 }
    state.props.push({
        id: 'near',
        kind: 'flower',
        position: { x: 2.5, y: 4, z: 6.5 },
        yaw: 0,
        scale: 1,
        gridAligned: true,
    }, {
        id: 'far',
        kind: 'bush',
        position: { x: 10.5, y: 4, z: 6.5 },
        yaw: 0,
        scale: 1,
        gridAligned: true,
    })
    state.selectedPropId = 'near'

    const system = createPropPlaceSystem(
        fakeInput([{ x: 10, y: 10, button: 2 }]),
        {} as IsometricCamera,
        new ChunkManager(DEFAULT_PALETTE),
        state,
    )
    system.update(createGameWorld(), 0)

    assert.deepEqual(state.props.map((p) => p.id), ['far'])
    assert.equal(state.selectedPropId, null)
})

test('scatter prop mode emits ordinary prop instances on discovered ground', () => {
    const state = createEditorState({ x: 0, y: 1, z: 0 })
    state.mode = 'scatter-props'
    state.cursor = { x: 0, y: 1, z: 0 }
    state.propScatterShape = 'square'
    state.propScatterSize = 3
    state.propScatterItems = [{
        id: 'scatter-test',
        kind: 'bush',
        enabled: true,
        density: 1,
        scale: 1.2,
        scaleVariation: 0,
        yaw: 0.25,
        yawVariation: 0,
    }]

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) chunks.setVoxel(x, 0, z, BLOCK.grass)
    }

    const system = createPropPlaceSystem(
        fakeInput([{ x: 10, y: 10, button: 0 }]),
        {} as IsometricCamera,
        chunks,
        state,
    )
    system.update(createGameWorld(), 0)

    assert.equal(state.props.length, 9)
    for (const prop of state.props) {
        assert.equal(prop.kind, 'bush')
        assert.equal(prop.position.y, 1)
        assert.equal(prop.scale, 1.2)
        assert.equal(prop.yaw, 0.25)
        assert.equal(prop.gridAligned, false)
        assert.ok(Math.floor(prop.position.x) >= -1 && Math.floor(prop.position.x) <= 1)
        assert.ok(Math.floor(prop.position.z) >= -1 && Math.floor(prop.position.z) <= 1)
    }
})

test('scatter brush exposes distinct square and circle footprints', () => {
    const cursor = { x: 0, y: 1, z: 0 }
    const square = scatterBrushCells({ propScatterShape: 'square', propScatterSize: 5 }, cursor)
    const circle = scatterBrushCells({ propScatterShape: 'circle', propScatterSize: 5 }, cursor)
    assert.equal(square.length, 25)
    assert.ok(circle.length > 0)
    assert.ok(circle.length < square.length)
})
