import { createOverlayRoot, createShell, menuButton, panelTitle, setOverlayVisible } from '../ui/menu-kit'

export interface LevelSelectEntry {
    id: string
    title: string
    description?: string
}

export interface LevelSelectOptions {
    entries: readonly LevelSelectEntry[]
    onPick: (id: string) => void
    onBack: () => void
}

export interface LevelSelect {
    show(): void
    hide(): void
    dispose(): void
}

/** Curated level picker (the public arc levels). */
export function createLevelSelect(opts: LevelSelectOptions): LevelSelect {
    const root = createOverlayRoot(1900)
    root.id = 'vp-level-select'
    const shell = createShell(440)
    root.appendChild(shell)

    shell.appendChild(panelTitle('Level Select'))

    for (const entry of opts.entries) {
        const button = menuButton(entry.title, () => opts.onPick(entry.id))
        if (entry.description) {
            const desc = document.createElement('div')
            desc.textContent = entry.description
            Object.assign(desc.style, {
                marginTop: '3px',
                fontWeight: '400',
                fontSize: '11px',
                color: 'rgba(238, 246, 242, 0.6)',
            } satisfies Partial<CSSStyleDeclaration>)
            button.appendChild(desc)
        }
        shell.appendChild(button)
    }

    shell.appendChild(menuButton('Back', opts.onBack))

    document.body.appendChild(root)
    setOverlayVisible(root, false)

    return {
        show() { setOverlayVisible(root, true) },
        hide() { setOverlayVisible(root, false) },
        dispose() { root.remove() },
    }
}
