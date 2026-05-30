// Equipment socket resolution + attachment.
import type { Object3D } from 'three'
import { SLOT_TO_SOCKET, SOCKET_NAMES, type EquipSlot } from '../core/convention'

/** Find every canonical socket node by name under `root`. Missing sockets are
 *  simply absent from the map (that slot is disabled). */
export function resolveSockets(root: Object3D): Map<string, Object3D> {
    const map = new Map<string, Object3D>()
    for (const name of SOCKET_NAMES) {
        const node = root.getObjectByName(name)
        if (node) map.set(name, node)
    }
    return map
}

export function socketNode(sockets: Map<string, Object3D>, slot: EquipSlot): Object3D | undefined {
    return sockets.get(SLOT_TO_SOCKET[slot])
}

/** Parent `item` to the slot's socket so it inherits the bone's animated
 *  transform. Returns false if the slot's socket is missing. */
export function attachToSocket(sockets: Map<string, Object3D>, slot: EquipSlot, item: Object3D): boolean {
    const node = socketNode(sockets, slot)
    if (!node) return false
    item.position.set(0, 0, 0)
    item.quaternion.identity()
    node.add(item)
    return true
}

export function detachFromSocket(item: Object3D): void {
    item.parent?.remove(item)
}
