import { ChunkManager } from '../../engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../../engine/voxel/palette'
import { PickupKind } from '../../engine/ecs/systems/pickup-system'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import {
    NEW_LEVEL_DEFAULT_DEPTH,
    NEW_LEVEL_DEFAULT_WIDTH,
    NEW_LEVEL_MAX_DIMENSION,
    loadLevelFromFile,
    loadLevelFromBuffer,
    newLevel,
    saveLevelDownload,
} from '../save-load'
import { serializeLevel } from '../../engine/voxel/level-serializer'
import { listLevelLibrary, saveLevelToLibrary, type LevelLibraryEntry } from '../../game/level-library'
import { launchPlaytest } from '../playtest'
import { copyScriptEntry, copyStoneSpawner, DEFAULT_AMBIENT_WEATHER, toLevelMeta, type EditorLevelMeta } from '../editor-state'
import { generatePlatformerLevel, type LevelMeta } from '../../game/level'
import { copyPlayerSettings } from '../../game/player-settings'
import { sectionEl, type RefreshableElement } from './common'
import { buildEnvironmentAudioSection, buildGlobalVisualEnvironmentSection } from './environment-controls'
import { buildDisplayControlsSection } from './display-controls'
import demoQuestSource from '../../../examples/scripts/demo-quest.js?raw'
import lanternTrialSource from '../../../examples/scripts/lantern-trial.js?raw'
import hasteShrineSource from '../../../examples/scripts/haste-shrine.js?raw'

export interface LevelTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

