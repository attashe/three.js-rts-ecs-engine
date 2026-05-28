import { query } from 'bitecs'
import { Camera, Vector3 } from 'three'
import { BoxCollider, PlayerControlled, Position } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import { pushScriptTriggerEvent, type GameWorld, type VoxelCoord } from '../engine/ecs/world'
import { isZoneActive, type Zone } from '../engine/ecs/zones'
import type { ActionMap } from '../engine/input/actions'
import { GameAction } from './actions'

export interface InteractionSystemOptions {
    actions: ActionMap
    camera: () => Camera
    domElement: HTMLElement
}

interface InteractionTarget {
    zone: Zone
    anchor: VoxelCoord
    distanceSq: number
}

interface ActiveBubble {
    targetId: string
    message: string
    expiresAt: number
    /** Queued follow-up messages for the same target, FIFO. Drained
     *  when the current bubble expires so back-to-back `ui.say` calls
     *  to one target play sequentially instead of overwriting. */
    queue: { message: string; seconds: number }[]
}

const PROJECT = new Vector3()
const MAX_BUBBLES = 8

/**
 * Renders popup bubbles authored by `ui.say(...)` and the on-screen
 * "press E" interaction prompt.
 *
 * Multi-bubble model: each `targetId` owns at most one visible bubble;
 * follow-up `ui.say` calls for the same target queue and play
 * sequentially when the current bubble expires. Bubbles for *different*
 * targets render in parallel — two NPCs in the same scene each get
 * their own DOM node positioned over their anchor. `ui.clear(targetId?)`
 * dismisses bubbles early (per-target or all-at-once).
 */
