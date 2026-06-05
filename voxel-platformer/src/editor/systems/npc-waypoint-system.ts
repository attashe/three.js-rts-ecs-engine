/**
 * NPC waypoint tool — visualize + edit a route in the 3D scene.
 *
 * Renders the selected NPC's `behaviour.waypoints` as numbered node markers, a
 * connecting polyline (loop-closed for patrols), and a spawn→first-node link.
 * In `edit-waypoints` mode the same nodes are pickable: LMB on the floor appends
 * a node, LMB on a node selects it for a `TransformControls` drag, RMB removes
 * the nearest. Every change rewrites the NPC's behaviour script via
 * `mergeBehaviourIntoScript`, so the route stays the source of truth the runtime
 * reads (the structured `behaviour` block is editor-only).
 *
 * Combines rendering + editing in one system because the edit picker needs the
 * node meshes the renderer owns. Modeled on `zone-render-system.ts` (overlay)
 * and `selection-gizmo-system.ts` (TransformControls lifecycle).
 */
import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Raycaster,
    Sprite,
    SpriteMaterial,
    Vector2,
    Vector3,
    type Scene,
} from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { System } from '../../engine/ecs/systems/system'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { Input } from '../../engine/input/input'
import { makeRay } from '../../engine/input/pointer'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { EditorState } from '../editor-state'
import { DEFAULT_NPC_BEHAVIOUR, type NpcBehaviourConfig, type NpcConfig } from '../../game/npcs/npc-types'
import { mergeBehaviourIntoScript } from '../../game/npcs/npc-behaviour-script'
import { raycastClick, resolvePlacement } from './placement-raycast'

const LIFT = 0.3 // raise nodes/lines above the floor so they don't z-fight
const NODE = 0.26
const REMOVE_RADIUS = 1.4

