import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogueAvatarImageUrl, dialogueRequestKey } from '../src/game/dialogue-system'

test('dialogueRequestKey prefers explicit request.id over npc.id', () => {
    assert.equal(
        dialogueRequestKey({
            id: 'keeper.greeting',
            npc: { id: 'keeper', name: 'Keeper' },
            lines: [{ text: 'Hi.' }],
        }),
        'id:keeper.greeting',
    )
})

test('dialogueRequestKey falls back to npc.id when request.id is absent', () => {
    assert.equal(
        dialogueRequestKey({
            npc: { id: 'sundial', name: 'Sundial' },
            lines: [{ text: 'Hi.' }],
        }),
        'npc:sundial',
    )
})

test('dialogueRequestKey returns null when neither id is present so the call is never deduped', () => {
    assert.equal(
        dialogueRequestKey({ lines: [{ text: 'Anonymous narration.' }] }),
        null,
    )
})

test('dialogueRequestKey treats whitespace-only ids as absent', () => {
    assert.equal(
        dialogueRequestKey({
            id: '   ',
            npc: { id: '  ', name: 'Nameless' },
            lines: [{ text: 'Hi.' }],
        }),
        null,
    )
})

test('dialogueAvatarImageUrl resolves built-in avatar keys to replaceable public PNG assets', () => {
    assert.equal(dialogueAvatarImageUrl('keeper'), '/avatars/keeper.png')
    assert.equal(dialogueAvatarImageUrl('PLAYER'), '/avatars/player.png')
})

test('dialogueAvatarImageUrl accepts explicit image paths for custom portraits', () => {
    assert.equal(dialogueAvatarImageUrl('/avatars/merchant.png'), '/avatars/merchant.png')
    assert.equal(dialogueAvatarImageUrl('avatars/merchant.webp?v=2'), 'avatars/merchant.webp?v=2')
    assert.equal(dialogueAvatarImageUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==')
})

test('dialogueAvatarImageUrl keeps unknown author strings on the labelled fallback badge', () => {
    assert.equal(dialogueAvatarImageUrl('merchant'), null)
    assert.equal(dialogueAvatarImageUrl(''), null)
})
