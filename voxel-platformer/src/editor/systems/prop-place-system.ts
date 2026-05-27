import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type VoxelCoord } from '../../engine/ecs/world'
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isPathSurface } from '../../engine/voxel/palette'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { EditorState } from '../editor-state'
import type { EditorProp, EditorPropKind } from '../../game/props/prop-types'

const MAX_RAY = 60
const REMOVE_RADIUS = 1.5
const GROUND_SCAN_UP = 8
const GROUND_SCAN_DOWN = 24
type VoxelRayHit = NonNullable<ReturnType<typeof voxelRaycast>>
type WorldPoint = { x: number; y: number; z: number }
type ClickPoint = { x: number; y: number }

/**
 * Click-to-place editor decorative props. Active in single-prop and
 * scatter-prop modes.
 *
 * LMB places a prop at the editor cursor. With `propGridAlign = true`
 * the cursor is authoritative, so props work on the same working plane
 * as painting / pickups / sound sources. With `propGridAlign = false`
 * the prop lands at the precise ray-hit world point so the author can
 * scatter naturally on existing surfaces, falling back to the working
 * plane when the ray passes through empty space.
 *
 * RMB removes the prop closest to the editor cursor, with a ray-hit
 * fallback when the cursor is unavailable. Mirrors the same
 * "right-click to erase" convention the sound-source and weather-zone
 * place systems use.
 */
