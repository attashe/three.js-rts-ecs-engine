import { el, kbd, type Disposable } from './primitives'

export interface CommandHint {
    keys: string[]
    label: string
}

export class CommandHintBar implements Disposable {
    readonly element: HTMLDivElement

    constructor(hints: CommandHint[] = []) {
        this.element = el('div', { className: 'ui-command-bar' })
        this.setHints(hints)
    }

    setHints(hints: CommandHint[]): void {
        this.element.replaceChildren()
        for (const hint of hints) {
            this.element.append(el('span', {
                className: 'ui-command-bar__item',
                children: [
                    ...hint.keys.map((key) => kbd(key)),
                    el('span', { text: hint.label }),
                ],
            }))
        }
    }

    dispose(): void {
        this.element.remove()
    }
}
