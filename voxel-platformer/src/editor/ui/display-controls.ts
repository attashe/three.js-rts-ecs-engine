import {
    getRenderTextures,
    getTorchSystem,
    setRenderTextures,
    setTorchSystem,
    subscribeRenderTextures,
    type TorchSystemKind,
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

    // ── Torch system selector. Read once at gameplay startup, so
    //    flipping it here only takes effect after a reload — we
    //    surface that explicitly so it doesn't look broken.
    const torchRow = document.createElement('div')
    torchRow.className = 'vpe-field'
    const torchLabel = document.createElement('span')
    torchLabel.textContent = 'Torch system:'
    torchLabel.title = 'Classic: production InstancedMesh + PointLight pool. Experimental: same meshes, replaces the light pool with a single global LightProbe (no per-light shader cost, softer ambient look). Takes effect on next reload.'
    const torchSelect = document.createElement('select')
    torchSelect.className = 'vpe-input'
    torchSelect.style.flex = '2'
    const classicOpt = document.createElement('option')
    classicOpt.value = 'classic'
    classicOpt.textContent = 'Classic — pool of PointLights (production)'
    const experimentalOpt = document.createElement('option')
    experimentalOpt.value = 'experimental'
    experimentalOpt.textContent = 'Experimental — LightProbe ambient'
    torchSelect.append(classicOpt, experimentalOpt)
    torchSelect.value = getTorchSystem()
    torchSelect.onchange = () => {
        setTorchSystem(torchSelect.value as TorchSystemKind)
        // Inline note: reload required. We don't prompt — the user is
        // in the editor and may want to keep authoring before
        // restarting. The dropdown's title attribute also explains.
        torchNote.textContent = 'Saved. Reload to take effect.'
        torchNote.style.color = '#ffd166'
    }
    torchRow.append(torchLabel, torchSelect)
    section.appendChild(torchRow)

    const torchNote = document.createElement('div')
    torchNote.className = 'vpe-hint'
    torchNote.style.fontSize = '11px'
    torchNote.textContent = ''
    section.appendChild(torchNote)

    return {
        element: section,
        refresh() {
            input.checked = getRenderTextures()
            torchSelect.value = getTorchSystem()
        },
    }
}
