import { hasComponent } from 'bitecs'
import {
    AdditiveBlending,
    BufferGeometry,
    DoubleSide,
    DynamicDrawUsage,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three'
import { Position, Rotation } from '../engine/ecs/components'
import {
    meleeAttackActiveEndSeconds,
    meleeAttackTotalSeconds,
    type ActiveMeleeAttack,
    type MeleeShape,
    type MeleeVec3,
} from '../engine/ecs/melee-types'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'

type MeleeTrailKind = 'sweep' | 'thrust' | 'slam'
type MeleeTrailSweepMode = 'left-to-right' | 'right-to-left' | 'center-out'

export interface MeleeTrailStyle {
    kind: MeleeTrailKind
    color: number
    edgeColor: number
    opacity: number
    yOffset: number
    leadSeconds: number
    tailSeconds: number
    innerRadiusMul: number
    outerRadiusMul: number
    thrustWidth: number
    sweepMode: MeleeTrailSweepMode
}

export interface MeleeTrailTiming {
    visible: boolean
    phase: number
    alpha: number
}

interface ActorTrailPose extends MeleeVec3 {
    yaw: number
}

interface TrailMeshState {
    root: Group
    fill: Mesh<BufferGeometry, MeshBasicMaterial>
    edge: Line<BufferGeometry, LineBasicMaterial>
}

const TRAIL_RENDER_ORDER = 8_500
const SWEEP_STEPS = 18
const CIRCLE_STEPS = 40
const TRAIL_FILL_VERTEX_CAPACITY = Math.max(SWEEP_STEPS * 6, CIRCLE_STEPS * 6, 9)
const TRAIL_EDGE_VERTEX_CAPACITY = Math.max(SWEEP_STEPS + 1, CIRCLE_STEPS + 1, 5)

const DEFAULT_TRAIL_STYLE: MeleeTrailStyle = {
    kind: 'sweep',
    color: 0xffa85a,
    edgeColor: 0xffe2a0,
    opacity: 0.48,
    yOffset: 0.92,
    leadSeconds: 0.1,
    tailSeconds: 0.16,
    innerRadiusMul: 0.18,
    outerRadiusMul: 1.0,
    thrustWidth: 0.3,
    sweepMode: 'left-to-right',
}

const MELEE_TRAIL_STYLES: Record<string, MeleeTrailStyle> = {
    'player-thrust': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'thrust',
        color: 0xffdd86,
        edgeColor: 0xfff4c2,
        opacity: 0.5,
        yOffset: 0.98,
        thrustWidth: 0.32,
    },
    'player-spear-thrust': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'thrust',
        color: 0x9fcaff,
        edgeColor: 0xd5eeff,
        opacity: 0.5,
        yOffset: 1.02,
        leadSeconds: 0.13,
        thrustWidth: 0.18,
    },
    'player-swing': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'sweep',
        color: 0xff9a35,
        edgeColor: 0xfff0a8,
        opacity: 0.5,
        yOffset: 0.95,
        innerRadiusMul: 0.24,
        sweepMode: 'left-to-right',
    },
    'staff-slam': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'sweep',
        color: 0xb76cff,
        edgeColor: 0xf0c0ff,
        opacity: 0.44,
        yOffset: 0.9,
        leadSeconds: 0.14,
        tailSeconds: 0.2,
        innerRadiusMul: 0.12,
        sweepMode: 'center-out',
    },
    'npc-slash': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'sweep',
        color: 0xff5c30,
        edgeColor: 0xffb079,
        opacity: 0.42,
        yOffset: 0.9,
        leadSeconds: 0.1,
        innerRadiusMul: 0.22,
        sweepMode: 'right-to-left',
    },
    'npc-spear-thrust': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'thrust',
        color: 0xff7f58,
        edgeColor: 0xffd4bd,
        opacity: 0.42,
        yOffset: 0.98,
        leadSeconds: 0.12,
        thrustWidth: 0.16,
    },
    'hammer-slam': {
        ...DEFAULT_TRAIL_STYLE,
        kind: 'slam',
        color: 0xff3f1f,
        edgeColor: 0xffc35a,
        opacity: 0.56,
        yOffset: 0.08,
        leadSeconds: 0.04,
        tailSeconds: 0.22,
        innerRadiusMul: 0.62,
        outerRadiusMul: 1.0,
        sweepMode: 'center-out',
    },
}

export function meleeTrailStyleForAttack(attackId: string): MeleeTrailStyle {
    return MELEE_TRAIL_STYLES[attackId] ?? DEFAULT_TRAIL_STYLE
}

