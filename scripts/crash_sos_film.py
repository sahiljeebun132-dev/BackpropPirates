"""The aftermath: a car on its roof, a driver who cannot reach the phone.

Run:
    blender --background --factory-startup --python scripts/crash_sos_film.py -- --still 40
    blender --background --factory-startup --python scripts/crash_sos_film.py -- --stills 1,80,170,250
    blender --background --factory-startup --python scripts/crash_sos_film.py -- --render

Out: docs/pitch-assets/zetway-sos.mp4

WHY THIS CLIP EXISTS, AND WHY IT IS NOT A SIMULATION.

crash_car_ragdoll.py already makes the argument that an impact throws a
belted body about in a way a dropped phone does not, and it makes it with
physics because that argument needs evidence. This clip makes a different
one: that after the crash, the person who most needs help is the one least
able to ask for it. The car is on its roof, they are hanging in the belt,
and the phone is somewhere on the roof lining out of reach.

Nothing here is simulated, deliberately. Rolling a car convincingly in
Bullet takes many passes, and a roll that ends badly looks like a bug
rather than a crash. Nothing in this clip's argument depends on the motion
being derived, so the geometry is posed: the car and its occupant are built
by the same code as the crash clip and then rotated onto the roof as one
rigid piece. The honest description is a diorama, and the caption track
says so rather than implying a second simulation.

THE PHONE SCREEN IS A REAL SCREENSHOT. It is a capture of the deployed app
at 1080x2240, taken while a real microphone fed it real audio, showing the
countdown it actually runs. Drawing a fake screen would have been easier
and would have made the one frame a judge looks hardest at the one frame
that was invented.
"""

from __future__ import annotations

import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crash_car_ragdoll as cc  # noqa: E402  (path has to be set first)

R = cc.R
FPS = 24
F_START, F_END = 1, 312          # 13.0 s

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(_REPO, "docs", "pitch-assets")
SCREEN_PNG = os.path.join(ASSETS, "sos-screen.png")
OUT = os.path.join(ASSETS, "zetway-sos.mp4")

PHONE_GLASS = "#0b1018"
PHONE_BODY = "#1b2330"


# --------------------------------------------------------------------- posing
def scene_objects_to_flip():
    """Everything that is the car or the person, and nothing that is the road.

    Only parentless objects are returned. The car's panels and the belt are
    children, so transforming them as well would apply the rotation twice --
    which looks, confusingly, like a car that has rolled one and a half
    times and left its doors behind.
    """
    keep_put = {"Road", "Ground", "Sun", "SunObj", "Camera", "CamTarget"}
    out = []
    for o in bpy.data.objects:
        if o.parent is not None:
            continue
        if o.name in keep_put:
            continue
        if o.name.startswith(("Verge", "Dash", "Barrier")):
            continue
        if o.type in {"CAMERA", "LIGHT"}:
            continue
        out.append(o)
    return out


def flip_onto_roof(objs):
    """Roll the whole assembly 180 degrees and set it down on the road.

    The lift is measured rather than worked out on paper: rotate first, ask
    Blender where the lowest corner of the whole group ended up, then raise
    everything by exactly that. Hard-coding a height from CAR_BODY_Z and the
    roof panel's offset would be two numbers that have to stay true to a
    file this script does not own.
    """
    pivot = Vector((0.0, 0.0, cc.CAR_BODY_Z))
    rot = Euler((0.0, R(180.0), R(-7.0)), "XYZ").to_matrix().to_4x4()
    m = Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot)
    for o in objs:
        o.matrix_world = m @ o.matrix_world

    bpy.context.view_layer.update()
    low = min(
        (o.matrix_world @ Vector(c)).z
        for o in objs
        if o.type == "MESH"
        for c in o.bound_box
    )
    lift = Matrix.Translation(Vector((0.0, 0.0, -low)))
    for o in objs:
        o.matrix_world = lift @ o.matrix_world
    bpy.context.view_layer.update()
    return -low


def droop(parts):
    """A little slack, so the figure reads as hanging rather than as seated
    upside down. Rotations only, at the shoulders and neck: the belt still
    holds the chest and pelvis exactly where the car put them, which is the
    whole point of a belt and the reason the figure is not on the roof."""
    for key, angle in (
        ("upperarmL", 34.0), ("upperarmR", -30.0),
        ("forearmL", 26.0), ("forearmR", -22.0),
        ("head", 13.0),
    ):
        o = parts.get(key)
        if o is None:
            continue
        pivot = o.matrix_world.translation.copy()
        rot = Euler((R(angle), 0.0, 0.0), "XYZ").to_matrix().to_4x4()
        o.matrix_world = (
            Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot) @ o.matrix_world
        )
    bpy.context.view_layer.update()


