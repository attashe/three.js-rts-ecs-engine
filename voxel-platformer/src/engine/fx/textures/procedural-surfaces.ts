import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from 'three'

/**
 * Tiled surface textures for liquid effects. 256×256 each, marked
 * `RepeatWrapping` so the emitter can scroll UVs cheaply. Caustic and
 * lava-glow textures are designed to be additively blended on top of
 * the base water / lava plane.
 *
 * As with the particle textures, treat these as prototype-grade — the
 * production roadmap calls for real shaders driven by flow maps.
 */

export type SurfaceTextureKind = 'caustics' | 'lava' | 'lavaGlow'

export function makeSurfaceTexture(kind: SurfaceTextureKind): Texture {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    if (kind === 'caustics') drawCaustics(ctx)
    else drawLava(ctx, kind === 'lavaGlow')
    return wrap(canvas)
}

function wrap(canvas: HTMLCanvasElement): Texture {
    const t = new CanvasTexture(canvas)
    t.minFilter = LinearFilter
    t.magFilter = LinearFilter
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
    t.colorSpace = SRGBColorSpace
    t.needsUpdate = true
    return t
}

function drawCaustics(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = 0; i < 140; i++) {
        let x = rand(-16, 272)
        let y = rand(-16, 272)
        let ang = rand(0, Math.PI * 2)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.shadowBlur = rand(4, 10)
        ctx.shadowColor = 'rgba(185, 245, 255, 0.45)'
        ctx.strokeStyle = `rgba(185, 245, 255, ${(0.07 + Math.random() * 0.11).toFixed(3)})`
        ctx.lineWidth = rand(1.0, 2.7)
        const steps = 3 + Math.floor(Math.random() * 4)
        for (let s = 0; s < steps; s++) {
            const len = rand(10, 28)
            const cx = x + Math.cos(ang + rand(-0.75, 0.75)) * len * 0.55
            const cy = y + Math.sin(ang + rand(-0.75, 0.75)) * len * 0.55
            const nx = x + Math.cos(ang) * len
            const ny = y + Math.sin(ang) * len
            ctx.quadraticCurveTo(cx, cy, nx, ny)
            x = nx; y = ny
            ang += rand(-0.9, 0.9)
        }
        ctx.stroke()
    }
    ctx.shadowBlur = 0
    for (let i = 0; i < 55; i++) {
        const x = rand(0, 256), y = rand(0, 256), r = rand(4, 12)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0,   'rgba(220, 250, 255, 0.45)')
        g.addColorStop(1,   'rgba(220, 250, 255, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 256, 256)
    }
}

function drawLava(ctx: CanvasRenderingContext2D, glowOnly: boolean): void {
    const w = 256
    const h = 256
    const image = ctx.createImageData(w, h)
    const data = image.data

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = x / w
            const v = y / h
            const broad = fbmTile(u, v, 4, glowOnly ? 73 : 31)
            const detail = fbmTile(u + broad * 0.08, v - broad * 0.05, 10, glowOnly ? 89 : 47)
            const micro = fbmTile(u * 1.7 + 0.11, v * 1.7 - 0.07, 18, glowOnly ? 109 : 61)
            const heat = clamp01(smoothstep(0.45, 0.86, broad) * 0.55 + smoothstep(0.52, 0.90, detail) * 0.42 + smoothstep(0.62, 0.92, micro) * 0.26)
            const cracks = smoothstep(0.58, 0.96, Math.abs(detail - broad) * 1.55 + micro * 0.25)
            const hot = clamp01(heat * 0.84 + cracks * 0.46)
            const i = (y * w + x) * 4

            if (glowOnly) {
                const a = Math.round(smoothstep(0.46, 0.94, hot) * 185)
                data[i] = 255
                data[i + 1] = Math.round(96 + hot * 138)
                data[i + 2] = Math.round(18 + hot * 76)
                data[i + 3] = a
            } else {
                const crust = 1 - smoothstep(0.24, 0.78, hot)
                data[i] = Math.round(30 + hot * 210 - crust * 16)
                data[i + 1] = Math.round(10 + hot * 82 - crust * 5)
                data[i + 2] = Math.round(5 + hot * 22)
                data[i + 3] = 255
            }
        }
    }
    ctx.putImageData(image, 0, 0)
}

function rand(a: number, b: number): number {
    return a + Math.random() * (b - a)
}

function fbmTile(u: number, v: number, basePeriod: number, seed: number): number {
    let value = 0
    let amp = 0.5
    let norm = 0
    for (let octave = 0; octave < 4; octave++) {
        const period = basePeriod << octave
        value += tileGradientNoise(u * period, v * period, period, seed + octave * 101) * amp
        norm += amp
        amp *= 0.5
    }
    return value / Math.max(0.0001, norm)
}

function tileGradientNoise(x: number, y: number, period: number, seed: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = x0 + 1
    const y1 = y0 + 1
    const sx = fade(x - x0)
    const sy = fade(y - y0)
    const n00 = gradDot(x0, y0, x, y, period, seed)
    const n10 = gradDot(x1, y0, x, y, period, seed)
    const n01 = gradDot(x0, y1, x, y, period, seed)
    const n11 = gradDot(x1, y1, x, y, period, seed)
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy) * 0.5 + 0.5
}

function gradDot(ix: number, iy: number, x: number, y: number, period: number, seed: number): number {
    const wrappedX = ((ix % period) + period) % period
    const wrappedY = ((iy % period) + period) % period
    const h = hash2(wrappedX, wrappedY, seed)
    const angle = (h / 0xffffffff) * Math.PI * 2
    return Math.cos(angle) * (x - ix) + Math.sin(angle) * (y - iy)
}

function hash2(x: number, y: number, seed: number): number {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return (h ^ (h >>> 16)) >>> 0
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = clamp01((x - edge0) / Math.max(0.0001, edge1 - edge0))
    return t * t * (3 - 2 * t)
}

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v))
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}
