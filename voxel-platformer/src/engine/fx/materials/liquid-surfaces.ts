import { Color, DoubleSide, Mesh, PlaneGeometry, Vector3, type BufferGeometry } from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
    Fn,
    cameraPosition,
    cross,
    float,
    mix,
    mx_fractal_noise_float,
    mx_noise_float,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    reflect,
    saturate,
    sin,
    smoothstep,
    time,
    uniform,
    vec2,
    vec3,
} from 'three/tsl'

const LOCAL_FX_SURFACE_RENDER_ORDER = 840

/**
 * Production-grade liquid surface materials, driven entirely by the
 * GPU via TSL nodes — zero per-frame CPU work, zero per-frame
 * allocations, and no overlay quad.
 *
 * Each builder returns:
 *   - `mesh`     : a `Mesh` ready to be added to a scene group;
 *   - `setColors`/`setOpacity` : runtime tweakers that mutate uniforms;
 *   - `dispose`  : free GPU resources owned by the material.
 *
 * The shader reads three.js's global `time` uniform, so no caller
 * needs to feed it a clock. Multiple instances share the same time —
 * they all phase together, which keeps a body of water reading as a
 * single fluid even across many zones.
 */

export interface LiquidSurfaceBase {
    mesh: Mesh
    setOpacity(o: number): void
    setSize(x: number, z: number): void
    dispose(): void
}

export interface WaterSurface extends LiquidSurfaceBase {
    setColors(opts: { deep?: string; shallow?: string; foam?: string }): void
}

export interface LavaSurface extends LiquidSurfaceBase {
    setColors(opts: { crust?: string; hot?: string; glow?: string }): void
}

export interface WaterSurfaceOpts {
    size: { x: number; z: number }
    /** Optional custom geometry. When omitted a scaled plane is built. */
    geometry?: BufferGeometry
    /** Bottom-of-wave tint — dominates troughs. */
    deepColor?: string
    /** Top-of-wave tint — dominates crests and grazing-angle highlights. */
    shallowColor?: string
    /** Wash colour at foamy crests. */
    foamColor?: string
    sunDirection?: Vector3
    /** Peak wave height in local units. Default 0.16 — visible. */
    waveAmplitude?: number
    /** Animation rate multiplier. Default 1.0. */
    waveSpeed?: number
    opacity?: number
    /** FX zones default to false so iso overlays stay readable; voxel-bound
     *  liquid surfaces pass true so terrain can occlude them normally. */
    depthTest?: boolean
    renderOrder?: number
}

/**
 * Stylised "video-game water" surface. Unlit on purpose — we don't
 * try to compete with real PBR water (which needs reflections and an
 * environment map). Instead we lean into the look that reads as water
 * from any angle:
 *
 *   - Four overlapping sin-wave trains drive both displacement and
 *     analytic-difference normals. Wavelengths are deliberately
 *     non-commensurate so the surface never resolves into a grid.
 *   - The base colour is a *vertical gradient* keyed to wave height,
 *     not a fresnel mix. Troughs are dark and saturated, crests are
 *     bright and pastel — the eye reads the gradient as depth and
 *     the displacement as motion.
 *   - Two scrolling FBM noise fields paint moving bright patches on
 *     top, evoking light scatter / underwater caustics without ever
 *     being a real reflection.
 *   - Foam appears at the highest crests as an additive white wash
 *     so the wave shape is visible even at glancing angles.
 *   - A single sharp specular highlight tracks the sun direction.
 *   - A soft fresnel adds a hint of shallow tint at grazing angles.
 *
 * All composited into `colorNode`. We bypass PBR entirely
 * (`MeshBasicNodeMaterial`) so the look doesn't depend on the
 * surrounding lighting rig.
 */
