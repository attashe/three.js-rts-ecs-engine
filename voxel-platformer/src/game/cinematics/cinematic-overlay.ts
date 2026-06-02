// DOM overlay for cinematics: animated letterbox bars, a subtitle line, a black
// fade layer, and a skip hint. Mirrors the fixed-position overlay pattern used
// by the dialogue and HUD systems (a full-viewport, mostly pointer-transparent
// container at a high z-index). Shared by the in-game cinematic stage and the
// in-editor preview so both look identical.

export interface CinematicOverlay {
    setLetterbox(on: boolean): void
    showSubtitle(text: string, speaker?: string): void
    clearSubtitle(): void
    /** Black fade opacity, 0 (clear) … 1 (black). */
    setFade(alpha: number): void
    /** Register the skip handler (fired on Esc/Space while visible). */
    onSkip(handler: () => void): void
    /** Show/hide everything without tearing down the DOM (used between plays). */
    setVisible(visible: boolean): void
    dispose(): void
}

const BAR_HEIGHT = 'min(12vh, 96px)'
const Z = 1150

export function createCinematicOverlay(): CinematicOverlay {
    const root = document.createElement('div')
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: String(Z),
        pointerEvents: 'none',
        display: 'none',
        fontFamily: 'system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)

    const fade = document.createElement('div')
    Object.assign(fade.style, {
        position: 'absolute',
        inset: '0',
        background: '#000',
        opacity: '0',
    } satisfies Partial<CSSStyleDeclaration>)

    const topBar = bar('top')
    const bottomBar = bar('bottom')

    const subtitle = document.createElement('div')
    // Sit the caption vertically centred *inside* the bottom letterbox bar, so
    // the white text is always over black (full contrast) instead of floating
    // over arbitrary gameplay colours above the bar.
    Object.assign(subtitle.style, {
        position: 'absolute',
        left: '50%',
        bottom: `calc(${BAR_HEIGHT} / 2)`,
        transform: 'translate(-50%, 50%)',
        maxWidth: '80%',
        textAlign: 'center',
        color: '#f4f6f8',
        fontSize: '18px',
        lineHeight: '1.35',
        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        opacity: '0',
        transition: 'opacity 0.18s ease',
    } satisfies Partial<CSSStyleDeclaration>)

    const skipHint = document.createElement('div')
    skipHint.textContent = 'Esc to skip'
    Object.assign(skipHint.style, {
        position: 'absolute',
        right: '16px',
        bottom: `calc(${BAR_HEIGHT} / 2)`,
        transform: 'translateY(50%)',
        color: 'rgba(255,255,255,0.55)',
        fontSize: '12px',
        letterSpacing: '0.04em',
    } satisfies Partial<CSSStyleDeclaration>)

    root.append(fade, topBar, bottomBar, subtitle, skipHint)
    document.body.appendChild(root)

    let skipHandler: (() => void) | null = null
    // `capturing` (key-swallow gate) is true only while a cinematic is on stage,
    // independent of DOM display. The bug it guards against: after a cinematic
    // ends the overlay is still in the DOM (invisible), and without this gate it
    // would keep eating Space / Esc — stealing jump and the pause menu.
    let capturing = false

    const onKey = (e: KeyboardEvent): void => {
        if (!capturing) return
        if (e.key === 'Escape' || e.key === ' ' || e.code === 'Space') {
            e.preventDefault()
            skipHandler?.()
        }
    }
    window.addEventListener('keydown', onKey)

    function show(): void { root.style.display = 'block' }

    function setVisible(v: boolean): void {
        root.style.display = v ? 'block' : 'none'
        if (!v) capturing = false
    }

    return {
        setLetterbox(on) {
            capturing = on
            show()
            topBar.style.height = on ? BAR_HEIGHT : '0'
            bottomBar.style.height = on ? BAR_HEIGHT : '0'
            skipHint.style.opacity = on ? '1' : '0'
        },
        showSubtitle(text, speaker) {
            capturing = true
            show()
            subtitle.innerHTML = ''
            if (speaker) {
                const name = document.createElement('span')
                name.textContent = `${speaker}: `
                name.style.color = '#9fd0ff'
                name.style.fontWeight = '600'
                subtitle.appendChild(name)
            }
            subtitle.appendChild(document.createTextNode(text))
            subtitle.style.opacity = '1'
        },
        clearSubtitle() {
            subtitle.style.opacity = '0'
        },
        setFade(alpha) {
            if (alpha > 0) { capturing = true; show() }
            fade.style.opacity = String(Math.max(0, Math.min(1, alpha)))
        },
        onSkip(handler) {
            skipHandler = handler
        },
        setVisible,
        dispose() {
            window.removeEventListener('keydown', onKey)
            root.remove()
        },
    }
}

function bar(edge: 'top' | 'bottom'): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        [edge]: '0',
        height: '0',
        background: '#000',
        transition: 'height 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
    } as Partial<CSSStyleDeclaration>)
    return el
}
