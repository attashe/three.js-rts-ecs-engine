import {
    InstancedMesh,
    Line,
    LineSegments,
    Mesh,
    Object3D,
    Points,
    Sprite,
    type BufferGeometry,
    type Scene,
} from 'three'
import type { Renderer } from '../../render/renderer'
import { getDebugInfoEnabled, subscribeDebugInfo } from '../../render/render-settings'
import type { System } from './system'
import { RenderOrder } from './orders'

export interface RenderMetricsOptions {
    /** Cheap renderer.info sampling frequency. */
    updateHz?: number
    /** Full scene traversal frequency. Keep low in large levels. */
    sceneUpdateHz?: number
    /** Browser/renderer memory sampling frequency. */
    memoryUpdateHz?: number
}

export function createRenderMetricsSystem(renderer: Renderer, opts: RenderMetricsOptions = {}): System {
    const rendererUpdateDt = 1 / (opts.updateHz ?? 4)
    const sceneUpdateDt = 1 / (opts.sceneUpdateHz ?? 1)
    const memoryUpdateDt = 1 / (opts.memoryUpdateHz ?? 1)
    let rendererAccumulator = rendererUpdateDt
    let sceneAccumulator = sceneUpdateDt
    let memoryAccumulator = memoryUpdateDt
    let enabled = getDebugInfoEnabled()
    let unsubscribeDebug: (() => void) | null = null

    return {
        order: RenderOrder.debug - 5,
        init() {
            unsubscribeDebug = subscribeDebugInfo((next) => {
                enabled = next
                if (enabled) {
                    rendererAccumulator = rendererUpdateDt
                    sceneAccumulator = sceneUpdateDt
                    memoryAccumulator = memoryUpdateDt
                }
            })
        },
        update(world, dt) {
            if (!enabled) return

            rendererAccumulator += dt
            sceneAccumulator += dt
            memoryAccumulator += dt

            if (rendererAccumulator >= rendererUpdateDt) {
                rendererAccumulator %= rendererUpdateDt
                const info = rendererInfo(renderer)
                if (info?.render) {
                    const render = info.render
                    // WebGPU render.calls is cumulative; drawCalls is the
                    // per-frame value we want in the perf panel.
                    if (typeof render.drawCalls === 'number') world.metrics.setGauge('render.drawCalls', render.drawCalls)
                    if (typeof render.frameCalls === 'number') world.metrics.setGauge('render.frameCalls', render.frameCalls)
                    if (typeof render.calls === 'number') world.metrics.setGauge('render.totalCalls', render.calls)
                    if (typeof render.triangles === 'number') world.metrics.setGauge('render.infoTriangles', render.triangles)
                    if (typeof render.points === 'number') world.metrics.setGauge('render.points', render.points)
                    if (typeof render.lines === 'number') world.metrics.setGauge('render.infoLines', render.lines)
                }
            }

            if (sceneAccumulator >= sceneUpdateDt) {
                sceneAccumulator %= sceneUpdateDt
                const counts = collectSceneCounts(renderer.scene)
                world.metrics.setGauge('render.objects', counts.objects)
                world.metrics.setGauge('render.visible', counts.visibleObjects)
                world.metrics.setGauge('render.meshes', counts.meshes)
                world.metrics.setGauge('render.lines', counts.lines)
                world.metrics.setGauge('render.sprites', counts.sprites)
                world.metrics.setGauge('render.instanced', counts.instancedMeshes)
                world.metrics.setGauge('render.triangles', counts.triangles)
                world.metrics.setGauge('memory.sceneGeometryMB', bytesToMb(counts.geometryBytes))
            }

            if (memoryAccumulator >= memoryUpdateDt) {
                memoryAccumulator %= memoryUpdateDt
                const info = rendererInfo(renderer)
                if (info?.memory) {
                    const memory = info.memory
                    if (typeof memory.geometries === 'number') world.metrics.setGauge('memory.geometries', memory.geometries)
                    if (typeof memory.textures === 'number') world.metrics.setGauge('memory.textures', memory.textures)
                    if (typeof memory.total === 'number') world.metrics.setGauge('memory.gpuTotalMB', bytesToMb(memory.total))
                    if (typeof memory.texturesSize === 'number') world.metrics.setGauge('memory.gpuTexturesMB', bytesToMb(memory.texturesSize))
                    if (typeof memory.attributesSize === 'number') world.metrics.setGauge('memory.gpuAttributesMB', bytesToMb(memory.attributesSize))
                }
                const heap = jsHeapMemory()
                if (heap) {
                    world.metrics.setGauge('memory.jsHeapUsedMB', heap.usedMB)
                    if (typeof heap.totalMB === 'number') world.metrics.setGauge('memory.jsHeapTotalMB', heap.totalMB)
                    if (typeof heap.limitMB === 'number') world.metrics.setGauge('memory.jsHeapLimitMB', heap.limitMB)
                }
            }
        },
        dispose() {
            unsubscribeDebug?.()
            unsubscribeDebug = null
        },
    }
}

