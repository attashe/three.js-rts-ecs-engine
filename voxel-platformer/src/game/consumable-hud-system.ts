import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import { CONSUMABLE_DEFS, ensureSelectedConsumable } from './consumables'
import { inventoryItemCount } from './inventory'

export function createConsumableHudSystem(): System {
    let root: HTMLDivElement | null = null
    let lastKey = ''

    return {
        name: 'consumableHud',
        order: RenderOrder.cameraFollow + 9,
        init() {
            root = document.createElement('div')
            root.id = 'voxel-platformer-consumable'
            Object.assign(root.style, {
                position: 'fixed',
                top: '88px',
                left: '8px',
                zIndex: '1200',
                minHeight: '34px',
                display: 'none',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '8px',
                background: 'rgba(8, 12, 16, 0.58)',
                border: '1px solid rgba(255, 214, 102, 0.24)',
                color: '#eef6f2',
                font: '700 12px ui-sans-serif, system-ui, sans-serif',
                pointerEvents: 'none',
            } satisfies Partial<CSSStyleDeclaration>)
            root.setAttribute('aria-hidden', 'true')
            document.body.appendChild(root)
        },
        update(world) {
            if (!root) return
            const itemId = ensureSelectedConsumable(world)
            if (!itemId) {
                root.style.display = 'none'
                lastKey = ''
                return
            }
            const count = inventoryItemCount(world.inventory.items, itemId)
            if (count <= 0) {
                root.style.display = 'none'
                lastKey = ''
                return
            }
            const key = `${itemId}:${count}`
            if (key === lastKey) return
            lastKey = key
            const def = CONSUMABLE_DEFS[itemId]
            root.style.display = 'flex'
            root.innerHTML = `<span style="${badgeStyle(def.icon)}"></span><span>Z</span><span>${escapeHtml(def.name)}</span><span style="color:rgba(238,246,242,0.62)">x${count}</span>`
        },
        dispose() {
            root?.remove()
            root = null
            lastKey = ''
        },
    }
}

function badgeStyle(icon: string): string {
    const color = icon === 'heal-potion' ? '#e34c64'
        : icon === 'mana-potion' ? '#45b8ff'
            : icon === 'dynamite' ? '#e04b3f'
                : icon === 'food-pie' || icon === 'pie' ? '#c08544'
                    : icon === 'food-fish' ? '#78bfd0'
                        : icon === 'food-meat' ? '#c76b4e'
                            : '#d94b43'
    return [
        'display:inline-block',
        'width:18px',
        'height:18px',
        'border-radius:5px',
        `background:${color}`,
        'box-shadow:inset -3px -3px 0 rgba(0,0,0,0.22)',
    ].join(';')
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&': return '&amp;'
            case '<': return '&lt;'
            case '>': return '&gt;'
            case '"': return '&quot;'
            default: return '&#39;'
        }
    })
}