export function createInteractionSystem(opts: InteractionSystemOptions): System {
    let promptEl: HTMLDivElement | null = null
    let promptLabelEl: HTMLSpanElement | null = null
    let bubbleLayer: HTMLDivElement | null = null
    let now = 0
    let lastPopupId = 0
    let lastClearId = 0
    const bubbles = new Map<string, ActiveBubble>()
    const bubbleEls = new Map<string, HTMLDivElement>()

    return {
        name: 'interaction',
        order: RenderOrder.cameraFollow + 6,
        init() {
            const built = buildPrompt()
            promptEl = built.promptEl
            promptLabelEl = built.promptLabelEl
            bubbleLayer = built.bubbleLayer
            document.body.appendChild(built.bubbleLayer)
            document.body.appendChild(built.promptEl)
        },
        update(world, dt) {
            now += dt
            consumePopupClears(world)
            consumePopupMessages(world)
            expireBubbles()
            const player = playerInfo(world)
            const active = player && world.playerSettings.abilities.interact
                ? nearestInteractionTarget(world, player)
                : null
            if (player && active && opts.actions.consumePressed(GameAction.Interact, active.zone.id)) {
                pushScriptTriggerEvent(world, {
                    kind: 'input',
                    action: GameAction.Interact,
                    edge: 'pressed',
                    targetId: active.zone.id,
                    zoneId: active.zone.id,
                    point: { x: player.x, y: player.y, z: player.z },
                    entityId: player.eid,
                })
            }
            renderPrompt(active)
            renderBubbles(world)
        },
        dispose() {
            for (const el of bubbleEls.values()) el.remove()
            bubbleEls.clear()
            bubbles.clear()
            bubbleLayer?.remove()
            promptEl?.remove()
            bubbleLayer = null
            promptEl = null
            promptLabelEl = null
        },
    }

    function consumePopupMessages(world: GameWorld): void {
        for (const msg of world.popupMessages) {
            if (msg.id <= lastPopupId) continue
            lastPopupId = msg.id
            const existing = bubbles.get(msg.targetId)
            if (existing) {
                // Same target already has a bubble — queue the new
                // message so it plays after the current one expires.
                existing.queue.push({ message: msg.message, seconds: msg.seconds })
                continue
            }
            if (bubbles.size >= MAX_BUBBLES) {
                // Soft cap. Evict the bubble closest to expiry so a
                // spammy quest can't pile up DOM nodes indefinitely.
                evictOldestBubble()
            }
            bubbles.set(msg.targetId, {
                targetId: msg.targetId,
                message: msg.message,
                expiresAt: now + msg.seconds,
                queue: [],
            })
        }
    }

    function consumePopupClears(world: GameWorld): void {
        for (const req of world.popupClears) {
            if (req.id <= lastClearId) continue
            lastClearId = req.id
            if (req.targetId === null) {
                bubbles.clear()
                removeAllBubbleEls()
                continue
            }
            bubbles.delete(req.targetId)
            const el = bubbleEls.get(req.targetId)
            if (el) {
                el.remove()
                bubbleEls.delete(req.targetId)
            }
        }
    }

    function expireBubbles(): void {
        for (const [id, bubble] of bubbles) {
            if (bubble.expiresAt > now) continue
            const next = bubble.queue.shift()
            if (next) {
                bubble.message = next.message
                bubble.expiresAt = now + next.seconds
                continue
            }
            bubbles.delete(id)
            const el = bubbleEls.get(id)
            if (el) {
                el.remove()
                bubbleEls.delete(id)
            }
        }
    }

    function evictOldestBubble(): void {
        let oldestId: string | null = null
        let oldestExpiry = Infinity
        for (const [id, bubble] of bubbles) {
            if (bubble.expiresAt < oldestExpiry) {
                oldestExpiry = bubble.expiresAt
                oldestId = id
            }
        }
        if (oldestId !== null) {
            bubbles.delete(oldestId)
            const el = bubbleEls.get(oldestId)
            if (el) {
                el.remove()
                bubbleEls.delete(oldestId)
            }
        }
    }

    function removeAllBubbleEls(): void {
        for (const el of bubbleEls.values()) el.remove()
        bubbleEls.clear()
    }

    function renderPrompt(active: InteractionTarget | null): void {
        if (!promptEl || !promptLabelEl) return
        if (!active) {
            promptEl.style.display = 'none'
            return
        }
        const screen = projectToScreen(active.anchor, opts.camera(), opts.domElement)
        if (!screen) {
            promptEl.style.display = 'none'
            return
        }
        promptLabelEl.textContent = active.zone.interaction?.prompt ?? 'Interaction'
        promptEl.style.display = 'block'
        promptEl.style.left = `${screen.x}px`
        promptEl.style.top = `${screen.y}px`
    }

    function renderBubbles(world: GameWorld): void {
        if (!bubbleLayer) return
        for (const [id, bubble] of bubbles) {
            const target = targetForId(world, id)
            // If the zone disappeared or deactivated, hide the bubble
            // visually but leave the entry in the map so the seconds
            // timer keeps ticking — the bubble re-appears if the zone
            // re-activates within its lifetime.
            let el = bubbleEls.get(id)
            if (!el) {
                el = buildBubbleEl(bubble.message)
                bubbleLayer.appendChild(el)
                bubbleEls.set(id, el)
            } else {
                el.textContent = bubble.message
            }
            if (!target) {
                el.style.display = 'none'
                continue
            }
            const screen = projectToScreen(target.anchor, opts.camera(), opts.domElement)
            if (!screen) {
                el.style.display = 'none'
                continue
            }
            el.style.display = 'block'
            el.style.left = `${screen.x}px`
            el.style.top = `${screen.y}px`
        }
    }
}

function nearestInteractionTarget(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
): InteractionTarget | null {
    let best: InteractionTarget | null = null
    for (const zone of world.zones.values()) {
        if (!isInteractionZone(zone)) continue
        if (!isZoneActive(zone)) continue
        const anchor = interactionAnchor(zone)
        const radius = zone.interaction?.radius ?? 2.2
        const dx = player.x - anchor.x
        const dy = player.y - anchor.y
        const dz = player.z - anchor.z
        const distanceSq = dx * dx + dy * dy + dz * dz
        if (distanceSq > radius * radius) continue
        if (!best || distanceSq < best.distanceSq) best = { zone, anchor, distanceSq }
    }
    return best
}

function targetForId(world: GameWorld, targetId: string): InteractionTarget | null {
    const zone = world.zones.get(targetId)
    if (!zone || !isZoneActive(zone)) return null
    return { zone, anchor: interactionAnchor(zone), distanceSq: 0 }
}