interface SceneCounts {
    objects: number
    visibleObjects: number
    meshes: number
    instancedMeshes: number
    lines: number
    sprites: number
    triangles: number
    geometryBytes: number
}

function collectSceneCounts(scene: Scene): SceneCounts {
    const counts: SceneCounts = {
        objects: 0,
        visibleObjects: 0,
        meshes: 0,
        instancedMeshes: 0,
        lines: 0,
        sprites: 0,
        triangles: 0,
        geometryBytes: 0,
    }
    const geometries = new Set<BufferGeometry>()
    scene.traverse((object) => {
        counts.objects++
        if (isWorldVisible(object)) counts.visibleObjects++
        if (object instanceof InstancedMesh) {
            counts.instancedMeshes++
            counts.meshes++
            counts.triangles += geometryTriangles(object) * object.count
            geometries.add(object.geometry)
        } else if (object instanceof Mesh) {
            counts.meshes++
            counts.triangles += geometryTriangles(object)
            geometries.add(object.geometry)
        } else if (object instanceof Line || object instanceof LineSegments || object instanceof Points) {
            counts.lines++
            geometries.add(object.geometry)
        } else if (object instanceof Sprite) {
            counts.sprites++
        }
    })
    for (const geometry of geometries) counts.geometryBytes += geometryByteSize(geometry)
    return counts
}

function isWorldVisible(object: Object3D): boolean {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (!current.visible) return false
    }
    return true
}

function geometryTriangles(mesh: Mesh): number {
    const geometry = mesh.geometry
    if (!geometry) return 0
    if (geometry.index) return Math.floor(geometry.index.count / 3)
    const position = geometry.getAttribute('position')
    return position ? Math.floor(position.count / 3) : 0
}

interface RendererInfoSnapshot {
    render?: {
        calls?: number
        frameCalls?: number
        drawCalls?: number
        triangles?: number
        points?: number
        lines?: number
    }
    memory?: {
        geometries?: number
        textures?: number
        total?: number
        texturesSize?: number
        attributesSize?: number
    }
}

function rendererInfo(renderer: Renderer): RendererInfoSnapshot | null {
    const info = (renderer.webgpu as unknown as { info?: unknown }).info
    if (!info || typeof info !== 'object') return null
    const renderInfo = (info as { render?: unknown }).render
    const memoryInfo = (info as { memory?: unknown }).memory
    return {
        render: typeof renderInfo === 'object' && renderInfo !== null
            ? renderInfo as RendererInfoSnapshot['render']
            : undefined,
        memory: typeof memoryInfo === 'object' && memoryInfo !== null
            ? memoryInfo as RendererInfoSnapshot['memory']
            : undefined,
    }
}

interface BrowserMemoryInfo {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
    jsHeapSizeLimit?: number
}

function jsHeapMemory(): { usedMB: number; totalMB?: number; limitMB?: number } | null {
    if (typeof performance === 'undefined') return null
    const memory = (performance as Performance & { memory?: BrowserMemoryInfo }).memory
    if (!memory || typeof memory.usedJSHeapSize !== 'number') return null
    const bytesToMb = 1 / (1024 * 1024)
    const heap: { usedMB: number; totalMB?: number; limitMB?: number } = {
        usedMB: memory.usedJSHeapSize * bytesToMb,
    }
    if (typeof memory.totalJSHeapSize === 'number') heap.totalMB = memory.totalJSHeapSize * bytesToMb
    if (typeof memory.jsHeapSizeLimit === 'number') heap.limitMB = memory.jsHeapSizeLimit * bytesToMb
    return heap
}

function geometryByteSize(geometry: BufferGeometry): number {
    let bytes = 0
    for (const name in geometry.attributes) {
        bytes += attributeByteSize(geometry.attributes[name])
    }
    if (geometry.index) bytes += attributeByteSize(geometry.index)
    return bytes
}

function attributeByteSize(attribute: unknown): number {
    const array = (attribute as { array?: { byteLength?: number } } | undefined)?.array
    return typeof array?.byteLength === 'number' ? array.byteLength : 0
}

function bytesToMb(bytes: number): number {
    return bytes / (1024 * 1024)
}
