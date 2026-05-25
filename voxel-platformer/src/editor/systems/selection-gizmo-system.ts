import {
    BoxGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Raycaster,
    SphereGeometry,
    Vector2,
    Vector3,
    type Scene,
} from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { Position } from '../../engine/ecs/components'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { System } from '../../engine/ecs/systems/system'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type {
    EditorPickup,
    EditorSoundSource,
    EditorSoundZone,
    EditorState,
    EditorZone,
} from '../editor-state'

type SelectionRef =
    | { kind: 'spawn' }
    | { kind: 'pickup'; pickup: EditorPickup }
    | { kind: 'zone'; zone: EditorZone }
    | { kind: 'sound-source'; source: EditorSoundSource }
    | { kind: 'sound-zone'; zone: EditorSoundZone }

interface SelectionBaseline {
    ref: SelectionRef
    anchor: Vector3
    spawn?: { x: number; y: number; z: number }
    pickup?: EditorPickup
    pickupPosition?: { x: number; y: number; z: number }
    zone?: EditorZone
    zoneMin?: VoxelCoord
    zoneMax?: VoxelCoord
    soundSource?: EditorSoundSource
    soundSourcePosition?: { x: number; y: number; z: number }
    soundZone?: EditorSoundZone
    soundZoneMin?: VoxelCoord
    soundZoneMax?: VoxelCoord
}

const SELECTABLE_OPACITY = 0.07
const SELECTED_OPACITY = 0.18

/**
 * Select-mode gizmo for editor-authored movable metadata. It deliberately
 * creates pick proxies only for spawn, pickups, zones, sound zones, and
 * sound sources; voxels and pistons never enter the raycast list.
 *
 * Translation is snapped by integer *deltas* from the selected object's
 * original anchor, so centred objects stay centred on cells while still
 * moving in whole-grid increments.
 */
