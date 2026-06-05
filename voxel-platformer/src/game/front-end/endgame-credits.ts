import { menuButton } from '../ui/menu-kit'

export interface EndgameCreditsOptions {
    /** Called when the player dismisses the credits (button or after the
     *  scroll completes) — the host returns to the title screen. */
    onDone: () => void
    lines?: readonly string[]
}

export interface EndgameCredits {
    show(): void
    dispose(): void
}

const DEFAULT_LINES: readonly string[] = [
    'THE END',
    '',
    'You climbed from the cliffs,',
    'through the abandoned mine,',
    'to the shrine above the clouds.',
    '',
    'Voxel Platformer',
    '',
    'A procedurally-built world',
    'of voxels, light, and sound.',
    '',
    'Thanks for playing.',
]

/** Full-screen rolling credits shown when the final shrine cinematic ends.
 *  Mounts hidden; call `show()`. */
export function createEndgameCredits(opts: EndgameCreditsOptions): EndgameCredits {
    const root = document.createElement('div')
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1200',
        display: 'none',
        overflow: 'hidden',
        background: 'rgba(2, 4, 6, 0.96)',
        color: '#eef6f2',
        font: '15px ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>)

    const scroll = document.createElement('div')
    Object.assign(scroll.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        top: '0',
        padding: '0 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    for (const line of opts.lines ?? DEFAULT_LINES) {
        const el = document.createElement('div')
        el.textContent = line
        if (line === 'THE END' || line === 'Voxel Platformer') {
            el.style.fontSize = '28px'
            el.style.fontWeight = '700'
            el.style.margin = '12px 0'
        } else {
            el.style.color = 'rgba(238, 246, 242, 0.82)'
        }
        el.style.minHeight = '8px'
        scroll.appendChild(el)
    }
    root.appendChild(scroll)

    const returnButton = menuButton('Return to title', () => finish())
    Object.assign(returnButton.style, {
        position: 'absolute',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        width: 'auto',
        minWidth: '200px',
    } satisfies Partial<CSSStyleDeclaration>)
    root.appendChild(returnButton)

    document.body.appendChild(root)

    let raf = 0
    let done = false
    const finish = (): void => {
        if (done) return
        done = true
        if (raf) cancelAnimationFrame(raf)
        opts.onDone()
    }

    return {
        show() {
            root.style.display = 'block'
            // Start below the viewport and crawl upward; auto-finish once the
            // last line clears the top.
            let y = window.innerHeight
            const speed = 28 // px/s
            let last = performance.now()
            const tick = (now: number): void => {
                const dt = (now - last) / 1000
                last = now
                y -= speed * dt
                scroll.style.transform = `translateY(${y}px)`
                if (y < -scroll.offsetHeight - 40) { finish(); return }
                raf = requestAnimationFrame(tick)
            }
            raf = requestAnimationFrame(tick)
        },
        dispose() {
            if (raf) cancelAnimationFrame(raf)
            root.remove()
        },
    }
}
