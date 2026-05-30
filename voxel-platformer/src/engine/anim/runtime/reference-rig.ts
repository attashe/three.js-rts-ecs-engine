// Code-built reference rig: a true skinned humanoid that conforms exactly to the
// Blender convention (clip ids, socket bone names, +Y up, feet at origin, ~1.6
// tall). It is the default character clip source until a real `.glb` exists, and
// the canonical spec the Blender model must match — a conforming export drops in
// via the same ClipSource interface with no code change.
//
// It is a genuine SkinnedMesh (rigid weights, one bone per vertex) so it also
// validates the SkinnedMesh + AnimationMixer path under WebGPU end-to-end.

import {
    type AnimationClip,
    Bone,
    BoxGeometry,
    type BufferGeometry,
    Float32BufferAttribute,
    Group,
    MeshStandardMaterial,
    Skeleton,
    SkinnedMesh,
    Uint16BufferAttribute,
    type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SOCKET_ID } from '../core/convention'
import type { ClipSet, ClipSource } from './clip-source'
import { resolveSockets } from './sockets'
import { buildProcClip, eulerQuatTrack } from './proc-clip-builder'

// Bone index order — MUST match the skinIndex values written into the parts.
const BONE = { hips: 0, spine: 1, head: 2, armR: 3, armL: 4, legR: 5, legL: 6 } as const

export interface ReferenceRigOptions {
    bodyColor?: number
}

export function referenceRigSource(opts: ReferenceRigOptions = {}): ClipSource {
    return {
        kind: 'reference',
        instantiate(): ClipSet {
            const root = buildRigRoot(opts)
            return {
                root,
                clips: buildClips(),
                sockets: resolveSockets(root),
            }
        },
    }
}

function buildRigRoot(opts: ReferenceRigOptions): Object3D {
    const body = opts.bodyColor ?? 0x3f6f9f

    // Skinned geometry — each part rigidly weighted to one bone. Part positions
    // are in rest (mesh-local) space; bones sit at the joints so rotations pivot
    // correctly (arms from the shoulder, legs from the hip, head at the neck).
    const parts: BufferGeometry[] = [
        part(0.34, 0.24, 0.22, 0, 0.82, 0, BONE.hips),
        part(0.42, 0.50, 0.24, 0, 1.15, 0, BONE.spine),
        part(0.32, 0.32, 0.30, 0, 1.55, 0, BONE.head),
        part(0.13, 0.50, 0.15, -0.30, 1.05, 0, BONE.armR),
        part(0.13, 0.50, 0.15, 0.30, 1.05, 0, BONE.armL),
        part(0.15, 0.70, 0.18, -0.10, 0.34, 0, BONE.legR),
        part(0.15, 0.70, 0.18, 0.10, 0.34, 0, BONE.legL),
    ]
    const geometry = mergeGeometries(parts, false)
    if (!geometry) throw new Error('reference rig: geometry merge failed')
    for (const p of parts) p.dispose()

    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0.0, color: body })
    const mesh = new SkinnedMesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false // small animated body; avoid skinned-bounds culling surprises

    // Bone hierarchy (positions are relative to the parent bone).
    const hips = bone('hips', 0, 0.82, 0)
    const spine = bone('spine', 0, 0.30, 0); hips.add(spine)
    const head3d = bone('head', 0, 0.38, 0); spine.add(head3d)
    const armR = bone('upperArmR', -0.27, 0.16, 0); spine.add(armR)
    const armL = bone('upperArmL', 0.27, 0.16, 0); spine.add(armL)
    const legR = bone('thighR', -0.10, -0.14, 0); hips.add(legR)
    const legL = bone('thighL', 0.10, -0.14, 0); hips.add(legL)

    // Equipment sockets — Bones parented to animated joints so attached gear
    // inherits the animation. Not part of the skinning skeleton (no weights).
    head3d.add(socket(SOCKET_ID.head, 0, 0.20, 0))
    armR.add(socket(SOCKET_ID.handR, 0, -0.50, 0))
    armL.add(socket(SOCKET_ID.handL, 0, -0.50, 0))
    spine.add(socket(SOCKET_ID.back, 0, 0.10, -0.16))

    mesh.add(hips)
    mesh.updateMatrixWorld(true) // so the Skeleton computes correct bind inverses
    const skeleton = new Skeleton([hips, spine, head3d, armR, armL, legR, legL])
    mesh.bind(skeleton)

    const root = new Group()
    root.add(mesh)
    return root
}

function part(w: number, h: number, d: number, cx: number, cy: number, cz: number, boneIndex: number): BufferGeometry {
    const g = new BoxGeometry(w, h, d)
    g.translate(cx, cy, cz)
    const count = g.attributes.position!.count
    const si = new Uint16Array(count * 4)
    const sw = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
        si[i * 4] = boneIndex
        sw[i * 4] = 1
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4))
    return g
}

