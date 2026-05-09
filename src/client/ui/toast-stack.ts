import { el, type Disposable } from './primitives'

export type ToastTone = 'default' | 'ok' | 'danger'

export interface ToastOptions {
    tone?: ToastTone
    timeoutMs?: number
}

export interface ToastStackOptions {
    /** Hard cap on concurrent toasts. Older toasts are evicted FIFO once the
     *  cap is reached, so a spammy notify caller (combat log, air-push count)
     *  can't fill the viewport. Default 4. */
    maxConcurrent?: number
}

interface LiveToast {
    node: HTMLElement
    timer: number
}

export class ToastStack implements Disposable {
    readonly element: HTMLDivElement
    private readonly toasts: LiveToast[] = []
    private readonly maxConcurrent: number

    constructor(parent: HTMLElement = document.body, options: ToastStackOptions = {}) {
        this.element = el('div', { className: 'ui-toast-stack', attrs: { 'aria-live': 'polite' } })
        this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 4)
        parent.appendChild(this.element)
    }

    show(message: string, options: ToastOptions = {}): void {
        // Evict the oldest toasts until we're under the cap.
        while (this.toasts.length >= this.maxConcurrent) {
            const oldest = this.toasts.shift()
            if (!oldest) break
            window.clearTimeout(oldest.timer)
            oldest.node.remove()
        }

        const tone = options.tone ?? 'default'
        const node = el('div', {
            className: ['ui-toast', tone !== 'default' ? `ui-toast--${tone}` : ''].filter(Boolean).join(' '),
            text: message,
        })
        this.element.appendChild(node)

        const live: LiveToast = { node, timer: 0 }
        live.timer = window.setTimeout(() => {
            this.expire(live)
        }, options.timeoutMs ?? 2200)
        this.toasts.push(live)
    }

    dispose(): void {
        for (const live of this.toasts) {
            window.clearTimeout(live.timer)
            live.node.remove()
        }
        this.toasts.length = 0
        this.element.remove()
    }

    private expire(live: LiveToast): void {
        const idx = this.toasts.indexOf(live)
        if (idx < 0) return
        this.toasts.splice(idx, 1)
        live.node.remove()
    }
}
