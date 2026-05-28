import type { AudioBusId, AudioEngine } from '../engine/audio'
import type { GameWorld } from '../engine/ecs/world'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { Input } from '../engine/input/input'
import { getDebugInfoEnabled, setDebugInfoEnabled, subscribeDebugInfo } from '../engine/render/render-settings'

export interface GameMenuSystemOptions {
    renderElement?: HTMLElement
    exitHref?: string
    storageKey?: string
}

interface GameMenuSettings {
    masterVolume: number
    musicVolume: number
    sfxVolume: number
    brightness: number
}

const DEFAULT_SETTINGS: GameMenuSettings = {
    masterVolume: 1,
    musicVolume: 1,
    sfxVolume: 1,
    brightness: 1,
}

export function createGameMenuSystem(
    input: Input,
    actions: ActionMap,
    audio: AudioEngine,
    opts: GameMenuSystemOptions = {},
): System {
    const storageKey = opts.storageKey ?? 'voxel-platformer.settings'
    const settings = loadSettings(storageKey)
    let root: HTMLDivElement | null = null
    let menuPanel: HTMLDivElement | null = null
    let settingsPanel: HTMLDivElement | null = null
    let returnButton: HTMLButtonElement | null = null
    let unsubscribeDebugInfo: (() => void) | null = null
    let open = false

    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.code !== 'Escape' || ev.repeat) return
        ev.preventDefault()
        ev.stopPropagation()
        ev.stopImmediatePropagation()
        setOpen(!open)
    }

    function setOpen(next: boolean): void {
        open = next
        input.setEnabled(!open)
        input.clear()
        if (!root) return
        setRootVisible(root, open)
        if (open) {
            showMenu()
            setTimeout(() => returnButton?.focus(), 0)
        }
    }

    function showMenu(): void {
        if (menuPanel) setPanelVisible(menuPanel, true)
        if (settingsPanel) setPanelVisible(settingsPanel, false)
    }

    function showSettings(): void {
        if (menuPanel) setPanelVisible(menuPanel, false)
        if (settingsPanel) setPanelVisible(settingsPanel, true)
    }

    function applySettings(ramp = 0): void {
        setBusVolume(audio, 'master', settings.masterVolume, ramp)
        setBusVolume(audio, 'music', settings.musicVolume, ramp)
        setBusVolume(audio, 'sfx', settings.sfxVolume, ramp)
        setBusVolume(audio, 'ui', settings.sfxVolume, ramp)
        setBusVolume(audio, 'stinger', settings.sfxVolume, ramp)
        const element = opts.renderElement
        if (element) element.style.filter = `brightness(${settings.brightness.toFixed(2)})`
    }

    return {
        name: 'gameMenu',
        order: RenderOrder.debug + 20,
        init(_world: GameWorld) {
            applySettings()
            const built = buildMenu({
                actions,
                settings,
                onReturn: () => setOpen(false),
                onSettings: showSettings,
                onBack: showMenu,
                onExit: () => { window.location.href = opts.exitHref ?? './editor.html' },
                onSettingsChanged: () => {
                    saveSettings(storageKey, settings)
                    applySettings(0.05)
                },
            })
            root = built.root
            menuPanel = built.menuPanel
            settingsPanel = built.settingsPanel
            returnButton = built.returnButton
            unsubscribeDebugInfo = subscribeDebugInfo((enabled) => {
                built.debugInfoInput.checked = enabled
            })
            document.body.appendChild(root)
            setRootVisible(root, false)
            window.addEventListener('keydown', onKeyDown, { capture: true })
        },
        update() {
            if (open) input.clear()
        },
        dispose() {
            window.removeEventListener('keydown', onKeyDown, true)
            input.setEnabled(true)
            root?.remove()
            unsubscribeDebugInfo?.()
            if (opts.renderElement) opts.renderElement.style.filter = ''
            root = null
            menuPanel = null
            settingsPanel = null
            returnButton = null
            unsubscribeDebugInfo = null
        },
    }
}

interface BuildMenuOptions {
    actions: ActionMap
    settings: GameMenuSettings
    onReturn: () => void
    onSettings: () => void
    onBack: () => void
    onExit: () => void
    onSettingsChanged: () => void
}

function buildMenu(opts: BuildMenuOptions): {
    root: HTMLDivElement
    menuPanel: HTMLDivElement
    settingsPanel: HTMLDivElement
    returnButton: HTMLButtonElement
    debugInfoInput: HTMLInputElement
} {
    const root = document.createElement('div')
    root.id = 'voxel-platformer-menu'
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1800',
        display: 'none',
        placeItems: 'center',
        background: 'rgba(3, 7, 10, 0.54)',
        color: '#eef6f2',
        font: '14px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)

    const shell = document.createElement('div')
    Object.assign(shell.style, {
        width: 'min(460px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        background: 'rgba(13, 18, 21, 0.94)',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
        borderRadius: '8px',
        padding: '18px',
    } satisfies Partial<CSSStyleDeclaration>)
    root.appendChild(shell)

    const menuPanel = document.createElement('div')
    const settingsPanel = document.createElement('div')
    shell.append(menuPanel, settingsPanel)

    const title = document.createElement('h1')
    title.textContent = 'Menu'
    Object.assign(title.style, titleStyle())
    menuPanel.appendChild(title)

    const returnButton = menuButton('Return', opts.onReturn)
    const settingsButton = menuButton('Settings', opts.onSettings)
    const exitButton = menuButton('Exit to Editor', opts.onExit)
    menuPanel.append(returnButton, settingsButton, exitButton)

    const settingsTitle = document.createElement('h1')
    settingsTitle.textContent = 'Settings'
    Object.assign(settingsTitle.style, titleStyle())
    settingsPanel.appendChild(settingsTitle)
    const debugInfoRow = checkboxRow('Debug info', getDebugInfoEnabled(), (enabled) => {
        setDebugInfoEnabled(enabled)
    })
    settingsPanel.append(
        debugInfoRow.row,
        sliderRow('Sound', opts.settings.masterVolume, 0, 1, 0.01, (value) => {
            opts.settings.masterVolume = value
            opts.onSettingsChanged()
        }),
        sliderRow('Music', opts.settings.musicVolume, 0, 1, 0.01, (value) => {
            opts.settings.musicVolume = value
            opts.onSettingsChanged()
        }),
        sliderRow('Effects', opts.settings.sfxVolume, 0, 1, 0.01, (value) => {
            opts.settings.sfxVolume = value
            opts.onSettingsChanged()
        }),
        sliderRow('Brightness', opts.settings.brightness, 0.55, 1.35, 0.01, (value) => {
            opts.settings.brightness = value
            opts.onSettingsChanged()
        }),
        keyboardPanel(opts.actions),
        menuButton('Back', opts.onBack),
    )
    setPanelVisible(settingsPanel, false)

    return { root, menuPanel, settingsPanel, returnButton, debugInfoInput: debugInfoRow.input }
}

