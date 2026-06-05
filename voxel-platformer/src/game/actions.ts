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
    RaiseShield: 'weapon.shield',
    CastSpell: 'spell.cast',
    SwitchWeapon: 'weapon.switch',
    UseConsumable: 'consumable.use',
    Interact: 'interact',
    Inventory: 'inventory.open',
    CameraRotateLeft: 'camera.rotateLeft',
    CameraRotateRight: 'camera.rotateRight',
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
        // `mods: []` = plain Space only, so Shift+Space (high jump) doesn't also
        // fire an ordinary jump.
        bindings: [{ keys: ['Space'], mods: [] }],
        bufferMs: 200,
        hint: { group: 'jump', label: 'Jump', keys: ['Space'], order: 40 },
    },
    {
        id: GameAction.HighJump,
        label: 'High jump',
        bindings: [{ keys: ['Space'], mods: ['Shift'] }],
        bufferMs: 160,
        cooldownMs: 900,
        hint: { group: 'highJump', label: 'High jump', keys: ['Shift+Space'], order: 45 },
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
        // Universal attack on Left Mouse: melee swing, bow shot, or staff bonk
        // depending on the active weapon stance. (Id kept as `weapon.bowShot`.)
        id: GameAction.BowShot,
        label: 'Attack',
        bindings: [{ keys: ['Mouse0'] }],
        bufferMs: 140,
        cooldownMs: 420,
        hint: { group: 'attack', label: 'Attack', keys: ['LMB'], order: 50 },
    },
    {
        // Right Mouse is the contextual secondary: it raises the shield in the
        // melee (sword+shield) stance. With a staff there's no shield, so the
        // same button casts (see CastSpell). Consumers gate on equipment/stance,
        // so binding both to RMB is unambiguous.
        id: GameAction.RaiseShield,
        label: 'Block (shield)',
        bindings: [{ keys: ['Mouse2'] }],
        hint: { group: 'secondary', label: 'Block / Cast', keys: ['RMB'], order: 51 },
    },
    {
        id: GameAction.CastSpell,
        label: 'Cast spell (staff)',
        bindings: [{ keys: ['Mouse2'] }],
        bufferMs: 140,
        cooldownMs: 700,
        hint: { group: 'secondary', label: 'Block / Cast', keys: ['RMB'], order: 51 },
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
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 160,
        cooldownMs: 320,
        hint: { group: 'useConsumable', label: 'Use consumable', keys: ['F'], order: 54 },
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

// ── Keybind persistence ──────────────────────────────────────────────
// Player-customised bindings live in localStorage so a rebind survives a
// reload. Stored as { [actionId]: ['Mouse0', ...] }; unknown ids / non-string
// keys are dropped on read so a stale/corrupt entry can't break startup.

export const KEYBINDS_STORAGE_KEY = 'vp:keybinds'

interface KeyValueStore {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

function browserStore(): KeyValueStore | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage
    } catch {
        return null
    }
}

const VALID_ACTION_IDS = new Set<string>(Object.values(GameAction))

/** Drop unknown action ids and non-string key codes from a parsed overrides
 *  blob. Exported for tests. */
export function sanitizeKeyOverrides(value: unknown): GameKeyboardOverrides {
    if (!value || typeof value !== 'object') return {}
    const out: Record<string, readonly string[]> = {}
    for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
        if (!VALID_ACTION_IDS.has(id) || !Array.isArray(keys)) continue
        const codes = keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        if (codes.length > 0) out[id] = codes
    }
    return out as GameKeyboardOverrides
}

export function loadStoredKeyOverrides(store: KeyValueStore | null = browserStore()): GameKeyboardOverrides {
    if (!store) return {}
    try {
        const raw = store.getItem(KEYBINDS_STORAGE_KEY)
        return raw ? sanitizeKeyOverrides(JSON.parse(raw)) : {}
    } catch {
        return {}
    }
}

export function saveKeyOverrides(overrides: GameKeyboardOverrides, store: KeyValueStore | null = browserStore()): void {
    if (!store) return
    try {
        store.setItem(KEYBINDS_STORAGE_KEY, JSON.stringify(overrides))
    } catch {
        // Private mode / quota — bindings still apply in memory this session.
    }
}
