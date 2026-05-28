export interface LevelLibraryEntry {
    id: string
    name: string
    file: string
    url: string
    builtin?: 'demo'
    size?: number
    modifiedAt?: string
}

export interface LevelLibraryManifest {
    version: 1
    levels: LevelLibraryEntry[]
}

const DEV_ENDPOINT = '/__vpe/levels'
const MANIFEST_URL = '/levels/manifest.json'
const LEVELS_BASE_URL = '/levels'
export const BUILTIN_DEMO_LEVEL_ID = 'demo'

export async function listLevelLibrary(fetchImpl: typeof fetch = fetch): Promise<LevelLibraryEntry[]> {
    try {
        const res = await fetchImpl(DEV_ENDPOINT, { cache: 'no-store' })
        if (res.ok) return withBuiltinLevels(normalizeEntries(await res.json()))
    } catch {
        // Static builds do not have the dev endpoint; fall through to
        // the manifest emitted at build time.
    }

    const res = await fetchImpl(MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) {
        if (res.status === 404) return withBuiltinLevels([])
        throw new Error(`Level library manifest failed: HTTP ${res.status}`)
    }
    const manifest = await res.json() as Partial<LevelLibraryManifest>
    return withBuiltinLevels(normalizeEntries(manifest.levels ?? []))
}

export async function saveLevelToLibrary(
    name: string,
    buffer: ArrayBuffer,
    fetchImpl: typeof fetch = fetch,
): Promise<LevelLibraryEntry> {
    const levelName = normalizeLevelName(name)
    const res = await fetchImpl(`${DEV_ENDPOINT}/save?name=${encodeURIComponent(levelName)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: buffer,
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Saving level failed: HTTP ${res.status}`)
    }
    const [entry] = normalizeEntries([await res.json()])
    if (!entry) throw new Error('Saving level failed: empty response')
    return entry
}

export async function loadLevelBufferById(id: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
    const normalized = normalizeLevelId(id)
    let url = `${LEVELS_BASE_URL}/${encodeURIComponent(normalizeLevelFile(normalized))}`
    try {
        const entries = await listLevelLibrary(fetchImpl)
        const entry = entries.find((item) => item.id === normalized && item.builtin === undefined)
        if (entry) url = entry.url
    } catch {
        // Direct loading still works for canonical filenames even when the
        // optional project-library index is unavailable.
    }
    const res = await fetchImpl(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Level "${id}" failed to load: HTTP ${res.status}`)
    return res.arrayBuffer()
}

export function normalizeLevelId(input: string): string {
    const trimmed = input.trim().replace(/\.vplevel$/i, '')
    const safe = trimmed
        .replace(/[/\\]+/g, '-')
        .replace(/[^a-zA-Z0-9._ -]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
    return safe || 'untitled-level'
}

export function normalizeLevelFile(input: string): string {
    return `${normalizeLevelId(input)}.vplevel`
}

function normalizeLevelName(input: string): string {
    const trimmed = input.trim()
    return trimmed || 'untitled-level'
}

function preserveLevelFile(input: string): string {
    const trimmed = input.trim()
    if (!trimmed) return ''
    const base = trimmed.split(/[\\/]+/).filter(Boolean).pop() ?? ''
    if (!base.toLowerCase().endsWith('.vplevel')) return ''
    return base
}

function normalizeEntries(value: unknown): LevelLibraryEntry[] {
    if (!Array.isArray(value)) return []
    const out: LevelLibraryEntry[] = []
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Partial<LevelLibraryEntry>
        const preservedFile = typeof item.file === 'string' ? preserveLevelFile(item.file) : ''
        const idSource = typeof item.id === 'string' && item.id.trim()
            ? item.id
            : preservedFile.replace(/\.vplevel$/i, '')
        const id = idSource ? normalizeLevelId(idSource) : ''
        if (!id) continue
        const file = preservedFile || normalizeLevelFile(id)
        const url = typeof item.url === 'string' && item.url.trim()
            ? item.url
            : `${LEVELS_BASE_URL}/${encodeURIComponent(file)}`
        out.push({
            id,
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
            file,
            url,
            size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
            modifiedAt: typeof item.modifiedAt === 'string' ? item.modifiedAt : undefined,
        })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
}

function withBuiltinLevels(entries: LevelLibraryEntry[]): LevelLibraryEntry[] {
    if (entries.some((entry) => entry.id === BUILTIN_DEMO_LEVEL_ID)) return entries
    const out = [
        ...entries,
        {
            id: BUILTIN_DEMO_LEVEL_ID,
            name: 'Demo (built-in)',
            file: 'built-in demo',
            url: 'builtin:demo',
            builtin: 'demo' as const,
        },
    ]
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
}
