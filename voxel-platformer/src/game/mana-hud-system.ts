import { query } from 'bitecs'
import { Mana, PlayerControlled } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import { MANA_PER_ORB } from './mana'

const ORB_PATH = 'M12 2C8.4 6.2 5 10.24 5 14.25 5 18.56 8.13 22 12 22s7-3.44 7-7.75C19 10.24 15.6 6.2 12 2z'

export function createManaHudSystem(): System {
    let root: HTMLDivElement | null = null
    let lastCurrent = -1
    let lastMax = -1

    return {
        name: 'manaHud',
        order: RenderOrder.cameraFollow + 8,
        init() {
            root = document.createElement('div')
            root.id = 'voxel-platformer-mana'
            Object.assign(root.style, {
                position: 'fixed',
                top: '48px',
                left: '8px',
                zIndex: '1200',
                display: 'flex',
                gap: '3px',
                padding: '6px 8px',
                borderRadius: '8px',
                background: 'rgba(8, 12, 16, 0.55)',
                border: '1px solid rgba(104, 190, 255, 0.24)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'none',
            } satisfies Partial<CSSStyleDeclaration>)
            root.setAttribute('aria-hidden', 'true')
            document.body.appendChild(root)
        },
        update(world) {
            if (!root) return
            const players = query(world, [PlayerControlled, Mana])
            if (players.length === 0) {
                if (root.style.display !== 'none') root.style.display = 'none'
                lastCurrent = lastMax = -1
                return
            }
            const eid = players[0]!
            const current = Math.max(0, Math.round(Mana.current[eid]!))
            const max = Math.max(0, Math.round(Mana.max[eid]!))
            if (current === lastCurrent && max === lastMax) return
            lastCurrent = current
            lastMax = max
            renderMana(root, current, max)
        },
        dispose() {
            root?.remove()
            root = null
            lastCurrent = lastMax = -1
        },
    }
}

function renderMana(root: HTMLDivElement, current: number, max: number): void {
    root.style.display = max > 0 ? 'flex' : 'none'
    const orbs = Math.ceil(max / MANA_PER_ORB)
    let svg = ''
    for (let i = 0; i < orbs; i++) {
        const mana = Math.max(0, Math.min(MANA_PER_ORB, current - i * MANA_PER_ORB))
        svg += manaOrbSvg(mana / MANA_PER_ORB, `vp-mana-${i}`)
    }
    root.innerHTML = svg
}

function manaOrbSvg(fraction: number, clipId: string): string {
    const fillWidth = (24 * Math.max(0, Math.min(1, fraction))).toFixed(2)
    const fill = fraction > 0
        ? `<rect x="0" y="0" width="${fillWidth}" height="24" fill="#45b8ff" clip-path="url(#${clipId})"/>`
        : ''
    return `<svg width="28" height="26" viewBox="0 0 24 24" style="display:block">` +
        `<defs><clipPath id="${clipId}"><path d="${ORB_PATH}"/></clipPath></defs>` +
        `<path d="${ORB_PATH}" fill="#10243a"/>` +
        fill +
        `<path d="${ORB_PATH}" fill="none" stroke="#9fd9ff" stroke-width="1.4"/>` +
        `</svg>`
}

export function manaFractions(current: number, max: number): number[] {
    const orbs = Math.ceil(Math.max(0, max) / MANA_PER_ORB)
    const out: number[] = []
    for (let i = 0; i < orbs; i++) {
        const mana = Math.max(0, Math.min(MANA_PER_ORB, current - i * MANA_PER_ORB))
        out.push(mana / MANA_PER_ORB)
    }
    return out
}
