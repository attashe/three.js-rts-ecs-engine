import { type ActionMap, type ActionBinding, formatKeyCodeForDisplay } from '../../engine/input/actions'
import { mouseButtonCode } from '../../engine/input/input'
import {
    GAME_ACTIONS,
    GameAction,
    createGameActionDefinitions,
    saveKeyOverrides,
    loadStoredKeyOverrides,
    type GameKeyboardOverrides,
    type GameActionId,
} from '../actions'
import { keyBadge, menuButton } from '../ui/menu-kit'

export interface ControlsPanel {
    element: HTMLElement
    dispose(): void
}

// Chord / contextual actions keep their fixed defaults — single-binding remap
// only for v1 (Shift+Space high jump, and the RMB block/cast pair).
const NON_REBINDABLE = new Set<string>([
    GameAction.HighJump,
    GameAction.RaiseShield,
    GameAction.CastSpell,
])

const DEFAULT_BINDINGS: ReadonlyMap<string, readonly ActionBinding[]> = new Map(
    createGameActionDefinitions({}).map((d) => [d.id, d.bindings ?? []]),
)

/** Editable controls panel for the Settings menu: rebind a key or mouse
 *  button per action, with persistence + reset. */
export function createControlsPanel(actions: ActionMap): ControlsPanel {
    const overrides: GameKeyboardOverrides = { ...loadStoredKeyOverrides() }
    let capturing: (() => void) | null = null

    const panel = document.createElement('div')
    Object.assign(panel.style, {
        margin: '18px 0 12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(238, 246, 242, 0.12)',
    } satisfies Partial<CSSStyleDeclaration>)

    const title = document.createElement('h2')
    title.textContent = 'Controls'
    Object.assign(title.style, { margin: '0 0 10px', fontSize: '13px', fontWeight: '700' } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(title)

    const rowsHost = document.createElement('div')
    panel.appendChild(rowsHost)

    const note = document.createElement('div')
    Object.assign(note.style, { minHeight: '14px', margin: '6px 0', fontSize: '11px', color: 'rgba(255, 196, 120, 0.9)' } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(note)

    panel.appendChild(menuButton('Reset controls to defaults', () => {
        for (const [id, bindings] of DEFAULT_BINDINGS) actions.rebind(id, bindings)
        for (const key of Object.keys(overrides)) delete overrides[key as GameActionId]
        saveKeyOverrides(overrides)
        note.textContent = 'Controls reset to defaults.'
        render()
    }))

    function cancelCapture(): void {
        capturing?.()
        capturing = null
    }

    function beginCapture(id: GameActionId, label: string): void {
        cancelCapture()
        note.textContent = `Press a key or mouse button for "${label}" — Esc to cancel.`
        render()

        const finish = (code: string | null): void => {
            cancelCapture()
            if (code) applyBinding(id, code, label)
            else note.textContent = ''
            render()
        }
        const onKey = (e: KeyboardEvent): void => {
            e.preventDefault(); e.stopPropagation()
            if (e.code === 'Escape') return finish(null)
            // Ignore lone modifier presses — wait for a real key.
            if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return
            finish(e.code)
        }
        const onPointer = (e: PointerEvent): void => {
            e.preventDefault(); e.stopPropagation()
            finish(mouseButtonCode(e.button))
        }
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('pointerdown', onPointer, true)
        capturing = () => {
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('pointerdown', onPointer, true)
        }
    }

    function applyBinding(id: GameActionId, code: string, label: string): void {
        const clash = actions.all().find((d) => d.id !== id && (d.bindings ?? []).some((b) => b.keys.includes(code)))
        actions.rebind(id, [{ keys: [code] }])
        overrides[id] = [code]
        saveKeyOverrides(overrides)
        note.textContent = clash
            ? `Bound "${label}" to ${formatKeyCodeForDisplay(code)} — also used by "${clash.label}".`
            : `Bound "${label}" to ${formatKeyCodeForDisplay(code)}.`
    }

    function render(): void {
        rowsHost.replaceChildren()
        for (const definition of GAME_ACTIONS) {
            const keys = actions.bindingDisplayKeysFor(definition.id)
            if (keys.length === 0) continue
            const editable = !NON_REBINDABLE.has(definition.id)

            const row = document.createElement('div')
            Object.assign(row.style, {
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 0',
                borderBottom: '1px solid rgba(238, 246, 242, 0.07)',
            } satisfies Partial<CSSStyleDeclaration>)

            const label = document.createElement('span')
            label.textContent = definition.label
            label.style.color = 'rgba(238, 246, 242, 0.78)'

            const keyGroup = document.createElement('span')
            keyGroup.style.display = 'flex'
            keyGroup.style.gap = '4px'
            keyGroup.style.justifyContent = 'flex-end'
            for (const key of keys) keyGroup.appendChild(keyBadge(key))

            row.append(label, keyGroup)
            if (editable) {
                const rebindBtn = document.createElement('button')
                rebindBtn.type = 'button'
                rebindBtn.textContent = 'Rebind'
                Object.assign(rebindBtn.style, {
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '1px solid rgba(238, 246, 242, 0.24)',
                    background: 'rgba(33, 44, 48, 0.92)',
                    color: '#eef6f2',
                    font: '600 11px ui-sans-serif, system-ui, sans-serif',
                    cursor: 'pointer',
                } satisfies Partial<CSSStyleDeclaration>)
                rebindBtn.onclick = () => beginCapture(definition.id as GameActionId, definition.label)
                row.append(rebindBtn)
            } else {
                row.append(document.createElement('span'))
            }
            rowsHost.appendChild(row)
        }
    }

    render()
    return { element: panel, dispose: cancelCapture }
}
