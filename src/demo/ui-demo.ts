import {
    CommandHintBar,
    EditorShell,
    GameHud,
    ToastStack,
    UiMeter,
    UiSlot,
    button,
    el,
    fatalOverlay,
    iconButton,
    kbd,
    panel,
    sectionTitle,
    toolbar,
    toolbarSeparator,
} from '../client/ui'
import { createDefaultPlayerLoadout } from '../client/engine/ecs/world'

const app = el('main', { className: 'ui-root ui-demo-page' })
document.body.appendChild(app)

const toast = new ToastStack()
const hud = new GameHud()
hud.setVitals({ health: 72, maxHealth: 100, mana: 46, maxMana: 60, stamina: 83, maxStamina: 100 })
hud.setInventory({ gold: 128, potions: 2, arrows: 11 })
hud.setLoadout(createDefaultPlayerLoadout())
hud.setInventoryOpen(true)
hud.setShieldRaised(true)
hud.setCommandHints([
    { keys: ['WASD', 'Arrows'], label: 'Move' },
    { keys: ['Mouse'], label: 'Aim' },
    { keys: ['Q', 'R'], label: 'Rotate camera' },
    { keys: ['Space'], label: 'Jump' },
    { keys: ['F'], label: 'Use weapon' },
    { keys: ['1', '2', '3', '4'], label: 'Select weapon' },
    { keys: ['E'], label: 'Interact' },
    { keys: ['I'], label: 'Inventory' },
])

const editorShellMount = el('section', { className: 'ui-demo-shell-mount' })

app.append(
    el('header', {
        className: 'ui-demo-header',
        children: [
            el('div', {
                children: [
                    el('h1', { className: 'ui-demo-title', text: 'Voxel UI Demo' }),
                    el('p', { className: 'ui-demo-subtitle', text: 'Shared game and editor controls' }),
                ],
            }),
            toolbar([
                button({ label: 'Default toast', onClick: () => toast.show('Inventory updated') }),
                button({ label: 'Success', primary: true, onClick: () => toast.show('Saved checkpoint', { tone: 'ok' }) }),
                button({ label: 'Danger', onClick: () => toast.show('Piston trap triggered', { tone: 'danger' }) }),
                button({
                    label: 'Fatal overlay',
                    onClick: () => {
                        const overlay = fatalOverlay('WebGPU failed to initialize. Click to close this demo overlay.')
                        overlay.addEventListener('click', () => overlay.remove(), { once: true })
                    },
                }),
            ]),
        ],
    }),
    el('section', {
        className: 'ui-demo-grid',
        children: [
            controlsPanel(),
            toolbarPanel(),
            commandPanel(),
            hudPanel(),
            editorPanel(),
            logPanel(),
        ],
    }),
    editorShellMount,
)

new EditorShell(editorShellMount, { embedded: true })

function controlsPanel(): HTMLElement {
    return panel({
        title: 'Buttons',
        actions: [
            iconButton({ icon: 'R', label: 'Refresh', title: 'Refresh' }),
            iconButton({ icon: 'X', label: 'Close', title: 'Close' }),
        ],
        children: [
            sectionTitle('States'),
            el('div', {
                className: 'ui-demo-row',
                children: [
                    button({ label: 'Default' }),
                    button({ label: 'Primary', primary: true }),
                    button({ label: 'Disabled', disabled: true }),
                    button({ label: 'With icon', icon: '+', onClick: () => toast.show('Button clicked') }),
                    button({ label: 'Toggle inventory', onClick: () => hud.setInventoryOpen(!hud.isInventoryOpen()) }),
                ],
            }),
            sectionTitle('Keyboard'),
            el('div', {
                className: 'ui-demo-row',
                children: [kbd('Ctrl'), kbd('S'), kbd('Shift'), kbd('B'), kbd('Wheel')],
            }),
        ],
    })
}

function toolbarPanel(): HTMLElement {
    return panel({
        title: 'Toolbars',
        children: [
            sectionTitle('Horizontal'),
            toolbar([
                iconButton({ icon: 'P', label: 'Paint' }),
                iconButton({ icon: 'E', label: 'Erase' }),
                iconButton({ icon: 'F', label: 'Fill' }),
                toolbarSeparator(),
                button({ label: 'Validate' }),
            ]),
            sectionTitle('Vertical'),
            toolbar([
                iconButton({ icon: '1', label: 'Slot 1' }),
                iconButton({ icon: '2', label: 'Slot 2' }),
                iconButton({ icon: '3', label: 'Slot 3' }),
            ], true),
        ],
    })
}

function commandPanel(): HTMLElement {
    return panel({
        title: 'Command Hints',
        children: [
            new CommandHintBar([
                { keys: ['LMB'], label: 'Paint' },
                { keys: ['RMB'], label: 'Erase' },
                { keys: ['Ctrl', 'Z'], label: 'Undo' },
                { keys: ['Ctrl', 'Y'], label: 'Redo' },
            ]).element,
        ],
    })
}

function hudPanel(): HTMLElement {
    const health = new UiMeter({ label: 'Health', tone: 'health', current: 84, max: 100 })
    const mana = new UiMeter({ label: 'Mana', tone: 'mana', current: 52, max: 60 })
    const stamina = new UiMeter({ label: 'Stamina', tone: 'stamina', current: 58, max: 100 })
    return panel({
        title: 'HUD Widgets',
        children: [
            sectionTitle('Meters'),
            health.element,
            mana.element,
            stamina.element,
            sectionTitle('Slots'),
            el('div', {
                className: 'ui-slot-grid ui-slot-grid--skills',
                children: [
                    new UiSlot({ icon: 'SW', label: 'Sword', key: '1' }).element,
                    new UiSlot({ icon: 'BW', label: 'Bow', key: '2', active: true }).element,
                    new UiSlot({ icon: 'AP', label: 'Air Push', key: '3' }).element,
                    new UiSlot({ icon: '.', label: 'Empty', key: '4', muted: true }).element,
                    new UiSlot({ icon: 'SH', label: 'Shield', key: 'Shift' }).element,
                ],
            }),
        ],
    })
}

function editorPanel(): HTMLElement {
    return panel({
        title: 'Editor Properties',
        children: [
            sectionTitle('Selection'),
            propertyRow('Tool', 'Paint'),
            propertyRow('Brush', '3 x 3 x 1'),
            propertyRow('Material', 'Stone'),
            propertyRow('Position', '18, 4, 27'),
            sectionTitle('Palette'),
            el('div', {
                className: 'ui-swatch-row',
                children: [
                    swatch('#5ca64c', 'Grass'),
                    swatch('#735036', 'Dirt'),
                    swatch('#8c8c94', 'Stone'),
                    swatch('#c99c40', 'Plank'),
                    swatch('#a84c40', 'Brick'),
                    swatch('#9446b3', 'No-walk'),
                ],
            }),
        ],
    })
}

function logPanel(): HTMLElement {
    return panel({
        title: 'Log Panel',
        children: [
            el('div', {
                className: 'ui-log-panel ui-log-panel--embedded',
                text: [
                    '[ui] catalog mounted',
                    '[hud] command hints visible',
                    '[toast] notifications ready',
                    '[editor] shell controls ready',
                ].join('\n'),
            }),
        ],
    })
}

function propertyRow(label: string, value: string): HTMLElement {
    return el('div', {
        className: 'ui-property-row',
        children: [
            el('span', { text: label }),
            el('span', { text: value }),
        ],
    })
}

function swatch(color: string, title: string): HTMLElement {
    return el('span', {
        className: 'ui-swatch',
        title,
        attrs: { style: `background:${color}` },
    })
}
