import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REQUIRED_CLIP_IDS, SOCKET_NAMES } from '../src/engine/anim/core'

// Parse the GLB container's JSON chunk without three, so this conformance guard
// runs in the headless test build. Catches a bad regeneration of the Blender
// reference character (tools/build-reference-character.py) before it ships.
function readGlbJson(path: string): Record<string, unknown> {
    const buf = readFileSync(path)
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic "glTF"')
    assert.equal(view.getUint32(4, true), 2, 'glTF version 2')
    const chunkLength = view.getUint32(12, true)
    const chunkType = view.getUint32(16, true)
    assert.equal(chunkType, 0x4e4f534a, 'first chunk is JSON')
    const json = new TextDecoder().decode(buf.subarray(20, 20 + chunkLength))
    return JSON.parse(json)
}

test('the Blender reference character conforms to the animation convention', () => {
    const gltf = readGlbJson(resolve(process.cwd(), 'public/models/reference-character.glb'))

    // Skinned mesh present.
    assert.ok(Array.isArray(gltf.skins) && gltf.skins.length >= 1, 'has a skin')
    assert.ok(Array.isArray(gltf.meshes) && gltf.meshes.length >= 1, 'has a mesh')

    // All required clips, by exact name.
    const animations = (gltf.animations as Array<{ name?: string }>).map((a) => a.name)
    for (const id of REQUIRED_CLIP_IDS) assert.ok(animations.includes(id), `clip "${id}" present`)

    // All canonical sockets, by exact (underscore) name — these must survive
    // three's glTF name sanitisation so the engine can resolve them.
    const nodeNames = new Set((gltf.nodes as Array<{ name?: string }>).map((n) => n.name))
    for (const socket of SOCKET_NAMES) assert.ok(nodeNames.has(socket), `socket "${socket}" present`)
})
