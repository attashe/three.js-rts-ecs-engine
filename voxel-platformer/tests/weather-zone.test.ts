import test from 'node:test'
import assert from 'node:assert/strict'
import { InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Scene } from 'three'
import { WeatherZone } from '../src/engine/fx/core/weather-zone'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../src/engine/fx/core/types'
import { applyZonePreset } from '../src/engine/fx/presets/zone-presets'

test('WeatherZone writes seeded instances during init before shader warmup can reveal the mesh', () => {
    const scene = new Scene()
    const strategy = new RecordingEmitter()
    const zone = new WeatherZone(applyZonePreset('leaves', {
        id: 'test.leaves',
        name: 'Test Leaves',
        position: { x: 3, y: 4, z: 5 },
        count: 2,
    }))

    zone.init(strategy, fakeDeps(), scene)

    assert.equal(strategy.spawnCount, 2)
    assert.equal(strategy.updateCount, 0)
    assert.equal(strategy.writeCount, 1)
    assert.deepEqual(strategy.lastZonePosition, { x: 3, y: 4, z: 5 })
    const matrix = new Matrix4()
    zone.runtime.primary?.getMatrixAt(0, matrix)
    assert.equal(matrix.elements[12], 1)
    assert.equal(matrix.elements[13], 2)
    assert.equal(matrix.elements[14], 3)
    assert.equal(scene.children.includes(zone.group), true)
})

class RecordingEmitter implements EmitterStrategy {
    readonly type = 'leaves' as const
    spawnCount = 0
    updateCount = 0
    writeCount = 0
    lastZonePosition: { x: number; y: number; z: number } | null = null

    create(runtime: WeatherZoneRuntime, _deps: EmitterDeps): EmitterCreated {
        runtime.particles.count = runtime.params.count
        const mesh = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial(), runtime.params.count)
        return { primary: mesh, extras: [] }
    }

    spawn(runtime: WeatherZoneRuntime, i: number): void {
        const p3 = i * 3
        runtime.particles.positions[p3] = i + 1
        runtime.particles.positions[p3 + 1] = i + 2
        runtime.particles.positions[p3 + 2] = i + 3
        runtime.particles.sizes[i] = 1
        this.spawnCount += 1
    }

    update(): void {
        this.updateCount += 1
    }

    write(runtime: WeatherZoneRuntime, _elapsed: number, ctx: WriteContext): void {
        this.writeCount += 1
        this.lastZonePosition = { x: ctx.zonePosition.x, y: ctx.zonePosition.y, z: ctx.zonePosition.z }
        const primary = runtime.primary
        if (!primary) return
        for (let i = 0; i < runtime.particles.count; i += 1) {
            const p3 = i * 3
            ctx.dummy.position.set(
                runtime.particles.positions[p3]!,
                runtime.particles.positions[p3 + 1]!,
                runtime.particles.positions[p3 + 2]!,
            )
            ctx.dummy.scale.setScalar(1)
            ctx.dummy.updateMatrix()
            primary.setMatrixAt(i, ctx.dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
    }

    dispose(): void {}
}

function fakeDeps(): EmitterDeps {
    return {
        textures: null as never,
        materials: {
            release() {},
        } as never,
    }
}
