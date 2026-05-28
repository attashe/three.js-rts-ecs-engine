import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { Input } from '../engine/input/input'
import type {
    DialogueChoice,
    DialogueLine,
    DialogueRequest,
    DialogueResult,
    DialogueSpeaker,
    UiFacade,
} from '../engine/script/types'

interface DialogueControllerOptions {
    input: Input
}

interface DialogueQueueItem {
    request: DialogueRequest
    resolve: (result: DialogueResult) => void
    key: string | null
}

interface SpeakerView {
    id: string
    name: string
    avatar: string
    side: 'left' | 'right'
}

interface ActiveDialogue {
    request: DialogueRequest
    speakers: Map<string, SpeakerView>
    lines: DialogueLine[]
    index: number
    selectedChoice: number
    awaitingChoiceEcho: DialogueChoice | null
    result: DialogueResult
    resolve: (result: DialogueResult) => void
    key: string | null
}

interface DialogueDom {
    root: HTMLDivElement
    panel: HTMLDivElement
    title: HTMLDivElement
    speakerName: HTMLDivElement
    avatar: HTMLDivElement
    avatarImage: HTMLImageElement
    avatarInitial: HTMLDivElement
    text: HTMLDivElement
    choices: HTMLDivElement
    progress: HTMLDivElement
}

export interface DialogueController {
    readonly facade: Pick<UiFacade, 'dialogue'>
    readonly system: System
}

