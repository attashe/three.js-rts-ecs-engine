import type { ClickEvent } from '../../engine/input/input'

export interface PistonClickHandlers {
    hasCursor: () => boolean
    place: () => void
    removeLast: () => void
}

export function handlePistonClicks(clicks: readonly ClickEvent[], handlers: PistonClickHandlers): void {
    for (const click of clicks) {
        if (click.button === 2) {
            handlers.removeLast()
        } else if (handlers.hasCursor()) {
            handlers.place()
        }
    }
}
