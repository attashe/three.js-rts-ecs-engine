import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { CommandStack } from '../history'

/**
 * Maps Ctrl/Cmd + Z / Y onto the editor's command stack.
 *
 *   Ctrl+Z          → undo
 *   Ctrl+Shift+Z    → redo
 *   Ctrl+Y          → redo
 *
 * Runs *before* `working-plane-system` (which uses plain `Z` / `X` for the
 * plane-Y nudge). The history system only consumes the `Z` keypress when
 * a modifier is held, so plain `Z` falls through to working-plane.
 *
 * Fixed-step + early in the input phase so the consume happens before any
 * later system (or render-phase system) sees the same key.
 */
export function createHistorySystem(input: Input, history: CommandStack): System {
    return {
        fixed: true,
        // Earlier than the placement systems so an undo doesn't race against
        // a click that landed on the same tick.
        order: FixedOrder.input - 10,
        update(world) {
            const w = world as GameWorld
            const mod = input.isKeyDown('ControlLeft') || input.isKeyDown('ControlRight') ||
                input.isKeyDown('MetaLeft') || input.isKeyDown('MetaRight')
            if (!mod) return

            const shift = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight')

            if (input.consumeKeyPressed('KeyZ')) {
                if (shift) {
                    const cmd = history.redo()
                    pushLog(w, cmd ? `Redo: ${cmd.label}` : 'Nothing to redo.')
                } else {
                    const cmd = history.undo()
                    pushLog(w, cmd ? `Undo: ${cmd.label}` : 'Nothing to undo.')
                }
                return
            }
            if (input.consumeKeyPressed('KeyY')) {
                const cmd = history.redo()
                pushLog(w, cmd ? `Redo: ${cmd.label}` : 'Nothing to redo.')
            }
        },
    }
}
