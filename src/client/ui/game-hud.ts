import { CommandHintBar, type CommandHint } from './command-hint-bar'
import { ToastStack } from './toast-stack'
import { el, fatalOverlay, type Disposable, type UiChild, type UiWidget } from './primitives'

export type HudRegion =
    'top-left' |
    'top-center' |
    'top-right' |
    'bottom-left' |
    'bottom-center' |
    'bottom-right'

export class GameHud implements Disposable {
    readonly element: HTMLDivElement
    readonly toast: ToastStack
    private readonly regions = new Map<HudRegion, HTMLDivElement>()
    private readonly disposables: Disposable[] = []

    constructor(parent: HTMLElement = document.body) {
        this.element = el('div', { className: 'ui-root ui-hud' })
        for (const region of [
            'top-left',
            'top-center',
            'top-right',
            'bottom-left',
            'bottom-center',
            'bottom-right',
        ] as HudRegion[]) {
            const node = el('div', { className: `ui-hud__${region}` })
            this.regions.set(region, node)
            this.element.appendChild(node)
        }
        parent.appendChild(this.element)
        this.toast = new ToastStack(parent)
    }

    add(region: HudRegion, child: HTMLElement | UiWidget): void {
        const node = child instanceof HTMLElement ? child : child.element
        this.regions.get(region)?.appendChild(node)
        if (!(child instanceof HTMLElement)) this.disposables.push(child)
    }

    addStack(region: HudRegion, children: UiChild[]): HTMLDivElement {
        const stack = el('div', { className: 'ui-stack', children })
        this.add(region, stack)
        return stack
    }

    setCommandHints(hints: CommandHint[]): CommandHintBar {
        const bar = new CommandHintBar(hints)
        this.add('bottom-center', bar)
        return bar
    }

    notify(message: string): void {
        this.toast.show(message)
    }

    fatal(message: string): HTMLElement {
        return fatalOverlay(message)
    }

    dispose(): void {
        for (const disposable of this.disposables) disposable.dispose()
        this.disposables.length = 0
        this.toast.dispose()
        this.element.remove()
    }
}
