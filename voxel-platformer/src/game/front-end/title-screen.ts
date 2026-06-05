import { createOverlayRoot, createShell, menuButton, setOverlayVisible } from '../ui/menu-kit'

export interface TitleScreenOptions {
    title?: string
    subtitle?: string
    onPlay: () => void
    onLevelSelect: () => void
    onSettings: () => void
    onHelp: () => void
}

export interface TitleScreen {
    show(): void
    hide(): void
    readonly visible: boolean
    dispose(): void
}

/** The main-menu overlay shown before any level loads (and via the pause
 *  menu's "Main Menu"). Mounts hidden; call `show()`. */
export function createTitleScreen(opts: TitleScreenOptions): TitleScreen {
    const root = createOverlayRoot(1900)
    root.id = 'vp-title-screen'
    const shell = createShell(420)
    root.appendChild(shell)

    const heading = document.createElement('h1')
    heading.textContent = opts.title ?? 'Voxel Platformer'
    Object.assign(heading.style, {
        margin: '4px 0 2px',
        fontSize: '30px',
        lineHeight: '1.1',
        letterSpacing: '0.5px',
        textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>)

    const subtitle = document.createElement('p')
    subtitle.textContent = opts.subtitle ?? 'From the cliffs, through the caves, to the summit.'
    Object.assign(subtitle.style, {
        margin: '0 0 18px',
        textAlign: 'center',
        color: 'rgba(238, 246, 242, 0.62)',
        fontSize: '13px',
    } satisfies Partial<CSSStyleDeclaration>)

    shell.append(
        heading,
        subtitle,
        menuButton('Play', opts.onPlay),
        menuButton('Level Select', opts.onLevelSelect),
        menuButton('Settings', opts.onSettings),
        menuButton('Help', opts.onHelp),
    )

    document.body.appendChild(root)
    setOverlayVisible(root, false)
    let visible = false

    return {
        show() { visible = true; setOverlayVisible(root, true) },
        hide() { visible = false; setOverlayVisible(root, false) },
        get visible() { return visible },
        dispose() { root.remove() },
    }
}
