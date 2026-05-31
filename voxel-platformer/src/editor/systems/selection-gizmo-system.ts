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
import { pushLog, type GameWorld, type RailCartConfig, type VoxelCoord } from '../../engine/ecs/world'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isRailBlock } from '../../engine/voxel/palette'
import type {
    EditorPickup,
    EditorSoundSource,
    EditorSoundZone,
    EditorState,
    EditorWeatherZone,
    EditorZone,
} from '../editor-state'
import type { EditorProp } from '../../game/props/prop-types'
import type { NpcConfig } from '../../game/npcs/npc-types'
import { stoneRadiusForConfig, type StoneFallSpawnerConfig, type StonePlacementConfig } from '../../game/moving-objects'
import { nextStoneEditorId } from '../stone-ids'

type SelectionRef =
    | { kind: 'spawn' }
    | { kind: 'pickup'; pickup: EditorPickup }
    | { kind: 'prop'; prop: EditorProp }
    | { kind: 'npc'; npc: NpcConfig }
    | { kind: 'stone'; stone: StonePlacementConfig }
    | { kind: 'stone-spawner'; spawner: StoneFallSpawnerConfig }
    | { kind: 'rail-cart'; cart: RailCartConfig }
    | { kind: 'zone'; zone: EditorZone }
    | { kind: 'sound-source'; source: EditorSoundSource }
    | { kind: 'sound-zone'; zone: EditorSoundZone }
    | { kind: 'effect-zone'; zone: EditorWeatherZone }

interface SelectionBaseline {
    ref: SelectionRef
    anchor: Vector3
    spawn?: { x: number; y: number; z: number }
    pickup?: EditorPickup
    pickupPosition?: { x: number; y: number; z: number }
    prop?: EditorProp
    propPosition?: { x: number; y: number; z: number }
    npc?: NpcConfig
    npcPosition?: { x: number; y: number; z: number }
    stone?: StonePlacementConfig
    stonePosition?: { x: number; y: number; z: number }
    stoneSpawner?: StoneFallSpawnerConfig
    stoneSpawnerPosition?: { x: number; y: number; z: number }
    railCart?: RailCartConfig
    railCartCell?: VoxelCoord
    zone?: EditorZone
    zoneMin?: VoxelCoord
    zoneMax?: VoxelCoord
    soundSource?: EditorSoundSource
    soundSourcePosition?: { x: number; y: number; z: number }
    soundZone?: EditorSoundZone
    soundZoneMin?: VoxelCoord
    soundZoneMax?: VoxelCoord
    effectZone?: EditorWeatherZone
    effectZonePosition?: { x: number; y: number; z: number }
}

const SELECTABLE_OPACITY = 0.07
const SELECTED_OPACITY = 0.18

