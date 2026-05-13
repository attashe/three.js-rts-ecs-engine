import {
    InstancedMesh,
    Line,
    LineSegments,
    Mesh,
    Object3D,
    Points,
    Sprite,
    type Scene,
} from 'three'
import type { Renderer } from '../../render/renderer'
import type { System } from './system'
import { RenderOrder } from './orders'

export interface RenderMetricsOptions {
    updateHz?: number
}

export function createRenderMetricsSystem(renderer: Renderer, opts: RenderMetricsOptions = {}): System {
    const updateDt = 1 / (opts.updateHz ?? 2)
    let accumulator = updateDt

    return {
        order: RenderOrder.debug - 5,
        update(world, dt) {
            accumulator += dt
            if (accumulator < updateDt) return
            accumulator %= updateDt

            const counts = collectSceneCounts(renderer.scene)
            world.metrics.setGauge('render.objects', counts.objects)
            world.metrics.setGauge('render.visible', counts.visibleObjects)
            world.metrics.setGauge('render.meshes', counts.meshes)
            world.metrics.setGauge('render.lines', counts.lines)
            world.metrics.setGauge('render.sprites', counts.sprites)
            world.metrics.setGauge('render.instanced', counts.instancedMeshes)
            world.metrics.setGauge('render.triangles', counts.triangles)

            const info = rendererInfo(renderer)
            if (info) {
                if (typeof info.calls === 'number') world.metrics.setGauge('render.calls', info.calls)
                if (typeof info.triangles === 'number') world.metrics.setGauge('render.infoTriangles', info.triangles)
                if (typeof info.points === 'number') world.metrics.setGauge('render.points', info.points)
                if (typeof info.lines === 'number') world.metrics.setGauge('render.infoLines', info.lines)
            }
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
    }
    scene.traverse((object) => {
        counts.objects++
        if (isWorldVisible(object)) counts.visibleObjects++
        if (object instanceof InstancedMesh) {
            counts.instancedMeshes++
            counts.meshes++
            counts.triangles += geometryTriangles(object) * object.count
        } else if (object instanceof Mesh) {
            counts.meshes++
            counts.triangles += geometryTriangles(object)
        } else if (object instanceof Line || object instanceof LineSegments || object instanceof Points) {
            counts.lines++
        } else if (object instanceof Sprite) {
            counts.sprites++
        }
    })
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

function rendererInfo(renderer: Renderer): { calls?: number; triangles?: number; points?: number; lines?: number } | null {
    const info = (renderer.webgpu as unknown as { info?: { render?: unknown } }).info
    if (!info || typeof info.render !== 'object' || info.render === null) return null
    return info.render as { calls?: number; triangles?: number; points?: number; lines?: number }
}
