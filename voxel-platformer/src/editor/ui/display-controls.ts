import {
    getRenderTextures,
    setRenderTextures,
    subscribeRenderTextures,
} from '../../engine/render/render-settings'
import { sectionEl, type RefreshableElement } from './common'

/**
 * Editor → Level → Display panel. Houses per-user render toggles
 * (currently the chunk-texture pass) that don't belong in the level
 * save format: they're personal preferences, not authoring choices.
 *
 * Wiring out to runtime: the chunk renderer subscribes directly to
 * `render-settings`, so flipping the checkbox here propagates through
 * without any explicit hookup from the UI layer.
 */
export function buildDisplayControlsSection(): RefreshableElement {
    const section = sectionEl('Display')

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Per-user render preferences. Saved in this browser only.'
    section.appendChild(hint)

    // Surface-textures toggle.
    const row = document.createElement('label')
    row.className = 'vpe-field'
    row.style.cursor = 'pointer'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = getRenderTextures()
    input.onchange = () => setRenderTextures(input.checked)
    const span = document.createElement('span')
    span.textContent = 'Block surface textures'
    span.title = 'Toggle the 32×32 atlas sampling pass. Off shows the flat-colour look.'
    row.append(span, input)
    section.appendChild(row)

    // Stay in sync if another part of the UI flips the setting. The
    // panel lives for the editor's lifetime, so we deliberately do not
    // unsubscribe — a leak here would matter only if a host repeatedly
    // tore down + reinstated the editor panel within one page load,
    // which the codebase doesn't do anywhere.
    subscribeRenderTextures((enabled) => {
        if (input.checked !== enabled) input.checked = enabled
    })

    return {
        element: section,
        refresh() {
            input.checked = getRenderTextures()
        },
    }
}