function isInteractionZone(zone: Zone): boolean {
    return zone.kind === 'interact' || zone.interaction !== undefined
}

function interactionAnchor(zone: Zone): VoxelCoord {
    return zone.interaction?.anchor ?? {
        x: (zone.min.x + zone.max.x) * 0.5,
        y: zone.max.y,
        z: (zone.min.z + zone.max.z) * 0.5,
    }
}

function playerInfo(world: GameWorld): { eid: number; x: number; y: number; z: number } | null {
    const players = query(world, [PlayerControlled, Position])
    if (players.length === 0) return null
    const eid = players[0]!
    const y = Position.y[eid] + (BoxCollider.y[eid] || 0)
    return { eid, x: Position.x[eid], y, z: Position.z[eid] }
}

function projectToScreen(point: VoxelCoord, camera: Camera, element: HTMLElement): { x: number; y: number } | null {
    PROJECT.set(point.x, point.y, point.z).project(camera)
    if (PROJECT.z < -1 || PROJECT.z > 1) return null
    const rect = element.getBoundingClientRect()
    return {
        x: rect.left + (PROJECT.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-PROJECT.y * 0.5 + 0.5) * rect.height + 8,
    }
}

function buildPrompt(): {
    promptEl: HTMLDivElement
    promptLabelEl: HTMLSpanElement
    bubbleLayer: HTMLDivElement
} {
    // Bubbles live in their own pointer-events-none layer so each
    // bubble can be positioned independently without parenting under
    // a single root.
    const bubbleLayer = document.createElement('div')
    bubbleLayer.id = 'voxel-platformer-popups'
    Object.assign(bubbleLayer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '1340',
    } satisfies Partial<CSSStyleDeclaration>)

    const promptEl = document.createElement('div')
    promptEl.id = 'voxel-platformer-interaction-prompt'
    Object.assign(promptEl.style, {
        position: 'fixed',
        display: 'none',
        transform: 'translate(-50%, 0)',
        zIndex: '1350',
        pointerEvents: 'none',
        color: '#f7fbf0',
        font: '12px ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
        maxWidth: '240px',
    } satisfies Partial<CSSStyleDeclaration>)

    const inner = document.createElement('div')
    Object.assign(inner.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        width: 'max-content',
        margin: '0 auto',
        padding: '4px 7px',
        borderRadius: '6px',
        background: 'rgba(8, 12, 16, 0.78)',
        border: '1px solid rgba(217, 247, 255, 0.28)',
        boxShadow: '0 5px 18px rgba(0, 0, 0, 0.24)',
    } satisfies Partial<CSSStyleDeclaration>)

    const promptLabelEl = promptText('Interaction')
    inner.append(keyBadge('E'), promptLabelEl)
    promptEl.appendChild(inner)

    return { promptEl, promptLabelEl, bubbleLayer }
}

function buildBubbleEl(message: string): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'fixed',
        transform: 'translate(-50%, -100%)',
        marginTop: '-6px',
        padding: '7px 9px',
        borderRadius: '7px',
        background: 'rgba(10, 13, 12, 0.84)',
        border: '1px solid rgba(250, 238, 184, 0.36)',
        boxShadow: '0 6px 22px rgba(0, 0, 0, 0.32)',
        color: '#f7fbf0',
        font: '12px ui-sans-serif, system-ui, sans-serif',
        lineHeight: '1.25',
        textAlign: 'center',
        maxWidth: '240px',
        whiteSpace: 'normal',
        pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    el.textContent = message
    return el
}

function keyBadge(key: string): HTMLSpanElement {
    const span = document.createElement('span')
    span.textContent = key
    Object.assign(span.style, {
        minWidth: '18px',
        padding: '1px 5px',
        borderRadius: '4px',
        background: 'rgba(247, 251, 240, 0.92)',
        color: '#101418',
        font: '700 11px ui-monospace, monospace',
    } satisfies Partial<CSSStyleDeclaration>)
    return span
}

function promptText(text: string): HTMLSpanElement {
    const span = document.createElement('span')
    span.textContent = text
    span.style.fontWeight = '700'
    return span
}
