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
}

const PROJECT = new Vector3()

export function createInteractionSystem(opts: InteractionSystemOptions): System {
    let root: HTMLDivElement | null = null
    let messageEl: HTMLDivElement | null = null
    let promptEl: HTMLDivElement | null = null
    let promptLabelEl: HTMLSpanElement | null = null
    let now = 0
    let lastPopupId = 0
    let bubble: ActiveBubble | null = null

    return {
        name: 'interaction',
        order: RenderOrder.cameraFollow + 6,
        init() {
            const built = buildPrompt()
            root = built.root
            messageEl = built.messageEl
            promptEl = built.promptEl
            promptLabelEl = built.promptLabelEl
            document.body.appendChild(root)
        },
        update(world, dt) {
            now += dt
            consumePopupMessages(world)
            const player = playerInfo(world)
            const active = player ? nearestInteractionTarget(world, player) : null
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
            renderPrompt(world, active)
        },
        dispose() {
            root?.remove()
            root = null
            messageEl = null
            promptEl = null
            promptLabelEl = null
            bubble = null
        },
    }

    function consumePopupMessages(world: GameWorld): void {
        for (const msg of world.popupMessages) {
            if (msg.id <= lastPopupId) continue
            lastPopupId = msg.id
            bubble = {
                targetId: msg.targetId,
                message: msg.message,
                expiresAt: now + msg.seconds,
            }
        }
        if (bubble && bubble.expiresAt <= now) bubble = null
    }

    function renderPrompt(world: GameWorld, active: InteractionTarget | null): void {
        if (!root || !messageEl || !promptEl || !promptLabelEl) return

        const bubbleTarget = bubble ? targetForId(world, bubble.targetId) : null
        const target = bubbleTarget ?? active
        if (!target) {
            root.style.display = 'none'
            return
        }

        const screen = projectToScreen(target.anchor, opts.camera(), opts.domElement)
        if (!screen) {
            root.style.display = 'none'
            return
        }

        const activeMatchesBubble = active?.zone.id === bubble?.targetId
        if (bubble && target.zone.id === bubble.targetId) {
            messageEl.textContent = bubble.message
            messageEl.style.display = 'block'
            promptEl.style.display = activeMatchesBubble ? 'flex' : 'none'
        } else {
            messageEl.style.display = 'none'
            promptEl.style.display = 'flex'
        }
        promptLabelEl.textContent = target.zone.interaction?.prompt ?? 'Interaction'

        root.style.display = 'block'
        root.style.left = `${screen.x}px`
        root.style.top = `${screen.y}px`
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
    if (!zone || !isInteractionZone(zone) || !isZoneActive(zone)) return null
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
    root: HTMLDivElement
    messageEl: HTMLDivElement
    promptEl: HTMLDivElement
    promptLabelEl: HTMLSpanElement
} {
    const root = document.createElement('div')
    root.id = 'voxel-platformer-interaction'
    Object.assign(root.style, {
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

    const messageEl = document.createElement('div')
    Object.assign(messageEl.style, {
        marginBottom: '5px',
        padding: '7px 9px',
        borderRadius: '7px',
        background: 'rgba(10, 13, 12, 0.84)',
        border: '1px solid rgba(250, 238, 184, 0.36)',
        boxShadow: '0 6px 22px rgba(0, 0, 0, 0.32)',
        lineHeight: '1.25',
        whiteSpace: 'normal',
    } satisfies Partial<CSSStyleDeclaration>)

    const promptEl = document.createElement('div')
    Object.assign(promptEl.style, {
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
    promptEl.append(keyBadge('E'), promptLabelEl)

    root.append(messageEl, promptEl)
    return { root, messageEl, promptEl, promptLabelEl }
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
