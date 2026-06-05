import test from 'node:test'
import assert from 'node:assert/strict'
import { LightBudget } from '../src/engine/fx/lights/light-budget'

function makeLight(x: number, y: number, z: number, wanted: number) {
    return {
        position: { x, y, z },
        intensity: wanted,
        userData: { wanted } as Record<string, unknown>,
        getWorldPosition(out: { x: number; y: number; z: number }) {
            out.x = x
            out.y = y
            out.z = z
            return out
        },
    } as unknown as import('three').PointLight
}

test('LightBudget keeps the closest N lights at full intensity', () => {
    const budget = new LightBudget(2)
    const lights = [
        makeLight(0, 0, 0, 10),
        makeLight(5, 0, 0, 10),
        makeLight(30, 0, 0, 10),
        makeLight(100, 0, 0, 10),
    ]
    const camera = { position: { x: 0, y: 0, z: 0 } } as unknown as import('three').Camera
    budget.apply(lights, camera)
    assert.equal(lights[0]!.intensity, 10, 'closest light stays lit')
    assert.equal(lights[1]!.intensity, 10, 'second-closest light stays lit')
    assert.ok(lights[2]!.intensity < 10, 'third light dimmed')
    assert.ok(lights[3]!.intensity <= 0, 'farthest light fully off')
})

test('LightBudget restores intensity when a light comes back into budget', () => {
    const budget = new LightBudget(1)
    const a = makeLight(0, 0, 0, 4)
    const b = makeLight(50, 0, 0, 4)
    const camera = { position: { x: 0, y: 0, z: 0 } } as unknown as import('three').Camera
    budget.apply([a, b], camera)
    assert.equal(a.intensity, 4)
    assert.ok(b.intensity <= 0)
    // Walk the camera over to `b`.
    ;(camera.position as { x: number }).x = 100
    budget.apply([a, b], camera)
    assert.equal(b.intensity, 4, 'newly-closest light comes back to full')
})