export function createNpcWaypointSystem(
    scene: Scene,
    iso: IsometricCamera,
    input: Input,
    domElement: HTMLElement,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const group = new Group()
    group.name = 'EditorNpcWaypoints'

    const ray = makeRay()
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    const transform = new TransformControls(iso.camera, domElement)
    transform.setMode('translate')
    transform.setSpace('world')
    transform.setSize(0.7)
    transform.setTranslationSnap(null)
    const target = new Object3D()
    target.name = 'EditorWaypointTarget'

    const nodeGeo = new BoxGeometry(NODE, NODE, NODE)
    const nodeMat = new MeshBasicMaterial({ color: 0x6cf0a0, transparent: true, opacity: 0.95, depthTest: false })
    const startMat = new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, depthTest: false })
    const pathMat = new LineBasicMaterial({ color: 0x6cf0a0, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
    const spawnMat = new LineBasicMaterial({ color: 0x8aa0ff, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false })

    const nodeMeshes: Mesh[] = []
    const sprites: Sprite[] = []
    const lines: Line[] = []
    let fingerprint = ''
    let selectedNode = -1
    let activeWorld: GameWorld | null = null
    let suppress = false

    function selectedNpc(): NpcConfig | null {
        const id = editorState.selectedNpcId
        if (!id) return null
        return editorState.npcs.find((n) => n.id === id) ?? null
    }

    /** The route to show: the selected NPC's, when it has a behaviour block. */
    function routeNpc(): NpcConfig | null {
        const npc = selectedNpc()
        return npc && npc.behaviour && npc.behaviour.mode !== 'none' ? npc : null
    }

    function ensureBehaviour(npc: NpcConfig): NpcBehaviourConfig {
        if (!npc.behaviour || npc.behaviour.mode === 'none') {
            npc.behaviour = { ...DEFAULT_NPC_BEHAVIOUR, mode: 'patrol', waypoints: npc.behaviour?.waypoints ?? [] }
        }
        return npc.behaviour
    }

    /** Recompile the behaviour region of the NPC's script from its route. */
    function commitScript(npc: NpcConfig): void {
        npc.scriptSource = mergeBehaviourIntoScript(npc.scriptSource, npc.behaviour)
    }

    /** Recompile + force a full visual rebuild (for add / remove / clear). */
    function commit(npc: NpcConfig): void {
        commitScript(npc)
        fingerprint = ''
    }

    // ─── visuals ───────────────────────────────────────────────────────────
    function clearVisuals(): void {
        for (const m of nodeMeshes) group.remove(m)
        nodeMeshes.length = 0
        for (const s of sprites) { group.remove(s); s.material.map?.dispose(); s.material.dispose() }
        sprites.length = 0
        for (const l of lines) { group.remove(l); l.geometry.dispose() }
        lines.length = 0
    }

    function buildPolyline(points: Vector3[], material: LineBasicMaterial): void {
        if (points.length < 2) return
        const geo = new BufferGeometry()
        const arr = new Float32Array(points.length * 3)
        points.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z })
        geo.setAttribute('position', new Float32BufferAttribute(arr, 3))
        const line = new Line(geo, material)
        line.frustumCulled = false
        line.renderOrder = 996
        group.add(line)
        lines.push(line)
    }

    /** Rebuild only the polylines (cheap — no textures). Safe to call per frame
     *  during a drag so the route follows the dragged node smoothly. */
    function rebuildLines(npc: NpcConfig): void {
        for (const l of lines) { group.remove(l); l.geometry.dispose() }
        lines.length = 0
        const b = npc.behaviour!
        const pts = b.waypoints
        const routePts = pts.map((p) => new Vector3(p.x, p.y + LIFT, p.z))
        // Loop-closed for a patrol of 3+.
        if (b.mode === 'patrol' && pts.length >= 3) routePts.push(routePts[0]!.clone())
        buildPolyline(routePts, pathMat)
        // Spawn → first node.
        if (pts.length > 0) {
            buildPolyline([
                new Vector3(npc.position.x, npc.position.y + LIFT, npc.position.z),
                routePts[0]!.clone(),
            ], spawnMat)
        }
    }

    /** Full rebuild: node markers + index sprites + polylines. */
    function rebuild(npc: NpcConfig): void {
        clearVisuals()
        const pts = npc.behaviour!.waypoints
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i]!
            const mesh = new Mesh(nodeGeo, i === 0 ? startMat : nodeMat)
            mesh.position.set(p.x, p.y + LIFT, p.z)
            mesh.frustumCulled = false
            mesh.renderOrder = 997
            mesh.userData.index = i
            group.add(mesh)
            nodeMeshes.push(mesh)
            const sprite = makeLabelSprite(String(i + 1))
            sprite.position.set(p.x, p.y + LIFT + 0.42, p.z)
            sprite.renderOrder = 999
            group.add(sprite)
            sprites.push(sprite)
        }
        rebuildLines(npc)
    }

    function visualFingerprint(npc: NpcConfig): string {
        const b = npc.behaviour!
        const wp = b.waypoints.map((p) => `${p.x},${p.y},${p.z}`).join(';')
        const edit = editorState.mode === 'edit-waypoints' ? '1' : '0'
        return `${npc.id}|${b.mode}|${edit}|${npc.position.x},${npc.position.y},${npc.position.z}|${wp}`
    }

    // ─── editing ───────────────────────────────────────────────────────────
    function setRay(x: number, y: number): void {
        const rect = domElement.getBoundingClientRect()
        pointer.x = ((x - rect.left) / rect.width) * 2 - 1
        pointer.y = -((y - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, iso.camera)
    }

    function selectNode(index: number): void {
        selectedNode = index
        const npc = selectedNpc()
        const p = npc?.behaviour?.waypoints[index]
        if (!p) { transform.detach(); selectedNode = -1; return }
        target.position.set(p.x, p.y + LIFT, p.z)
        if (!transform.object) transform.attach(target)
    }

    function onPointerDown(ev: PointerEvent): void {
        if (editorState.mode !== 'edit-waypoints') return
        if (ev.target !== domElement || transform.dragging || transform.axis) return
        const npc = selectedNpc()
        if (!npc) return
        const b = ensureBehaviour(npc)

        setRay(ev.clientX, ev.clientY)
        const hits = raycaster.intersectObjects(nodeMeshes, false)
        if (hits.length > 0) {
            selectNode(hits[0]!.object.userData.index as number)
            return
        }
        // Empty space: LMB adds a node on the floor, RMB removes the nearest.
        // raycastClick writes `ray` (via screenToWorldRay) and returns the hit.
        const hit = raycastClick({ x: ev.clientX, y: ev.clientY }, iso, chunks, ray)
        const point = resolvePlacement({
            gridAligned: npc.gridAligned,
            cursor: editorState.cursor,
            ray,
            workingPlaneY: editorState.workingPlaneY,
            hit,
        })
        if (ev.button === 2) {
            ev.preventDefault()
            removeNearest(npc, b, point)
        } else if (ev.button === 0 && point) {
            b.waypoints.push({ x: point.x, y: point.y, z: point.z })
            commit(npc)
            selectNode(b.waypoints.length - 1)
            if (activeWorld) pushLog(activeWorld, `Waypoint ${b.waypoints.length} added to ${npc.name}.`)
        }
    }

    function removeNearest(npc: NpcConfig, b: NpcBehaviourConfig, near: { x: number; y: number; z: number } | null): void {
        if (!near || b.waypoints.length === 0) return
        let best = -1
        let bestD = REMOVE_RADIUS * REMOVE_RADIUS
        for (let i = 0; i < b.waypoints.length; i++) {
            const p = b.waypoints[i]!
            const d2 = (p.x - near.x) ** 2 + (p.z - near.z) ** 2
            if (d2 < bestD) { bestD = d2; best = i }
        }
        if (best < 0) return
        b.waypoints.splice(best, 1)
        transform.detach()
        selectedNode = -1
        commit(npc)
        if (activeWorld) pushLog(activeWorld, `Waypoint removed from ${npc.name}.`)
    }

    function onObjectChange(): void {
        if (suppress || selectedNode < 0) return
        const npc = selectedNpc()
        const p = npc?.behaviour?.waypoints[selectedNode]
        if (!p) return
        const gridAligned = npc!.gridAligned
        const nx = gridAligned ? Math.floor(target.position.x) + 0.5 : target.position.x
        const nz = gridAligned ? Math.floor(target.position.z) + 0.5 : target.position.z
        const ny = Math.round(target.position.y - LIFT)
        p.x = nx; p.y = ny; p.z = nz
        // Snap the gizmo back onto the (grid-aligned) node.
        suppress = true
        target.position.set(nx, ny + LIFT, nz)
        suppress = false
        // In-place visual update — move only the dragged node + label and redraw
        // the cheap polylines. Avoids a full rebuild (and its per-frame canvas
        // textures) every drag tick; the script is recompiled on drag end.
        nodeMeshes[selectedNode]?.position.set(nx, ny + LIFT, nz)
        sprites[selectedNode]?.position.set(nx, ny + LIFT + 0.42, nz)
        rebuildLines(npc!)
    }

    function onDraggingChanged(): void {
        if (transform.dragging) return // drag start — nothing to do yet
        const npc = selectedNpc()
        if (npc) commitScript(npc) // recompile the route into the script once, at drag end
    }

    return {
        order: RenderOrder.debug + 4,
        init(world) {
            activeWorld = world as GameWorld
            scene.add(group)
            scene.add(target)
            scene.add(transform.getHelper())
            domElement.addEventListener('pointerdown', onPointerDown)
            transform.addEventListener('objectChange', onObjectChange)
            transform.addEventListener('dragging-changed', onDraggingChanged)
        },
        update() {
            // Drop the gizmo when we leave edit mode or the selection changes.
            const npc = selectedNpc()
            if (editorState.mode !== 'edit-waypoints' || !npc) {
                if (transform.object) transform.detach()
                selectedNode = -1
            } else {
                // We handle waypoint input via DOM pointerdown; drain the click
                // queue so a stray click doesn't leak to the next tool/mode.
                input.consumeClicks()
            }
            // Mid-drag, onObjectChange keeps visuals current in place — skip the
            // fingerprint rebuild so we don't recreate textures every frame.
            if (transform.dragging) return
            const route = routeNpc()
            if (!route) {
                if (fingerprint !== '') { clearVisuals(); fingerprint = '' }
                return
            }
            const fp = visualFingerprint(route)
            if (fp !== fingerprint) { rebuild(route); fingerprint = fp }
        },
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown)
            transform.removeEventListener('objectChange', onObjectChange)
            transform.removeEventListener('dragging-changed', onDraggingChanged)
            transform.detach()
            scene.remove(transform.getHelper())
            transform.dispose()
            clearVisuals()
            scene.remove(group)
            scene.remove(target)
            nodeGeo.dispose()
            nodeMat.dispose(); startMat.dispose(); pathMat.dispose(); spawnMat.dispose()
            activeWorld = null
        },
    }
}

function makeLabelSprite(text: string): Sprite {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(10,18,14,0.78)'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dffbe9'
    ctx.font = 'bold 38px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, size / 2, size / 2 + 2)
    const texture = new CanvasTexture(canvas)
    const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
    sprite.scale.set(0.5, 0.5, 0.5)
    sprite.frustumCulled = false
    return sprite
}
