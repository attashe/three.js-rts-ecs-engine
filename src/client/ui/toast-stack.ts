import { el, type Disposable } from './primitives'

export type ToastTone = 'default' | 'ok' | 'danger'

export interface ToastOptions {
    tone?: ToastTone
    timeoutMs?: number
}

export class ToastStack implements Disposable {
    readonly element: HTMLDivElement
    private readonly timers = new Set<number>()

    constructor(parent: HTMLElement = document.body) {
        this.element = el('div', { className: 'ui-toast-stack', attrs: { 'aria-live': 'polite' } })
        parent.appendChild(this.element)
    }

    show(message: string, options: ToastOptions = {}): void {
        const tone = options.tone ?? 'default'
        const toast = el('div', {
            className: ['ui-toast', tone !== 'default' ? `ui-toast--${tone}` : ''].filter(Boolean).join(' '),
            text: message,
        })
        this.element.appendChild(toast)

        const timeout = window.setTimeout(() => {
            toast.remove()
            this.timers.delete(timeout)
        }, options.timeoutMs ?? 2200)
        this.timers.add(timeout)
    }

    dispose(): void {
        for (const timer of this.timers) window.clearTimeout(timer)
        this.timers.clear()
        this.element.remove()
    }
}
