import type { PaletteEntry } from '../../engine/voxel/palette'

/**
 * Shared bits used by every tab in the editor panel — CSS, the `sectionEl`
 * helper, and small formatting utilities. Keeping these here keeps the
 * per-tab builder files focused on layout instead of plumbing.
 */

export const PANEL_CSS = `
.vpe-panel {
    position: fixed; top: 8px; right: 8px; width: 260px;
    max-height: calc(100vh - 16px);
    display: flex; flex-direction: column;
    font: 12px ui-sans-serif, system-ui, sans-serif;
    background: rgba(8, 12, 16, 0.86); color: #d9f7ff;
    border-radius: 6px;
    pointer-events: auto; z-index: 1000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    overflow: hidden;
}
.vpe-tabs {
    display: flex;
    border-bottom: 1px solid rgba(217, 247, 255, 0.12);
    background: rgba(0, 0, 0, 0.2);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(217, 247, 255, 0.24) transparent;
}
.vpe-tabs::-webkit-scrollbar { height: 6px; }
.vpe-tabs::-webkit-scrollbar-track { background: transparent; }
.vpe-tabs::-webkit-scrollbar-thumb {
    background: rgba(217, 247, 255, 0.2);
    border-radius: 999px;
}
.vpe-tab {
    flex: 0 0 auto;
    min-width: 58px;
    padding: 8px 6px;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    font: inherit;
    background: none;
    border: none;
    color: rgba(217, 247, 255, 0.55);
    border-bottom: 2px solid transparent;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.vpe-tab:hover { background: rgba(217, 247, 255, 0.04); color: #d9f7ff; }
.vpe-tab.active {
    color: #ffd166;
    border-bottom-color: #ffd166;
    background: rgba(255, 209, 102, 0.06);
}
.vpe-body {
    padding: 10px 12px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
}
.vpe-section { display: flex; flex-direction: column; gap: 4px; }
.vpe-section h3 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 2px 0; color: rgba(217, 247, 255, 0.65);
}
.vpe-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.vpe-row.tight { gap: 2px; }
.vpe-field { display: flex; align-items: center; gap: 6px; }
.vpe-field-label { flex: 1; color: rgba(217, 247, 255, 0.7); }
.vpe-swatch {
    width: 24px; height: 24px; border-radius: 3px;
    border: 2px solid transparent; cursor: pointer;
    position: relative; overflow: hidden;
    transition: transform 80ms ease, border-color 80ms ease;
}
.vpe-swatch:hover { transform: scale(1.08); }
.vpe-swatch.active { border-color: #ffd166; }
.vpe-swatch.torch {
    background: rgba(217, 247, 255, 0.08);
}
.vpe-swatch.torch::before {
    content: '';
    position: absolute;
    left: 11px; top: 9px;
    width: 4px; height: 13px;
    border-radius: 2px;
    background: #5b3118;
    transform: rotate(22deg);
}
.vpe-swatch.torch::after {
    content: '';
    position: absolute;
    left: 8px; top: 3px;
    width: 8px; height: 9px;
    border-radius: 7px 7px 7px 1px;
    background: #ff8a2f;
    transform: rotate(12deg);
}
.vpe-button {
    background: rgba(217, 247, 255, 0.1); color: inherit;
    border: 1px solid rgba(217, 247, 255, 0.25);
    padding: 4px 8px; border-radius: 3px; cursor: pointer;
    font: inherit;
}
.vpe-button:hover { background: rgba(217, 247, 255, 0.2); }
.vpe-button.active {
    background: rgba(255, 209, 102, 0.35);
    border-color: #ffd166; color: #1c1402;
}
.vpe-list {
    max-height: 140px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
    font-size: 11px; color: rgba(217, 247, 255, 0.75);
    background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 3px;
}
.vpe-list-item { display: flex; justify-content: space-between; gap: 6px; }
.vpe-list-item button {
    background: none; border: none; color: #ff8a5a; cursor: pointer;
    padding: 0 4px; font: inherit;
}
.vpe-list-item button:hover { text-decoration: underline; }
.vpe-list-empty { color: rgba(217,247,255,0.45); }
.vpe-input {
    font: inherit; background: rgba(0,0,0,0.3); color: inherit;
    border: 1px solid rgba(217, 247, 255, 0.25); padding: 2px 4px;
    border-radius: 3px;
}
.vpe-hint { font-size: 10px; color: rgba(217, 247, 255, 0.5); }
.vpe-divider {
    height: 1px; background: rgba(217, 247, 255, 0.08);
    margin: 4px 0;
}
`

export function sectionEl(title: string): HTMLElement {
    const section = document.createElement('section')
    section.className = 'vpe-section'
    if (title) {
        const h3 = document.createElement('h3')
        h3.textContent = title
        section.appendChild(h3)
    }
    return section
}

export function colorToCss(entry: PaletteEntry): string {
    const [r, g, b] = entry.color
    const alpha = entry.opacity ?? 1
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

export function colorToSwatchCss(entry: PaletteEntry): string {
    const [r, g, b] = entry.color
    const alpha = entry.renderAs ? 1 : Math.max(0.35, entry.opacity ?? 1)
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

export function trimForList(text: string, max = 22): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function formatCoord(p: { x: number; y: number; z: number }): string {
    return `${p.x},${p.y},${p.z}`
}

let cssInjected = false
export function injectCss(): void {
    if (cssInjected) return
    cssInjected = true
    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    document.head.appendChild(style)
}

/** Uniform contract for tab + section builders that need periodic refresh. */
export interface RefreshableElement {
    element: HTMLElement
    refresh: () => void
}
