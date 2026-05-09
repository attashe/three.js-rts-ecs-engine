import {
    button,
    el,
    iconButton,
    panel,
    sectionTitle,
    toolbar,
    toolbarSeparator,
    type Disposable,
} from './primitives'

export interface EditorShellOptions {
    embedded?: boolean
}

export class EditorShell implements Disposable {
    readonly element: HTMLDivElement
    readonly viewport: HTMLElement
    readonly left: HTMLElement
    readonly right: HTMLElement
    readonly status: HTMLElement

    constructor(parent: HTMLElement = document.body, options: EditorShellOptions = {}) {
        this.viewport = el('main', { className: 'ui-editor-shell__viewport' })
        this.left = el('aside', { className: 'ui-editor-shell__left' })
        this.right = el('aside', { className: 'ui-editor-shell__right' })
        this.status = el('footer', { className: 'ui-editor-shell__status' })

        this.element = el('div', {
            className: [
                'ui-editor-shell',
                options.embedded ? 'ui-editor-shell--embedded' : '',
            ].filter(Boolean).join(' '),
            children: [
                this.createTopBar(),
                this.left,
                this.viewport,
                this.right,
                this.status,
            ],
        })
        parent.appendChild(this.element)
        this.populateDefaultLayout()
    }

    setStatus(left: string, right = 'Ready'): void {
        this.status.replaceChildren(
            el('span', { text: left }),
            el('span', { text: right }),
        )
    }

    dispose(): void {
        this.element.remove()
    }

    private createTopBar(): HTMLElement {
        return el('header', {
            className: 'ui-editor-shell__top',
            children: [
                el('div', {
                    className: 'ui-editor-shell__brand',
                    children: [
                        el('h1', { className: 'ui-editor-shell__title', text: 'Voxel Editor' }),
                        el('span', { className: 'ui-editor-shell__subtitle', text: 'Engine tools' }),
                    ],
                }),
                toolbar([
                    button({ label: 'New', disabled: true }),
                    button({ label: 'Open', disabled: true }),
                    button({ label: 'Save', primary: true, disabled: true }),
                    toolbarSeparator(),
                    button({ label: 'Validate', disabled: true }),
                ]),
            ],
        })
    }

    private populateDefaultLayout(): void {
        this.left.append(toolbar([
            iconButton({ icon: 'P', label: 'Paint', title: 'Paint blocks', disabled: true }),
            iconButton({ icon: 'E', label: 'Erase', title: 'Erase blocks', disabled: true }),
            iconButton({ icon: 'F', label: 'Fill', title: 'Box fill', disabled: true }),
            iconButton({ icon: 'S', label: 'Select', title: 'Select region', disabled: true }),
        ], true))

        this.viewport.append(el('div', {
            className: 'ui-editor-shell__empty',
            text: 'No level loaded.',
        }))

        this.right.append(
            panel({
                title: 'Tool',
                flat: true,
                children: [
                    sectionTitle('Current'),
                    propertyRow('Mode', 'None'),
                    propertyRow('Brush', '1 x 1 x 1'),
                    propertyRow('Layer', 'Terrain'),
                ],
            }),
            panel({
                title: 'Palette',
                flat: true,
                children: [
                    sectionTitle('Blocks'),
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
            }),
            panel({
                title: 'Selection',
                flat: true,
                children: [
                    propertyRow('Position', '0, 0, 0'),
                    propertyRow('Size', '0 x 0 x 0'),
                    propertyRow('Entities', '0'),
                ],
            }),
        )

        this.setStatus('No level loaded', 'Ready')
    }
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
