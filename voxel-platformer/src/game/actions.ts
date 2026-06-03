import {
    ActionMap,
    keyOverridesToActionBindings,
    withActionBindingOverrides,
    type ActionDefinition,
    type ActionId,
    type ActionKeyOverrideMap,
} from '../engine/input/actions'
import type { Input } from '../engine/input/input'

export const GameAction = {
    MoveForward: 'move.forward',
    MoveBackward: 'move.backward',
    MoveLeft: 'move.left',
    MoveRight: 'move.right',
    AimPointer: 'aim.pointer',
    Jump: 'move.jump',
    HighJump: 'spell.highJump',
    AirPush: 'spell.airPush',
    BowShot: 'weapon.bowShot',
    Attack: 'weapon.attack',
    RaiseShield: 'weapon.shield',
    CastSpell: 'spell.cast',
    SwitchWeapon: 'weapon.switch',
    UseConsumable: 'consumable.use',
    Interact: 'interact',
    Inventory: 'inventory.open',
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
        id: GameAction.HighJump,
        label: 'High jump',
        bindings: [{ keys: ['KeyH'] }],
        bufferMs: 160,
        cooldownMs: 900,
        hint: { group: 'highJump', label: 'High jump', keys: ['H'], order: 45 },
    },
    {
        id: GameAction.AirPush,
        label: 'Air push',
        bindings: [{ keys: ['KeyG'] }],
        bufferMs: 140,
        cooldownMs: 1500,
        hint: { group: 'airPush', label: 'Air push', keys: ['G'], order: 46 },
    },
    {
        // Universal attack: melee swing, bow shot, or magic bolt depending on
        // the active weapon stance. Kept under the legacy `weapon.bowShot` id and
        // F binding so saved keymaps and the action tests stay valid.
        id: GameAction.BowShot,
        label: 'Attack',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 140,
        cooldownMs: 420,
        hint: { group: 'attack', label: 'Attack', keys: ['F'], order: 50 },
    },
    {
        // Legacy melee attack id, retained so saved keymaps and tests stay
        // valid. The universal attack on F drives combat now; this is unused at
        // runtime but kept bound to V.
        id: GameAction.Attack,
        label: 'Melee attack',
        bindings: [{ keys: ['KeyV'] }],
        bufferMs: 120,
        cooldownMs: 420,
    },
    {
        id: GameAction.RaiseShield,
        label: 'Raise shield',
        bindings: [{ keys: ['KeyT'] }],
        hint: { group: 'shield', label: 'Shield', keys: ['T'], order: 51 },
    },
    {
        id: GameAction.CastSpell,
        label: 'Cast spell',
        bindings: [{ keys: ['KeyC'] }],
        bufferMs: 140,
        cooldownMs: 700,
        hint: { group: 'cast', label: 'Cast', keys: ['C'], order: 52 },
    },
    {
        id: GameAction.SwitchWeapon,
        label: 'Switch weapon',
        bindings: [{ keys: ['KeyX'] }],
        bufferMs: 160,
        hint: { group: 'switchWeapon', label: 'Switch weapon', keys: ['X'], order: 53 },
    },
    {
        id: GameAction.UseConsumable,
        label: 'Use consumable',
        bindings: [{ keys: ['KeyZ'] }],
        bufferMs: 160,
        cooldownMs: 320,
        hint: { group: 'useConsumable', label: 'Use consumable', keys: ['Z'], order: 54 },
    },
    {
        id: GameAction.Interact,
        label: 'Interaction',
        bindings: [{ keys: ['KeyE'] }],
        bufferMs: 160,
        hint: { group: 'interact', label: 'Interaction', keys: ['E'], order: 55 },
    },
    {
        id: GameAction.Inventory,
        label: 'Inventory',
        bindings: [{ keys: ['Tab'] }],
        bufferMs: 160,
        hint: { group: 'inventory', label: 'Inventory', keys: ['Tab'], order: 56 },
    },
]

export const GAME_COMMAND_HINT_ACTIONS: readonly ActionId[] = [
    GameAction.MoveForward,
    GameAction.AimPointer,
    GameAction.Jump,
    GameAction.HighJump,
    GameAction.AirPush,
    GameAction.BowShot,
    GameAction.RaiseShield,
    GameAction.CastSpell,
    GameAction.SwitchWeapon,
    GameAction.UseConsumable,
    GameAction.Interact,
    GameAction.Inventory,
    GameAction.CameraRotateLeft,
]

export type GameKeyboardOverrides = Partial<Record<GameActionId, readonly string[]>>

export function createGameActionDefinitions(overrides: GameKeyboardOverrides = {}): ActionDefinition[] {
    return withActionBindingOverrides(
        GAME_ACTIONS,
        keyOverridesToActionBindings(overrides as ActionKeyOverrideMap),
    )
}

export function createGameActionMap(input: Input, overrides: GameKeyboardOverrides = {}): ActionMap {
    return new ActionMap(createGameActionDefinitions(overrides), input)
}
