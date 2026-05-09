import {
    Box3,
    Box3Helper,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PlaneGeometry,
    Sprite,
    SpriteMaterial,
    Texture,
    Vector3,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import { BoxCollider, Faction, MovementState, Position, Wanderer } from '../components'
import { movementStateName } from '../movement-state'
import type { System } from './system'
import { RenderOrder } from './orders'
import type { Input } from '../../input/input'
import { UiLogPanel } from '../../../ui'

export interface DebugOverlayOptions {
    enabled?: boolean
    updateHz?: number
}

interface LabelState {
    sprite: Sprite
    text: string
}

interface PathState {
    line: Line
    pointCount: number
}

export function createDebugOverlaySystem(scene: Scene, input: Input, opts: DebugOverlayOptions = {}): System {
    let enabled = opts.enabled ?? true
    const updateDt = 1 / (opts.updateHz ?? 6)
    const root = new Group()
    root.name = 'DebugOverlay'
    const lineMaterial = new LineBasicMaterial({ color: 0x55d6ff })
    const labelByEid = new Map<number, LabelState>()
    const boxByEid = new Map<number, Box3Helper>()
    const pathByEid = new Map<number, PathState>()
    let logPanel: UiLogPanel | null = null
    let lastLogLength = -1
    let accumulator = 0

    return {
        order: RenderOrder.debug,
        init() {
            scene.add(root)
            root.visible = enabled
            logPanel = new UiLogPanel()
            logPanel.setVisible(enabled)
        },
        update(world, dt) {
            if (input.consumeKeyPressed('Backquote')) {
                enabled = !enabled
                root.visible = enabled
                logPanel?.setVisible(enabled)
            }
            if (!enabled) return
            accumulator += dt
            const refreshHeavyDebug = accumulator >= updateDt
            if (refreshHeavyDebug) accumulator %= updateDt

            const eids = query(world, [Wanderer, Position, BoxCollider])
            const live = new Set<number>()
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                live.add(eid)
                updateBox(root, boxByEid, eid)
                updateLabel(root, labelByEid, eid, refreshHeavyDebug)
                if (refreshHeavyDebug) {
                    updatePath(root, pathByEid, lineMaterial, eid, world.pathByEid.get(eid)?.points)
                } else {
                    updatePathOrigin(pathByEid, eid)
                }
            }
            prune(root, boxByEid, live)
            pruneLabels(root, labelByEid, live)
            if (refreshHeavyDebug) {
                prunePaths(root, pathByEid, live)
                updateLog(logPanel, world.log, lastLogLength)
                lastLogLength = world.log.length
            }
        },
        dispose() {
            for (const obj of boxByEid.values()) disposeDebugObject(obj)
            for (const state of pathByEid.values()) disposePath(state)
            for (const state of labelByEid.values()) disposeLabel(state)
            boxByEid.clear()
            pathByEid.clear()
            labelByEid.clear()
            root.clear()
            scene.remove(root)
            lineMaterial.dispose()
            logPanel?.dispose()
            logPanel = null
        },
    }
}

function updateBox(root: Group, map: Map<number, Box3Helper>, eid: number): void {
    let helper = map.get(eid)
    if (!helper) {
        helper = new Box3Helper(new Box3(), new Color(0x9cff57))
        map.set(eid, helper)
        root.add(helper)
    }
    helper.box.min.set(
        Position.x[eid] - BoxCollider.x[eid],
        Position.y[eid],
        Position.z[eid] - BoxCollider.z[eid],
    )
    helper.box.max.set(
        Position.x[eid] + BoxCollider.x[eid],
        Position.y[eid] + BoxCollider.y[eid] * 2,
        Position.z[eid] + BoxCollider.z[eid],
    )
}

