import { query } from 'bitecs'
import { Health, PlayerControlled } from '../engine/ecs/components'
import { HP_PER_HEART } from '../engine/ecs/combat'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'

// Filled heart silhouette (24×24 viewBox), shared by the fill clip and the
// empty/outline layers.
const HEART_PATH =
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'

/**
 * Production player-health HUD: a row of heart symbols, top-left, reading the
 * player's `Health`. Each heart is `HP_PER_HEART` HP, so a half-heart (1 HP) hit
 * shows a half-filled heart — the numeric model stays integer HP underneath.
 * Always visible (unlike the debug collider/HP-bar overlays).
 */
export function createHealthHudSystem(): System {
    let root: HTMLDivElement | null = null
    // Re-render only when the numbers change, so we're not rebuilding SVG every
    // frame.
    let lastCurrent = -1
    let lastMax = -1

    return {
        name: 'healthHud',
        order: RenderOrder.cameraFollow + 7,
        init() {
            root = document.createElement('div')
            root.id = 'voxel-platformer-health'
            Object.assign(root.style, {
                position: 'fixed',
                top: '8px',
                left: '8px',
                zIndex: '1200',
                display: 'flex',
                gap: '3px',
                padding: '6px 8px',
                borderRadius: '8px',
                background: 'rgba(8, 12, 16, 0.55)',
                border: '1px solid rgba(255, 143, 163, 0.22)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'none',
            } satisfies Partial<CSSStyleDeclaration>)
            root.setAttribute('aria-hidden', 'true')
            document.body.appendChild(root)
        },
        update(world) {
            if (!root) return
            const players = query(world, [PlayerControlled, Health])
            if (players.length === 0) {
                if (root.style.display !== 'none') root.style.display = 'none'
                lastCurrent = lastMax = -1
                return
            }
            const eid = players[0]!
            const current = Math.max(0, Math.round(Health.current[eid]!))
            const max = Math.max(0, Math.round(Health.max[eid]!))
            if (current === lastCurrent && max === lastMax) return
            lastCurrent = current
            lastMax = max
            renderHearts(root, current, max)
        },
        dispose() {
            root?.remove()
            root = null
            lastCurrent = lastMax = -1
        },
    }
}

function renderHearts(root: HTMLDivElement, current: number, max: number): void {
    root.style.display = max > 0 ? 'flex' : 'none'
    const hearts = Math.ceil(max / HP_PER_HEART)
    let svg = ''
    for (let i = 0; i < hearts; i++) {
        const hp = Math.max(0, Math.min(HP_PER_HEART, current - i * HP_PER_HEART))
        svg += heartSvg(hp / HP_PER_HEART, `vp-heart-${i}`)
    }
    root.innerHTML = svg
}

/** A single heart filled left-to-right by `fraction` (0, 0.5 or 1 in practice). */
function heartSvg(fraction: number, clipId: string): string {
    const fillWidth = (24 * Math.max(0, Math.min(1, fraction))).toFixed(2)
    const fill = fraction > 0
        ? `<rect x="0" y="0" width="${fillWidth}" height="24" fill="#ff4d6d" clip-path="url(#${clipId})"/>`
        : ''
    return `<svg width="28" height="26" viewBox="0 0 24 24" style="display:block">` +
        `<defs><clipPath id="${clipId}"><path d="${HEART_PATH}"/></clipPath></defs>` +
        `<path d="${HEART_PATH}" fill="#2a141d"/>` +
        fill +
        `<path d="${HEART_PATH}" fill="none" stroke="#ff8fa3" stroke-width="1.4"/>` +
        `</svg>`
}

/** Exposed for tests: how many full/half/empty hearts a HP/max pair shows. */
export function heartFractions(current: number, max: number): number[] {
    const hearts = Math.ceil(Math.max(0, max) / HP_PER_HEART)
    const out: number[] = []
    for (let i = 0; i < hearts; i++) {
        const hp = Math.max(0, Math.min(HP_PER_HEART, current - i * HP_PER_HEART))
        out.push(hp / HP_PER_HEART)
    }
    return out
}
