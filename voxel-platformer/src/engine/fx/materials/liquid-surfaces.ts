import { AdditiveBlending, BufferAttribute, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three'
import type { TextureRegistryView } from '../core/types'

/**
 * Liquid surface meshes for water + lava zones. CPU-displaced plane
 * (the migration doc calls this a prototype-grade approach — a flow
 * map / normal-driven shader is the right production target).
 *
 * The mesh + overlay are returned as a pair so the emitter can animate
 * texture offsets and per-vertex displacement from a single update
 * call. Disposal is the caller's responsibility.
 */
export function buildWaterSurface(color: string, size: { x: number; z: number }, textures: TextureRegistryView): { surface: Mesh; overlay: Mesh; base: Float32Array } {
    const geo = new PlaneGeometry(1, 1, 36, 36)
    geo.rotateX(-Math.PI / 2)
    const positions = geo.attributes.position as import('three').BufferAttribute
    const base = new Float32Array(positions.array as Float32Array)
    const colorAttr = new Float32Array(positions.count * 3)
    geo.setAttribute('color', new BufferAttribute(colorAttr, 3))

    const mat = new MeshStandardMaterial({
        color: new Color(color),
        roughness: 0.12,
        metalness: 0.04,
        transparent: true,
        opacity: 0.76,
        emissive: new Color('#12385a'),
        emissiveIntensity: 0.16,
        vertexColors: true,
        side: DoubleSide,
    })
    const surface = new Mesh(geo, mat)
    surface.scale.set(size.x, 1, size.z)

    const overlayMat = new MeshBasicMaterial({
        map: textures.surface('caustics'),
        transparent: true,
        depthWrite: false,
        opacity: 0.28,
        blending: AdditiveBlending,
        side: DoubleSide,
    })
    overlayMat.map!.repeat.set(2.4, 2.4)
    const overlayGeo = new PlaneGeometry(1, 1)
    overlayGeo.rotateX(-Math.PI / 2)
    const overlay = new Mesh(overlayGeo, overlayMat)
    overlay.scale.set(size.x, 1, size.z)
    overlay.position.y = 0.06

    return { surface, overlay, base }
}

export function buildLavaSurface(color: string, size: { x: number; z: number }, textures: TextureRegistryView): { surface: Mesh; overlay: Mesh; base: Float32Array } {
    const geo = new PlaneGeometry(1, 1, 54, 54)
    geo.rotateX(-Math.PI / 2)
    const positions = geo.attributes.position as import('three').BufferAttribute
    const base = new Float32Array(positions.array as Float32Array)
    const colorAttr = new Float32Array(positions.count * 3)
    geo.setAttribute('color', new BufferAttribute(colorAttr, 3))

    const mat = new MeshStandardMaterial({
        map: textures.surface('lava'),
        color: new Color('#ffffff'),
        roughness: 0.58,
        metalness: 0.02,
        emissive: new Color(color),
        emissiveIntensity: 1.35,
        vertexColors: true,
        side: DoubleSide,
    })
    mat.map!.repeat.set(1.12, 1.12)
    const surface = new Mesh(geo, mat)
    surface.scale.set(size.x, 1, size.z)

    const overlayMat = new MeshBasicMaterial({
        map: textures.surface('lavaGlow'),
        transparent: true,
        depthWrite: false,
        opacity: 0.34,
        blending: AdditiveBlending,
        side: DoubleSide,
    })
    overlayMat.color.set(new Color('#ff8a2a'))
    overlayMat.map!.repeat.set(1.35, 1.35)
    const overlayGeo = new PlaneGeometry(1, 1)
    overlayGeo.rotateX(-Math.PI / 2)
    const overlay = new Mesh(overlayGeo, overlayMat)
    overlay.scale.set(size.x, 1, size.z)
    overlay.position.y = 0.08

    return { surface, overlay, base }
}

/**
 * Step the water plane vertices + caustics offset. `base` is the
 * cached rest-state positions allocated alongside the surface.
 */
export function animateWaterSurface(mesh: Mesh, base: Float32Array, overlay: Mesh | null, params: { speed: number; opacity: number; color: string }, elapsed: number): void {
    const geo = mesh.geometry as PlaneGeometry
    const positions = geo.attributes.position as import('three').BufferAttribute
    const arr = positions.array as Float32Array
    const colorArr = (geo.attributes.color as import('three').BufferAttribute).array as Float32Array
    for (let i = 0; i < positions.count; i++) {
        const i3 = i * 3
        const x = base[i3]!
        const z = base[i3 + 2]!
        const phase = base[i3]! * 0.7 + base[i3 + 2]! * 1.1
        const wave =
            Math.sin((x * 10.0) + elapsed * (1.7 + params.speed * 0.12) + phase) * 0.020 +
            Math.cos((z * 11.5) - elapsed * (1.35 + params.speed * 0.10) + phase * 1.7) * 0.016 +
            Math.sin((x + z) * 16.0 + elapsed * 2.4) * 0.010
        arr[i3 + 1] = wave
        const glow = 0.55 + 0.45 * Math.sin((x - z) * 18 + elapsed * 2.8 + phase)
        colorArr[i3]     = 0.18 + glow * 0.08
        colorArr[i3 + 1] = 0.44 + glow * 0.15
        colorArr[i3 + 2] = 0.68 + glow * 0.17
    }
    positions.needsUpdate = true
    ;(geo.attributes.color as import('three').BufferAttribute).needsUpdate = true
    geo.computeVertexNormals()
    ;(mesh.material as MeshStandardMaterial).opacity = params.opacity
    ;(mesh.material as MeshStandardMaterial).color.set(params.color)

    if (overlay) {
        const m = overlay.material as MeshBasicMaterial
        const tex = m.map!
        tex.offset.x = elapsed * 0.045 + Math.sin(elapsed * 0.25) * 0.03
        tex.offset.y = -elapsed * 0.034 + Math.cos(elapsed * 0.22) * 0.03
        m.opacity = 0.10 + Math.min(0.20, params.opacity * 0.18)
    }
}

export function animateLavaSurface(mesh: Mesh, base: Float32Array, overlay: Mesh | null, params: { speed: number; opacity: number; color: string }, elapsed: number): void {
    const geo = mesh.geometry as PlaneGeometry
    const positions = geo.attributes.position as import('three').BufferAttribute
    const arr = positions.array as Float32Array
    const colorArr = (geo.attributes.color as import('three').BufferAttribute).array as Float32Array
    for (let i = 0; i < positions.count; i++) {
        const i3 = i * 3
        const x = base[i3]!
        const z = base[i3 + 2]!
        const speed = 0.45 + params.speed * 0.32
        const flowX = x + Math.sin(elapsed * 0.18 + z * 2.4) * 0.10
        const flowZ = z + Math.cos(elapsed * 0.16 + x * 2.1) * 0.10
        const broad = lavaFbm(flowX * 2.15 + elapsed * 0.18 * speed, flowZ * 2.05 - elapsed * 0.14 * speed, 11)
        const detail = lavaFbm(flowX * 5.6 - elapsed * 0.36 * speed, flowZ * 5.1 + elapsed * 0.29 * speed, 29)
        const fine = lavaFbm(flowX * 10.5 + elapsed * 0.52 * speed, flowZ * 9.2 - elapsed * 0.44 * speed, 53)
        const heat = clamp01(
            smoothstep(0.42, 0.86, broad) * 0.50 +
            smoothstep(0.48, 0.90, detail) * 0.42 +
            smoothstep(0.54, 0.95, Math.abs(detail - broad) * 1.45 + fine * 0.36) * 0.50,
        )
        const crust = 1 - smoothstep(0.28, 0.76, heat)
        const bubble = smoothstep(0.62, 0.96, fine) * heat
        arr[i3 + 1] = heat * 0.060 + bubble * 0.017 +
            Math.sin((x * 4.2 + z * 3.6) + elapsed * 0.62 * speed) * 0.005

        const dark: [number, number, number] = [0.09, 0.035, 0.020]
        const molten: [number, number, number] = [0.82, 0.16, 0.035]
        const bright: [number, number, number] = [1.0, 0.64, 0.12]
        const midT = smoothstep(0.12, 0.72, heat)
        const hotT = smoothstep(0.68, 1.0, heat)
        const r = lerp(lerp(dark[0], molten[0], midT), bright[0], hotT)
        const g = lerp(lerp(dark[1], molten[1], midT), bright[1], hotT)
        const b = lerp(lerp(dark[2], molten[2], midT), bright[2], hotT)
        colorArr[i3] = r * (1 - crust * 0.18)
        colorArr[i3 + 1] = g * (1 - crust * 0.12)
        colorArr[i3 + 2] = b
    }
    positions.needsUpdate = true
    ;(geo.attributes.color as import('three').BufferAttribute).needsUpdate = true
    geo.computeVertexNormals()
    const mat = mesh.material as MeshStandardMaterial
    mat.emissive.set(params.color)
    mat.emissiveIntensity = 1.05 + Math.max(0, Math.sin(elapsed * 1.8)) * 0.38 + Math.max(0, Math.sin(elapsed * 4.9)) * 0.18
    if (mat.map) {
        mat.map.offset.x = elapsed * 0.012 + Math.sin(elapsed * 0.17) * 0.018
        mat.map.offset.y = -elapsed * 0.009 + Math.cos(elapsed * 0.13) * 0.016
    }

    if (overlay) {
        const m = overlay.material as MeshBasicMaterial
        const glowTex = m.map!
        glowTex.offset.x = -elapsed * 0.018 + Math.sin(elapsed * 0.21) * 0.014
        glowTex.offset.y = elapsed * 0.014 + Math.cos(elapsed * 0.19) * 0.012
        m.opacity = 0.13 + Math.max(0, Math.sin(elapsed * 1.7)) * 0.11
    }
}

function lavaFbm(x: number, z: number, seed: number): number {
    let value = 0
    let amp = 0.55
    let norm = 0
    for (let octave = 0; octave < 4; octave++) {
        value += gradientNoise(x, z, seed + octave * 97) * amp
        norm += amp
        x *= 2.02
        z *= 2.02
        amp *= 0.52
    }
    return value / Math.max(0.0001, norm)
}

function gradientNoise(x: number, z: number, seed: number): number {
    const x0 = Math.floor(x)
    const z0 = Math.floor(z)
    const x1 = x0 + 1
    const z1 = z0 + 1
    const sx = fade(x - x0)
    const sz = fade(z - z0)
    const n00 = gradDot(x0, z0, x, z, seed)
    const n10 = gradDot(x1, z0, x, z, seed)
    const n01 = gradDot(x0, z1, x, z, seed)
    const n11 = gradDot(x1, z1, x, z, seed)
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sz) * 0.5 + 0.5
}

function gradDot(ix: number, iz: number, x: number, z: number, seed: number): number {
    const h = hash2(ix, iz, seed)
    const angle = (h / 0xffffffff) * Math.PI * 2
    return Math.cos(angle) * (x - ix) + Math.sin(angle) * (z - iz)
}

function hash2(x: number, z: number, seed: number): number {
    let h = (x * 374761393 + z * 668265263 + seed * 1442695041) | 0
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return (h ^ (h >>> 16)) >>> 0
}

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = clamp01((x - edge0) / Math.max(0.0001, edge1 - edge0))
    return t * t * (3 - 2 * t)
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v))
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}
