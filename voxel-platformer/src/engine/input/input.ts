// Lightweight global input state. Tracks held keys, last pointer position,
// and accumulated wheel delta. Systems read this synchronously each frame.
//
// Higher-level gameplay actions are layered on top in actions.ts; this class
// intentionally stays as the raw keyboard/pointer/wheel source.

export interface ClickEvent {
    /** CSS pixel x in viewport. */
    x: number
    /** CSS pixel y in viewport. */
    y: number
    /** 0 = left, 2 = right, 1 = middle. Mirrors PointerEvent.button. */
    button: number
}

const CLICK_DRAG_THRESHOLD_PX = 6
const CLICK_TIME_THRESHOLD_MS = 350

export class Input {
    private readonly target: HTMLElement
    private keys: Set<string> = new Set()
    private pressed: Set<string> = new Set()
    private pressedAt: Map<string, number> = new Map()
    private pointer: { x: number; y: number } | null = null
    private wheelAccum = 0
    private pendingClicks: ClickEvent[] = []
    private downAt: { x: number; y: number; t: number; button: number } | null = null

    constructor(target: HTMLElement = document.body) {
        this.target = target
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.onBlur)
        this.target.addEventListener('pointermove', this.onPointerMove)
        this.target.addEventListener('pointerdown', this.onPointerDown)
        this.target.addEventListener('pointerup', this.onPointerUp)
        this.target.addEventListener('wheel', this.onWheel, { passive: true })
        this.target.addEventListener('contextmenu', this.onContextMenu)
    }

    private onKeyDown = (e: KeyboardEvent) => {
        if (isEditableTarget(e.target)) return
        if (!e.repeat && !this.keys.has(e.code)) {
            this.pressed.add(e.code)
            this.pressedAt.set(e.code, performance.now())
        }
        this.keys.add(e.code)
    }
    private onKeyUp = (e: KeyboardEvent) => {
        if (isEditableTarget(e.target)) return
        this.keys.delete(e.code)
    }
    private onBlur = () => {
        // Clear held keys on focus loss so we don't get stuck-key drift.
        this.keys.clear()
        this.pressed.clear()
        this.pressedAt.clear()
        this.downAt = null
    }
    private onPointerMove = (e: PointerEvent) => {
        this.pointer = { x: e.clientX, y: e.clientY }
    }
    private onPointerDown = (e: PointerEvent) => {
        this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }
    }
    private onPointerUp = (e: PointerEvent) => {
        const d = this.downAt
        this.downAt = null
        if (!d || d.button !== e.button) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        const dragged = (dx * dx + dy * dy) > CLICK_DRAG_THRESHOLD_PX * CLICK_DRAG_THRESHOLD_PX
        const tooSlow = (performance.now() - d.t) > CLICK_TIME_THRESHOLD_MS
        if (dragged || tooSlow) return
        this.pendingClicks.push({ x: e.clientX, y: e.clientY, button: e.button })
    }
    private onWheel = (e: WheelEvent) => {
        this.wheelAccum += e.deltaY
    }
    private onContextMenu = (e: MouseEvent) => {
        // Suppress browser right-click menu so we can use right-button as an in-game input.
        e.preventDefault()
    }

    /** True if the given key code (e.g. "KeyW", "ArrowLeft") is currently held. */
    isKeyDown(code: string): boolean {
        return this.keys.has(code)
    }

    /** True once for each keydown event, then cleared. Useful for fixed-step actions. */
    consumeKeyPressed(code: string): boolean {
        const pressed = this.pressed.has(code)
        this.pressed.delete(code)
        this.pressedAt.delete(code)
        return pressed
    }

    /** Consume a press if it happened within the given buffer window. */
    consumeBufferedKeyPressed(code: string, bufferMs: number): boolean {
        const t = this.pressedAt.get(code)
        if (t === undefined) return false
        if (performance.now() - t > bufferMs) {
            this.pressed.delete(code)
            this.pressedAt.delete(code)
            return false
        }
        this.pressed.delete(code)
        this.pressedAt.delete(code)
        return true
    }

    /** True while a press is still inside the buffer window. Expired presses are cleared. */
    hasBufferedKeyPressed(code: string, bufferMs: number): boolean {
        const t = this.pressedAt.get(code)
        if (t === undefined) return false
        if (performance.now() - t <= bufferMs) return true
        this.pressed.delete(code)
        this.pressedAt.delete(code)
        return false
    }

    /** Last known pointer position in CSS pixels, or null if pointer hasn't moved yet. */
    getPointer(): { x: number; y: number } | null {
        return this.pointer
    }

    /** Read and clear accumulated wheel delta. Positive = scroll down. */
    consumeWheel(): number {
        const d = this.wheelAccum
        this.wheelAccum = 0
        return d
    }

    /** Read and clear queued click events. A "click" is a pointerdown+pointerup
     *  pair without significant drag and within ~350 ms. */
    consumeClicks(): ClickEvent[] {
        if (this.pendingClicks.length === 0) return []
        const out = this.pendingClicks
        this.pendingClicks = []
        return out
    }

    dispose(): void {
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.onBlur)
        this.target.removeEventListener('pointermove', this.onPointerMove)
        this.target.removeEventListener('pointerdown', this.onPointerDown)
        this.target.removeEventListener('pointerup', this.onPointerUp)
        this.target.removeEventListener('wheel', this.onWheel)
        this.target.removeEventListener('contextmenu', this.onContextMenu)
    }
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
