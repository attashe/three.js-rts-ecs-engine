import type { System } from './system'
import { RenderOrder } from './orders'
import { pushLog, type GameWorld, type DeathReason } from '../world'

const REASON_LABEL: Record<DeathReason, string> = {
    'fell-into-void': 'You fell off the world',
    'crushed-by-piston': 'Crushed by a piston',
    'manual-restart': 'Restarting…',
}

/**
 * Render-side watcher that triggers a page reload when
 * `world.deathSignal` is set. A brief delay shows a "you died — restarting"
 * overlay so the user understands what happened. SessionStorage holds the
 * current playtest level so reload lands them back on the same map.
 */
export function createRestartSystem(): System {
    let triggered = false
    let overlay: HTMLElement | null = null

    return {
        order: RenderOrder.debug + 10,
        update(world) {
            const reason = (world as GameWorld).deathSignal
            if (!reason || triggered) return
            triggered = true
            pushLog(world as GameWorld, `${REASON_LABEL[reason]} — restarting level.`)
            overlay = mountOverlay(REASON_LABEL[reason])
            // Slight delay so the overlay is visible — straight reload
            // feels jarring because the user has no idea why the page
            // suddenly blanked.
            setTimeout(() => {
                window.location.reload()
            }, 650)
        },
        dispose() {
            overlay?.remove()
        },
    }
}

function mountOverlay(text: string): HTMLElement {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = [
        'position: fixed',
        'inset: 0',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'background: rgba(8, 12, 16, 0.78)',
        'color: #ff8a5a',
        'font: 600 28px ui-sans-serif, system-ui, sans-serif',
        'letter-spacing: 0.04em',
        'z-index: 2000',
        'pointer-events: none',
    ].join('; ')
    document.body.appendChild(el)
    return el
}
