/**
 * Undo / redo command stack for the editor.
 *
 * Each editor mutation that the user might want to reverse is wrapped in a
 * `Command` — a label plus `apply` / `revert` functions. The stack tracks
 * what's been done; the history system maps Ctrl+Z / Ctrl+Y onto
 * `undo()` / `redo()`.
 *
 * Two entry points for pushing:
 *  - `push(cmd)` — calls `apply()` for you and records the command. Used by
 *    point-in-time actions (place piston, place zone, …).
 *  - `pushApplied(cmd)` — the caller has already done the side effect;
 *    just record it. Used by streaming actions like voxel painting, where
 *    the apply happens incrementally during a click-drag and we record one
 *    consolidated command on release.
 *
 * Any push (either kind) clears the redo stack — the textbook semantics
 * for a linear history. The stack is bounded by `maxSize` (default 200);
 * oldest entries fall off the bottom.
 */

export interface Command {
    /** Short human-readable label (e.g. `'paint'`, `'place piston'`).
     *  Surfaces in the debug log when undoing / redoing. */
    readonly label: string
    /** Perform the side effect. Must be idempotent enough that
     *  `apply(); revert(); apply();` lands at the same final state. */
    apply(): void
    /** Reverse the side effect. Assumes the world is in the state
     *  `apply()` left it in (so the caller never reverts twice without
     *  applying again first). */
    revert(): void
}

export interface CommandStack {
    /** Apply the command and record it. Clears the redo stack. */
    push(cmd: Command): void
    /** Record a command whose `apply()` has already been executed.
     *  Clears the redo stack. */
    pushApplied(cmd: Command): void
    /** Undo the most recent command. Returns the command that was
     *  reverted, or null if the undo stack is empty. */
    undo(): Command | null
    /** Re-apply the most recently undone command. Returns the command
     *  that was re-applied, or null if the redo stack is empty. */
    redo(): Command | null
    canUndo(): boolean
    canRedo(): boolean
    /** Drop both stacks. Call on level-wide operations (New, Load) so a
     *  stale command can't revert against the wrong world state. */
    clear(): void
    undoDepth(): number
    redoDepth(): number
}

export const DEFAULT_HISTORY_MAX_SIZE = 200

export function createCommandStack(maxSize: number = DEFAULT_HISTORY_MAX_SIZE): CommandStack {
    const undoStack: Command[] = []
    const redoStack: Command[] = []
    const cap = Math.max(1, Math.floor(maxSize))

    function record(cmd: Command): void {
        undoStack.push(cmd)
        if (undoStack.length > cap) undoStack.splice(0, undoStack.length - cap)
        redoStack.length = 0
    }

    return {
        push(cmd) {
            cmd.apply()
            record(cmd)
        },
        pushApplied(cmd) {
            record(cmd)
        },
        undo() {
            const cmd = undoStack.pop()
            if (!cmd) return null
            cmd.revert()
            redoStack.push(cmd)
            return cmd
        },
        redo() {
            const cmd = redoStack.pop()
            if (!cmd) return null
            cmd.apply()
            undoStack.push(cmd)
            return cmd
        },
        canUndo() { return undoStack.length > 0 },
        canRedo() { return redoStack.length > 0 },
        clear() {
            undoStack.length = 0
            redoStack.length = 0
        },
        undoDepth() { return undoStack.length },
        redoDepth() { return redoStack.length },
    }
}