export function meleeTrailTiming(attack: ActiveMeleeAttack): MeleeTrailTiming {
    const style = meleeTrailStyleForAttack(attack.def.id)
    const activeStart = attack.def.startupSeconds
    const activeEnd = meleeAttackActiveEndSeconds(attack.def)
    const total = meleeAttackTotalSeconds(attack.def)
    const visualStart = Math.max(0, activeStart - style.leadSeconds)
    const visualEnd = Math.min(total, activeEnd + style.tailSeconds)
    const elapsed = attack.elapsedSeconds
    if (elapsed < visualStart || elapsed > visualEnd || visualEnd <= visualStart) {
        return { visible: false, phase: 0, alpha: 0 }
    }

    const phase = style.kind === 'slam'
        ? slamPhase(elapsed, activeStart, visualEnd)
        : smooth01(inverseLerp(visualStart, activeEnd, elapsed))
    const alpha = style.opacity * alphaEnvelope(elapsed, visualStart, activeStart, activeEnd, visualEnd, style.kind === 'slam')
    return {
        visible: alpha > 0.01,
        phase,
        alpha,
    }
}

export function createMeleeTrailRenderSystem(scene: Scene): System {
    const states = new Map<string, TrailMeshState>()

    function stateForKey(key: string): TrailMeshState {
        const existing = states.get(key)
        if (existing) return existing
        const fill = new Mesh(
            createDynamicTrailGeometry(TRAIL_FILL_VERTEX_CAPACITY),
            new MeshBasicMaterial({
                color: DEFAULT_TRAIL_STYLE.color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                depthTest: true,
                side: DoubleSide,
                blending: AdditiveBlending,
            }),
        )
        fill.name = `${key}:MeleeTrailFill`
        fill.frustumCulled = false
        fill.renderOrder = TRAIL_RENDER_ORDER

        const edge = new Line(
            createDynamicTrailGeometry(TRAIL_EDGE_VERTEX_CAPACITY),
            new LineBasicMaterial({
                color: DEFAULT_TRAIL_STYLE.edgeColor,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                depthTest: true,
                blending: AdditiveBlending,
            }),
        )
        edge.name = `${key}:MeleeTrailEdge`
        edge.frustumCulled = false
        edge.renderOrder = TRAIL_RENDER_ORDER + 1

        const root = new Group()
        root.name = `${key}:MeleeTrail`
        root.visible = false
        root.add(fill, edge)
        scene.add(root)
        const next = { root, fill, edge }
        states.set(key, next)
        return next
    }

    return {
        name: 'meleeTrails',
        order: RenderOrder.worldRender + 6,
        update(world) {
            const gw = world as GameWorld
            const used = new Set<string>()
            for (const [key, attack] of gw.meleeAttacks.entries()) {
                used.add(key)
                const pose = meleeTrailPose(gw, attack)
                const timing = meleeTrailTiming(attack)
                const state = stateForKey(key)
                if (!pose || !timing.visible) {
                    state.root.visible = false
                    continue
                }
                const style = meleeTrailStyleForAttack(attack.def.id)
                updateTrailGeometry(state, attack, pose, style, timing)
                state.fill.material.color.setHex(style.color)
                state.fill.material.opacity = timing.alpha
                state.edge.material.color.setHex(style.edgeColor)
                state.edge.material.opacity = timing.alpha * 0.92
                state.root.visible = true
            }
            for (const [key, state] of states) {
                if (!used.has(key)) state.root.visible = false
            }
        },
        dispose() {
            for (const state of states.values()) {
                scene.remove(state.root)
                state.fill.geometry.dispose()
                state.fill.material.dispose()
                state.edge.geometry.dispose()
                state.edge.material.dispose()
            }
            states.clear()
        },
    }
}

function meleeTrailPose(world: GameWorld, attack: ActiveMeleeAttack): ActorTrailPose | null {
    const live = actorPose(world, attack)
    if (!live) return null
    if (attack.lockedOrigin && attack.lockedYaw !== null) {
        return {
            x: attack.lockedOrigin.x,
            y: attack.lockedOrigin.y,
            z: attack.lockedOrigin.z,
            yaw: attack.lockedYaw,
        }
    }
    return live
}

function actorPose(world: GameWorld, attack: ActiveMeleeAttack): ActorTrailPose | null {
    if (attack.attacker.kind === 'player') {
        const eid = attack.attacker.eid
        if (!hasComponent(world, eid, Position) || !hasComponent(world, eid, Rotation)) return null
        return {
            x: Position.x[eid]!,
            y: Position.y[eid]!,
            z: Position.z[eid]!,
            yaw: Rotation.y[eid]!,
        }
    }
    const npc = world.npcRuntimeById.get(attack.attacker.id)
    if (!npc || npc.dying) return null
    return {
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
        yaw: npc.yaw,
    }
}

