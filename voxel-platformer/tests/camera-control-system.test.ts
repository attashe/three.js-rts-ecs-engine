import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { createCameraControlSystem } from '../src/engine/ecs/systems/camera-control-system'
import type { IsometricCamera } from '../src/engine/render/isometric-camera'
import type { Input } from '../src/engine/input/input'
import type { ActionMap } from '../src/engine/input/actions'

class FakeInput {
    wheel = 0

    getPointer(): null {
        return null
    }

    consumeWheel(): number {
        const out = this.wheel
        this.wheel = 0
        return out
    }
}

class FakeActions {
    isHeld(): boolean {
        return false
    }

    consumePressed(): null {
        return null
    }
}

function fakeIso(zoom: number): IsometricCamera {
    const iso = {
        camera: { zoom },
        target: new Vector3(),
        getViewMode: () => 'iso',
        rotateYaw() {},
        getPanRight(out: Vector3): Vector3 {
            return out.set(1, 0, 0)
        },
        getPanForward(out: Vector3): Vector3 {
            return out.set(0, 0, 1)
        },
        syncPosition() {},
        applyZoom(min = 0.25, max = 5) {
            this.camera.zoom = Math.max(min, Math.min(max, this.camera.zoom))
        },
    }
    return iso as unknown as IsometricCamera
}

test('camera control supports dynamic zoom-out limits', () => {
    let debugInfo = false
    const iso = fakeIso(0.2)
    const input = new FakeInput()
    const system = createCameraControlSystem(
        iso,
        input as unknown as Input,
        new FakeActions() as unknown as ActionMap,
        {
            keyboardPan: false,
            edgePan: false,
            wheelZoom: true,
            zoomMin: () => debugInfo ? 0.25 : 0.42,
        },
    )

    system.update?.({} as never, 1 / 60)

    assert.equal(iso.camera.zoom, 0.42)

    debugInfo = true
    input.wheel = 100
    system.update?.({} as never, 1 / 60)

    assert.ok(iso.camera.zoom < 0.42)
    assert.ok(iso.camera.zoom >= 0.25)
})
