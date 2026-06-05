import { sectionEl, type RefreshableElement } from './common'

interface HelpGroup {
    title: string
    lines: readonly string[]
}

const HELP_GROUPS: readonly HelpGroup[] = [
    {
        title: 'Camera',
        lines: [
            'WASD / arrows — pan',
            'Q / R — rotate 90°',
            'Wheel — zoom',
            'Orbit view — LMB rotate, RMB pan, wheel zoom',
        ],
    },
    {
        title: 'Working plane',
        lines: [
            'Z / X — down / up by 1',
            'Shift + Z/X — down / up by 4',
            'V — cycle iso / top-down / orbit view',
            'L — toggle cursor-locks-to-plane',
        ],
    },
    {
        title: 'Mouse',
        lines: [
            'LMB — primary action for the current mode',
            'RMB — secondary (erase / undo last placement)',
            'Box drag brush — press, drag, release to fill',
            'Column / Wall X / Wall Z — use Brush size fields in Paint mode',
            'Terrain sculpt — LMB raises, RMB lowers',
            'Terrain ramp — drag XZ path; Target Y sets the end height',
            'Select mode — click movable editor objects, drag gizmo by grid cells',
        ],
    },
    {
        title: 'Palette',
        lines: [
            '1-9 — select palette block',
            'B — pick block under cursor',
        ],
    },
    {
        title: 'History',
        lines: [
            'Ctrl+Z — undo last paint stroke',
            'Ctrl+Shift+Z / Ctrl+Y — redo',
            '(New / Load clear the history.)',
        ],
    },
    {
        title: 'Debug',
        lines: [
            '` (backtick) — toggle debug overlay',
        ],
    },
]

/** Static reference card. No state, no refresh. */
export function buildHelpTab(): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    for (const group of HELP_GROUPS) {
        const section = sectionEl(group.title)
        for (const line of group.lines) {
            const row = document.createElement('div')
            row.className = 'vpe-hint'
            row.style.color = 'rgba(217, 247, 255, 0.75)'
            row.textContent = line
            section.appendChild(row)
        }
        root.appendChild(section)
    }

    return { element: root, refresh: () => {} }
}