export function createPropPlaceSystem(
    input: Input,
    iso: IsometricCamera,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    const ray = makeRay()
    let idCounter = 0
    // Cache of in-use ids. We mutate it on each `nextId` so a single
    // scatter stroke placing N props pays O(N) total — not the
    // O(N²) the original `new Set(state.props.map(...))` per call
    // cost. Stale entries from external removes are harmless (they
    // just cause us to skip a counter value); external adds are
    // detected via `size < state.props.length` and trigger a rebuild.
    const knownIds = new Set<string>()

    function syncKnownIds(): void {
        if (knownIds.size === editorState.props.length) return
        // We tolerate `knownIds` being larger than props.length (e.g.
        // after a delete) — only smaller means we missed an add and
        // need to refresh.
        if (knownIds.size > editorState.props.length) return
        knownIds.clear()
        for (const p of editorState.props) knownIds.add(p.id)
    }

    function nextId(kind: EditorPropKind = editorState.propKind): string {
        syncKnownIds()
        for (;;) {
            idCounter += 1
            const candidate = `prop-${kind}-${idCounter}`
            if (!knownIds.has(candidate)) {
                knownIds.add(candidate)
                return candidate
            }
        }
    }

    return {
        fixed: true,
        order: FixedOrder.input + 12,
        update(world) {
            if (editorState.mode !== 'place-prop' && editorState.mode !== 'scatter-props') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return

            const getHit = (click: ClickPoint): VoxelRayHit | null => {
                screenToWorldRay(click.x, click.y, iso.camera, ray)
                return voxelRaycast(chunks, ray.origin, ray.direction, MAX_RAY)
            }

            for (const click of clicks) {
                if (editorState.mode === 'scatter-props') {
                    if (click.button === 2) removePropsInScatterBrush(world as GameWorld, editorState)
                    else if (click.button === 0) scatterProps(world as GameWorld, editorState, nextId)
                } else {
                    if (click.button === 2) {
                        const anchor = editorState.cursor
                            ? removeAnchor(editorState, null)
                            : removeAnchor(editorState, getHit(click))
                        removeNearestProp(world as GameWorld, editorState, anchor)
                    } else if (click.button === 0) {
                        placeProp(world as GameWorld, editorState, click, getHit, nextId)
                    }
                }
            }
        },
    }

    function placeProp(
        world: GameWorld,
        state: EditorState,
        click: ClickPoint,
        getHit: (click: ClickPoint) => VoxelRayHit | null,
        nextPropId: () => string,
    ): void {
        const hit = state.propGridAlign && state.cursor ? null : getHit(click)
        const position = state.propGridAlign
            ? gridAlignedPosition(state.cursor, hit)
            : hit
                ? freeHitPosition(hit)
                : freePlanePosition(state)
        if (!position) return

        const id = nextPropId()
        const prop: EditorProp = {
            id,
            kind: state.propKind,
            position,
            yaw: state.propYaw,
            scale: state.propScale,
            gridAligned: state.propGridAlign,
        }
        state.props.push(prop)
        state.selectedPropId = prop.id
        pushLog(world, `Prop "${prop.kind}" placed (${prop.id}).`)
    }

    function removeNearestProp(
        world: GameWorld,
        state: EditorState,
        anchor: WorldPoint | null,
    ): void {
        if (!anchor) return
        let bestIndex = -1
        let bestDistSq = REMOVE_RADIUS * REMOVE_RADIUS
        for (let i = 0; i < state.props.length; i++) {
            const p = state.props[i]!
            const dx = p.position.x - anchor.x
            const dy = p.position.y - anchor.y
            const dz = p.position.z - anchor.z
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 < bestDistSq) {
                bestDistSq = d2
                bestIndex = i
            }
        }
        if (bestIndex < 0) return
        const [removed] = state.props.splice(bestIndex, 1)
        if (state.selectedPropId === removed?.id) state.selectedPropId = null
        if (removed) pushLog(world, `Removed prop "${removed.kind}" (${removed.id}).`)
    }

    function freeHitPosition(hit: VoxelRayHit): WorldPoint {
        return {
            x: ray.origin.x + ray.direction.x * hit.t,
            y: ray.origin.y + ray.direction.y * hit.t + 0.001,
            z: ray.origin.z + ray.direction.z * hit.t,
        }
    }

    function freePlanePosition(state: EditorState): WorldPoint | null {
        return intersectWorkingPlane(ray, state.workingPlaneY) ??
            (state.cursor ? cursorFloorPosition(state.cursor) : null)
    }

    function scatterProps(
        world: GameWorld,
        state: EditorState,
        nextPropId: (kind?: EditorPropKind) => string,
    ): void {
        const cursor = state.cursor
        if (!cursor) return
        const enabled = state.propScatterItems.filter((item) => item.enabled && item.density > 0)
        if (enabled.length === 0) {
            pushLog(world, 'Scatter list is empty.')
            return
        }

        const brushCells = scatterBrushCells(state, cursor)
        if (brushCells.length === 0) return
        const rng = mulberry32(scatterSeed(state, cursor))
        const center = { x: cursor.x + 0.5, y: cursor.y, z: cursor.z + 0.5 }
        const before = state.props.length

        for (const item of enabled) {
            const count = stochasticCount(brushCells.length * clamp(item.density, 0, 5), rng)
            for (let i = 0; i < count; i++) {
                const sample = sampleScatterPoint(state, center, rng)
                const groundY = findGroundY(chunks, sample.x, sample.z, cursor.y)
                if (groundY === null) continue
                const scale = Math.max(0.05, item.scale * (1 + randSigned(rng) * clamp(item.scaleVariation, 0, 2)))
                const yaw = item.yaw + randSigned(rng) * clamp(item.yawVariation, 0, Math.PI * 2)
                const prop: EditorProp = {
                    id: nextPropId(item.kind),
                    kind: item.kind,
                    position: { x: sample.x, y: groundY, z: sample.z },
                    yaw,
                    scale,
                    gridAligned: false,
                }
                state.props.push(prop)
                state.selectedPropId = prop.id
            }
        }

        const placed = state.props.length - before
        if (placed > 0) pushLog(world, `Scattered ${placed} props.`)
    }

    function removePropsInScatterBrush(world: GameWorld, state: EditorState): void {
        const cursor = state.cursor
        if (!cursor) return
        const cells = new Set(scatterBrushCells(state, cursor).map((c) => `${c.x},${c.z}`))
        if (cells.size === 0) return
        let removed = 0
        for (let i = state.props.length - 1; i >= 0; i--) {
            const prop = state.props[i]!
            const key = `${Math.floor(prop.position.x)},${Math.floor(prop.position.z)}`
            if (!cells.has(key)) continue
            const [gone] = state.props.splice(i, 1)
            if (state.selectedPropId === gone?.id) state.selectedPropId = null
            removed++
        }
        if (removed > 0) pushLog(world, `Removed ${removed} scattered props.`)
    }
}