export function buildWaterSurface(opts: WaterSurfaceOpts): WaterSurface {
    const deepColor = uniform(new Color(opts.deepColor ?? '#08283f'))
    const shallowColor = uniform(new Color(opts.shallowColor ?? '#7ddbf2'))
    const foamColor = uniform(new Color(opts.foamColor ?? '#f4faff'))
    const opacityUniform = uniform(opts.opacity ?? 0.88)
    const amplitude = uniform(opts.waveAmplitude ?? 0.16)
    const speed = uniform(opts.waveSpeed ?? 1.0)
    const sunDir = uniform(
        opts.sunDirection
            ? opts.sunDirection.clone().normalize()
            : new Vector3(0.35, 0.75, 0.4).normalize(),
    )

    const tScaled = time.mul(speed)

    // Four wave trains with prime-ish directions + wavelengths so the
    // sum never tiles visibly. Coefficients chosen so the *summed*
    // wave envelope stays in roughly [-1, 1] before the amplitude
    // multiplier — which keeps the colour-from-height remap stable.
    const wavefn = Fn(([p, t]: [any, any]) => {
        const w1 = p.dot(vec2(0.93, 0.36).mul(1.8)).add(t.mul(1.45)).sin().mul(0.40)
        const w2 = p.dot(vec2(-0.52, 0.85).mul(2.6)).add(t.mul(1.15)).sin().mul(0.28)
        const w3 = p.dot(vec2(0.71, -0.71).mul(3.9)).add(t.mul(1.85)).sin().mul(0.18)
        const w4 = p.dot(vec2(-0.85, -0.52).mul(5.7)).add(t.mul(2.35)).sin().mul(0.12)
        return w1.add(w2).add(w3).add(w4)
    })

    const localXZ = vec2(positionLocal.x, positionLocal.z)
    const waveRaw = wavefn(localXZ, tScaled)
    const h = waveRaw.mul(amplitude)
    const newPos = vec3(positionLocal.x, h, positionLocal.z)

    // Analytic-style normal via central difference on the wave field.
    // We use a small eps relative to the wave wavelengths so the
    // surface tangents are well-conditioned.
    const eps = float(0.03)
    const hL = wavefn(localXZ.sub(vec2(eps, 0)), tScaled).mul(amplitude)
    const hR = wavefn(localXZ.add(vec2(eps, 0)), tScaled).mul(amplitude)
    const hD = wavefn(localXZ.sub(vec2(0, eps)), tScaled).mul(amplitude)
    const hU = wavefn(localXZ.add(vec2(0, eps)), tScaled).mul(amplitude)
    const tangentX = vec3(eps.mul(2), hR.sub(hL), float(0))
    const tangentZ = vec3(float(0), hU.sub(hD), eps.mul(2))
    const n = normalize(cross(tangentZ, tangentX))

    // View direction for fresnel + sun glint.
    const view = normalize(cameraPosition.sub(positionWorld))
    const ndotv = saturate(view.dot(n))
    const fresnel = pow(float(1).sub(ndotv), 4)  // softer than ^5

    // Wave-height remap to [0, 1] so we can drive a colour gradient.
    // `waveRaw` sums to roughly [-1, 1]; the .add(1).mul(0.5) hits [0, 1].
    const heightT = saturate(waveRaw.add(1).mul(0.5))

    // Caustic-style scrolling bright patches. Two scales for richness.
    const cau1 = mx_fractal_noise_float(vec3(localXZ.x, localXZ.y, time.mul(0.4)).mul(2.4), 3, 2.0, 0.5, 1.0)
    const cau2 = mx_fractal_noise_float(vec3(localXZ.x, localXZ.y, time.mul(-0.25)).mul(5.1), 3, 2.0, 0.5, 1.0)
    // Sharpen the patches into bright highlights with a smoothstep.
    const caustics = smoothstep(float(0.35), float(0.85), cau1.add(cau2).mul(0.5).add(0.5))
        .mul(0.45)

    // Foam at crests. The crest is anything in the top ~30 % of the
    // height range. Wide smoothstep keeps the edge soft.
    const foamMask = smoothstep(float(0.68), float(0.92), heightT)

    // Sun glint. Sharp but not pinpoint — moderate exponent gives a
    // streak you can actually see when the camera moves.
    const reflected = reflect(view.negate(), n)
    const sunDot = saturate(reflected.dot(sunDir))
    const glint = pow(sunDot, 48).mul(0.85)

    // Composition order:
    //   1. base height gradient (deep ↔ shallow)
    //   2. mix in shallow tint at grazing angles (fresnel)
    //   3. add caustic brightness (mostly shallow-tinted)
    //   4. wash with foam at crests
    //   5. add sun glint (additive bright white)
    const baseHeight = mix(deepColor, shallowColor, heightT)
    const withFresnel = mix(baseHeight, shallowColor, fresnel.mul(0.6))
    const withCaustics = withFresnel.add(shallowColor.mul(caustics))
    const withFoam = mix(withCaustics, foamColor, foamMask)
    const finalColor = withFoam.add(vec3(glint))

    // Opacity climbs at grazing angles (where the eye sees more water
    // surface). Foam pushes opacity to nearly 1 so crests read solid.
    const finalOpacity = saturate(
        opacityUniform.add(fresnel.mul(0.20)).add(foamMask.mul(0.30)),
    )

    const mat = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthTest: opts.depthTest ?? false,
        depthWrite: false,
    })
    mat.positionNode = newPos
    mat.colorNode = finalColor
    mat.opacityNode = finalOpacity

    // 96×96 segments — plenty for smooth Gerstner waves at the demo's
    // zone sizes. Modern hardware doesn't notice.
    const ownsGeneratedPlane = !opts.geometry
    const geo = opts.geometry ?? new PlaneGeometry(1, 1, 96, 96)
    if (ownsGeneratedPlane) geo.rotateX(-Math.PI / 2)
    const mesh = new Mesh(geo, mat)
    if (ownsGeneratedPlane) mesh.scale.set(opts.size.x, 1, opts.size.z)
    mesh.renderOrder = opts.renderOrder ?? LOCAL_FX_SURFACE_RENDER_ORDER

    return {
        mesh,
        setColors(c) {
            if (c.deep)    deepColor.value.set(c.deep)
            if (c.shallow) shallowColor.value.set(c.shallow)
            if (c.foam)    foamColor.value.set(c.foam)
        },
        setOpacity(o) { opacityUniform.value = o },
        setSize(x, z) {
            if (ownsGeneratedPlane) mesh.scale.set(x, 1, z)
        },
        dispose() {
            geo.dispose()
            mat.dispose()
        },
    }
}

