import { ActionMap, type ActionDefinition, type ActionId } from '../engine/input/actions'
import type { Input } from '../engine/input/input'

export const GameAction = {
    MoveForward: 'move.forward',
    MoveBackward: 'move.backward',
    MoveLeft: 'move.left',
    MoveRight: 'move.right',
    AimPointer: 'aim.pointer',
    Jump: 'move.jump',
    AttackPrimary: 'attack.primary',
    BowShot: 'weapon.bowShot',
    Shield: 'defense.shield',
    AirPush: 'spell.airPush',
    HighJump: 'spell.highJump',
    SelectWeapon1: 'weapon.select1',
    SelectWeapon2: 'weapon.select2',
    SelectWeapon3: 'weapon.select3',
    SelectWeapon4: 'weapon.select4',
    Interact: 'world.interact',
    ToggleInventory: 'ui.inventory',
    CameraRotateLeft: 'camera.rotateLeft',
    CameraRotateRight: 'camera.rotateRight',
    CameraZoom: 'camera.zoom',
} as const

export type GameActionId = typeof GameAction[keyof typeof GameAction]

export const GAME_ACTIONS: readonly ActionDefinition[] = [
    {
        id: GameAction.MoveForward,
        label: 'Move forward',
        bindings: [{ keys: ['KeyW', 'ArrowUp'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD', 'Arrows'], order: 10 },
    },
    {
        id: GameAction.MoveBackward,
        label: 'Move backward',
        bindings: [{ keys: ['KeyS', 'ArrowDown'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD', 'Arrows'], order: 10 },
    },
    {
        id: GameAction.MoveLeft,
        label: 'Move left',
        bindings: [{ keys: ['KeyA', 'ArrowLeft'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD', 'Arrows'], order: 10 },
    },
    {
        id: GameAction.MoveRight,
        label: 'Move right',
        bindings: [{ keys: ['KeyD', 'ArrowRight'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD', 'Arrows'], order: 10 },
    },
    {
        id: GameAction.AimPointer,
        label: 'Aim',
        hint: { group: 'aim', label: 'Aim', keys: ['Mouse'], order: 20 },
    },
    {
        id: GameAction.CameraRotateLeft,
        label: 'Rotate camera left',
        bindings: [{ keys: ['KeyQ'] }],
        bufferMs: 140,
        hint: { group: 'cameraRotate', label: 'Rotate camera', keys: ['Q', 'R'], order: 30 },
    },
    {
        id: GameAction.CameraRotateRight,
        label: 'Rotate camera right',
        bindings: [{ keys: ['KeyR'] }],
        bufferMs: 140,
        hint: { group: 'cameraRotate', label: 'Rotate camera', keys: ['Q', 'R'], order: 30 },
    },
    {
        id: GameAction.Jump,
        label: 'Jump',
        bindings: [{ keys: ['Space'] }],
        bufferMs: 200,
        hint: { group: 'jump', label: 'Jump', keys: ['Space'], order: 40 },
    },
    {
        id: GameAction.AttackPrimary,
        label: 'Use selected weapon',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 120,
        cooldownMs: 360,
        hint: { group: 'attack', label: 'Use weapon', keys: ['F'], order: 50 },
    },
    {
        id: GameAction.BowShot,
        label: 'Bow',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 140,
        cooldownMs: 520,
    },
    {
        id: GameAction.Shield,
        label: 'Shield',
        bindings: [{ keys: ['ShiftLeft', 'ShiftRight'], displayKeys: ['Shift'] }],
        hint: { group: 'shield', label: 'Shield', keys: ['Shift'], order: 65 },
    },
    {
        id: GameAction.AirPush,
        label: 'Air push',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 140,
        cooldownMs: 1500,
    },
    {
        id: GameAction.HighJump,
        label: 'High jump',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 160,
        cooldownMs: 900,
    },
    {
        id: GameAction.SelectWeapon1,
        label: 'Select slot 1',
        bindings: [{ keys: ['Digit1'] }],
        bufferMs: 140,
        hint: { group: 'weaponSelect', label: 'Select weapon', keys: ['1', '2', '3', '4'], order: 70 },
    },
    {
        id: GameAction.SelectWeapon2,
        label: 'Select slot 2',
        bindings: [{ keys: ['Digit2'] }],
        bufferMs: 140,
        hint: { group: 'weaponSelect', label: 'Select weapon', keys: ['1', '2', '3', '4'], order: 70 },
    },
    {
        id: GameAction.SelectWeapon3,
        label: 'Select slot 3',
        bindings: [{ keys: ['Digit3'] }],
        bufferMs: 140,
        hint: { group: 'weaponSelect', label: 'Select weapon', keys: ['1', '2', '3', '4'], order: 70 },
    },
    {
        id: GameAction.SelectWeapon4,
        label: 'Select slot 4',
        bindings: [{ keys: ['Digit4'] }],
        bufferMs: 140,
        hint: { group: 'weaponSelect', label: 'Select weapon', keys: ['1', '2', '3', '4'], order: 70 },
    },
    {
        id: GameAction.Interact,
        label: 'Interact',
        bindings: [{ keys: ['KeyE'] }],
        bufferMs: 160,
        hint: { group: 'interact', label: 'Interact', keys: ['E'], order: 80 },
    },
    {
        id: GameAction.ToggleInventory,
        label: 'Inventory',
        bindings: [{ keys: ['KeyI'] }],
        bufferMs: 160,
        hint: { group: 'inventory', label: 'Inventory', keys: ['I'], order: 85 },
    },
    {
        id: GameAction.CameraZoom,
        label: 'Zoom',
        hint: { group: 'zoom', label: 'Zoom', keys: ['Wheel'], order: 90 },
    },
]

export const GAME_COMMAND_HINT_ACTIONS: readonly ActionId[] = [
    GameAction.MoveForward,
    GameAction.AimPointer,
    GameAction.CameraRotateLeft,
    GameAction.Jump,
    GameAction.AttackPrimary,
    GameAction.Shield,
    GameAction.SelectWeapon1,
    GameAction.Interact,
    GameAction.ToggleInventory,
    GameAction.CameraZoom,
]

export function createGameActionMap(input: Input): ActionMap {
    return new ActionMap(GAME_ACTIONS, input)
}