export function scatterBrushCells(
    state: Pick<EditorState, 'propScatterShape' | 'propScatterSize'>,
    cursor: VoxelCoord,
): VoxelCoord[] {
    const size = Math.max(1, Math.floor(state.propScatterSize))
    const halfBefore = Math.floor((size - 1) / 2)
    const minX = cursor.x - halfBefore
    const minZ = cursor.z - halfBefore
    const radius = size * 0.5
    // Compare against squared distance so the per-cell check is two
    // multiplies + a compare instead of Math.hypot's sqrt; with the
    // 15×15 brush this runs 225×/frame in scatter mode.
    const radiusSq = radius * radius
    const brushCenterX = cursor.x + 0.5
    const brushCenterZ = cursor.z + 0.5
    const isCircle = state.propScatterShape === 'circle'
    const cells: VoxelCoord[] = []
    for (let dz = 0; dz < size; dz++) {
        for (let dx = 0; dx < size; dx++) {
            const x = minX + dx
            const z = minZ + dz
            if (isCircle) {
                const ex = x + 0.5 - brushCenterX
                const ez = z + 0.5 - brushCenterZ
                if (ex * ex + ez * ez > radiusSq) continue
            }
            cells.push({ x, y: cursor.y, z })
        }
    }
    return cells
}

function gridAlignedPosition(cursor: VoxelCoord | null, hit: VoxelRayHit | null): WorldPoint | null {
    if (cursor) return cursorFloorPosition(cursor)
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

function removeAnchor(state: EditorState, hit: VoxelRayHit | null): WorldPoint | null {
    if (state.cursor) return cursorFloorPosition(state.cursor)
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

function cursorFloorPosition(cursor: VoxelCoord): WorldPoint {
    return {
        x: cursor.x + 0.5,
        y: cursor.y,
        z: cursor.z + 0.5,
    }
}

function intersectWorkingPlane(ray: ReturnType<typeof makeRay>, planeY: number): WorldPoint | null {
    if (Math.abs(ray.direction.y) < 1e-6) return null
    const t = (planeY - ray.origin.y) / ray.direction.y
    if (t < 0) return null
    return {
        x: ray.origin.x + ray.direction.x * t,
        y: planeY,
        z: ray.origin.z + ray.direction.z * t,
    }
}

function sampleScatterPoint(
    state: Pick<EditorState, 'propScatterShape' | 'propScatterSize'>,
    center: WorldPoint,
    rng: () => number,
): { x: number; z: number } {
    const size = Math.max(1, state.propScatterSize)
    if (state.propScatterShape === 'circle') {
        const radius = size * 0.5
        const angle = rng() * Math.PI * 2
        const dist = Math.sqrt(rng()) * radius
        return {
            x: center.x + Math.cos(angle) * dist,
            z: center.z + Math.sin(angle) * dist,
        }
    }
    return {
        x: center.x + (rng() - 0.5) * size,
        z: center.z + (rng() - 0.5) * size,
    }
}

function findGroundY(chunks: ChunkManager, x: number, z: number, baseY: number): number | null {
    const vx = Math.floor(x)
    const vz = Math.floor(z)
    const top = Math.floor(baseY) + GROUND_SCAN_UP
    const bottom = Math.floor(baseY) - GROUND_SCAN_DOWN
    for (let y = top; y >= bottom; y--) {
        const block = chunks.getVoxel(vx, y, vz)
        if (!isPathSurface(chunks.palette, block)) continue
        return y + 1
    }
    return null
}

function stochasticCount(expected: number, rng: () => number): number {
    if (!Number.isFinite(expected) || expected <= 0) return 0
    const whole = Math.floor(expected)
    return whole + (rng() < expected - whole ? 1 : 0)
}

function scatterSeed(state: EditorState, cursor: VoxelCoord): number {
    let seed = 2166136261
    seed = hashInt(seed, cursor.x)
    seed = hashInt(seed, cursor.y)
    seed = hashInt(seed, cursor.z)
    seed = hashInt(seed, state.props.length)
    seed = hashInt(seed, Math.floor(state.propScatterSize * 100))
    seed = hashInt(seed, state.propScatterShape === 'circle' ? 1 : 2)
    return seed >>> 0
}

function hashInt(seed: number, value: number): number {
    let v = value | 0
    seed ^= v & 0xff
    seed = Math.imul(seed, 16777619)
    v >>= 8
    seed ^= v & 0xff
    seed = Math.imul(seed, 16777619)
    v >>= 8
    seed ^= v & 0xff
    seed = Math.imul(seed, 16777619)
    v >>= 8
    seed ^= v & 0xff
    return Math.imul(seed, 16777619)
}

function mulberry32(seed: number): () => number {
    let t = seed >>> 0
    return () => {
        t += 0x6d2b79f5
        let r = t
        r = Math.imul(r ^ (r >>> 15), r | 1)
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
}

function randSigned(rng: () => number): number {
    return rng() * 2 - 1
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}
