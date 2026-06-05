import type { AudioBusId, AudioEngine } from '../engine/audio'
import type { GameWorld } from '../engine/ecs/world'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { Input } from '../engine/input/input'
import { getDebugInfoEnabled, setDebugInfoEnabled, subscribeDebugInfo } from '../engine/render/render-settings'
import {
    checkboxRow,
    createOverlayRoot,
    createShell,
    menuButton,
    panelTitle,
    setOverlayVisible,
    setPanelVisible,
    sliderRow,
} from './ui/menu-kit'
import { createControlsPanel } from './front-end/controls-rebind'

export interface GameMenuSystemOptions {
    renderElement?: HTMLElement
    exitHref?: string
    storageKey?: string
    /** Return to the title screen (public build). Replaces "Exit to Editor". */
    onMainMenu?: () => void
    /** Open the help screen from the pause menu. */
    onHelp?: () => void
}

/** Pause-menu controller: the engine system + handles so the title screen can
 *  open Settings, and the host can drive open/close. */
export interface GameMenuController {
    system: System
    setOpen(open: boolean): void
    openSettings(): void
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
): GameMenuController {
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
        setOverlayVisible(root, open)
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

    let controlsDispose: (() => void) | null = null

    const system: System = {
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
                onMainMenu: opts.onMainMenu,
                onHelp: opts.onHelp,
                onSettingsChanged: () => {
                    saveSettings(storageKey, settings)
                    applySettings(0.05)
                },
            })
            root = built.root
            menuPanel = built.menuPanel
            settingsPanel = built.settingsPanel
            returnButton = built.returnButton
            controlsDispose = built.controlsDispose
            unsubscribeDebugInfo = subscribeDebugInfo((enabled) => {
                built.debugInfoInput.checked = enabled
            })
            document.body.appendChild(root)
            setOverlayVisible(root, false)
            window.addEventListener('keydown', onKeyDown, { capture: true })
        },
        update() {
            if (open) input.clear()
        },
        dispose() {
            window.removeEventListener('keydown', onKeyDown, true)
            input.setEnabled(true)
            controlsDispose?.()
            root?.remove()
            unsubscribeDebugInfo?.()
            if (opts.renderElement) opts.renderElement.style.filter = ''
            root = null
            menuPanel = null
            settingsPanel = null
            returnButton = null
            unsubscribeDebugInfo = null
            controlsDispose = null
        },
    }

    return {
        system,
        setOpen,
        openSettings() { setOpen(true); showSettings() },
    }
}

interface BuildMenuOptions {
    actions: ActionMap
    settings: GameMenuSettings
    onReturn: () => void
    onSettings: () => void
    onBack: () => void
    onExit: () => void
    onMainMenu?: () => void
    onHelp?: () => void
    onSettingsChanged: () => void
}

function buildMenu(opts: BuildMenuOptions): {
    root: HTMLDivElement
    menuPanel: HTMLDivElement
    settingsPanel: HTMLDivElement
    returnButton: HTMLButtonElement
    debugInfoInput: HTMLInputElement
    controlsDispose: () => void
} {
    const root = createOverlayRoot(1800)
    root.id = 'voxel-platformer-menu'
    const shell = createShell()
    root.appendChild(shell)

    const menuPanel = document.createElement('div')
    const settingsPanel = document.createElement('div')
    shell.append(menuPanel, settingsPanel)

    menuPanel.appendChild(panelTitle('Menu'))

    const returnButton = menuButton('Return', opts.onReturn)
    menuPanel.append(returnButton, menuButton('Settings', opts.onSettings))
    if (opts.onHelp) menuPanel.append(menuButton('Help', opts.onHelp))
    // Public build returns to the title; dev build exits to the editor.
    if (opts.onMainMenu) menuPanel.append(menuButton('Main Menu', opts.onMainMenu))
    else if (!__GAME_BUILD__) menuPanel.append(menuButton('Exit to Editor', opts.onExit))

    settingsPanel.appendChild(panelTitle('Settings'))
    const controls = createControlsPanel(opts.actions)
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
        controls.element,
        menuButton('Back', opts.onBack),
    )
    setPanelVisible(settingsPanel, false)

    return { root, menuPanel, settingsPanel, returnButton, debugInfoInput: debugInfoRow.input, controlsDispose: controls.dispose }
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