function updateTrailGeometry(
    state: TrailMeshState,
    attack: ActiveMeleeAttack,
    pose: ActorTrailPose,
    style: MeleeTrailStyle,
    timing: MeleeTrailTiming,
): void {
    const shape = attack.def.shape
    if (style.kind === 'thrust' && shape.kind === 'wedge') {
        writeThrustTrail(state, pose, shape, style, timing.phase)
        return
    }
    if (style.kind === 'slam' && shape.kind === 'circle') {
        writeSlamTrail(state, pose, shape, style, timing.phase)
        return
    }
    if (shape.kind === 'wedge') {
        writeSweepTrail(state, pose, shape, style, timing.phase)
        return
    }
    writeSlamTrail(state, pose, shape, style, timing.phase)
}

function writeSweepTrail(
    state: TrailMeshState,
    pose: ActorTrailPose,
    shape: Extract<MeleeShape, { kind: 'wedge' }>,
    style: MeleeTrailStyle,
    phase: number,
): void {
    const y = pose.y + style.yOffset
    const range = shape.range * style.outerRadiusMul
    const inner = Math.max(0.12, range * style.innerRadiusMul)
    const halfArc = shape.arcRadians * 0.5
    const eased = smooth01(phase)
    let a0 = pose.yaw - halfArc
    let a1 = pose.yaw + halfArc
    if (style.sweepMode === 'left-to-right') {
        a1 = a0 + shape.arcRadians * eased
    } else if (style.sweepMode === 'right-to-left') {
        a0 = a1 - shape.arcRadians * eased
    } else {
        a0 = pose.yaw - halfArc * eased
        a1 = pose.yaw + halfArc * eased
    }
    if (Math.abs(a1 - a0) < 1e-4) a1 = a0 + 1e-4
    const steps = Math.max(2, Math.ceil(SWEEP_STEPS * Math.abs(a1 - a0) / Math.max(shape.arcRadians, 1e-4)))
    const positions: number[] = []
    const indices: number[] = []
    const edge: number[] = []
    for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const a = a0 + (a1 - a0) * t
        const sx = Math.sin(a)
        const sz = Math.cos(a)
        positions.push(pose.x + sx * inner, y, pose.z + sz * inner)
        positions.push(pose.x + sx * range, y + Math.sin(t * Math.PI) * 0.05, pose.z + sz * range)
        edge.push(pose.x + sx * range, y + 0.035, pose.z + sz * range)
        if (i < steps) {
            const base = i * 2
            indices.push(base, base + 1, base + 3, base, base + 3, base + 2)
        }
    }
    writeMeshGeometry(state.fill.geometry, positions, indices)
    writeLineGeometry(state.edge.geometry, edge)
}

function writeThrustTrail(
    state: TrailMeshState,
    pose: ActorTrailPose,
    shape: Extract<MeleeShape, { kind: 'wedge' }>,
    style: MeleeTrailStyle,
    phase: number,
): void {
    const y = pose.y + style.yOffset
    const eased = smooth01(phase)
    const length = Math.max(0.18, shape.range * (0.18 + 0.82 * eased))
    const baseDistance = Math.min(0.35, length * 0.3)
    const midDistance = Math.max(baseDistance + 0.1, length * 0.72)
    const width = style.thrustWidth * (0.45 + 0.55 * eased)
    const baseWidth = Math.max(0.04, width * 0.36)
    const fx = Math.sin(pose.yaw)
    const fz = Math.cos(pose.yaw)
    const rx = Math.cos(pose.yaw)
    const rz = -Math.sin(pose.yaw)
    const bx = pose.x + fx * baseDistance
    const bz = pose.z + fz * baseDistance
    const mx = pose.x + fx * midDistance
    const mz = pose.z + fz * midDistance
    const tx = pose.x + fx * length
    const tz = pose.z + fz * length
    const positions = [
        bx - rx * baseWidth, y, bz - rz * baseWidth,
        bx + rx * baseWidth, y, bz + rz * baseWidth,
        mx + rx * width, y + 0.035, mz + rz * width,
        tx, y + 0.065, tz,
        mx - rx * width, y + 0.035, mz - rz * width,
    ]
    const indices = [0, 1, 2, 0, 2, 4, 4, 2, 3]
    writeMeshGeometry(state.fill.geometry, positions, indices)
    writeLineGeometry(state.edge.geometry, [
        bx - rx * baseWidth, y + 0.04, bz - rz * baseWidth,
        mx - rx * width, y + 0.07, mz - rz * width,
        tx, y + 0.1, tz,
        mx + rx * width, y + 0.07, mz + rz * width,
        bx + rx * baseWidth, y + 0.04, bz + rz * baseWidth,
    ])
}

