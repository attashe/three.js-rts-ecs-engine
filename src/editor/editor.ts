import { EditorShell } from '../client/ui'

document.body.replaceChildren()

const shell = new EditorShell()
shell.setStatus('No level loaded', 'Ready')
