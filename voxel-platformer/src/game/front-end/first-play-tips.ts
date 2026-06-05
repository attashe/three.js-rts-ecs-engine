const SEEN_TIPS_KEY = 'vp:seen-tips'

const TIPS: readonly string[] = [
    'WASD — move',
    'E — interact',
    'Left-click — attack',
    'Right-click — block / cast',
    'F — use item',
    'Tab — inventory',
    'Esc — menu',
]

function hasSeenTips(): boolean {
    try {
        return typeof window !== 'undefined' && window.localStorage.getItem(SEEN_TIPS_KEY) === '1'
    } catch {
        return false
    }
}

function markSeen(): void {
    try {
        window.localStorage.setItem(SEEN_TIPS_KEY, '1')
    } catch {
        // Private mode — fine; tips just show again next session.
    }
}

/** Show a small, dismissible controls reminder the first time the player
 *  reaches a level this browser. No-op on later visits. */
export function maybeShowFirstPlayTips(): void {
    if (hasSeenTips()) return
    markSeen()

    const toast = document.createElement('div')
    Object.assign(toast.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '1150',
        maxWidth: 'calc(100vw - 32px)',
        padding: '12px 16px',
        borderRadius: '8px',
        background: 'rgba(13, 18, 21, 0.92)',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
        color: '#eef6f2',
        font: '13px ui-sans-serif, system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        justifyContent: 'center',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)

    const list = document.createElement('span')
    list.textContent = TIPS.join('   ·   ')
    list.style.color = 'rgba(238, 246, 242, 0.86)'

    const dismiss = document.createElement('span')
    dismiss.textContent = 'Got it ✕'
    Object.assign(dismiss.style, { color: 'rgba(238, 246, 242, 0.6)', fontWeight: '600' } satisfies Partial<CSSStyleDeclaration>)

    toast.append(list, dismiss)

    let removed = false
    const remove = (): void => {
        if (removed) return
        removed = true
        toast.style.transition = 'opacity 0.3s'
        toast.style.opacity = '0'
        window.setTimeout(() => toast.remove(), 320)
    }
    toast.addEventListener('click', remove)
    window.setTimeout(remove, 9000)

    document.body.appendChild(toast)
}