export interface LavaSurfaceOpts {
    size: { x: number; z: number }
    /** Optional custom geometry. When omitted a scaled plane is built. */
    geometry?: BufferGeometry
    hotColor?: string
    crustColor?: string
    glowColor?: string
    waveAmplitude?: number
    flowSpeed?: number
    crustAmount?: number
    /** HDR emissive multiplier. Default 4.5 — high enough that the
     *  surface noticeably glows through fog under ACES tonemapping. */
    emissiveStrength?: number
    /** FX zones default to false so iso overlays stay readable; voxel-bound
     *  liquid surfaces pass true so terrain can occlude them normally. */
    depthTest?: boolean
    renderOrder?: number
}

/**
 * Stylised lava with HDR emissive. The shader produces values well
 * above 1.0 in the hottest regions, so under ACES tonemapping the
 * surface visibly glows even when fog is heavy.
 *
 *   - Vertex displacement: low-octave FBM scrolling slowly across the
 *     surface, giving the goopy bulges. Same finite-difference normal
 *     trick as the water shader.
 *   - Crust mask: independent low-frequency Perlin thresholded with
 *     smoothstep. Dark patches that don't visibly correlate with the
 *     displacement field.
 *   - Hot veins: faster-scrolling FBM, sharpened. Concentrates bright
 *     emissive at sharp boundaries.
 *   - Fresnel rim: extra glow at grazing angles so the rim of the
 *     pool reads as luminous even when viewed from above.
 *   - Pulse: two-frequency sin oscillator gives the surface life.
 *   - `material.fog = false` — lava is a light source. Fog dimming
 *     the emissive would look wrong (and *was* the user's complaint).
 */
