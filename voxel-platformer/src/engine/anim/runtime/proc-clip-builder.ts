// Build THREE.AnimationClips from declarative track data.
//
// Used by the code reference rig (and any future procedural NPC clips). Tracks
// address target nodes by `name` via the standard three property path
// "<NodeName>.<property>", which the mixer's PropertyBinding resolves against the
// animated root's descendants.

import {
    AnimationClip,
    Euler,
    Quaternion,
    QuaternionKeyframeTrack,
    VectorKeyframeTrack,
    type KeyframeTrack,
} from 'three'

export type TrackProperty = 'position' | 'quaternion' | 'scale'

export interface ProcTrackDef {
    /** Target node name (bone or mesh). */
    target: string
    property: TrackProperty
    times: number[]
    /** Flattened values: 3/key for position|scale, 4/key for quaternion. */
    values: number[]
}

export interface ProcClipDef {
    name: string
    duration: number
    tracks: ProcTrackDef[]
}

export function buildProcClip(def: ProcClipDef): AnimationClip {
    const tracks: KeyframeTrack[] = def.tracks.map((t) => {
        const path = `${t.target}.${t.property}`
        return t.property === 'quaternion'
            ? new QuaternionKeyframeTrack(path, t.times, t.values)
            : new VectorKeyframeTrack(path, t.times, t.values)
    })
    return new AnimationClip(def.name, def.duration, tracks)
}

/** Convenience: a quaternion track authored as Euler (XYZ radians) keyframes. */
export function eulerQuatTrack(
    target: string,
    keys: Array<{ t: number; e: [number, number, number] }>,
): ProcTrackDef {
    const q = new Quaternion()
    const e = new Euler()
    const times: number[] = []
    const values: number[] = []
    for (const k of keys) {
        e.set(k.e[0], k.e[1], k.e[2], 'XYZ')
        q.setFromEuler(e)
        times.push(k.t)
        values.push(q.x, q.y, q.z, q.w)
    }
    return { target, property: 'quaternion', times, values }
}

/** Convenience: a position track authored as XYZ keyframes. */
export function vec3Track(
    target: string,
    property: 'position' | 'scale',
    keys: Array<{ t: number; v: [number, number, number] }>,
): ProcTrackDef {
    const times: number[] = []
    const values: number[] = []
    for (const k of keys) {
        times.push(k.t)
        values.push(k.v[0], k.v[1], k.v[2])
    }
    return { target, property, times, values }
}