function updatePath(
    root: Group,
    map: Map<number, PathState>,
    material: LineBasicMaterial,
    eid: number,
    points: Vector3[] | undefined,
): void {
    let state = map.get(eid)
    if (!points || points.length === 0) {
        if (state) {
            root.remove(state.line)
            disposePath(state)
            map.delete(eid)
        }
        return
    }
    if (!state) {
        const line = new Line(new BufferGeometry(), material)
        line.name = `PathDebug${eid}`
        state = { line, pointCount: 0 }
        map.set(eid, state)
        root.add(line)
    }
    const pointCount = points.length + 1
    if (state.pointCount !== pointCount) {
        state.line.geometry.setAttribute('position', new Float32BufferAttribute(pointCount * 3, 3))
        state.pointCount = pointCount
    }

    const attribute = state.line.geometry.getAttribute('position') as Float32BufferAttribute
    const coords = attribute.array
    coords[0] = Position.x[eid]
    coords[1] = Position.y[eid] + 0.08
    coords[2] = Position.z[eid]
    for (let i = 0; i < points.length; i++) {
        const offset = (i + 1) * 3
        const p = points[i]
        coords[offset] = p.x
        coords[offset + 1] = p.y + 0.08
        coords[offset + 2] = p.z
    }
    attribute.needsUpdate = true
    state.line.geometry.computeBoundingSphere()
}

function updatePathOrigin(map: Map<number, PathState>, eid: number): void {
    const state = map.get(eid)
    if (!state) return
    const attribute = state.line.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    if (!attribute) return
    const coords = attribute.array
    coords[0] = Position.x[eid]
    coords[1] = Position.y[eid] + 0.08
    coords[2] = Position.z[eid]
    attribute.needsUpdate = true
}

function updateLabel(root: Group, map: Map<number, LabelState>, eid: number, refreshText: boolean): void {
    const text = `F${Faction.id[eid]} ${movementStateName(MovementState.value[eid])}`
    let state = map.get(eid)
    if (!state) {
        const sprite = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }))
        sprite.name = `DebugLabel${eid}`
        sprite.scale.set(1.6, 0.35, 1)
        state = { sprite, text: '' }
        map.set(eid, state)
        root.add(sprite)
    }
    if (state.text !== text && (refreshText || state.text.length === 0)) {
        const material = state.sprite.material as SpriteMaterial
        material.map?.dispose()
        material.map = makeTextTexture(text)
        material.needsUpdate = true
        state.text = text
    }
    state.sprite.position.set(Position.x[eid], Position.y[eid] + BoxCollider.y[eid] * 2 + 0.45, Position.z[eid])
}

function makeTextTexture(text: string): Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(8, 12, 16, 0.72)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#d9f7ff'
    ctx.font = '24px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const texture = new Texture(canvas)
    texture.needsUpdate = true
    return texture
}

function prune<T extends Object3D>(root: Group, map: Map<number, T>, live: Set<number>): void {
    for (const [eid, obj] of map) {
        if (live.has(eid)) continue
        root.remove(obj)
        disposeDebugObject(obj)
        map.delete(eid)
    }
}

function pruneLabels(root: Group, map: Map<number, LabelState>, live: Set<number>): void {
    for (const [eid, state] of map) {
        if (live.has(eid)) continue
        root.remove(state.sprite)
        disposeLabel(state)
        map.delete(eid)
    }
}

function prunePaths(root: Group, map: Map<number, PathState>, live: Set<number>): void {
    for (const [eid, state] of map) {
        if (live.has(eid)) continue
        root.remove(state.line)
        disposePath(state)
        map.delete(eid)
    }
}

function updateLog(panel: UiLogPanel | null, log: { message: string }[], lastLength: number): void {
    if (!panel || log.length === lastLength) return
    panel.setLines(log.slice(-6).map((entry) => entry.message))
}

function disposePath(state: PathState): void {
    state.line.geometry.dispose()
}

function disposeLabel(state: LabelState): void {
    state.sprite.material.map?.dispose()
    state.sprite.material.dispose()
}

function disposeDebugObject(obj: Object3D): void {
    if (obj instanceof Box3Helper) {
        obj.geometry.dispose()
        if (obj.material instanceof LineBasicMaterial) obj.material.dispose()
    }
    if (obj instanceof Line) obj.geometry.dispose()
    if (obj instanceof Sprite) {
        obj.material.map?.dispose()
        obj.material.dispose()
    }
    if (obj instanceof Mesh) {
        if (obj.geometry instanceof PlaneGeometry) obj.geometry.dispose()
        if (obj.material instanceof MeshBasicMaterial) obj.material.dispose()
    }
}
