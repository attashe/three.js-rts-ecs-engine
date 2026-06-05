// Minimal FPS / frame-time HUD. Replaces the deleted three-stats-module dep.
// Updated each render frame; smooths FPS over a 0.5 s window.

export class StatsHUD {
    private readonly el: HTMLDivElement
    private frameCount = 0
    private elapsed = 0
    private lastFps = 0

    constructor() {
        this.el = document.createElement('div')
        this.el.id = 'stats-hud'
        this.el.className = 'ui-stats-hud'
        this.el.textContent = '— fps'
        document.body.appendChild(this.el)
    }

    update(dt: number): void {
        this.frameCount++
        this.elapsed += dt
        if (this.elapsed >= 0.5) {
            this.lastFps = this.frameCount / this.elapsed
            this.frameCount = 0
            this.elapsed = 0
            this.el.textContent = `${this.lastFps.toFixed(0)} fps  ${(1000 / Math.max(this.lastFps, 1)).toFixed(1)} ms`
        }
    }

    dispose(): void {
        this.el.remove()
    }
}
