import type { TemplateStore, FxTemplate } from './template-store'
import { el } from './ui-helpers'

export interface PaletteHandle {
    element: HTMLElement
    refresh(): void
}

export interface PaletteCallbacks {
    /** Click on a palette card → spawn a zone at the demo's target. */
    onSpawn(template: FxTemplate): void
    /** Edit icon → open the constructor pre-filled with this template. */
    onEdit(template: FxTemplate): void
    /** + New custom button — should open the constructor on a clone of
     *  the user's choice. The fx-demo orchestrator picks the source. */
    onNewCustom(): void
    /** Currently-selected template id (so the card can show "active"). */
    activeId(): string | null
}

/**
 * Renders the FX template palette as a grid of cards. Each card
 * shows a colour swatch + label; clicking spawns, the pencil opens
 * the constructor, the trash deletes (custom only).
 *
 * The list re-renders on every template-store change.
 */
export function mountPalette(opts: { store: TemplateStore; root: HTMLElement } & PaletteCallbacks): PaletteHandle {
    const grid = el('div', 'palette-grid')
    const toolbar = el('div', 'row')
    toolbar.style.marginBottom = '8px'
    const newBtn = el('button')
    newBtn.textContent = '+ New from template'
    newBtn.title = 'Create a custom template by cloning one of the built-ins'
    newBtn.style.flex = '1'
    newBtn.onclick = () => opts.onNewCustom()
    toolbar.appendChild(newBtn)
    opts.root.append(toolbar, grid)

    function render(): void {
        grid.innerHTML = ''
        const active = opts.activeId()
        for (const template of opts.store.list()) {
            const card = el('div', 'palette-card')
            if (template.id === active) card.classList.add('active')
            if (!template.builtin) card.classList.add('custom')

            const swatch = el('span', 'swatch')
            swatch.style.background = template.params.color || '#888'

            const label = el('span', 'label', template.label)
            label.title = `${template.label} · ${template.params.type}`

            const spawn = el('button', 'spawn')
            spawn.textContent = '+'
            spawn.title = 'Spawn at the camera target'
            spawn.onclick = (ev) => { ev.stopPropagation(); opts.onSpawn(template) }

            const edit = el('button', 'edit')
            edit.textContent = '✎'
            edit.title = 'Edit in constructor'
            edit.onclick = (ev) => { ev.stopPropagation(); opts.onEdit(template) }

            const actions = el('div', 'actions')
            actions.append(spawn, edit)

            if (!template.builtin) {
                const del = el('button', 'del')
                del.textContent = '×'
                del.title = 'Delete custom template'
                del.onclick = (ev) => {
                    ev.stopPropagation()
                    if (window.confirm(`Delete "${template.label}"?`)) opts.store.removeCustom(template.id)
                }
                actions.appendChild(del)
            }

            card.onclick = () => opts.onEdit(template)
            card.append(swatch, label, actions)
            grid.appendChild(card)
        }
        if (grid.children.length === 0) {
            const empty = el('div', 'hint')
            empty.textContent = 'No templates yet — should never happen, file a bug.'
            grid.appendChild(empty)
        }
    }

    opts.store.onChange(render)
    render()

    return { element: grid, refresh: render }
}