export function createSelectionGizmoSystem(
    scene: Scene,
    iso: IsometricCamera,
    input: Input,
    domElement: HTMLElement,
    editorState: EditorState,
): System {
    const transform = new TransformControls(iso.camera, domElement)
    transform.setMode('translate')
    transform.setSpace('world')
    transform.setSize(0.82)
    // Manual delta snapping preserves half-cell anchors; absolute
    // TransformControls snapping would round 6.5 to 7.0.
    transform.setTranslationSnap(null)

    const proxyGroup = new Group()
    proxyGroup.name = 'EditorSelectionProxies'
    const target = new Object3D()
    target.name = 'EditorSelectionTarget'

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const proxyMeshes: Mesh[] = []
    let proxyFingerprint = ''
    let selected: SelectionRef | null = null
    let baseline: SelectionBaseline | null = null
    let suppressObjectChange = false

    function onPointerDown(ev: PointerEvent): void {
        if (editorState.mode !== 'select' || ev.button !== 0) return
        if (ev.target !== domElement || transform.dragging) return
        setRayFromPointer(ev)

        syncProxies()
        const hits = raycaster.intersectObjects(proxyMeshes, false)
        if (hits.length === 0) {
            select(null)
            return
        }
        const hit = chooseBestHit(hits)
        select(hit ? selectionFromMesh(hit) : null)
    }

    function setRayFromPointer(ev: PointerEvent): void {
        const rect = domElement.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, iso.camera)
    }

    function onObjectChange(): void {
        if (suppressObjectChange || !baseline) return
        const delta = snappedDelta(target.position, baseline.anchor)
        applyDelta(baseline, delta)
        const snappedAnchor = baseline.anchor.clone().add(delta)
        if (target.position.distanceToSquared(snappedAnchor) > 1e-8) {
            suppressObjectChange = true
            target.position.copy(snappedAnchor)
            suppressObjectChange = false
        }
        proxyFingerprint = ''
    }

    function onDraggingChanged(): void {
        baseline = selected ? createBaseline(selected) : null
        if (baseline) target.position.copy(baseline.anchor)
    }

    function select(ref: SelectionRef | null): void {
        if (sameSelection(selected, ref)) return
        selected = ref
        editorState.selectedSoundSourceId = ref?.kind === 'sound-source' ? ref.source.id : null
        editorState.selectedSoundZoneId = ref?.kind === 'sound-zone' ? ref.zone.id : null
        baseline = ref ? createBaseline(ref) : null
        if (baseline) {
            target.position.copy(baseline.anchor)
            transform.attach(target)
            if (ref && activeWorld) pushLog(activeWorld, `Selected ${selectionLabel(ref)}.`)
        } else {
            selected = null
            transform.detach()
        }
        proxyFingerprint = ''
        syncProxies()
    }

    let activeWorld: GameWorld | null = null

    function syncSelectionTarget(): void {
        if (editorState.mode !== 'select') {
            transform.detach()
            proxyGroup.visible = false
            return
        }
        proxyGroup.visible = true
        if (!selected) return
        const anchor = anchorFor(selected, editorState)
        if (!anchor) {
            select(null)
            return
        }
        if (!transform.object) transform.attach(target)
        if (!transform.dragging && target.position.distanceToSquared(anchor) > 1e-8) {
            target.position.copy(anchor)
            baseline = createBaseline(selected)
        }
    }

    function syncProxies(): void {
        const fp = selectionFingerprint(editorState, selected)
        if (fp === proxyFingerprint) return
        proxyFingerprint = fp
        clearProxies(proxyGroup, proxyMeshes)
        addSpawnProxy(proxyGroup, proxyMeshes, editorState.spawn, { kind: 'spawn' }, sameSelection(selected, { kind: 'spawn' }))
        for (const pickup of editorState.pickups) {
            addPickupProxy(proxyGroup, proxyMeshes, pickup, sameSelection(selected, { kind: 'pickup', pickup }))
        }
        for (const zone of editorState.zones) {
            addBoxProxy(proxyGroup, proxyMeshes, {
                ref: { kind: 'zone', zone },
                center: aabbCenter(zone.min, zone.max),
                size: aabbSize(zone.min, zone.max),
                color: 0xff66cc,
                selected: sameSelection(selected, { kind: 'zone', zone }),
            })
        }
        for (const source of editorState.soundSources) {
            addSoundSourceProxy(proxyGroup, proxyMeshes, source, sameSelection(selected, { kind: 'sound-source', source }))
        }
        for (const zone of editorState.soundZones) {
            addBoxProxy(proxyGroup, proxyMeshes, {
                ref: { kind: 'sound-zone', zone },
                center: aabbCenter(zone.min, zone.max),
                size: aabbSize(zone.min, zone.max),
                color: 0x4af6c8,
                selected: sameSelection(selected, { kind: 'sound-zone', zone }),
            })
        }
    }

    return {
        order: RenderOrder.debug + 8,
        init(world) {
            activeWorld = world as GameWorld
            scene.add(proxyGroup)
            scene.add(target)
            scene.add(transform.getHelper())
            domElement.addEventListener('pointerdown', onPointerDown)
            transform.addEventListener('objectChange', onObjectChange)
            transform.addEventListener('dragging-changed', onDraggingChanged)
        },
        update() {
            if (editorState.mode === 'select') input.consumeClicks()
            syncSelectionTarget()
            syncProxies()
        },
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown)
            transform.removeEventListener('objectChange', onObjectChange)
            transform.removeEventListener('dragging-changed', onDraggingChanged)
            transform.detach()
            scene.remove(transform.getHelper())
            transform.dispose()
            clearProxies(proxyGroup, proxyMeshes)
            scene.remove(proxyGroup)
            scene.remove(target)
            activeWorld = null
        },
    }

    function applyDelta(current: SelectionBaseline, delta: Vector3): void {
        const dx = delta.x
        const dy = delta.y
        const dz = delta.z
        switch (current.ref.kind) {
            case 'spawn':
                if (!current.spawn) return
                editorState.spawn = {
                    x: current.spawn.x + dx,
                    y: current.spawn.y + dy,
                    z: current.spawn.z + dz,
                }
                break
            case 'pickup':
                if (!current.pickup || !current.pickupPosition || !editorState.pickups.includes(current.pickup)) return
                current.pickup.position = {
                    x: current.pickupPosition.x + dx,
                    y: current.pickupPosition.y + dy,
                    z: current.pickupPosition.z + dz,
                }
                syncPickupPreview(activeWorld, current.pickup)
                break
            case 'zone':
                if (!current.zone || !current.zoneMin || !current.zoneMax || !editorState.zones.includes(current.zone)) return
                current.zone.min = addDeltaToVoxel(current.zoneMin, dx, dy, dz)
                current.zone.max = addDeltaToVoxel(current.zoneMax, dx, dy, dz)
                break
            case 'sound-source':
                if (!current.soundSource || !current.soundSourcePosition || !editorState.soundSources.includes(current.soundSource)) return
                current.soundSource.position = {
                    x: current.soundSourcePosition.x + dx,
                    y: current.soundSourcePosition.y + dy,
                    z: current.soundSourcePosition.z + dz,
                }
                break
            case 'sound-zone':
                if (!current.soundZone || !current.soundZoneMin || !current.soundZoneMax || !editorState.soundZones.includes(current.soundZone)) return
                current.soundZone.min = addDeltaToVoxel(current.soundZoneMin, dx, dy, dz)
                current.soundZone.max = addDeltaToVoxel(current.soundZoneMax, dx, dy, dz)
                break
        }
    }

    function createBaseline(ref: SelectionRef): SelectionBaseline | null {
        const anchor = anchorFor(ref, editorState)
        if (!anchor) return null
        switch (ref.kind) {
            case 'spawn':
                return { ref, anchor, spawn: { ...editorState.spawn } }
            case 'pickup':
                return { ref, anchor, pickup: ref.pickup, pickupPosition: { ...ref.pickup.position } }
            case 'zone':
                return { ref, anchor, zone: ref.zone, zoneMin: { ...ref.zone.min }, zoneMax: { ...ref.zone.max } }
            case 'sound-source':
                return { ref, anchor, soundSource: ref.source, soundSourcePosition: { ...ref.source.position } }
            case 'sound-zone':
                return { ref, anchor, soundZone: ref.zone, soundZoneMin: { ...ref.zone.min }, soundZoneMax: { ...ref.zone.max } }
        }
    }
}