function bone(name: string, x: number, y: number, z: number): Bone {
    const b = new Bone()
    b.name = name
    b.position.set(x, y, z)
    return b
}

function socket(name: string, x: number, y: number, z: number): Bone {
    return bone(name, x, y, z)
}

// ── Authored clips (ids == REQUIRED_CLIP_IDS) ───────────────────────────────

function buildClips(): Map<string, AnimationClip> {
    const m = new Map<string, AnimationClip>()
    m.set('idle', buildProcClip({
        name: 'idle', duration: 2.0, tracks: [
            eulerQuatTrack('spine', [{ t: 0, e: [0, 0, 0] }, { t: 1, e: [0.035, 0, 0] }, { t: 2, e: [0, 0, 0] }]),
            eulerQuatTrack('upperArmR', [{ t: 0, e: [0, 0, -0.04] }, { t: 1, e: [0, 0, -0.08] }, { t: 2, e: [0, 0, -0.04] }]),
            eulerQuatTrack('upperArmL', [{ t: 0, e: [0, 0, 0.04] }, { t: 1, e: [0, 0, 0.08] }, { t: 2, e: [0, 0, 0.04] }]),
        ],
    }))
    m.set('walk', limbCycle('walk', 0.8, 0.45, 0.0))
    m.set('run', limbCycle('run', 0.55, 0.85, 0.20))
    m.set('jump', buildProcClip({
        name: 'jump', duration: 0.4, tracks: [
            eulerQuatTrack('spine', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [-0.15, 0, 0] }]),
            eulerQuatTrack('upperArmR', [{ t: 0, e: [0, 0, -0.1] }, { t: 0.25, e: [-2.2, 0, -0.2] }]),
            eulerQuatTrack('upperArmL', [{ t: 0, e: [0, 0, 0.1] }, { t: 0.25, e: [-2.2, 0, 0.2] }]),
            eulerQuatTrack('thighR', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [0.7, 0, 0] }]),
            eulerQuatTrack('thighL', [{ t: 0, e: [0, 0, 0] }, { t: 0.25, e: [0.5, 0, 0] }]),
        ],
    }))
    m.set('fall', buildProcClip({
        name: 'fall', duration: 0.7, tracks: [
            eulerQuatTrack('upperArmR', [{ t: 0, e: [-1.4, 0, -0.5] }, { t: 0.35, e: [-1.6, 0, -0.7] }, { t: 0.7, e: [-1.4, 0, -0.5] }]),
            eulerQuatTrack('upperArmL', [{ t: 0, e: [-1.4, 0, 0.5] }, { t: 0.35, e: [-1.6, 0, 0.7] }, { t: 0.7, e: [-1.4, 0, 0.5] }]),
            eulerQuatTrack('thighR', [{ t: 0, e: [-0.25, 0, -0.1] }, { t: 0.35, e: [0.1, 0, -0.1] }, { t: 0.7, e: [-0.25, 0, -0.1] }]),
            eulerQuatTrack('thighL', [{ t: 0, e: [0.1, 0, 0.1] }, { t: 0.35, e: [-0.25, 0, 0.1] }, { t: 0.7, e: [0.1, 0, 0.1] }]),
        ],
    }))
    m.set('land', buildProcClip({
        name: 'land', duration: 0.3, tracks: [
            eulerQuatTrack('spine', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.28, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
            eulerQuatTrack('thighR', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.7, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
            eulerQuatTrack('thighL', [{ t: 0, e: [0, 0, 0] }, { t: 0.12, e: [0.7, 0, 0] }, { t: 0.3, e: [0, 0, 0] }]),
        ],
    }))
    return m
}

/** Symmetric arm/leg swing cycle: arms counter-swing the same-side leg. */
function limbCycle(name: string, duration: number, amp: number, lean: number): AnimationClip {
    const half = duration / 2
    const swing = (sign: number) => [
        { t: 0, e: [sign * amp, 0, 0] as [number, number, number] },
        { t: half, e: [-sign * amp, 0, 0] as [number, number, number] },
        { t: duration, e: [sign * amp, 0, 0] as [number, number, number] },
    ]
    return buildProcClip({
        name, duration, tracks: [
            eulerQuatTrack('spine', [{ t: 0, e: [lean, 0, 0] }, { t: duration, e: [lean, 0, 0] }]),
            eulerQuatTrack('thighR', swing(1)),
            eulerQuatTrack('thighL', swing(-1)),
            eulerQuatTrack('upperArmR', swing(-1)),
            eulerQuatTrack('upperArmL', swing(1)),
        ],
    })
}
