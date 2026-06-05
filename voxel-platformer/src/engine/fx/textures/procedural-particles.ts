import { CanvasTexture, LinearFilter, SRGBColorSpace, Texture } from 'three'

/**
 * Procedural particle texture atlases distilled from the source demos.
 * Each kind paints a 128×128 (or 64×64 for tiny billboards) canvas and
 * wraps it in a `CanvasTexture`. The output is cached by kind in
 * `texture-registry.ts` — these are one-shot builders.
 *
 * The intent of every builder is to capture the *silhouette* of the
 * effect: rain streaks need a vertical gradient, fire needs a
 * teardrop with a hot core, magic motes need a soft glow + cross
 * highlight. Replace these with authored textures in production when
 * the rest of the system is stable.
 */

export type ParticleTextureKind =
    | 'soft'
    | 'drop'
    | 'streak'
    | 'flake'
    | 'splash'
    | 'fog'
    | 'dust'
    | 'ember'
    | 'magic'
    | 'flame'
    | 'smoke'
    | 'shockwave'
    | 'leaf'
    | 'bubble'
    | 'spark'
    | 'lightning'
    | 'glint'

const RAND = (s = 1) => Math.random() * s

/** Build the procedural texture for `kind`. Caller owns disposal. */
export function makeParticleTexture(kind: ParticleTextureKind): Texture {
    if (kind === 'streak') return buildStreak()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    drawKind(ctx, kind)
    return wrap(canvas)
}

function buildStreak(): Texture {
    // Rain streak: tall, narrow, soft-ended. Smaller canvas keeps memory tight.
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0,   'rgba(220, 235, 255, 0)')
    g.addColorStop(0.3, 'rgba(220, 235, 255, 0.95)')
    g.addColorStop(0.7, 'rgba(220, 235, 255, 0.95)')
    g.addColorStop(1,   'rgba(220, 235, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(2, 0, 4, 64)
    return wrap(canvas)
}

function wrap(canvas: HTMLCanvasElement): Texture {
    const tex = new CanvasTexture(canvas)
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.generateMipmaps = false
    tex.colorSpace = SRGBColorSpace
    tex.needsUpdate = true
    return tex
}

function drawKind(ctx: CanvasRenderingContext2D, kind: ParticleTextureKind): void {
    switch (kind) {
        case 'soft':      return drawSoft(ctx)
        case 'drop':      return drawDrop(ctx)
        case 'flake':     return drawFlake(ctx)
        case 'splash':    return drawSplash(ctx)
        case 'fog':       return drawFog(ctx)
        case 'dust':      return drawDust(ctx)
        case 'ember':     return drawEmber(ctx)
        case 'magic':     return drawMagic(ctx)
        case 'flame':     return drawFlame(ctx)
        case 'smoke':     return drawSmoke(ctx)
        case 'shockwave': return drawShockwave(ctx)
        case 'leaf':      return drawLeaf(ctx)
        case 'bubble':    return drawBubble(ctx)
        case 'spark':     return drawSpark(ctx)
        case 'lightning': return drawLightning(ctx)
        case 'glint':     return drawGlint(ctx)
    }
}

function drawSoft(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)')
    g.addColorStop(1,   'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
}