# ---------------------------------------------------------------------- phone
def build_phone(near: Vector):
    """The phone, face up on the roof lining, an arm's length from the head.

    Face up because that is the only way the screen is in the shot, and
    because a phone thrown from a cradle lands either way. The screen is an
    emission shader at low strength: a lit screen in daylight that glows
    like a torch reads as a prop, and this one has to read as a phone.
    """
    body_m = cc.matte("PhoneBody", PHONE_BODY, rough=0.55)
    body = cc.box("Phone", (0.075, 0.156, 0.009),
                  (near.x + 0.46, near.y - 0.30, 0.0075), rot=(0, 0, R(14)),
                  material=body_m)

    img = bpy.data.images.load(SCREEN_PNG, check_existing=True)
    mat = bpy.data.materials.new("PhoneScreen")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "EXTEND"
    # 1.25, not 2. The screenshot is a white app on a bright day: at any
    # real emission strength every light pixel clips and the screen renders
    # as a blank white lozenge, which is exactly what the first pass did.
    emit.inputs["Strength"].default_value = 1.25
    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    # A plane, not a box, and placed in world space rather than parented.
    # cc.box takes a WORLD location, so building the screen at a local-looking
    # (0, 0, 0.0055) and then re-parenting left it lit and glowing at the
    # origin of the road, a metre from the phone it belonged to. A plane also
    # unwraps to a clean 0-1 square, where a cube's six faces share the map
    # and the portrait capture lands on the wrong one.
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(
        body.location.x, body.location.y, 0.0125))
    screen = bpy.context.active_object
    screen.name = "PhoneScreen"
    screen.scale = (0.068, 0.145, 1.0)
    screen.rotation_euler = (0.0, 0.0, R(14))
    screen.data.materials.append(mat)
    return body


# --------------------------------------------------------------------- camera
def film_camera(scene, car, head: Vector, phone: Vector):
    cam_data = bpy.data.cameras.new("FilmCam")
    cam_data.lens = 44.0
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    target = bpy.data.objects.new("CamTarget", None)
    scene.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    wreck = Vector((0.0, 0.0, 0.75))

    # (frame, camera position, what it is looking at). Four shots, each one
    # moving slowly throughout: a still camera on a still subject is a
    # photograph, and thirteen seconds of photograph is a long time.
    # Shots three and four are placed relative to the phone rather than in
    # world coordinates, because the phone is placed relative to the head and
    # the head is wherever build_occupant and the flip left it. Absolute
    # numbers here would have to be re-derived every time any of that moves.
    beats = [
        (1,   Vector((7.8, -8.4, 3.5)),  wreck),
        (60,  Vector((6.3, -6.9, 2.6)),  wreck),
        (61,  Vector((3.1, -3.5, 1.15)), head),
        (132, Vector((2.3, -2.6, 0.92)), head),
        # The phone, with the wreck still behind it: looking from +x and -y
        # points the lens back at the car, so the shot says "this phone, in
        # that car" instead of "a phone on a road somewhere".
        (133, phone + Vector((0.62, -0.62, 0.50)), phone),
        (216, phone + Vector((0.45, -0.46, 0.34)), phone),
        # Close enough to read, far enough to keep the whole screen in
        # frame. The first pass put the lens 12 cm away, which filled the
        # frame with the middle third of the app and cropped both ends; a
        # 145 mm screen on a 44 mm lens needs about 24 cm to fit with margin.
        (217, phone + Vector((0.124, -0.160, 0.222)), phone),
        (288, phone + Vector((0.106, -0.137, 0.190)), phone),
        (312, Vector((2.9, -3.2, 1.25)), head),
    ]
    for f, pos, look in beats:
        cam.location = pos
        cam.keyframe_insert("location", frame=f)
        target.location = look
        target.keyframe_insert("location", frame=f)

    # Cuts, not whip pans. Without this the camera sails between shots and
    # the whole thing reads as one long drifting take.
    #
    # Through cc.set_interp, because on 5.2 Action.fcurves is absent rather
    # than empty and the keys live under layers -> strips -> channelbags.
    for holder in (cam, target):
        for f in (60, 132, 216, 288):
            cc.set_interp(holder, f, "CONSTANT")
    return cam


# ----------------------------------------------------------------------- main
def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    do_render = "--render" in argv
    stills = []
    if "--still" in argv:
        stills = [int(argv[argv.index("--still") + 1])]
    if "--stills" in argv:
        stills = [int(x) for x in argv[argv.index("--stills") + 1].split(",")]

    if not os.path.exists(SCREEN_PNG):
        print(f"MISSING screen capture: {SCREEN_PNG}")
        return 2

    cc.clear()
    scene = bpy.context.scene

    cc.build_road()
    car, _interior = cc.build_car()
    parts = cc.build_occupant()

    # No solver at all. build_car and build_occupant register rigid bodies
    # because the crash clip needs them; this one does not, and a rigid body
    # world left switched on would drop the whole posed diorama one frame in.
    if scene.rigidbody_world is not None:
        bpy.ops.rigidbody.world_remove()

    flip_onto_roof(scene_objects_to_flip())
    droop(parts)

    head = parts["head"].matrix_world.translation.copy()
    phone = build_phone(head)
    phone_at = phone.matrix_world.translation.copy()

    cc.build_lighting(scene)
    film_camera(scene, car, head, phone_at)

    cc.setup_render(scene, samples=72)
    scene.frame_start, scene.frame_end = F_START, F_END
    scene.render.fps = FPS

    print(f"HEAD {tuple(round(v, 2) for v in head)}  PHONE {tuple(round(v, 2) for v in phone_at)}")

    if stills:
        os.makedirs(ASSETS, exist_ok=True)
        scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        for f in stills:
            scene.frame_set(f)
            scene.render.filepath = os.path.join(ASSETS, f"sosfilm_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"WROTE {scene.render.filepath}")

    if do_render:
        os.makedirs(ASSETS, exist_ok=True)
        scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.ffmpeg.audio_codec = "NONE"
        scene.render.filepath = OUT
        bpy.ops.render.render(animation=True)
        print(f"WROTE {OUT}")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
