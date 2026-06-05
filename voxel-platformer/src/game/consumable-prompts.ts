export function actionKeyLabel(keys: readonly string[], fallback = 'Use button'): string {
    const clean = keys.map((key) => key.trim()).filter(Boolean)
    return clean.length > 0 ? clean.join(' / ') : fallback
}

export function consumableUseLabel(keys: readonly string[], consumableName: string): string {
    return `${actionKeyLabel(keys)} to use ${consumableName}`
}
