import { ActionMap, type ActionDefinition } from '../engine/input/actions'
import type { Input } from '../engine/input/input'

export const EditorAction = {
    MoveForward: 'move.forward',
    MoveBackward: 'move.backward',
    MoveLeft: 'move.left',
    MoveRight: 'move.right',
    CameraRotateLeft: 'camera.rotateLeft',
    CameraRotateRight: 'camera.rotateRight',
} as const

const EDITOR_ACTIONS: readonly ActionDefinition[] = [
    { id: EditorAction.MoveForward, label: 'Pan forward',  bindings: [{ keys: ['KeyW', 'ArrowUp'] }] },
    { id: EditorAction.MoveBackward, label: 'Pan backward', bindings: [{ keys: ['KeyS', 'ArrowDown'] }] },
    { id: EditorAction.MoveLeft, label: 'Pan left',     bindings: [{ keys: ['KeyA', 'ArrowLeft'] }] },
    { id: EditorAction.MoveRight, label: 'Pan right',    bindings: [{ keys: ['KeyD', 'ArrowRight'] }] },
    { id: EditorAction.CameraRotateLeft, label: 'Rotate left',   bindings: [{ keys: ['KeyQ'] }], bufferMs: 140 },
    { id: EditorAction.CameraRotateRight, label: 'Rotate right',  bindings: [{ keys: ['KeyR'] }], bufferMs: 140 },
]

export function createEditorActionMap(input: Input): ActionMap {
    return new ActionMap(EDITOR_ACTIONS, input)
}
