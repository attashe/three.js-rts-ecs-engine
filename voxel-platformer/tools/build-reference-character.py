"""
Build a conforming reference character .glb using Blender as a Python module.

Run headless WITHOUT the blender binary:

    python tools/build-reference-character.py

It writes `public/models/reference-character.glb`, authored to the contract in
`docs/animation-blender-convention.md`:
  - glTF 2.0 binary, +Y up, feet at the origin, ~1.6 units tall
  - one armature named `Armature` + one skinned mesh
  - socket bones: socket_head, socket_hand_R, socket_hand_L, socket_back,
    socket_foot_R, socket_foot_L
  - actions named: idle, walk, run, jump, fall, land

This is the canonical Blender mirror of the code reference rig — proof the import
pipeline works end-to-end, and a template to author real characters from.
"""

import math
import os
import bpy
from mathutils import Euler, Quaternion, Vector

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "models", "reference-character.glb")
FPS = 24


# ── scene reset ─────────────────────────────────────────────────────────────
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


# ── armature ────────────────────────────────────────────────────────────────
# Blender is Z-up; the glTF exporter converts to +Y up. Bones point along +Z
# (or down), so a local X rotation swings limbs forward/back.
BONES = [
    # name,            head,                 tail,                 parent,        deform
    ("hips",          (0.0, 0.0, 0.85),  (0.0, 0.0, 1.05), None,          True),
    ("spine",         (0.0, 0.0, 1.05),  (0.0, 0.0, 1.45), "hips",        True),
    ("head",          (0.0, 0.0, 1.45),  (0.0, 0.0, 1.70), "spine",       True),
    ("upperArm.R",    (-0.20, 0.0, 1.40), (-0.30, 0.0, 1.00), "spine",     True),
    ("upperArm.L",    (0.20, 0.0, 1.40), (0.30, 0.0, 1.00), "spine",      True),
    ("thigh.R",       (-0.10, 0.0, 0.85), (-0.10, 0.0, 0.05), "hips",     True),
    ("thigh.L",       (0.10, 0.0, 0.85), (0.10, 0.0, 0.05), "hips",       True),
    # sockets — non-deform, just attachment frames that follow their joint.
    # Underscore names (NOT dots) so they survive three's glTF name sanitisation.
    ("socket_head",   (0.0, 0.0, 1.70), (0.0, 0.0, 1.85), "head",         False),
    ("socket_hand_R", (-0.30, 0.0, 1.00), (-0.30, 0.0, 0.88), "upperArm.R", False),
    ("socket_hand_L", (0.30, 0.0, 1.00), (0.30, 0.0, 0.88), "upperArm.L", False),
    ("socket_back",   (0.0, 0.12, 1.30), (0.0, 0.20, 1.30), "spine",      False),
    ("socket_foot_R", (-0.10, 0.02, 0.18), (-0.10, 0.02, 0.04), "thigh.R", False),
    ("socket_foot_L", (0.10, 0.02, 0.18), (0.10, 0.02, 0.04), "thigh.L",   False),
]


def build_armature():
    arm_data = bpy.data.armatures.new("Armature")
    arm_obj = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, head, tail, parent, deform in BONES:
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        b.use_deform = deform
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


# ── skinned mesh ────────────────────────────────────────────────────────────
# (center xyz, size xyz, bone) — each box is rigidly weighted to one bone.
PARTS = [
    ((0.0, 0.0, 0.92), (0.34, 0.22, 0.24), "hips"),
    ((0.0, 0.0, 1.20), (0.42, 0.24, 0.50), "spine"),
    ((0.0, 0.0, 1.57), (0.32, 0.30, 0.32), "head"),
    ((0.0, -0.16, 1.56), (0.07, 0.08, 0.07), "head"),   # nose → defines +Z front
    ((-0.27, 0.0, 1.15), (0.13, 0.15, 0.50), "upperArm.R"),
    ((0.27, 0.0, 1.15), (0.13, 0.15, 0.50), "upperArm.L"),
    ((-0.10, 0.0, 0.42), (0.15, 0.18, 0.70), "thigh.R"),
    ((0.10, 0.0, 0.42), (0.15, 0.18, 0.70), "thigh.L"),
]

BOX_FACES = [
    (0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4),
    (1, 5, 7, 3), (2, 3, 7, 6), (0, 4, 5, 1),
]


def box(center, size):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [
        (cx - hx, cy - hy, cz - hz), (cx - hx, cy - hy, cz + hz),
        (cx - hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz + hz),
        (cx + hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz + hz),
    ]
    return verts


