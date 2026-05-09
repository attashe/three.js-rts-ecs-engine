import { hasComponent } from 'bitecs'
import { Faction } from './components'
import type { GameWorld } from './world'

export const enum FactionId {
    None = 0,
    Player = 1,
    Neutral = 2,
    Hostile = 3,
    Hunter = 4,
    Wildlife = 5,
    SkirmishRed = 6,
    SkirmishBlue = 7,
}

export const enum Relation {
    Neutral = 0,
    Friend = 1,
    Enemy = 2,
}

const SIZE = 8

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

set(FactionId.Player, FactionId.Hunter, Relation.Neutral)
set(FactionId.Hunter, FactionId.Player, Relation.Neutral)

set(FactionId.Neutral, FactionId.Hunter, Relation.Friend)
set(FactionId.Hunter, FactionId.Neutral, Relation.Friend)

set(FactionId.Hostile, FactionId.Hunter, Relation.Enemy)
set(FactionId.Hunter, FactionId.Hostile, Relation.Enemy)

set(FactionId.Player, FactionId.Wildlife, Relation.Neutral)
set(FactionId.Wildlife, FactionId.Player, Relation.Neutral)

set(FactionId.Neutral, FactionId.Wildlife, Relation.Neutral)
set(FactionId.Wildlife, FactionId.Neutral, Relation.Neutral)

set(FactionId.Hostile, FactionId.Wildlife, Relation.Neutral)
set(FactionId.Wildlife, FactionId.Hostile, Relation.Neutral)

set(FactionId.Hunter, FactionId.Wildlife, Relation.Enemy)
set(FactionId.Wildlife, FactionId.Hunter, Relation.Enemy)

set(FactionId.Player, FactionId.SkirmishRed, Relation.Neutral)
set(FactionId.SkirmishRed, FactionId.Player, Relation.Neutral)

set(FactionId.Player, FactionId.SkirmishBlue, Relation.Neutral)
set(FactionId.SkirmishBlue, FactionId.Player, Relation.Neutral)

set(FactionId.SkirmishRed, FactionId.SkirmishBlue, Relation.Enemy)
set(FactionId.SkirmishBlue, FactionId.SkirmishRed, Relation.Enemy)

export function relationBetween(a: number, b: number): Relation {
    if (a < 0 || a >= SIZE || b < 0 || b >= SIZE) return Relation.Neutral
    return relationships[a * SIZE + b] as Relation
}

export function areEnemies(a: number, b: number): boolean {
    return relationBetween(a, b) === Relation.Enemy
}

export function markEntityHostile(world: GameWorld, subject: number, target: number): void {
    if (subject === target) return
    let enemies = world.hostilityByEid.get(subject)
    if (!enemies) {
        enemies = new Set<number>()
        world.hostilityByEid.set(subject, enemies)
    }
    enemies.add(target)
}

export function clearEntityHostility(world: GameWorld, eid: number): void {
    world.hostilityByEid.delete(eid)
    for (const enemies of world.hostilityByEid.values()) enemies.delete(eid)
}

export function areEntitiesEnemies(world: GameWorld, a: number, b: number): boolean {
    if (world.hostilityByEid.get(a)?.has(b)) return true
    if (!hasComponent(world, a, Faction) || !hasComponent(world, b, Faction)) return false
    return areEnemies(Faction.id[a], Faction.id[b])
}
