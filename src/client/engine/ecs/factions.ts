export const enum FactionId {
    None = 0,
    Player = 1,
    Neutral = 2,
    Hostile = 3,
}

export const enum Relation {
    Neutral = 0,
    Friend = 1,
    Enemy = 2,
}

const SIZE = 4

const relationships = new Uint8Array(SIZE * SIZE)

function set(a: FactionId, b: FactionId, relation: Relation): void {
    relationships[a * SIZE + b] = relation
}

for (let i = 0; i < SIZE; i++) set(i as FactionId, i as FactionId, Relation.Friend)

set(FactionId.Player, FactionId.Neutral, Relation.Neutral)
set(FactionId.Neutral, FactionId.Player, Relation.Neutral)

set(FactionId.Player, FactionId.Hostile, Relation.Enemy)
set(FactionId.Hostile, FactionId.Player, Relation.Enemy)

set(FactionId.Neutral, FactionId.Hostile, Relation.Enemy)
set(FactionId.Hostile, FactionId.Neutral, Relation.Enemy)

export function relationBetween(a: number, b: number): Relation {
    if (a < 0 || a >= SIZE || b < 0 || b >= SIZE) return Relation.Neutral
    return relationships[a * SIZE + b] as Relation
}

export function areEnemies(a: number, b: number): boolean {
    return relationBetween(a, b) === Relation.Enemy
}