/** Save / Load / Playtest controls + level name field + new-level form. */
export function buildLevelTab(opts: LevelTabOptions): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // New-level form. Two number inputs (W × D in cells) plus a New
    // button. Clicking confirms before destroying the current state so
    // the user doesn't lose work by accident.
    const newSection = sectionEl('New level')
    const sizeRow = document.createElement('div')
    sizeRow.className = 'vpe-field'
    const sizeLabel = document.createElement('span')
    sizeLabel.className = 'vpe-field-label'
    sizeLabel.textContent = 'Size (W × D):'
    const widthInput = document.createElement('input')
    widthInput.className = 'vpe-input'
    widthInput.type = 'number'
    widthInput.min = '1'
    widthInput.max = String(NEW_LEVEL_MAX_DIMENSION)
    widthInput.value = String(NEW_LEVEL_DEFAULT_WIDTH)
    widthInput.style.width = '52px'
    widthInput.title = 'Width — number of cells along X'
    const times = document.createElement('span')
    times.textContent = '×'
    times.style.color = 'rgba(217, 247, 255, 0.55)'
    const depthInput = document.createElement('input')
    depthInput.className = 'vpe-input'
    depthInput.type = 'number'
    depthInput.min = '1'
    depthInput.max = String(NEW_LEVEL_MAX_DIMENSION)
    depthInput.value = String(NEW_LEVEL_DEFAULT_DEPTH)
    depthInput.style.width = '52px'
    depthInput.title = 'Depth — number of cells along Z'
    sizeRow.append(sizeLabel, widthInput, times, depthInput)
    newSection.appendChild(sizeRow)

    const newBtn = document.createElement('button')
    newBtn.className = 'vpe-button'
    newBtn.textContent = 'New'
    newBtn.title = 'Discard the current level and seed a fresh dirt+grass pad'
    newBtn.onclick = () => {
        const w = parseInt(widthInput.value, 10)
        const d = parseInt(depthInput.value, 10)
        if (!Number.isFinite(w) || !Number.isFinite(d) || w < 1 || d < 1) return
        const confirmed = window.confirm(
            `Discard the current level and create a new ${w} × ${d} pad? Unsaved work will be lost.`,
        )
        if (!confirmed) return
        newLevel(opts.world, opts.chunks, opts.editorState, w, d)
        opts.history.clear()
        nameInput.value = 'untitled-level'
    }
    newSection.appendChild(newBtn)
    root.appendChild(newSection)

    const section = sectionEl('Level')

    const nameRow = document.createElement('div')
    nameRow.className = 'vpe-field'
    const nameLabel = document.createElement('span')
    nameLabel.className = 'vpe-field-label'
    nameLabel.textContent = 'Name:'
    const nameInput = document.createElement('input')
    nameInput.className = 'vpe-input'
    nameInput.type = 'text'
    nameInput.value = 'untitled-level'
    nameInput.style.flex = '2'
    nameRow.append(nameLabel, nameInput)
    section.appendChild(nameRow)

    const ioRow = document.createElement('div')
    ioRow.className = 'vpe-row'
    const saveBtn = document.createElement('button')
    saveBtn.className = 'vpe-button'
    saveBtn.textContent = 'Download'
    saveBtn.style.flex = '1'
    saveBtn.onclick = () => saveLevelDownload(opts.chunks, opts.editorState, nameInput.value || 'untitled-level')

    const loadBtn = document.createElement('button')
    loadBtn.className = 'vpe-button'
    loadBtn.textContent = 'Load'
    loadBtn.style.flex = '1'
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.vplevel,application/octet-stream'
    fileInput.style.display = 'none'
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0]
        if (!file) return
        try {
            const meta = await loadLevelFromFile(file, opts.world, opts.chunks, opts.editorState)
            opts.history.clear()
            nameInput.value = meta.name
        } catch (err) {
            console.error('Failed to load level:', err)
        } finally {
            fileInput.value = ''
        }
    }
    loadBtn.onclick = () => fileInput.click()
    ioRow.append(saveBtn, loadBtn, fileInput)
    section.appendChild(ioRow)

    const playtestBtn = document.createElement('button')
    playtestBtn.className = 'vpe-button'
    playtestBtn.textContent = '▶ Playtest'
    playtestBtn.title = 'Save the current level to session storage and open it in the game'
    playtestBtn.style.fontWeight = 'bold'
    playtestBtn.onclick = () => launchPlaytest(opts.chunks, opts.editorState, nameInput.value || 'playtest-level')
    section.appendChild(playtestBtn)

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Download saves a .vplevel file. Playtest jumps to the game with the current state.'
    section.appendChild(hint)

    root.appendChild(section)

    const librarySection = sectionEl('Project library')
    const libraryStatus = document.createElement('div')
    libraryStatus.className = 'vpe-hint'
    libraryStatus.textContent = 'Levels in public/levels.'
    const librarySelect = document.createElement('select')
    librarySelect.className = 'vpe-input'
    librarySelect.style.width = '100%'
    const libraryRow = document.createElement('div')
    libraryRow.className = 'vpe-row'
    const saveProjectBtn = document.createElement('button')
    saveProjectBtn.className = 'vpe-button'
    saveProjectBtn.textContent = 'Save to project'
    saveProjectBtn.style.flex = '1'
    const refreshLibraryBtn = document.createElement('button')
    refreshLibraryBtn.className = 'vpe-button'
    refreshLibraryBtn.textContent = 'Refresh'
    refreshLibraryBtn.style.flex = '1'
    const loadProjectBtn = document.createElement('button')
    loadProjectBtn.className = 'vpe-button'
    loadProjectBtn.textContent = 'Load selected'
    loadProjectBtn.style.width = '100%'
    libraryRow.append(saveProjectBtn, refreshLibraryBtn)
    librarySection.append(libraryStatus, librarySelect, libraryRow, loadProjectBtn)
    root.appendChild(librarySection)

    let libraryEntries: LevelLibraryEntry[] = []
    let selectedLevelId = ''

    function renderLibraryOptions(): void {
        const previous = selectedLevelId || librarySelect.value
        librarySelect.innerHTML = ''
        if (libraryEntries.length === 0) {
            const option = document.createElement('option')
            option.value = ''
            option.textContent = '(no saved project levels)'
            librarySelect.appendChild(option)
            librarySelect.value = ''
            selectedLevelId = ''
            return
        }
        for (const entry of libraryEntries) {
            const option = document.createElement('option')
            option.value = entry.id
            option.textContent = entry.name
            if (entry.modifiedAt) option.title = `${entry.file} · ${entry.modifiedAt}`
            librarySelect.appendChild(option)
        }
        const wanted = libraryEntries.some((entry) => entry.id === previous) ? previous : libraryEntries[0]!.id
        librarySelect.value = wanted
        selectedLevelId = wanted
    }

    async function refreshLibrary(): Promise<void> {
        libraryStatus.textContent = 'Loading project levels...'
        try {
            libraryEntries = await listLevelLibrary()
            renderLibraryOptions()
            const savedCount = libraryEntries.filter((entry) => !entry.builtin).length
            libraryStatus.textContent = savedCount === 0
                ? 'Built-in demo available. No saved .vplevel files in public/levels.'
                : `${savedCount} saved level${savedCount === 1 ? '' : 's'} available.`
        } catch (err) {
            console.error('Failed to list project levels:', err)
            libraryStatus.textContent = err instanceof Error ? err.message : 'Failed to list project levels.'
        }
    }

    function loadBuiltInDemoLevel(): EditorLevelMeta {
        const demoChunks = new ChunkManager(DEFAULT_PALETTE)
        const demo = generatePlatformerLevel(demoChunks)
        demo.scripts = [
            {
                id: 'demo-quest',
                name: 'demo-quest.js',
                source: demoQuestSource,
                fromFile: true,
                sourcePath: 'examples/scripts/demo-quest.js',
            },
            {
                id: 'lantern-trial',
                name: 'lantern-trial.js',
                source: lanternTrialSource,
                fromFile: true,
                sourcePath: 'examples/scripts/lantern-trial.js',
            },
            {
                id: 'haste-shrine',
                name: 'haste-shrine.js',
                source: hasteShrineSource,
                fromFile: true,
                sourcePath: 'examples/scripts/haste-shrine.js',
            },
        ]
        return loadLevelFromBuffer(
            serializeLevel(demoChunks, editorMetaFromRuntimeLevel(demo)),
            opts.world,
            opts.chunks,
            opts.editorState,
        )
    }

    /*
     * The built-in demo is generated as runtime LevelMeta, not as an
     * editor save. This adapter lets the Level tab expose it beside
     * disk-backed `.vplevel` files without teaching save-load about
     * procedural runtime-only hazards such as stone spawners.
     */
    function editorMetaFromRuntimeLevel(meta: LevelMeta): EditorLevelMeta {
        return {
            name: meta.name,
            spawn: { ...meta.spawn },
            player: copyPlayerSettings(meta.player),
            stoneSpawners: meta.stoneSpawners.map(copyStoneSpawner),
            pickups: meta.coinPiles.map((pile) => ({
                position: { ...pile.position },
                kind: PickupKind.Gold,
                amount: pile.amount ?? 1,
            })),
            pistons: meta.pistons.map((piston) => ({
                from: { ...piston.from },
                to: { ...piston.to },
                block: piston.block,
                delay: piston.delay ?? piston.interval ?? 2,
                motion: piston.motion ?? 'teleport',
                travelTime: piston.travelTime ?? 1,
                characterPolicy: piston.characterPolicy ?? 'block',
                moveSoundId: piston.moveSoundId,
                moveSoundVolume: piston.moveSoundVolume,
            })),
            zones: meta.zones.map((zone) => ({
                id: zone.id,
                kind: zone.kind,
                label: zone.label,
                min: { ...zone.min },
                max: { ...zone.max },
                triggerSources: zone.triggerSources ? [...zone.triggerSources] : undefined,
                script: zone.script ? { actions: [...zone.script.actions] } : undefined,
                portal: zone.portal ? { ...zone.portal } : undefined,
                interaction: zone.interaction ? {
                    prompt: zone.interaction.prompt,
                    anchor: zone.interaction.anchor ? { ...zone.interaction.anchor } : undefined,
                    radius: zone.interaction.radius,
                } : undefined,
                active: zone.active,
            })),
            soundSources: meta.soundSources.map((source) => ({
                id: source.id,
                soundId: source.soundId,
                label: source.label,
                position: { ...source.position },
                radius: source.radius,
                volume: source.volume,
                loop: source.loop,
                autoplay: source.autoplay,
            })),
            environment: meta.environment ? { ...meta.environment } : undefined,
            soundZones: meta.soundZones.map((zone) => ({
                id: zone.id,
                label: zone.label,
                min: { ...zone.min },
                max: { ...zone.max },
                soundId: zone.soundId,
                volume: zone.volume,
                fadeTime: zone.fadeTime,
            })),
            weatherZones: meta.weatherZones.map((zone) => ({
                id: zone.id,
                label: zone.label,
                presetId: zone.presetId,
                position: { ...zone.position },
                size: { ...zone.size },
                addSound: zone.addSound,
                soundId: zone.soundId,
                soundVolume: zone.soundVolume,
            })),
            props: meta.props.map((prop) => ({
                id: prop.id,
                kind: prop.kind,
                position: { ...prop.position },
                yaw: prop.yaw,
                scale: prop.scale,
                gridAligned: prop.gridAligned,
            })),
            npcs: meta.npcs.map((npc) => ({
                ...npc,
                position: { ...npc.position },
            })),
            ambientWeather: meta.ambientWeather ? {
                enabled: true,
                presetId: meta.ambientWeather.presetId ?? 'clear',
                state: {
                    ...DEFAULT_AMBIENT_WEATHER,
                    ...meta.ambientWeather.state,
                    skyTint: cloneSkyTint(meta.ambientWeather.state.skyTint),
                },
            } : undefined,
            scripts: meta.scripts.map(copyScriptEntry),
        }
    }

    function cloneSkyTint(value: unknown): [number, number, number] {
        if (!Array.isArray(value) || value.length < 3) return [...DEFAULT_AMBIENT_WEATHER.skyTint] as [number, number, number]
        const r = Number(value[0])
        const g = Number(value[1])
        const b = Number(value[2])
        return [
            Number.isFinite(r) ? r : 1,
            Number.isFinite(g) ? g : 1,
            Number.isFinite(b) ? b : 1,
        ]
    }

    librarySelect.onchange = () => {
        selectedLevelId = librarySelect.value
    }
    refreshLibraryBtn.onclick = () => { void refreshLibrary() }
    saveProjectBtn.onclick = async () => {
        const name = nameInput.value || 'untitled-level'
        const buffer = serializeLevel(opts.chunks, toLevelMeta(opts.editorState, name))
        libraryStatus.textContent = 'Saving project level...'
        try {
            const saved = await saveLevelToLibrary(name, buffer)
            selectedLevelId = saved.id
            await refreshLibrary()
            librarySelect.value = saved.id
            libraryStatus.textContent = `Saved ${saved.file}.`
        } catch (err) {
            console.error('Failed to save project level:', err)
            libraryStatus.textContent = err instanceof Error ? err.message : 'Failed to save project level.'
        }
    }
    loadProjectBtn.onclick = async () => {
        const id = selectedLevelId || librarySelect.value
        const entry = libraryEntries.find((item) => item.id === id)
        if (!entry) return
        if (entry.builtin === 'demo') {
            libraryStatus.textContent = 'Loading built-in demo...'
            try {
                const meta = loadBuiltInDemoLevel()
                opts.history.clear()
                nameInput.value = meta.name
                libraryStatus.textContent = 'Loaded built-in demo.'
            } catch (err) {
                console.error('Failed to load built-in demo:', err)
                libraryStatus.textContent = err instanceof Error ? err.message : 'Failed to load built-in demo.'
            }
            return
        }
        libraryStatus.textContent = `Loading ${entry.file}...`
        try {
            const res = await fetch(entry.url, { cache: 'no-store' })
            if (!res.ok) throw new Error(`Load failed: HTTP ${res.status}`)
            const meta = loadLevelFromBuffer(await res.arrayBuffer(), opts.world, opts.chunks, opts.editorState)
            opts.history.clear()
            nameInput.value = meta.name
            libraryStatus.textContent = `Loaded ${entry.file}.`
        } catch (err) {
            console.error('Failed to load project level:', err)
            libraryStatus.textContent = err instanceof Error ? err.message : 'Failed to load project level.'
        }
    }
    void refreshLibrary()

    const environmentAudio = buildEnvironmentAudioSection(opts.editorState)
    root.appendChild(environmentAudio.element)

    const visualEnvironment = buildGlobalVisualEnvironmentSection(opts.editorState)
    root.appendChild(visualEnvironment.element)

    const displayControls = buildDisplayControlsSection()
    root.appendChild(displayControls.element)

    return {
        element: root,
        refresh() {
            environmentAudio.refresh()
            visualEnvironment.refresh()
            displayControls.refresh()
        },
    }
}
