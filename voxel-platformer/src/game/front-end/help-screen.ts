import type { ActionMap } from '../../engine/input/actions'
import { createOverlayRoot, createShell, keyBadge, menuButton, panelTitle, setOverlayVisible } from '../ui/menu-kit'

export interface HelpScreenOptions {
    actions: ActionMap
    onBack: () => void
}

export interface HelpScreen {
    show(): void
    hide(): void
    dispose(): void
}

const HOW_TO_PLAY: readonly string[] = [
    'Explore from the cliffs down into the caves and up to the summit.',
    'Move with WASD or the arrow keys; Space to jump, Shift+Space for a high jump.',
    'Left-click to attack. Right-click to block with a shield, or cast with a staff.',
    'Press E to interact — open doors and chests, ride carts, talk to folk, use portals.',
    'Tab opens your inventory; F uses the selected consumable; Esc opens the menu.',
]

/** Help overlay: a short "how to play" plus the live controls legend
 *  (auto-generated from the action bindings, so it always matches). */
export function createHelpScreen(opts: HelpScreenOptions): HelpScreen {
    const root = createOverlayRoot(1900)
    root.id = 'vp-help-screen'
    const shell = createShell(460)
    root.appendChild(shell)

    shell.appendChild(panelTitle('How to play'))

    const intro = document.createElement('ul')
    Object.assign(intro.style, {
        margin: '0 0 6px',
        paddingLeft: '18px',
        color: 'rgba(238, 246, 242, 0.82)',
        fontSize: '13px',
        lineHeight: '1.5',
    } satisfies Partial<CSSStyleDeclaration>)
    for (const line of HOW_TO_PLAY) {
        const li = document.createElement('li')
        li.textContent = line
        li.style.margin = '4px 0'
        intro.appendChild(li)
    }
    shell.appendChild(intro)

    shell.appendChild(buildControlsLegend(opts.actions))
    shell.appendChild(menuButton('Back', opts.onBack))

    document.body.appendChild(root)
    setOverlayVisible(root, false)

    return {
        show() { setOverlayVisible(root, true) },
        hide() { setOverlayVisible(root, false) },
        dispose() { root.remove() },
    }
}

function buildControlsLegend(actions: ActionMap): HTMLDivElement {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        margin: '14px 0 12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(238, 246, 242, 0.12)',
    } satisfies Partial<CSSStyleDeclaration>)

    const title = document.createElement('h2')
    title.textContent = 'Controls'
    Object.assign(title.style, { margin: '0 0 10px', fontSize: '13px', fontWeight: '700' } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(title)

    for (const definition of actions.all()) {
        const keys = actions.bindingDisplayKeysFor(definition.id)
        if (keys.length === 0) continue
        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: '12px',
            padding: '6px 0',
            borderBottom: '1px solid rgba(238, 246, 242, 0.07)',
        } satisfies Partial<CSSStyleDeclaration>)

        const label = document.createElement('span')
        label.textContent = definition.label
        label.style.color = 'rgba(238, 246, 242, 0.78)'

        const keyGroup = document.createElement('span')
        keyGroup.style.display = 'flex'
        keyGroup.style.flexWrap = 'wrap'
        keyGroup.style.justifyContent = 'flex-end'
        keyGroup.style.gap = '4px'
        for (const key of keys) keyGroup.appendChild(keyBadge(key))

        row.append(label, keyGroup)
        panel.appendChild(row)
    }
    return panel
}
