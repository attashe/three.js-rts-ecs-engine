export type LocalAssetKind = 'sounds' | 'music' | 'stingers'

export interface LocalAssetRecord {
    id: string
    kind: LocalAssetKind
    fileName: string
    url: string
    size: number
    type: string
}

export function makeLocalAssetId(fileName: string, existingIds: ReadonlySet<string>): string {
    const clean = fileName
        .replace(/\.[^.]+$/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'clip'
    let id = `local.${clean}`
    let suffix = 2
    while (existingIds.has(id)) {
        id = `local.${clean}-${suffix}`
        suffix++
    }
    return id
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if (bytes < 1024) return `${Math.round(bytes)} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