function drawDrop(ctx: CanvasRenderingContext2D): void {
    ctx.translate(64, 80)
    ctx.rotate(-0.1)
    const g = ctx.createLinearGradient(0, -56, 0, 36)
    g.addColorStop(0,   'rgba(220, 235, 255, 0)')
    g.addColorStop(0.4, 'rgba(220, 235, 255, 0.55)')
    g.addColorStop(0.85, 'rgba(255, 255, 255, 1)')
    g.addColorStop(1,   'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, -56)
    ctx.quadraticCurveTo(8, -20, 5, 8)
    ctx.ellipse(0, 8, 5, 8, 0, 0, Math.PI * 2)
    ctx.quadraticCurveTo(-8, -20, 0, -56)
    ctx.fill()
}

function drawFlake(ctx: CanvasRenderingContext2D): void {
    ctx.translate(64, 64)
    ctx.shadowBlur = 12
    ctx.shadowColor = 'rgba(220, 240, 255, 0.55)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI * 0.88 + i * Math.PI * 0.29
        const r = 18 + (i % 3) * 5
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46)
        ctx.stroke()
        // Secondary branches near 60% along each arm.
        ctx.lineWidth = 3
        for (const sign of [-1, 1]) {
            ctx.beginPath()
            ctx.moveTo(Math.cos(a) * 28, Math.sin(a) * 28)
            ctx.lineTo(
                Math.cos(a) * 28 + Math.cos(a + sign * 0.62) * 14,
                Math.sin(a) * 28 + Math.sin(a + sign * 0.62) * 14,
            )
            ctx.stroke()
        }
        ctx.lineWidth = 5
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.beginPath()
    ctx.arc(0, 0, 9, 0, Math.PI * 2)
    ctx.fill()
}

function drawSplash(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.6)'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.ellipse(64, 64, 44, 14, 0, 0, Math.PI * 2)
    ctx.stroke()
    for (let i = 0; i < 7; i++) {
        const a = i * Math.PI / 3
        const x = 64 + Math.cos(a) * 38
        const y = 64 + Math.sin(a) * 12
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(220, 245, 255, 0.85)'
        ctx.fill()
    }
}

function drawFog(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < 18; i++) {
        const x = 12 + RAND(104)
        const y = 12 + RAND(104)
        const r = 24 + RAND(28)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0,   'rgba(255, 255, 255, ' + (0.07 + RAND(0.13)) + ')')
        g.addColorStop(0.5, 'rgba(255, 255, 255, ' + (0.025 + RAND(0.055)) + ')')
        g.addColorStop(1,   'rgba(255, 255, 255, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 128, 128)
    }
}

function drawDust(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < 20; i++) {
        const x = 30 + RAND(68)
        const y = 30 + RAND(68)
        const r = 18 + RAND(24)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0,   'rgba(214, 184, 130, ' + (0.12 + RAND(0.20)) + ')')
        g.addColorStop(0.55, 'rgba(180, 130, 70, '  + (0.05 + RAND(0.11)) + ')')
        g.addColorStop(1,   'rgba(120, 80, 40, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 128, 128)
    }
}

function drawEmber(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.14, 'rgba(255, 240, 135, 0.98)')
    g.addColorStop(0.36, 'rgba(255, 125, 25, 0.68)')
    g.addColorStop(0.72, 'rgba(255, 50, 0, 0.14)')
    g.addColorStop(1,   'rgba(40, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
}

function drawMagic(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.18, 'rgba(255, 255, 255, 0.95)')
    g.addColorStop(0.44, 'rgba(155, 120, 255, 0.48)')
    g.addColorStop(1,   'rgba(75, 30, 180, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    // Cross-shaped highlight beams.
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 3
    for (let i = 0; i < 4; i++) {
        ctx.save()
        ctx.translate(64, 64)
        ctx.rotate(i * Math.PI / 4)
        ctx.beginPath()
        ctx.moveTo(-50, 0)
        ctx.lineTo(50, 0)
        ctx.stroke()
        ctx.restore()
    }
}

function drawFlame(ctx: CanvasRenderingContext2D): void {
    ctx.translate(64, 72)
    const g = ctx.createRadialGradient(0, 18, 0, 0, 0, 62)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.2, 'rgba(255, 220, 110, 0.95)')
    g.addColorStop(0.55, 'rgba(255, 120, 40, 0.55)')
    g.addColorStop(1,   'rgba(50, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, -64)
    ctx.bezierCurveTo(34, -34, 38, 14, 0, 38)
    ctx.bezierCurveTo(-38, 14, -34, -34, 0, -64)
    ctx.fill()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = 'rgba(255, 240, 160, 0.65)'
    ctx.beginPath()
    ctx.moveTo(0, -36)
    ctx.bezierCurveTo(18, -16, 20, 14, 0, 26)
    ctx.bezierCurveTo(-20, 14, -18, -16, 0, -36)
    ctx.fill()
}