function addSpawnProxy(group: Group, out: Mesh[], spawn: { x: number; y: number; z: number }, ref: SelectionRef, selected: boolean): void {
    addBoxProxy(group, out, {
        ref,
        center: new Vector3(spawn.x, spawn.y + 0.9, spawn.z),
        size: new Vector3(0.9, 1.8, 0.9),
        color: 0x57e1ff,
        selected,
    })
}

function addPickupProxy(group: Group, out: Mesh[], pickup: EditorPickup, selected: boolean): void {
    addBoxProxy(group, out, {
        ref: { kind: 'pickup', pickup },
        center: new Vector3(pickup.position.x, pickup.position.y + 0.32, pickup.position.z),
        size: new Vector3(0.9, 0.65, 0.9),
        color: 0x8fb6ff,
        selected,
    })
}

function addSoundSourceProxy(group: Group, out: Mesh[], source: EditorSoundSource, selected: boolean): void {
    const geo = new SphereGeometry(0.42, 16, 8)
    const mesh = new Mesh(geo, proxyMaterial(0x66e6ff, selected))
    mesh.position.set(source.position.x, source.position.y, source.position.z)
    configureProxy(mesh, { kind: 'sound-source', source })
    group.add(mesh)
    out.push(mesh)
}

function addBoxProxy(
    group: Group,
    out: Mesh[],
    opts: {
        ref: SelectionRef
        center: Vector3
        size: Vector3
        color: number
        selected: boolean
    },
): void {
    const geo = new BoxGeometry(opts.size.x, opts.size.y, opts.size.z)
    const mesh = new Mesh(geo, proxyMaterial(opts.color, opts.selected))
    mesh.position.copy(opts.center)
    configureProxy(mesh, opts.ref)
    group.add(mesh)
    out.push(mesh)
}

function configureProxy(mesh: Mesh, ref: SelectionRef): void {
    mesh.userData.selectionRef = ref
    mesh.renderOrder = 994
    mesh.frustumCulled = false
}

function proxyMaterial(color: number, selected: boolean): MeshBasicMaterial {
    return new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? SELECTED_OPACITY : SELECTABLE_OPACITY,
        depthTest: false,
        depthWrite: false,
    })
}

function clearProxies(group: Group, proxies: Mesh[]): void {
    for (const proxy of proxies) {
        group.remove(proxy)
        proxy.geometry.dispose()
        ;(proxy.material as MeshBasicMaterial).dispose()
    }
    proxies.length = 0
}

function chooseBestHit(hits: Array<{ object: Object3D; distance: number }>): Mesh | null {
    let best: { mesh: Mesh; priority: number; distance: number } | null = null
    for (const hit of hits) {
        const mesh = hit.object as Mesh
        const ref = selectionFromMesh(mesh)
        if (!ref) continue
        const priority = selectionPriority(ref)
        if (
            !best ||
            priority < best.priority ||
            (priority === best.priority && hit.distance < best.distance)
        ) {
            best = { mesh, priority, distance: hit.distance }
        }
    }
    return best?.mesh ?? null
}

function selectionFromMesh(mesh: Object3D): SelectionRef | null {
    return (mesh.userData as { selectionRef?: SelectionRef }).selectionRef ?? null
}

function selectionPriority(ref: SelectionRef): number {
    switch (ref.kind) {
        case 'spawn': return 0
        case 'pickup': return 1
        case 'sound-source': return 1
        case 'zone': return 4
        case 'sound-zone': return 4
    }
}