export function createDialogueController(opts: DialogueControllerOptions): DialogueController {
    let dom: DialogueDom | null = null
    let active: ActiveDialogue | null = null
    const queue: DialogueQueueItem[] = []
    const activeKeys = new Set<string>()

    function open(request: DialogueRequest): Promise<DialogueResult> {
        const key = dialogueRequestKey(request)
        if (key !== null && activeKeys.has(key)) return Promise.resolve({})
        if (key !== null) activeKeys.add(key)
        return new Promise<DialogueResult>((resolve) => {
            queue.push({ request, resolve, key })
            pumpQueue()
        })
    }

    function pumpQueue(): void {
        if (active || queue.length === 0) return
        const next = queue.shift()!
        const lines = sanitizeLines(next.request.lines)
        active = {
            request: next.request,
            speakers: buildSpeakers(next.request),
            lines,
            index: 0,
            selectedChoice: 0,
            awaitingChoiceEcho: null,
            result: {},
            resolve: next.resolve,
            key: next.key,
        }
        ensureDom()
        opts.input.setEnabled(false)
        showRoot(true)
        render()
        if (lines.length === 0) finish({})
    }

    const system: System = {
        name: 'dialogue',
        order: RenderOrder.debug + 10,
        init() {
            ensureDom()
            showRoot(false)
            window.addEventListener('keydown', onKeyDown, { capture: true })
        },
        update() {
            if (active) opts.input.clear()
        },
        dispose() {
            window.removeEventListener('keydown', onKeyDown, true)
            dom?.root.remove()
            dom = null
            active = null
            queue.length = 0
            activeKeys.clear()
            opts.input.setEnabled(true)
        },
    }

    return {
        facade: { dialogue: open },
        system,
    }

    function ensureDom(): DialogueDom {
        if (dom) return dom
        const built = buildDialogueDom()
        dom = built
        document.body.appendChild(built.root)
        built.root.addEventListener('pointerdown', onPointerDown)
        return built
    }

    function onPointerDown(ev: PointerEvent): void {
        if (!active || ev.button !== 0) return
        const choiceTarget = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-dialogue-choice]')
        ev.preventDefault()
        ev.stopPropagation()
        if (choiceTarget) {
            selectChoice(Number(choiceTarget.dataset.dialogueChoice))
            return
        }
        advance()
    }

    function onKeyDown(ev: KeyboardEvent): void {
        if (!active) return
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return
        const handled = handleDialogueKey(ev.code)
        if (!handled) return
        ev.preventDefault()
        ev.stopPropagation()
        ev.stopImmediatePropagation()
    }

    function handleDialogueKey(code: string): boolean {
        if (!active) return false
        const choices = currentChoices()
        if (choices.length > 0 && !active.awaitingChoiceEcho) {
            const numberIndex = choiceIndexForKey(code)
            if (numberIndex !== null && numberIndex < choices.length) {
                selectChoice(numberIndex)
                return true
            }
            if (code === 'ArrowUp' || code === 'KeyW') {
                moveChoice(-1)
                return true
            }
            if (code === 'ArrowDown' || code === 'KeyS') {
                moveChoice(1)
                return true
            }
            if (code === 'Enter' || code === 'Space') {
                selectChoice(active.selectedChoice)
                return true
            }
            return code === 'Escape'
        }
        if (code === 'Enter' || code === 'Space') {
            advance()
            return true
        }
        return code === 'Escape'
    }

    function advance(): void {
        if (!active) return
        if (active.awaitingChoiceEcho) {
            finish(active.result)
            return
        }
        const choices = currentChoices()
        if (choices.length > 0) return
        active.index++
        if (active.index >= active.lines.length) {
            finish(active.result)
            return
        }
        active.selectedChoice = firstEnabledChoice(currentChoices())
        render()
    }

    function moveChoice(delta: number): void {
        if (!active) return
        const choices = currentChoices()
        if (choices.length === 0) return
        let next = active.selectedChoice
        for (let i = 0; i < choices.length; i++) {
            next = (next + delta + choices.length) % choices.length
            if (!choices[next]?.disabled) break
        }
        active.selectedChoice = next
        render()
    }

    function selectChoice(index: number): void {
        if (!active) return
        const choices = currentChoices()
        const choice = choices[index]
        if (!choice || choice.disabled) return
        active.result = { choiceId: choice.id, choiceIndex: index, text: choice.text }
        active.awaitingChoiceEcho = choice
        render()
    }

    function finish(result: DialogueResult): void {
        const done = active
        if (!done) return
        active = null
        if (done.key) activeKeys.delete(done.key)
        showRoot(false)
        opts.input.setEnabled(true)
        opts.input.clear()
        done.resolve(result)
        pumpQueue()
    }

    function render(): void {
        if (!active || !dom) return
        const d = dom
        const line = active.awaitingChoiceEcho
            ? { speaker: 'player', text: active.awaitingChoiceEcho.text }
            : active.lines[active.index]!
        const speaker = speakerForLine(active, line)
        const side = speaker.side

        d.title.textContent = active.request.title ?? ''
        d.title.style.display = active.request.title ? 'block' : 'none'
        d.speakerName.textContent = speaker.name
        d.text.textContent = line.text
        d.avatarInitial.textContent = avatarInitials(speaker)
        paintAvatar(d.avatar, d.avatarImage, d.avatarInitial, speaker)

        d.panel.style.gridTemplateColumns = side === 'right'
            ? 'minmax(0, 1fr) 104px'
            : '104px minmax(0, 1fr)'
        d.avatar.style.gridColumn = side === 'right' ? '2' : '1'
        d.avatar.style.gridRow = '1 / span 3'
        d.speakerName.style.textAlign = side === 'right' ? 'right' : 'left'
        d.text.style.textAlign = side === 'right' ? 'right' : 'left'
        d.choices.innerHTML = ''

        const choices = active.awaitingChoiceEcho ? [] : currentChoices()
        if (choices.length > 0) {
            d.choices.style.display = 'grid'
            choices.forEach((choice, i) => {
                d.choices.appendChild(choiceButton(choice, i, i === active!.selectedChoice))
            })
        } else {
            d.choices.style.display = 'none'
        }

        const total = Math.max(1, active.lines.length)
        const step = active.awaitingChoiceEcho ? total : Math.min(total, active.index + 1)
        d.progress.textContent = `${step}/${total}`
    }

    function currentChoices(): DialogueChoice[] {
        if (!active) return []
        return active.lines[active.index]?.choices?.filter((choice) => choice && choice.text.trim()) ?? []
    }

    function choiceButton(choice: DialogueChoice, index: number, selected: boolean): HTMLButtonElement {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.dialogueChoice = String(index)
        button.disabled = choice.disabled === true
        button.onclick = (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            selectChoice(index)
        }
        button.onmouseenter = () => {
            if (!active || choice.disabled) return
            active.selectedChoice = index
            render()
        }

        const key = document.createElement('span')
        key.textContent = String(index + 1)
        Object.assign(key.style, {
            display: 'inline-grid',
            placeItems: 'center',
            minWidth: '22px',
            height: '22px',
            borderRadius: '4px',
            background: selected ? 'rgba(255, 224, 131, 0.18)' : 'rgba(238, 246, 242, 0.08)',
            border: selected ? '1px solid rgba(255, 224, 131, 0.65)' : '1px solid rgba(238, 246, 242, 0.18)',
            color: selected ? '#ffe083' : 'rgba(238, 246, 242, 0.78)',
            font: '700 11px ui-monospace, monospace',
        } satisfies Partial<CSSStyleDeclaration>)

        const label = document.createElement('span')
        label.textContent = choice.text
        label.style.minWidth = '0'

        button.append(key, label)
        Object.assign(button.style, {
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: '10px',
            minHeight: '38px',
            padding: '8px 10px',
            borderRadius: '6px',
            border: selected ? '1px solid rgba(255, 224, 131, 0.62)' : '1px solid rgba(238, 246, 242, 0.16)',
            background: selected ? 'rgba(71, 54, 25, 0.92)' : 'rgba(19, 27, 31, 0.86)',
            color: choice.disabled ? 'rgba(238, 246, 242, 0.36)' : '#eef6f2',
            font: '600 13px ui-sans-serif, system-ui, sans-serif',
            textAlign: 'left',
            cursor: choice.disabled ? 'default' : 'pointer',
        } satisfies Partial<CSSStyleDeclaration>)
        return button
    }

    function showRoot(visible: boolean): void {
        if (!dom) return
        dom.root.style.display = visible ? 'grid' : 'none'
        dom.root.style.pointerEvents = visible ? 'auto' : 'none'
        dom.root.setAttribute('aria-hidden', visible ? 'false' : 'true')
    }
}

