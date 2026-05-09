import { el, type Disposable } from './primitives'

export class UiLogPanel implements Disposable {
    readonly element: HTMLDivElement

    constructor(parent: HTMLElement = document.body) {
        this.element = el('div', { className: 'ui-log-panel' })
        parent.appendChild(this.element)
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible
    }

    setLines(lines: readonly string[], maxLines = 6): void {
        this.element.textContent = lines.slice(-maxLines).join('\n')
    }

    dispose(): void {
        this.element.remove()
    }
}