def build_mesh(arm_obj):
    verts, faces, vert_bone = [], [], []
    for center, size, bone in PARTS:
        base = len(verts)
        verts.extend(box(center, size))
        faces.extend(tuple(base + i for i in f) for f in BOX_FACES)
        vert_bone.extend([bone] * 8)

    mesh = bpy.data.meshes.new("BodyMesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    mat = bpy.data.materials.new("Body")
    mat.diffuse_color = (0.25, 0.45, 0.65, 1.0)
    mesh.materials.append(mat)

    obj = bpy.data.objects.new("Body", mesh)
    bpy.context.collection.objects.link(obj)

    # Vertex groups named exactly after the deform bones; rigid weight 1.
    groups = {}
    for name, *_rest in BONES:
        if name not in groups:
            groups[name] = obj.vertex_groups.new(name=name)
    for i, bone in enumerate(vert_bone):
        groups[bone].add([i], 1.0, "REPLACE")

    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    return obj


# ── animations ──────────────────────────────────────────────────────────────
def euler_quat(rx, ry, rz):
    return Euler((rx, ry, rz), "XYZ").to_quaternion()


def new_action(arm_obj, name):
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm_obj.animation_data.action = act
    return act


def key(arm_obj, bone, frame, rot):
    pb = arm_obj.pose.bones[bone]
    pb.rotation_quaternion = euler_quat(*rot)
    pb.keyframe_insert("rotation_quaternion", frame=frame)


def build_actions(arm_obj):
    # idle — gentle breathe + arm sway
    new_action(arm_obj, "idle")
    for bone, frames in {
        "spine": [(1, (0, 0, 0)), (24, (0.04, 0, 0)), (48, (0, 0, 0))],
        "upperArm.R": [(1, (0, 0, -0.04)), (24, (0, 0, -0.09)), (48, (0, 0, -0.04))],
        "upperArm.L": [(1, (0, 0, 0.04)), (24, (0, 0, 0.09)), (48, (0, 0, 0.04))],
    }.items():
        for f, r in frames:
            key(arm_obj, bone, f, r)

    cycle(arm_obj, "walk", length=20, amp=0.45, lean=0.0)
    cycle(arm_obj, "run", length=14, amp=0.85, lean=0.18)

    # jump — arms up, legs tuck, hold
    new_action(arm_obj, "jump")
    for bone, r0, r1 in [
        ("spine", (0, 0, 0), (-0.15, 0, 0)),
        ("upperArm.R", (0, 0, -0.1), (-2.2, 0, -0.2)),
        ("upperArm.L", (0, 0, 0.1), (-2.2, 0, 0.2)),
        ("thigh.R", (0, 0, 0), (0.7, 0, 0)),
        ("thigh.L", (0, 0, 0), (0.5, 0, 0)),
    ]:
        key(arm_obj, bone, 1, r0)
        key(arm_obj, bone, 7, r1)

    # fall — arms out, slight flail
    new_action(arm_obj, "fall")
    for bone, a, b in [
        ("upperArm.R", (-1.4, 0, -0.5), (-1.6, 0, -0.7)),
        ("upperArm.L", (-1.4, 0, 0.5), (-1.6, 0, 0.7)),
        ("thigh.R", (-0.25, 0, 0), (0.1, 0, 0)),
        ("thigh.L", (0.1, 0, 0), (-0.25, 0, 0)),
    ]:
        key(arm_obj, bone, 1, a)
        key(arm_obj, bone, 8, b)
        key(arm_obj, bone, 16, a)

    # land — quick crouch + recover
    new_action(arm_obj, "land")
    for bone in ("thigh.R", "thigh.L"):
        key(arm_obj, bone, 1, (0, 0, 0))
        key(arm_obj, bone, 3, (0.7, 0, 0))
        key(arm_obj, bone, 8, (0, 0, 0))
    key(arm_obj, "spine", 1, (0, 0, 0))
    key(arm_obj, "spine", 3, (0.28, 0, 0))
    key(arm_obj, "spine", 8, (0, 0, 0))


def cycle(arm_obj, name, length, amp, lean):
    new_action(arm_obj, name)
    half = length // 2
    def swing(sign):
        return [(1, (sign * amp, 0, 0)), (1 + half, (-sign * amp, 0, 0)), (1 + length, (sign * amp, 0, 0))]
    key(arm_obj, "spine", 1, (lean, 0, 0))
    key(arm_obj, "spine", 1 + length, (lean, 0, 0))
    for bone, sign in [("thigh.R", 1), ("thigh.L", -1), ("upperArm.R", -1), ("upperArm.L", 1)]:
        for f, r in swing(sign):
            key(arm_obj, bone, f, r)


# ── export ──────────────────────────────────────────────────────────────────
def main():
    reset_scene()
    arm_obj = build_armature()
    build_mesh(arm_obj)
    build_actions(arm_obj)

    out = os.path.normpath(OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_apply=False,
        export_skins=True,
        export_def_bones=False,
        use_selection=False,
    )
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