function sameSelection(a: SelectionRef | null, b: SelectionRef | null): boolean {
    if (a === b) return true
    if (!a || !b || a.kind !== b.kind) return false
    switch (a.kind) {
        case 'spawn': return true
        case 'pickup': return b.kind === 'pickup' && a.pickup === b.pickup
        case 'zone': return b.kind === 'zone' && a.zone === b.zone
        case 'sound-source': return b.kind === 'sound-source' && a.source === b.source
        case 'sound-zone': return b.kind === 'sound-zone' && a.zone === b.zone
    }
}

function anchorFor(ref: SelectionRef, state: EditorState): Vector3 | null {
    switch (ref.kind) {
        case 'spawn':
            return new Vector3(state.spawn.x, state.spawn.y, state.spawn.z)
        case 'pickup':
            if (!state.pickups.includes(ref.pickup)) return null
            return new Vector3(ref.pickup.position.x, ref.pickup.position.y, ref.pickup.position.z)
        case 'zone':
            if (!state.zones.includes(ref.zone)) return null
            return aabbCenter(ref.zone.min, ref.zone.max)
        case 'sound-source':
            if (!state.soundSources.includes(ref.source)) return null
            return new Vector3(ref.source.position.x, ref.source.position.y, ref.source.position.z)
        case 'sound-zone':
            if (!state.soundZones.includes(ref.zone)) return null
            return aabbCenter(ref.zone.min, ref.zone.max)
    }
}

function aabbCenter(min: VoxelCoord, max: VoxelCoord): Vector3 {
    return new Vector3(
        (min.x + max.x) * 0.5,
        (min.y + max.y) * 0.5,
        (min.z + max.z) * 0.5,
    )
}

function aabbSize(min: VoxelCoord, max: VoxelCoord): Vector3 {
    return new Vector3(
        Math.max(0.01, max.x - min.x),
        Math.max(0.01, max.y - min.y),
        Math.max(0.01, max.z - min.z),
    )
}

function snappedDelta(position: Vector3, anchor: Vector3): Vector3 {
    return new Vector3(
        Math.round(position.x - anchor.x),
        Math.round(position.y - anchor.y),
        Math.round(position.z - anchor.z),
    )
}

function addDeltaToVoxel(coord: VoxelCoord, dx: number, dy: number, dz: number): VoxelCoord {
    return {
        x: coord.x + dx,
        y: coord.y + dy,
        z: coord.z + dz,
    }
}

function syncPickupPreview(world: GameWorld | null, pickup: EditorPickup): void {
    if (!world || pickup.eid < 0) return
    Position.x[pickup.eid] = pickup.position.x
    Position.y[pickup.eid] = pickup.position.y
    Position.z[pickup.eid] = pickup.position.z
    world.object3DByEid.get(pickup.eid)?.position.set(
        pickup.position.x,
        pickup.position.y,
        pickup.position.z,
    )
}

function selectionLabel(ref: SelectionRef): string {
    switch (ref.kind) {
        case 'spawn': return 'spawn point'
        case 'pickup': return `pickup @ ${formatPoint(ref.pickup.position)}`
        case 'zone': return `zone "${ref.zone.label ?? ref.zone.id}"`
        case 'sound-source': return `sound source "${ref.source.label ?? ref.source.id}"`
        case 'sound-zone': return `sound zone "${ref.zone.label ?? ref.zone.id}"`
    }
}

function formatPoint(p: { x: number; y: number; z: number }): string {
    return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`
}

function selectionFingerprint(state: EditorState, selected: SelectionRef | null): string {
    return [
        selected ? selectionKey(selected, state) : 'none',
        `spawn:${state.spawn.x},${state.spawn.y},${state.spawn.z}`,
        `pickups:${state.pickups.map((p) => `${p.amount}@${p.position.x},${p.position.y},${p.position.z}`).join(';')}`,
        `zones:${state.zones.map((z) => `${z.id}:${z.min.x},${z.min.y},${z.min.z}:${z.max.x},${z.max.y},${z.max.z}`).join(';')}`,
        `sources:${state.soundSources.map((s) => `${s.id}:${s.position.x},${s.position.y},${s.position.z}:${s.radius}`).join(';')}`,
        `soundZones:${state.soundZones.map((z) => `${z.id}:${z.min.x},${z.min.y},${z.min.z}:${z.max.x},${z.max.y},${z.max.z}`).join(';')}`,
    ].join('|')
}

function selectionKey(ref: SelectionRef, state: EditorState): string {
    switch (ref.kind) {
        case 'spawn': return 'spawn'
        case 'pickup': return `pickup:${state.pickups.indexOf(ref.pickup)}`
        case 'zone': return `zone:${ref.zone.id}`
        case 'sound-source': return `sound-source:${ref.source.id}`
        case 'sound-zone': return `sound-zone:${ref.zone.id}`
    }
}