function setRootVisible(root: HTMLElement, visible: boolean): void {
    root.style.display = visible ? 'grid' : 'none'
    root.style.pointerEvents = visible ? 'auto' : 'none'
    root.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

function setPanelVisible(panel: HTMLElement, visible: boolean): void {
    panel.style.display = visible ? 'block' : 'none'
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.onclick = onClick
    Object.assign(button.style, {
        display: 'block',
        width: '100%',
        minHeight: '40px',
        margin: '8px 0',
        padding: '9px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(238, 246, 242, 0.24)',
        background: 'rgba(33, 44, 48, 0.92)',
        color: '#eef6f2',
        font: '600 13px ui-sans-serif, system-ui, sans-serif',
        textAlign: 'left',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    button.onmouseenter = () => { button.style.background = 'rgba(48, 64, 69, 0.96)' }
    button.onmouseleave = () => { button.style.background = 'rgba(33, 44, 48, 0.92)' }
    return button
}

function checkboxRow(
    labelText: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
): { row: HTMLLabelElement; input: HTMLInputElement } {
    const label = document.createElement('label')
    Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '10px',
        margin: '12px 0',
        color: 'rgba(238, 246, 242, 0.78)',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)

    const text = document.createElement('span')
    text.textContent = labelText

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.onchange = () => onChange(input.checked)

    label.append(text, input)
    return { row: label, input }
}

function sliderRow(
    labelText: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): HTMLLabelElement {
    const label = document.createElement('label')
    Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: '92px minmax(0, 1fr) 42px',
        alignItems: 'center',
        gap: '10px',
        margin: '12px 0',
    } satisfies Partial<CSSStyleDeclaration>)

    const text = document.createElement('span')
    text.textContent = labelText
    text.style.color = 'rgba(238, 246, 242, 0.78)'

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.style.width = '100%'

    const output = document.createElement('span')
    output.textContent = `${Math.round(value * 100)}%`
    output.style.textAlign = 'right'
    output.style.fontVariantNumeric = 'tabular-nums'

    input.oninput = () => {
        const next = Number(input.value)
        output.textContent = `${Math.round(next * 100)}%`
        onChange(next)
    }

    label.append(text, input, output)
    return label
}

function keyboardPanel(actions: ActionMap): HTMLDivElement {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        margin: '18px 0 12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(238, 246, 242, 0.12)',
    } satisfies Partial<CSSStyleDeclaration>)

    const title = document.createElement('h2')
    title.textContent = 'Keyboard'
    Object.assign(title.style, {
        margin: '0 0 10px',
        fontSize: '13px',
        fontWeight: '700',
    } satisfies Partial<CSSStyleDeclaration>)
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

function keyBadge(key: string): HTMLSpanElement {
    const badge = document.createElement('span')
    badge.textContent = key
    Object.assign(badge.style, {
        minWidth: '24px',
        padding: '3px 7px',
        borderRadius: '4px',
        border: '1px solid rgba(238, 246, 242, 0.22)',
        background: 'rgba(238, 246, 242, 0.08)',
        color: '#eef6f2',
        font: '600 11px ui-monospace, monospace',
        textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>)
    return badge
}

function titleStyle(): Partial<CSSStyleDeclaration> {
    return {
        margin: '0 0 14px',
        fontSize: '18px',
        lineHeight: '1.2',
        letterSpacing: '0',
    }
}

function setBusVolume(audio: AudioEngine, bus: AudioBusId, value: number, ramp: number): void {
    audio.setBusVolume(bus, clamp(value, 0, 1), ramp)
}

function loadSettings(storageKey: string): GameMenuSettings {
    try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return { ...DEFAULT_SETTINGS }
        const parsed = JSON.parse(raw) as Partial<GameMenuSettings>
        return {
            masterVolume: clamp(parsed.masterVolume ?? DEFAULT_SETTINGS.masterVolume, 0, 1),
            musicVolume: clamp(parsed.musicVolume ?? DEFAULT_SETTINGS.musicVolume, 0, 1),
            sfxVolume: clamp(parsed.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume, 0, 1),
            brightness: clamp(parsed.brightness ?? DEFAULT_SETTINGS.brightness, 0.55, 1.35),
        }
    } catch {
        return { ...DEFAULT_SETTINGS }
    }
}

function saveSettings(storageKey: string, settings: GameMenuSettings): void {
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(settings))
    } catch {
        // Browsers may deny storage in private contexts; settings still apply in memory.
    }
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}
