// Equipment socket resolution + attachment.
import { Euler, Quaternion, Vector3, type Object3D } from 'three'
import { SLOT_TO_SOCKET, SOCKET_NAMES, type EquipSlot } from '../core/convention'

/** How to orient an attached item, independent of the socket bone's arbitrary
 *  rest frame. Different rigs orient their hand bones differently (the code rig
 *  is world-aligned; a Blender rig's hand bone is rolled ~180° along the limb),
 *  so attaching with the raw bone frame tilts the item. Supplying a frame
 *  cancels the bone's rest rotation relative to `root` (the rig model), so the
 *  item starts in the model's frame (then follows the animation). */
export interface SocketFrame {
    /** The rig model the orientation is expressed relative to (controller.root). */
    root: Object3D
    /** Desired item orientation in the model frame, Euler XYZ radians.
     *  Default = identity (item axis-aligned to the model: +Y up, +Z forward). */
    orient?: readonly [number, number, number]
    /** Desired grip offset from the socket, expressed in the model frame. */
    offset?: readonly [number, number, number]
}

const _boneQ = new Quaternion()
const _rootQ = new Quaternion()
const _desired = new Quaternion()
const _euler = new Euler()
const _offset = new Vector3()

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
 *  transform. Returns false if the slot's socket is missing. With a `frame`, the
 *  item is canonicalised into the model's frame so its orientation is consistent
 *  across rigs with differently-oriented socket bones. */
export function attachToSocket(
    sockets: Map<string, Object3D>,
    slot: EquipSlot,
    item: Object3D,
    frame?: SocketFrame,
): boolean {
    const node = socketNode(sockets, slot)
    if (!node) return false
    item.position.set(0, 0, 0)
    if (frame) {
        // item.local = inv(boneRelModel) * desired, where
        // boneRelModel = inv(rootWorld) * boneWorld.
        node.getWorldQuaternion(_boneQ)
        frame.root.getWorldQuaternion(_rootQ)
        const boneRelModel = _rootQ.invert().multiply(_boneQ)
        const o = frame.orient
        _desired.setFromEuler(o ? _euler.set(o[0], o[1], o[2], 'XYZ') : _euler.set(0, 0, 0))
        const invBoneRelModel = boneRelModel.invert()
        item.quaternion.copy(invBoneRelModel.clone().multiply(_desired))
        if (frame.offset) {
            item.position.copy(_offset.set(frame.offset[0], frame.offset[1], frame.offset[2]).applyQuaternion(invBoneRelModel))
        }
    } else {
        item.quaternion.identity()
    }
    node.add(item)
    return true
}

export function detachFromSocket(item: Object3D): void {
    item.parent?.remove(item)
}
