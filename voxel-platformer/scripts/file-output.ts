import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'

export type WritableData = ArrayBuffer | Uint8Array | string

export async function writeIfChanged(path: string, data: WritableData): Promise<boolean> {
    const next = bufferFrom(data)
    try {
        const previous = await readFile(path)
        if (Buffer.compare(previous, next) === 0) return false
    } catch {
        // Missing file, unreadable stale artifact, or new directory: write below.
    }

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, next)
    return true
}

export function relativeOutput(path: string): string {
    const rel = relative(process.cwd(), path)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

function bufferFrom(data: WritableData): Buffer {
    if (typeof data === 'string') return Buffer.from(data, 'utf8')
    if (data instanceof Uint8Array) return Buffer.from(data)
    return Buffer.from(new Uint8Array(data))
}
