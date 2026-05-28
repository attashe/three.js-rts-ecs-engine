import type { RefreshableElement } from './common'

export interface TabDef {
    id: string
    label: string
    /** Build the tab body the first time the tab is shown. Lazy — tabs the
     *  user never opens never pay the build cost or run their refresh loop. */
    build: () => RefreshableElement
}

export interface TabBar {
    /** Tab-bar + tab-body container. Mount this into the panel. */
    element: HTMLElement
    /** Tick refreshes for whichever tab is currently visible. */
    refreshActive: () => void
    /** Programmatic switch — useful when an external event (e.g. a placement
     *  finishing) wants to jump the user to a different tab. */
    activate: (id: string) => void
}

/**
 * Tab bar widget. Tabs build lazily on first activation; the bar caches
 * the resulting bodies so toggling back and forth doesn't tear down DOM
 * state (input focus / scroll position / etc.). Only the active tab's
 * refresh runs each interval tick.
 */
export function createTabBar(tabs: readonly TabDef[], initial: string): TabBar {
    const root = document.createElement('div')
    root.className = 'vpe-panel'

    const bar = document.createElement('div')
    bar.className = 'vpe-tabs'
    bar.addEventListener('wheel', onTabWheel, { passive: false })
    root.appendChild(bar)

    const body = document.createElement('div')
    body.className = 'vpe-body'
    root.appendChild(body)

    const buttons = new Map<string, HTMLButtonElement>()
    const built = new Map<string, RefreshableElement>()
    let active: string | null = null

    function activate(id: string): void {
        if (active === id) return
        if (active !== null) {
            const prev = built.get(active)
            if (prev) prev.element.style.display = 'none'
            buttons.get(active)?.classList.remove('active')
        }
        let entry = built.get(id)
        if (!entry) {
            const def = tabs.find((t) => t.id === id)
            if (!def) throw new Error(`Unknown tab: ${id}`)
            entry = def.build()
            built.set(id, entry)
            body.appendChild(entry.element)
        }
        entry.element.style.display = ''
        const activeButton = buttons.get(id)
        activeButton?.classList.add('active')
        activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        active = id
        entry.refresh()
    }

    function onTabWheel(ev: WheelEvent): void {
        if (bar.scrollWidth <= bar.clientWidth) return
        const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY)
            ? wheelDeltaToPixels(ev.deltaX, ev.deltaMode, bar.clientWidth)
            : wheelDeltaToPixels(ev.deltaY, ev.deltaMode, bar.clientWidth)
        if (delta === 0) return
        bar.scrollLeft += delta
        ev.preventDefault()
        ev.stopPropagation()
    }

    for (const tab of tabs) {
        const btn = document.createElement('button')
        btn.className = 'vpe-tab'
        btn.textContent = tab.label
        btn.onclick = () => activate(tab.id)
        bar.appendChild(btn)
        buttons.set(tab.id, btn)
    }

    activate(initial)

    return {
        element: root,
        refreshActive() {
            if (active === null) return
            built.get(active)?.refresh()
        },
        activate,
    }
}

function wheelDeltaToPixels(delta: number, mode: number, pageSize: number): number {
    if (mode === WheelEvent.DOM_DELTA_LINE) return delta * 16
    if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize
    return delta
}
