import test from 'node:test'
import assert from 'node:assert/strict'
import { MeshBasicMaterial, Texture } from 'three'
import { MaterialRegistry } from '../src/engine/fx/materials/material-registry'

test('local FX particle materials ignore depth by default for iso readability', () => {
    const registry = new MaterialRegistry()
    const material = registry.particleMaterial({
        texture: new Texture(),
        color: '#ffffff',
        opacity: 0.75,
    }) as MeshBasicMaterial

    assert.equal(material.depthTest, false)
    assert.equal(material.depthWrite, false)

    registry.release(material)
})

test('particle material cache separates depth-tested and overlay variants', () => {
    const registry = new MaterialRegistry()
    const texture = new Texture()

    const overlay = registry.particleMaterial({
        texture,
        color: '#ffffff',
        opacity: 1,
        depthTest: false,
    }) as MeshBasicMaterial
    const occluded = registry.particleMaterial({
        texture,
        color: '#ffffff',
        opacity: 1,
        depthTest: true,
    }) as MeshBasicMaterial

    assert.notEqual(overlay, occluded)
    assert.equal(overlay.depthTest, false)
    assert.equal(occluded.depthTest, true)

    registry.release(overlay)
    registry.release(occluded)
})
