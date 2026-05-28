import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, PointLight, Scene } from 'three'
import { createGameWorld } from '../src/engine/ecs/world'
import { createBlockLightSystem, selectNearestSources, type BlockLightSource } from '../src/engine/voxel/block-light-system'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'

test('block light system caps scene PointLights to the configured budget', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 12; x++) {
        chunks.setVoxel(x, 1, 0, BLOCK.glow)
    }
    const scene = new Scene()
    const camera = new PerspectiveCamera()
    const system = createBlockLightSystem(chunks, {
        scene,
        camera: () => camera,
        maxLights: 3,
    })

    const world = createGameWorld()
    system.init?.(world)
    system.update(world, 1 / 60)

    const lights = scene.children.filter((child): child is PointLight => child instanceof PointLight)
    assert.equal(lights.length, 3)
    assert.equal(lights.filter((light) => light.visible && light.intensity > 0).length, 3)

    camera.position.set(100, 0, 0)
    system.update(world, 1 / 60)
    assert.deepEqual(
        scene.children.filter((child): child is PointLight => child instanceof PointLight),
        lights,
        'camera movement should reuse the fixed light pool',
    )

    system.dispose?.()
    assert.equal(scene.children.some((child) => child instanceof PointLight), false)
})

test('selectNearestSources picks the nearest candidates deterministically', () => {
    const spec = { color: [1, 1, 1] as [number, number, number], intensity: 1, distance: 8, castShadow: false }
    const sources: BlockLightSource[] = [
        { key: 'far', chunkKey: '0,0,0', x: 10, y: 0, z: 0, spec },
        { key: 'near', chunkKey: '0,0,0', x: 1, y: 0, z: 0, spec },
        { key: 'mid', chunkKey: '0,0,0', x: 4, y: 0, z: 0, spec },
    ]
    const camera = new PerspectiveCamera()

    assert.deepEqual(
        selectNearestSources(sources, camera, 2).map((source) => source.key),
        ['near', 'mid'],
    )
})
