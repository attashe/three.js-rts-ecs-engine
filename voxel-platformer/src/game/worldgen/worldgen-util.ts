// Tiny dependency-free helpers shared across the worldgen compiler modules.
// Keep this module import-free so any worldgen file can use it without risking
// an import cycle.

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
