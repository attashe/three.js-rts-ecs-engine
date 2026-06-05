export const enum MovementStateId {
    Idle = 0,
    Moving = 1,
    Airborne = 2,
    Blocked = 3,
    Repathing = 4,
}

export function movementStateName(state: number): string {
    switch (state) {
        case MovementStateId.Idle: return 'idle'
        case MovementStateId.Moving: return 'moving'
        case MovementStateId.Airborne: return 'airborne'
        case MovementStateId.Blocked: return 'blocked'
        case MovementStateId.Repathing: return 'repathing'
        default: return 'unknown'
    }
}
