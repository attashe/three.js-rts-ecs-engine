export type StoneEditorIdKind = 'stone' | 'stone-spawner'

export function nextStoneEditorId(ids: Iterable<string | undefined>, kind: StoneEditorIdKind, start = 1): string {
    const taken = takenIds(ids)
    let index = Math.max(1, Math.floor(start))
    let candidate = `${kind}-${index}`
    while (taken.has(candidate)) {
        index += 1
        candidate = `${kind}-${index}`
    }
    return candidate
}

export function normalizeStoneEditorId(
    value: string,
    currentId: string | undefined,
    ids: Iterable<string | undefined>,
    kind: StoneEditorIdKind,
): string {
    const taken = takenIds(ids, currentId)
    const base = value.trim()
    if (!base) return nextStoneEditorId(taken, kind)
    if (!taken.has(base)) return base

    let index = 2
    let candidate = `${base}-${index}`
    while (taken.has(candidate)) {
        index += 1
        candidate = `${base}-${index}`
    }
    return candidate
}

function takenIds(ids: Iterable<string | undefined>, exclude?: string): Set<string> {
    const taken = new Set<string>()
    for (const id of ids) {
        if (id && id !== exclude) taken.add(id)
    }
    return taken
}