function writeSlamTrail(
    state: TrailMeshState,
    pose: ActorTrailPose,
    shape: Extract<MeleeShape, { kind: 'circle' }>,
    style: MeleeTrailStyle,
    phase: number,
): void {
    const cx = pose.x + Math.sin(pose.yaw) * shape.centerForwardOffset
    const cz = pose.z + Math.cos(pose.yaw) * shape.centerForwardOffset
    const y = pose.y + style.yOffset
    const radius = Math.max(0.12, shape.radius * (0.2 + 0.8 * smooth01(phase)))
    const inner = Math.max(0.04, radius * style.innerRadiusMul)
    const positions: number[] = []
    const indices: number[] = []
    const edge: number[] = []
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
        const a = (Math.PI * 2 * i) / CIRCLE_STEPS
        const sx = Math.sin(a)
        const sz = Math.cos(a)
        positions.push(cx + sx * inner, y, cz + sz * inner)
        positions.push(cx + sx * radius, y + 0.02, cz + sz * radius)
        edge.push(cx + sx * radius, y + 0.045, cz + sz * radius)
        if (i < CIRCLE_STEPS) {
            const base = i * 2
            indices.push(base, base + 1, base + 3, base, base + 3, base + 2)
        }
    }
    writeMeshGeometry(state.fill.geometry, positions, indices)
    writeLineGeometry(state.edge.geometry, edge)
}

function writeMeshGeometry(geometry: BufferGeometry, positions: number[], indices: number[]): void {
    const attr = geometry.getAttribute('position') as Float32BufferAttribute
    const array = attr.array as Float32Array
    if (indices.length * 3 > array.length) throw new Error(`Melee trail fill overflow: ${indices.length} vertices > ${array.length / 3}`)
    let offset = 0
    for (const index of indices) {
        const base = index * 3
        array[offset++] = positions[base] ?? 0
        array[offset++] = positions[base + 1] ?? 0
        array[offset++] = positions[base + 2] ?? 0
    }
    clearAttributeTail(array, offset)
    geometry.setIndex(null)
    geometry.setDrawRange(0, indices.length)
    attr.needsUpdate = true
}

function writeLineGeometry(geometry: BufferGeometry, positions: number[]): void {
    const attr = geometry.getAttribute('position') as Float32BufferAttribute
    const array = attr.array as Float32Array
    if (positions.length > array.length) throw new Error(`Melee trail edge overflow: ${positions.length / 3} vertices > ${array.length / 3}`)
    array.set(positions, 0)
    clearAttributeTail(array, positions.length)
    geometry.setDrawRange(0, positions.length / 3)
    attr.needsUpdate = true
}

function createDynamicTrailGeometry(vertexCapacity: number): BufferGeometry {
    const geometry = new BufferGeometry()
    const position = new Float32BufferAttribute(new Float32Array(vertexCapacity * 3), 3)
    position.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setDrawRange(0, 0)
    return geometry
}

function clearAttributeTail(array: Float32Array, start: number): void {
    array.fill(0, start)
}

function alphaEnvelope(
    elapsed: number,
    visualStart: number,
    activeStart: number,
    activeEnd: number,
    visualEnd: number,
    slam: boolean,
): number {
    if (slam && elapsed < activeStart) {
        return 0.26 * smooth01(inverseLerp(visualStart, activeStart, elapsed))
    }
    if (elapsed < activeStart) {
        return 0.18 + 0.64 * smooth01(inverseLerp(visualStart, activeStart, elapsed))
    }
    if (elapsed <= activeEnd) return 1
    return 1 - smooth01(inverseLerp(activeEnd, visualEnd, elapsed))
}

function slamPhase(elapsed: number, activeStart: number, visualEnd: number): number {
    if (elapsed < activeStart) return 0.08 + 0.12 * smooth01(inverseLerp(Math.max(0, activeStart - 0.04), activeStart, elapsed))
    return 0.22 + 0.78 * smooth01(inverseLerp(activeStart, visualEnd, elapsed))
}

function inverseLerp(a: number, b: number, value: number): number {
    if (Math.abs(b - a) < 1e-6) return value >= b ? 1 : 0
    return clamp01((value - a) / (b - a))
}

function smooth01(t: number): number {
    const x = clamp01(t)
    return x * x * (3 - 2 * x)
}

function clamp01(value: number): number {
    if (value <= 0) return 0
    if (value >= 1) return 1
    return value
}
