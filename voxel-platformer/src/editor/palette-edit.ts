import { clonePalette, type Palette, type PaletteEntry } from '../engine/voxel/palette'

export const MAX_EDITOR_PALETTE_ENTRIES = 256

export function colorToHex(color: readonly [number, number, number]): string {
    const [r, g, b] = color
    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`
}

export function hexToColor(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return [1, 1, 1]
    const value = m[1]!
    return [
        parseInt(value.slice(0, 2), 16) / 255,
        parseInt(value.slice(2, 4), 16) / 255,
        parseInt(value.slice(4, 6), 16) / 255,
    ]
}

export function appendMaterial(palette: Palette, source?: PaletteEntry): number {
    if (palette.entries.length >= MAX_EDITOR_PALETTE_ENTRIES) return -1
    const base = source ? clonePalette({ entries: [source] }).entries[0]! : defaultMaterial()
    palette.entries.push({
        ...base,
        name: uniqueMaterialName(palette, source ? `${base.name} copy` : 'new material'),
    })
    return palette.entries.length - 1
}

export function materialFingerprint(entry: PaletteEntry): string {
    return JSON.stringify(entry)
}

function uniqueMaterialName(palette: Palette, wanted: string): string {
    const used = new Set(palette.entries.map((entry) => entry.name))
    if (!used.has(wanted)) return wanted
    for (let i = 2; i < 1000; i++) {
        const candidate = `${wanted} ${i}`
        if (!used.has(candidate)) return candidate
    }
    return `${wanted} ${Date.now()}`
}

function defaultMaterial(): PaletteEntry {
    return {
        name: 'new material',
        color: [1, 1, 1],
        solid: true,
        collidable: true,
        occludesFaces: true,
        raycastTarget: true,
        pathSurface: true,
    }
}

function componentToHex(v: number): string {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)))
    return n.toString(16).padStart(2, '0')
}
