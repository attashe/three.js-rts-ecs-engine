import type { System } from './system'
import { RenderOrder } from './orders'
import { pushLog, type GameWorld, type DeathReason } from '../world'

const REASON_LABEL: Record<DeathReason, string> = {
    'fell-into-void': 'You fell off the world',
    'crushed-by-piston': 'Crushed by a piston',
    'manual-restart': 'Restarting…',
    'killed-by-zone-script': 'Killed by a trigger',
}

/**
 * Render-side watcher that triggers a page reload when
 * `world.deathSignal` is set. A brief delay shows a restart overlay so
 * the user understands what happened. By default it reloads the page;
 * callers can provide `onRestart` to rebuild the current location in-place.
 */
export interface RestartSystemOptions {
    onRestart?: (reason: DeathReason) => void | Promise<void>
}

export function createRestartSystem(opts: RestartSystemOptions = {}): System {
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
                if (!opts.onRestart) {
                    window.location.reload()
                    return
                }
                Promise.resolve(opts.onRestart(reason))
                    .catch((err) => {
                        console.error('Restart failed:', err)
                        window.location.reload()
                    })
                    .finally(() => {
                        overlay?.remove()
                        overlay = null
                        triggered = false
                        world.deathSignal = null
                    })
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
