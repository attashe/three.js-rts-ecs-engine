import {
    CommandHintBar,
    EditorShell,
    GameHud,
    ToastStack,
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

const app = el('main', { className: 'ui-root ui-demo-page' })
document.body.appendChild(app)

const toast = new ToastStack()
const hud = new GameHud()
hud.add('top-left', panel({
    title: 'Party',
    children: [
        meter('Health', 72, 'ok'),
        meter('Focus', 46, 'accent'),
    ],
}))
hud.add('top-right', panel({
    title: 'Quest',
    children: [
        el('div', { className: 'ui-demo-muted', text: 'Find the cliff path' }),
        el('div', { className: 'ui-demo-muted', text: 'Avoid moving pistons' }),
    ],
}))
hud.add('bottom-left', panel({
    title: 'Debug',
    children: [
        el('div', { className: 'ui-demo-log-line', text: '[path] npc_02 repath ok' }),
        el('div', { className: 'ui-demo-log-line', text: '[physics] stone settled' }),
        el('div', { className: 'ui-demo-log-line', text: '[combat] target neutral' }),
    ],
}))
hud.setCommandHints([
    { keys: ['WASD', 'Arrows'], label: 'Move' },
    { keys: ['Mouse'], label: 'Aim' },
    { keys: ['Q', 'R'], label: 'Rotate camera' },
    { keys: ['Space'], label: 'Jump' },
    { keys: ['F'], label: 'Attack' },
    { keys: ['B'], label: 'Bow' },
    { keys: ['E'], label: 'Interact' },
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
    return panel({
        title: 'HUD Widgets',
        children: [
            sectionTitle('Meters'),
            meter('Health', 84, 'ok'),
            meter('Stamina', 58, 'accent'),
            meter('Threat', 33, 'danger'),
            sectionTitle('Inventory'),
            el('div', {
                className: 'ui-demo-slots',
                children: ['Sword', 'Bow', 'Potion', 'Stone', 'Key'].map((label, index) => el('button', {
                    className: 'ui-demo-slot',
                    title: label,
                    text: String(index + 1),
                    onClick: () => toast.show(`${label} selected`),
                })),
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

function meter(label: string, value: number, tone: 'ok' | 'accent' | 'danger'): HTMLElement {
    return el('div', {
        className: 'ui-demo-meter',
        children: [
            el('div', {
                className: 'ui-demo-meter__label',
                children: [
                    el('span', { text: label }),
                    el('span', { text: `${value}%` }),
                ],
            }),
            el('div', {
                className: 'ui-demo-meter__track',
                children: [
                    el('span', {
                        className: `ui-demo-meter__fill ui-demo-meter__fill--${tone}`,
                        attrs: { style: `width:${value}%` },
                    }),
                ],
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
