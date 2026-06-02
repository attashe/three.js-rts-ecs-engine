import test from 'node:test'
import assert from 'node:assert/strict'
import { InstancedMesh, Scene } from 'three'
import { createPropRenderSystem } from '../src/game/props/prop-system'
import { createGameWorld } from '../src/engine/ecs/world'
import type { EditorProp } from '../src/game/props/prop-types'

function prop(id: string, x: number): EditorProp {
    return {
        id,
        kind: 'bush',
        position: { x, y: 1, z: 0 },
        yaw: 0,
        scale: 1,
        gridAligned: false,
    }
}

test('prop renderer grows instanced bucket capacity instead of dropping dense scatter results', () => {
    const scene = new Scene()
    const props: EditorProp[] = [prop('p1', 1), prop('p2', 2), prop('p3', 3)]
    const system = createPropRenderSystem(scene, {
        getProps: () => props,
        maxInstancesPerKind: 1,
    })

    system.init?.(createGameWorld())
    let mesh = scene.children.find((child) => child.name === 'Props:bush') as InstancedMesh | undefined
    assert.ok(mesh, 'bush bucket should be present')
    assert.equal(mesh!.count, 3)

    props.push(prop('p4', 4), prop('p5', 5))
    system.update(createGameWorld(), 0)
    mesh = scene.children.find((child) => child.name === 'Props:bush') as InstancedMesh | undefined
    assert.ok(mesh, 'grown bush bucket should still be present')
    assert.equal(mesh!.count, 5)

    system.dispose?.()
})

test('prop renderer removes authored props while visible is false', () => {
    const scene = new Scene()
    const props: EditorProp[] = [prop('p1', 1), { ...prop('p2', 2), visible: false }]
    const world = createGameWorld()
    const system = createPropRenderSystem(scene, {
        getProps: () => props,
    })

    system.init?.(world)
    let mesh = scene.children.find((child) => child.name === 'Props:bush') as InstancedMesh | undefined
    assert.ok(mesh)
    assert.equal(mesh!.count, 1)

    props[1]!.visible = true
    system.update(world, 0)
    mesh = scene.children.find((child) => child.name === 'Props:bush') as InstancedMesh | undefined
    assert.ok(mesh)
    assert.equal(mesh!.count, 2)

    props[0]!.visible = false
    system.update(world, 0)
    assert.equal(mesh!.count, 1)

    system.dispose?.()
})