function drawSmoke(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < 26; i++) {
        const x = 22 + RAND(84)
        const y = 18 + RAND(94)
        const r = 18 + RAND(28)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0,   'rgba(170, 160, 145, ' + (0.06 + RAND(0.12)) + ')')
        g.addColorStop(0.5, 'rgba(95, 85, 78, '   + (0.025 + RAND(0.065)) + ')')
        g.addColorStop(1,   'rgba(30, 25, 22, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 128, 128)
    }
}

function drawShockwave(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(64, 64, 18, 64, 64, 62)
    g.addColorStop(0,    'rgba(255, 255, 255, 0)')
    g.addColorStop(0.48, 'rgba(255, 220, 130, 0.04)')
    g.addColorStop(0.67, 'rgba(255, 190, 70,  0.75)')
    g.addColorStop(0.78, 'rgba(255, 90, 20,   0.45)')
    g.addColorStop(1,    'rgba(60, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
}

function drawLeaf(ctx: CanvasRenderingContext2D): void {
    ctx.translate(64, 64)
    ctx.rotate(-0.55)
    const g = ctx.createLinearGradient(-36, -8, 38, 12)
    g.addColorStop(0,   'rgba(255, 200, 110, 1)')
    g.addColorStop(0.4, 'rgba(220, 140, 50, 1)')
    g.addColorStop(0.85, 'rgba(120, 60, 20, 0.85)')
    g.addColorStop(1,   'rgba(70, 30, 10, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(-44, 0)
    ctx.bezierCurveTo(-22, -24, 22, -28, 44, 0)
    ctx.bezierCurveTo(22, 26, -22, 22, -44, 0)
    ctx.fill()
    // Mid + secondary veins.
    ctx.strokeStyle = 'rgba(70, 35, 12, 0.45)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(-40, 0)
    ctx.lineTo(40, 0)
    ctx.stroke()
    ctx.lineWidth = 2
    for (let i = -3; i <= 3; i++) {
        if (i === 0) continue
        ctx.beginPath()
        ctx.moveTo(i * 10, 0)
        ctx.lineTo(i * 10 + 8, (i < 0 ? -1 : 1) * 12)
        ctx.stroke()
    }
}

function drawBubble(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(54, 52, 2, 64, 64, 54)
    g.addColorStop(0,   'rgba(255, 255, 255, 0.95)')
    g.addColorStop(0.32, 'rgba(190, 230, 255, 0.32)')
    g.addColorStop(0.68, 'rgba(120, 180, 230, 0.12)')
    g.addColorStop(1,   'rgba(20, 40, 70, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    ctx.strokeStyle = 'rgba(180, 230, 255, 0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(64, 64, 36, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(54, 50, 16, -0.6, 0.3)
    ctx.stroke()
}

function drawSpark(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.46, 'rgba(255, 255, 255, 0.58)')
    g.addColorStop(1,   'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
}

function drawLightning(ctx: CanvasRenderingContext2D): void {
    // Long, thin, almost-additive streak with random kinks. Useful for
    // bolt cylinders as a fallback if you don't want CylinderGeometry.
    const g = ctx.createLinearGradient(64, 0, 64, 128)
    g.addColorStop(0,   'rgba(255, 255, 255, 0)')
    g.addColorStop(0.5, 'rgba(255, 255, 255, 1)')
    g.addColorStop(1,   'rgba(180, 200, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(60, 0, 8, 128)
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.7)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(64, 4)
    for (let y = 12; y < 128; y += 12) {
        ctx.lineTo(64 + (Math.random() - 0.5) * 6, y)
    }
    ctx.stroke()
}

function drawGlint(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 26)
    g.addColorStop(0,   'rgba(255, 255, 255, 1)')
    g.addColorStop(0.4, 'rgba(255, 255, 255, 0.55)')
    g.addColorStop(1,   'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(38, 38, 52, 52)
    // 4-rayed sparkle.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(20, 64); ctx.lineTo(108, 64)
    ctx.moveTo(64, 20); ctx.lineTo(64, 108)
    ctx.stroke()
}