/**
 * Select-mode gizmo for editor-authored movable metadata. It deliberately
 * creates pick proxies only for spawn, pickups, props, zones, sound zones,
 * effect zones, and sound sources; voxels and pistons never enter the
 * raycast list.
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
    chunks: ChunkManager,
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
        if (editorState.viewMode === 'orbit') return
        if (ev.target !== domElement || transform.dragging) return
        selectAtScreenPoint(ev.clientX, ev.clientY)
    }

    function selectAtScreenPoint(x: number, y: number): void {
        setRayFromScreenPoint(x, y)
        syncProxies()
        const hits = raycaster.intersectObjects(proxyMeshes, false)
        if (hits.length === 0) {
            select(null)
            return
        }
        const hit = chooseBestHit(hits)
        select(hit ? selectionFromMesh(hit) : null)
    }

    function setRayFromScreenPoint(x: number, y: number): void {
        const rect = domElement.getBoundingClientRect()
        pointer.x = ((x - rect.left) / rect.width) * 2 - 1
        pointer.y = -((y - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, iso.camera)
    }

    function onObjectChange(): void {
        if (suppressObjectChange || !baseline) return
        const delta = selectionDelta(target.position, baseline, editorState)
        applyDelta(baseline, delta)
        const appliedAnchor = anchorFor(baseline.ref, editorState) ?? baseline.anchor.clone().add(delta)
        if (target.position.distanceToSquared(appliedAnchor) > 1e-8) {
            suppressObjectChange = true
            target.position.copy(appliedAnchor)
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
        if (ref?.kind === 'stone' && !ref.stone.id) {
            ref.stone.id = nextStoneEditorId(editorState.stones.map((stone) => stone.id), 'stone')
        }
        if (ref?.kind === 'stone-spawner' && !ref.spawner.id) {
            ref.spawner.id = nextStoneEditorId(editorState.stoneSpawners.map((spawner) => spawner.id), 'stone-spawner')
        }
        selected = ref
        editorState.selectedSoundSourceId = ref?.kind === 'sound-source' ? ref.source.id : null
        editorState.selectedSoundZoneId = ref?.kind === 'sound-zone' ? ref.zone.id : null
        editorState.selectedPropId = ref?.kind === 'prop' ? ref.prop.id : null
        editorState.selectedNpcId = ref?.kind === 'npc' ? ref.npc.id : null
        editorState.selectedStoneId = ref?.kind === 'stone' ? ref.stone.id ?? null : null
        editorState.selectedStoneSpawnerId = ref?.kind === 'stone-spawner' ? ref.spawner.id ?? null : null
        editorState.selectedRailCartId = ref?.kind === 'rail-cart' ? ref.cart.id : null
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
        syncExternalPropSelection()
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
        for (const prop of editorState.props) {
            addPropProxy(proxyGroup, proxyMeshes, prop, sameSelection(selected, { kind: 'prop', prop }))
        }
        for (const npc of editorState.npcs) {
            addNpcProxy(proxyGroup, proxyMeshes, npc, sameSelection(selected, { kind: 'npc', npc }))
        }
        for (const stone of editorState.stones) {
            addStoneProxy(proxyGroup, proxyMeshes, stone, sameSelection(selected, { kind: 'stone', stone }))
        }
        for (const spawner of editorState.stoneSpawners) {
            addStoneSpawnerProxy(proxyGroup, proxyMeshes, spawner, sameSelection(selected, { kind: 'stone-spawner', spawner }))
        }
        for (const cart of editorState.railCarts) {
            addRailCartProxy(proxyGroup, proxyMeshes, cart, sameSelection(selected, { kind: 'rail-cart', cart }))
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
        for (const zone of editorState.weatherZones) {
            addBoxProxy(proxyGroup, proxyMeshes, {
                ref: { kind: 'effect-zone', zone },
                center: new Vector3(zone.position.x, zone.position.y, zone.position.z),
                size: new Vector3(zone.size.x, zone.size.y, zone.size.z),
                color: 0xffd6f0,
                selected: sameSelection(selected, { kind: 'effect-zone', zone }),
            })
        }
    }

    return {
        order: RenderOrder.debug + 8,
        init(world) {
            activeWorld = world
            scene.add(proxyGroup)
            scene.add(target)
            scene.add(transform.getHelper())
            domElement.addEventListener('pointerdown', onPointerDown)
            transform.addEventListener('objectChange', onObjectChange)
            transform.addEventListener('dragging-changed', onDraggingChanged)
        },
        update() {
            if (editorState.mode === 'select') {
                const clicks = input.consumeClicks()
                if (editorState.viewMode === 'orbit') {
                    for (const click of clicks) {
                        if (click.button === 0) selectAtScreenPoint(click.x, click.y)
                    }
                }
            }
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
            case 'prop':
                if (!current.prop || !current.propPosition || !editorState.props.includes(current.prop)) return
                current.prop.position = {
                    x: current.propPosition.x + dx,
                    y: current.propPosition.y + dy,
                    z: current.propPosition.z + dz,
                }
                break
            case 'npc':
                if (!current.npc || !current.npcPosition || !editorState.npcs.includes(current.npc)) return
                current.npc.position = {
                    x: current.npcPosition.x + dx,
                    y: current.npcPosition.y + dy,
                    z: current.npcPosition.z + dz,
                }
                break
            case 'stone':
                if (!current.stone || !current.stonePosition || !editorState.stones.includes(current.stone)) return
                current.stone.position = {
                    x: current.stonePosition.x + dx,
                    y: current.stonePosition.y + dy,
                    z: current.stonePosition.z + dz,
                }
                break
            case 'stone-spawner':
                if (!current.stoneSpawner || !current.stoneSpawnerPosition || !editorState.stoneSpawners.includes(current.stoneSpawner)) return
                current.stoneSpawner.position = {
                    x: current.stoneSpawnerPosition.x + dx,
                    y: current.stoneSpawnerPosition.y + dy,
                    z: current.stoneSpawnerPosition.z + dz,
                }
                break
            case 'rail-cart':
                if (!current.railCart || !current.railCartCell || !editorState.railCarts.includes(current.railCart)) return
                {
                    const nextCell = addDeltaToVoxel(current.railCartCell, dx, dy, dz)
                    if (!isRailBlock(chunks.palette, chunks.getVoxel(nextCell.x, nextCell.y, nextCell.z))) return
                    current.railCart.railCell = nextCell
                }
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
            case 'effect-zone':
                if (!current.effectZone || !current.effectZonePosition || !editorState.weatherZones.includes(current.effectZone)) return
                current.effectZone.position = {
                    x: current.effectZonePosition.x + dx,
                    y: current.effectZonePosition.y + dy,
                    z: current.effectZonePosition.z + dz,
                }
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
            case 'prop':
                return { ref, anchor, prop: ref.prop, propPosition: { ...ref.prop.position } }
            case 'npc':
                return { ref, anchor, npc: ref.npc, npcPosition: { ...ref.npc.position } }
            case 'stone':
                return { ref, anchor, stone: ref.stone, stonePosition: { ...ref.stone.position } }
            case 'stone-spawner':
                return { ref, anchor, stoneSpawner: ref.spawner, stoneSpawnerPosition: { ...ref.spawner.position } }
            case 'rail-cart':
                return { ref, anchor, railCart: ref.cart, railCartCell: { ...ref.cart.railCell } }
            case 'zone':
                return { ref, anchor, zone: ref.zone, zoneMin: { ...ref.zone.min }, zoneMax: { ...ref.zone.max } }
            case 'sound-source':
                return { ref, anchor, soundSource: ref.source, soundSourcePosition: { ...ref.source.position } }
            case 'sound-zone':
                return { ref, anchor, soundZone: ref.zone, soundZoneMin: { ...ref.zone.min }, soundZoneMax: { ...ref.zone.max } }
            case 'effect-zone':
                return { ref, anchor, effectZone: ref.zone, effectZonePosition: { ...ref.zone.position } }
        }
    }

    function syncExternalPropSelection(): void {
        const npcId = editorState.selectedNpcId
        if (npcId) {
            if (selected?.kind === 'npc' && selected.npc.id === npcId && editorState.npcs.includes(selected.npc)) return
            const npc = editorState.npcs.find((n) => n.id === npcId)
            if (npc) {
                select({ kind: 'npc', npc })
                return
            }
            editorState.selectedNpcId = null
            if (selected?.kind === 'npc') select(null)
        }
        if (editorState.selectedStoneId) {
            const stone = editorState.stones.find((s) => s.id === editorState.selectedStoneId)
            if (stone) {
                if (selected?.kind === 'stone' && selected.stone === stone) return
                select({ kind: 'stone', stone })
                return
            }
            editorState.selectedStoneId = null
            if (selected?.kind === 'stone') select(null)
        }
        if (editorState.selectedStoneSpawnerId) {
            const spawner = editorState.stoneSpawners.find((s) => s.id === editorState.selectedStoneSpawnerId)
            if (spawner) {
                if (selected?.kind === 'stone-spawner' && selected.spawner === spawner) return
                select({ kind: 'stone-spawner', spawner })
                return
            }
            editorState.selectedStoneSpawnerId = null
            if (selected?.kind === 'stone-spawner') select(null)
        }
        if (editorState.selectedRailCartId) {
            const cart = editorState.railCarts.find((c) => c.id === editorState.selectedRailCartId)
            if (cart) {
                if (selected?.kind === 'rail-cart' && selected.cart === cart) return
                select({ kind: 'rail-cart', cart })
                return
            }
            editorState.selectedRailCartId = null
            if (selected?.kind === 'rail-cart') select(null)
        }
        const propId = editorState.selectedPropId
        if (!propId) {
            if (selected?.kind === 'prop') select(null)
            return
        }
        if (selected?.kind === 'prop' && selected.prop.id === propId && editorState.props.includes(selected.prop)) return
        const prop = editorState.props.find((p) => p.id === propId)
        if (!prop) {
            editorState.selectedPropId = null
            if (selected?.kind === 'prop') select(null)
            return
        }
        select({ kind: 'prop', prop })
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

function addPropProxy(group: Group, out: Mesh[], prop: EditorProp, selected: boolean): void {
    const s = Math.max(0.1, prop.scale)
    const height = 0.9 * s
    addBoxProxy(group, out, {
        ref: { kind: 'prop', prop },
        center: new Vector3(prop.position.x, prop.position.y + height * 0.5, prop.position.z),
        size: new Vector3(0.9 * s, height, 0.9 * s),
        color: 0xb3e5b3,
        selected,
    })
}

function addNpcProxy(group: Group, out: Mesh[], npc: NpcConfig, selected: boolean): void {
    const radius = Math.max(0.15, npc.colliderRadius || 0.35)
    const height = Math.max(0.6, npc.colliderHeight || 1.6)
    addBoxProxy(group, out, {
        ref: { kind: 'npc', npc },
        center: new Vector3(npc.position.x, npc.position.y + height * 0.5, npc.position.z),
        size: new Vector3(radius * 2, height, radius * 2),
        color: 0xffd166,
        selected,
    })
}

function addStoneProxy(group: Group, out: Mesh[], stone: StonePlacementConfig, selected: boolean): void {
    const radius = stoneRadiusForConfig(stone)
    addBoxProxy(group, out, {
        ref: { kind: 'stone', stone },
        center: new Vector3(stone.position.x, stone.position.y + radius, stone.position.z),
        size: new Vector3(radius * 2, radius * 2, radius * 2),
        color: 0xff9f43,
        selected,
    })
}

function addStoneSpawnerProxy(group: Group, out: Mesh[], spawner: StoneFallSpawnerConfig, selected: boolean): void {
    addBoxProxy(group, out, {
        ref: { kind: 'stone-spawner', spawner },
        center: new Vector3(spawner.position.x, spawner.position.y + 0.25, spawner.position.z),
        size: new Vector3(0.7, 0.7, 0.7),
        color: 0xffb86b,
        selected,
    })
}

function addRailCartProxy(group: Group, out: Mesh[], cart: RailCartConfig, selected: boolean): void {
    addBoxProxy(group, out, {
        ref: { kind: 'rail-cart', cart },
        center: new Vector3(cart.railCell.x + 0.5, cart.railCell.y + 0.36, cart.railCell.z + 0.5),
        size: new Vector3(0.92, 0.58, 0.92),
        color: 0xf0c36b,
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
        case 'stone': return 1
        case 'stone-spawner': return 1
        case 'rail-cart': return 1
        case 'prop': return 2
        case 'npc': return 2
        case 'zone': return 4
        case 'sound-zone': return 4
        case 'effect-zone': return 4
    }
}

function sameSelection(a: SelectionRef | null, b: SelectionRef | null): boolean {
    if (a === b) return true
    if (!a || !b || a.kind !== b.kind) return false
    switch (a.kind) {
        case 'spawn': return true
        case 'pickup': return b.kind === 'pickup' && a.pickup === b.pickup
        case 'prop': return b.kind === 'prop' && a.prop === b.prop
        case 'npc': return b.kind === 'npc' && a.npc === b.npc
        case 'stone': return b.kind === 'stone' && a.stone === b.stone
        case 'stone-spawner': return b.kind === 'stone-spawner' && a.spawner === b.spawner
        case 'rail-cart': return b.kind === 'rail-cart' && a.cart === b.cart
        case 'zone': return b.kind === 'zone' && a.zone === b.zone
        case 'sound-source': return b.kind === 'sound-source' && a.source === b.source
        case 'sound-zone': return b.kind === 'sound-zone' && a.zone === b.zone
        case 'effect-zone': return b.kind === 'effect-zone' && a.zone === b.zone
    }
}

function anchorFor(ref: SelectionRef, state: EditorState): Vector3 | null {
    switch (ref.kind) {
        case 'spawn':
            return new Vector3(state.spawn.x, state.spawn.y, state.spawn.z)
        case 'pickup':
            if (!state.pickups.includes(ref.pickup)) return null
            return new Vector3(ref.pickup.position.x, ref.pickup.position.y, ref.pickup.position.z)
        case 'prop':
            if (!state.props.includes(ref.prop)) return null
            return new Vector3(ref.prop.position.x, ref.prop.position.y, ref.prop.position.z)
        case 'npc':
            if (!state.npcs.includes(ref.npc)) return null
            return new Vector3(ref.npc.position.x, ref.npc.position.y, ref.npc.position.z)
        case 'stone':
            if (!state.stones.includes(ref.stone)) return null
            return new Vector3(ref.stone.position.x, ref.stone.position.y, ref.stone.position.z)
        case 'stone-spawner':
            if (!state.stoneSpawners.includes(ref.spawner)) return null
            return new Vector3(ref.spawner.position.x, ref.spawner.position.y, ref.spawner.position.z)
        case 'rail-cart':
            if (!state.railCarts.includes(ref.cart)) return null
            return new Vector3(ref.cart.railCell.x + 0.5, ref.cart.railCell.y, ref.cart.railCell.z + 0.5)
        case 'zone':
            if (!state.zones.includes(ref.zone)) return null
            return aabbCenter(ref.zone.min, ref.zone.max)
        case 'sound-source':
            if (!state.soundSources.includes(ref.source)) return null
            return new Vector3(ref.source.position.x, ref.source.position.y, ref.source.position.z)
        case 'sound-zone':
            if (!state.soundZones.includes(ref.zone)) return null
            return aabbCenter(ref.zone.min, ref.zone.max)
        case 'effect-zone':
            if (!state.weatherZones.includes(ref.zone)) return null
            return new Vector3(ref.zone.position.x, ref.zone.position.y, ref.zone.position.z)
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

function selectionDelta(position: Vector3, baseline: SelectionBaseline, state: EditorState): Vector3 {
    if (baseline.ref.kind === 'prop' || baseline.ref.kind === 'npc') {
        const snap = baseline.ref.kind === 'prop'
            ? baseline.prop?.gridAligned !== false && state.propGridAlign
            : baseline.npc?.gridAligned !== false && state.npcGridAlign
        if (!snap) {
            return new Vector3(
                position.x - baseline.anchor.x,
                position.y - baseline.anchor.y,
                position.z - baseline.anchor.z,
            )
        }
    }
    return snappedDelta(position, baseline.anchor)
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
        case 'prop': return `prop "${ref.prop.kind}" @ ${formatPoint(ref.prop.position)}`
        case 'npc': return `NPC "${ref.npc.name}" @ ${formatPoint(ref.npc.position)}`
        case 'stone': return `stone "${ref.stone.id ?? 'stone'}" @ ${formatPoint(ref.stone.position)}`
        case 'stone-spawner': return `stone spawner "${ref.spawner.id ?? 'spawner'}" @ ${formatPoint(ref.spawner.position)}`
        case 'rail-cart': return `rail cart "${ref.cart.id}" @ ${formatPoint(ref.cart.railCell)}`
        case 'zone': return `zone "${ref.zone.label ?? ref.zone.id}"`
        case 'sound-source': return `sound source "${ref.source.label ?? ref.source.id}"`
        case 'sound-zone': return `sound zone "${ref.zone.label ?? ref.zone.id}"`
        case 'effect-zone': return `effect zone "${ref.zone.label ?? ref.zone.id}"`
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
        `props:${state.props.map((p) => `${p.id}:${p.kind}:${p.position.x},${p.position.y},${p.position.z}:${p.scale}`).join(';')}`,
        `npcs:${state.npcs.map((n) => `${n.id}:${n.model}:${n.beard}:${n.position.x},${n.position.y},${n.position.z}:${n.scale}:${n.colliderRadius}:${n.colliderHeight}`).join(';')}`,
        `stones:${state.stones.map((s) => `${s.id}:${s.position.x},${s.position.y},${s.position.z}:${s.tier}:${s.size}`).join(';')}`,
        `stoneSpawners:${state.stoneSpawners.map((s) => `${s.id}:${s.position.x},${s.position.y},${s.position.z}:${s.enabled}:${s.interval}:${s.maxLive}`).join(';')}`,
        `railCarts:${state.railCarts.map((c) => `${c.id}:${c.railCell.x},${c.railCell.y},${c.railCell.z}:${c.front}:${c.speed}:${c.enabled}`).join(';')}`,
        `zones:${state.zones.map((z) => `${z.id}:${z.min.x},${z.min.y},${z.min.z}:${z.max.x},${z.max.y},${z.max.z}`).join(';')}`,
        `sources:${state.soundSources.map((s) => `${s.id}:${s.position.x},${s.position.y},${s.position.z}:${s.radius}`).join(';')}`,
        `soundZones:${state.soundZones.map((z) => `${z.id}:${z.min.x},${z.min.y},${z.min.z}:${z.max.x},${z.max.y},${z.max.z}`).join(';')}`,
        `effectZones:${state.weatherZones.map((z) => `${z.id}:${z.position.x},${z.position.y},${z.position.z}:${z.size.x},${z.size.y},${z.size.z}`).join(';')}`,
    ].join('|')
}

function selectionKey(ref: SelectionRef, state: EditorState): string {
    switch (ref.kind) {
        case 'spawn': return 'spawn'
        case 'pickup': return `pickup:${state.pickups.indexOf(ref.pickup)}`
        case 'prop': return `prop:${ref.prop.id}`
        case 'npc': return `npc:${ref.npc.id}`
        case 'stone': return `stone:${ref.stone.id ?? state.stones.indexOf(ref.stone)}`
        case 'stone-spawner': return `stone-spawner:${ref.spawner.id ?? state.stoneSpawners.indexOf(ref.spawner)}`
        case 'rail-cart': return `rail-cart:${ref.cart.id}`
        case 'zone': return `zone:${ref.zone.id}`
        case 'sound-source': return `sound-source:${ref.source.id}`
        case 'sound-zone': return `sound-zone:${ref.zone.id}`
        case 'effect-zone': return `effect-zone:${ref.zone.id}`
    }
}