function buildDialogueDom(): DialogueDom {
    const root = document.createElement('div')
    root.id = 'voxel-platformer-dialogue'
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1700',
        display: 'none',
        placeItems: 'center',
        padding: '18px',
        background: 'rgba(4, 8, 10, 0.34)',
        color: '#eef6f2',
        font: '14px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)

    const shell = document.createElement('div')
    Object.assign(shell.style, {
        width: 'min(760px, calc(100vw - 28px))',
        maxHeight: 'min(540px, calc(100vh - 28px))',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: '10px',
    } satisfies Partial<CSSStyleDeclaration>)
    root.appendChild(shell)

    const title = document.createElement('div')
    Object.assign(title.style, {
        display: 'none',
        color: 'rgba(238, 246, 242, 0.68)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    shell.appendChild(title)

    const panel = document.createElement('div')
    Object.assign(panel.style, {
        display: 'grid',
        gridTemplateColumns: '104px minmax(0, 1fr)',
        gridTemplateRows: 'auto minmax(74px, auto) auto',
        columnGap: '16px',
        rowGap: '10px',
        padding: '18px',
        borderRadius: '8px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        background: 'rgba(10, 15, 17, 0.94)',
        boxShadow: '0 26px 90px rgba(0, 0, 0, 0.52)',
    } satisfies Partial<CSSStyleDeclaration>)
    shell.appendChild(panel)

    const avatar = document.createElement('div')
    Object.assign(avatar.style, {
        width: '96px',
        height: '116px',
        borderRadius: '8px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'inset 0 -24px 36px rgba(0, 0, 0, 0.24)',
    } satisfies Partial<CSSStyleDeclaration>)
    const avatarImage = document.createElement('img')
    avatarImage.alt = ''
    avatarImage.decoding = 'async'
    avatarImage.loading = 'eager'
    Object.assign(avatarImage.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    const avatarInitial = document.createElement('div')
    Object.assign(avatarInitial.style, {
        width: '54px',
        height: '54px',
        borderRadius: '999px',
        display: 'grid',
        placeItems: 'center',
        border: '1px solid rgba(255, 255, 255, 0.24)',
        background: 'rgba(255, 255, 255, 0.08)',
        color: '#fff5d6',
        font: '800 18px ui-sans-serif, system-ui, sans-serif',
        position: 'relative',
        zIndex: '1',
    } satisfies Partial<CSSStyleDeclaration>)
    avatar.append(avatarImage, avatarInitial)
    panel.appendChild(avatar)

    const speakerName = document.createElement('div')
    Object.assign(speakerName.style, {
        font: '800 15px ui-sans-serif, system-ui, sans-serif',
        color: '#ffe083',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(speakerName)

    const text = document.createElement('div')
    Object.assign(text.style, {
        minWidth: '0',
        fontSize: '18px',
        lineHeight: '1.36',
        color: '#eef6f2',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(text)

    const choices = document.createElement('div')
    Object.assign(choices.style, {
        display: 'none',
        gap: '7px',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(choices)

    const progress = document.createElement('div')
    Object.assign(progress.style, {
        gridColumn: '1 / -1',
        justifySelf: 'end',
        color: 'rgba(238, 246, 242, 0.42)',
        font: '600 11px ui-monospace, monospace',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(progress)

    return { root, panel, title, speakerName, avatar, avatarImage, avatarInitial, text, choices, progress }
}

/** Identity used by the re-entrancy gate. A second `ui.dialogue` call for the
 *  same key while one is already active resolves to `{}` instead of queueing. */
export function dialogueRequestKey(request: DialogueRequest): string | null {
    const id = request.id?.trim()
    if (id) return `id:${id}`
    const npcId = request.npc?.id?.trim()
    if (npcId) return `npc:${npcId}`
    return null
}

function buildSpeakers(request: DialogueRequest): Map<string, SpeakerView> {
    const speakers = new Map<string, SpeakerView>()
    const npc = request.npc ?? { id: 'npc', name: 'NPC', avatar: 'npc', side: 'left' as const }
    const player = request.player ?? { id: 'player', name: 'You', avatar: 'player', side: 'right' as const }
    addSpeaker(speakers, 'npc', npc, 'left')
    addSpeaker(speakers, npc.id ?? 'npc', npc, 'left')
    addSpeaker(speakers, 'player', player, 'right')
    addSpeaker(speakers, player.id ?? 'player', player, 'right')
    for (const speaker of request.speakers ?? []) addSpeaker(speakers, speaker.id ?? speaker.name, speaker, 'left')
    return speakers
}

function addSpeaker(
    speakers: Map<string, SpeakerView>,
    id: string,
    speaker: DialogueSpeaker,
    fallbackSide: 'left' | 'right',
): void {
    speakers.set(id, {
        id,
        name: speaker.name,
        avatar: speaker.avatar ?? id,
        side: speaker.side ?? fallbackSide,
    })
}

function speakerForLine(active: ActiveDialogue, line: DialogueLine): SpeakerView {
    const id = line.speaker ?? 'npc'
    const registered = active.speakers.get(id)
    if (registered && !line.name && !line.avatar) return registered
    return {
        id,
        name: line.name ?? registered?.name ?? (id === 'player' ? 'You' : 'NPC'),
        avatar: line.avatar ?? registered?.avatar ?? id,
        side: registered?.side ?? (id === 'player' ? 'right' : 'left'),
    }
}

function sanitizeLines(lines: readonly DialogueLine[] | undefined): DialogueLine[] {
    return (lines ?? [])
        .filter((line) => line && typeof line.text === 'string' && line.text.trim().length > 0)
        .map((line) => ({
            ...line,
            text: line.text.trim(),
            choices: line.choices?.filter((choice) => choice && choice.text.trim().length > 0),
        }))
}

function firstEnabledChoice(choices: readonly DialogueChoice[]): number {
    const index = choices.findIndex((choice) => !choice.disabled)
    return index >= 0 ? index : 0
}

function choiceIndexForKey(code: string): number | null {
    if (/^Digit[1-9]$/.test(code)) return Number(code.slice(5)) - 1
    if (/^Numpad[1-9]$/.test(code)) return Number(code.slice(6)) - 1
    return null
}

function avatarInitials(speaker: SpeakerView): string {
    const words = speaker.name.trim().split(/\s+/).filter(Boolean)
    const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('')
    return initials || '?'
}

function paintAvatar(el: HTMLElement, img: HTMLImageElement, initial: HTMLElement, speaker: SpeakerView): void {
    const theme = avatarTheme(speaker.avatar)
    el.style.background = theme.background
    el.style.borderColor = theme.border
    img.alt = `${speaker.name} portrait`

    const url = dialogueAvatarImageUrl(speaker.avatar)
    if (!url) {
        img.removeAttribute('src')
        img.dataset.avatarSrc = ''
        img.style.display = 'none'
        initial.style.display = 'grid'
        return
    }

    if (img.dataset.avatarSrc !== url) {
        img.dataset.avatarSrc = url
        img.style.display = 'none'
        initial.style.display = 'grid'
        img.onload = () => {
            if (img.dataset.avatarSrc !== url) return
            img.style.display = 'block'
            initial.style.display = 'none'
        }
        img.onerror = () => {
            if (img.dataset.avatarSrc !== url) return
            img.style.display = 'none'
            initial.style.display = 'grid'
        }
        img.src = url
        return
    }

    if (img.complete && img.naturalWidth > 0) {
        img.style.display = 'block'
        initial.style.display = 'none'
    }
}

function avatarTheme(avatar: string): { background: string; border: string } {
    switch (avatar.trim().toLowerCase()) {
        case 'keeper':
            return { background: 'linear-gradient(180deg, #374b63 0%, #1a222d 100%)', border: 'rgba(255, 224, 131, 0.34)' }
        case 'player':
            return { background: 'linear-gradient(180deg, #243947 0%, #11191f 100%)', border: 'rgba(138, 220, 255, 0.34)' }
        case 'sundial':
            return { background: 'linear-gradient(180deg, #5b4a2c 0%, #211a10 100%)', border: 'rgba(255, 224, 131, 0.30)' }
        case 'book':
            return { background: 'linear-gradient(180deg, #4a2f22 0%, #1c1410 100%)', border: 'rgba(238, 186, 135, 0.30)' }
        default:
            return { background: 'linear-gradient(180deg, #313b3c 0%, #151a1b 100%)', border: 'rgba(238, 246, 242, 0.18)' }
    }
}

const BUILTIN_AVATAR_IMAGES: Record<string, string> = {
    book: '/avatars/book.png',
    keeper: '/avatars/keeper.png',
    npc: '/avatars/npc.png',
    player: '/avatars/player.png',
    sundial: '/avatars/sundial.png',
}

export function dialogueAvatarImageUrl(avatar: string | undefined): string | null {
    const value = avatar?.trim()
    if (!value) return null
    const builtIn = BUILTIN_AVATAR_IMAGES[value.toLowerCase()]
    if (builtIn) return builtIn
    return isAvatarImagePath(value) ? value : null
}

function isAvatarImagePath(value: string): boolean {
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif);/i.test(value)) return true
    if (!/\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(value)) return false
    return /^(?:https?:\/\/|\/|\.\/|\.\.\/|avatars\/)/i.test(value)
}