export function buildLavaSurface(opts: LavaSurfaceOpts): LavaSurface {
    const hotColor = uniform(new Color(opts.hotColor ?? '#ffb35a'))
    const crustColor = uniform(new Color(opts.crustColor ?? '#1c0904'))
    const glowColor = uniform(new Color(opts.glowColor ?? '#ff5a16'))
    const opacityUniform = uniform(1.0)
    const amplitude = uniform(opts.waveAmplitude ?? 0.05)
    const flowSpeed = uniform(opts.flowSpeed ?? 0.18)
    const crustAmount = uniform(opts.crustAmount ?? 0.55)
    const emissiveStrength = uniform(opts.emissiveStrength ?? 4.5)

    const tFlow = time.mul(flowSpeed)
    const flow1 = vec2(positionLocal.x, positionLocal.z).mul(2.6).add(vec2(tFlow, tFlow.mul(-0.6)))
    const flow2 = vec2(positionLocal.x, positionLocal.z).mul(5.2).add(vec2(tFlow.mul(-0.85), tFlow.mul(0.4)))
    const flowCrust = vec2(positionLocal.x, positionLocal.z).mul(1.4).add(vec2(tFlow.mul(0.35), tFlow.mul(0.25)))

    const dispNoise = mx_fractal_noise_float(vec3(flow1.x, flow1.y, tFlow.mul(0.3)), 3, 2.0, 0.5, 1.0)
    const h = dispNoise.mul(amplitude)
    const newPos = vec3(positionLocal.x, h, positionLocal.z)

    const eps = float(0.05)
    const sampleDisp = Fn(([uv]: [any]) =>
        mx_fractal_noise_float(vec3(uv.x, uv.y, tFlow.mul(0.3)), 3, 2.0, 0.5, 1.0).mul(amplitude),
    )
    const hL = sampleDisp(flow1.sub(vec2(eps, 0)))
    const hR = sampleDisp(flow1.add(vec2(eps, 0)))
    const hD = sampleDisp(flow1.sub(vec2(0, eps)))
    const hU = sampleDisp(flow1.add(vec2(0, eps)))
    const tangentX = vec3(eps.mul(2), hR.sub(hL), float(0))
    const tangentZ = vec3(float(0), hU.sub(hD), eps.mul(2))
    const n = normalize(cross(tangentZ, tangentX))

    // Crust + heat masks.
    const crustNoise = mx_noise_float(vec3(flowCrust.x, flowCrust.y, tFlow.mul(0.18)))
    const crustBlend = crustNoise.add(1).mul(0.5)  // remap [-1, 1] → [0, 1]
    const crust = smoothstep(crustAmount.sub(0.15), crustAmount.add(0.18), crustBlend)
    const heat = float(1).sub(crust)

    // Hot vein highlights — sharp emissive bands inside the molten
    // patches.
    const veinNoise = mx_fractal_noise_float(vec3(flow2.x, flow2.y, tFlow.mul(0.5)), 4, 2.1, 0.55, 1.0)
    const veinBlend = veinNoise.add(1).mul(0.5)
    const vein = smoothstep(float(0.55), float(0.92), veinBlend)

    // Surface pulse — two frequencies superimposed for a "breathing"
    // intensity that never quite repeats.
    const pulse = sin(time.mul(1.8)).mul(0.18)
        .add(sin(time.mul(3.7)).mul(0.10))
        .add(1.0)

    // Fresnel rim. At grazing angles we add an extra glow band so the
    // pool's silhouette reads as luminous even when fog dims the
    // interior.
    const view = normalize(cameraPosition.sub(positionWorld))
    const ndotv = saturate(view.dot(n))
    const fresnel = pow(float(1).sub(ndotv), 3)

    // Base colour — visible in normal lighting via diffuse.
    const baseColor = mix(crustColor, hotColor, heat)
    const finalColor = mix(baseColor, hotColor, vein.mul(heat))

    // Emissive — what makes it glow. HDR magnitudes:
    //   - hot core:    `heat * strength * pulse` peaks around 4.5–5.5
    //   - vein highlights: `vein * 1.6`         peaks at 1.6
    //   - rim glow:    `fresnel * heat * 1.4`   peaks at ~1.4
    // ACES will bloom the high values into a believable glow.
    const emissive = glowColor.mul(heat.mul(emissiveStrength).mul(pulse))
        .add(glowColor.mul(vein.mul(1.6)))
        .add(glowColor.mul(fresnel.mul(heat).mul(1.4)))

    const mat = new MeshStandardNodeMaterial({
        side: DoubleSide,
        depthTest: opts.depthTest ?? false,
        depthWrite: false,
        roughness: 0.92,
        metalness: 0.0,
    })
    mat.positionNode = newPos
    mat.normalNode = n
    mat.colorNode = finalColor
    mat.opacityNode = opacityUniform
    mat.emissiveNode = emissive
    mat.roughnessNode = mix(float(0.55), float(0.96), crust)
    // Lava IS affected by fog (a real torch through mist still dims —
    // it just dims less than the rock around it). Combined with HDR
    // emissive ≥ 4.5 and ACES tonemapping on the renderer, the
    // surface reads as a powerful glow that fog partially absorbs.
    // Earlier `mat.fog = false` was wrong: the lava punched through
    // cloud weather as if nothing was there, which looked unnatural.
    mat.fog = true

    const ownsGeneratedPlane = !opts.geometry
    const geo = opts.geometry ?? new PlaneGeometry(1, 1, 56, 56)
    if (ownsGeneratedPlane) geo.rotateX(-Math.PI / 2)
    const mesh = new Mesh(geo, mat)
    if (ownsGeneratedPlane) mesh.scale.set(opts.size.x, 1, opts.size.z)
    mesh.renderOrder = opts.renderOrder ?? LOCAL_FX_SURFACE_RENDER_ORDER

    return {
        mesh,
        setColors(c) {
            if (c.crust) crustColor.value.set(c.crust)
            if (c.hot)   hotColor.value.set(c.hot)
            if (c.glow)  glowColor.value.set(c.glow)
        },
        setOpacity(o) { opacityUniform.value = o },
        setSize(x, z) {
            if (ownsGeneratedPlane) mesh.scale.set(x, 1, z)
        },
        dispose() {
            geo.dispose()
            mat.dispose()
        },
    }
}
