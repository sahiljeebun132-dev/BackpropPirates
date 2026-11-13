"""Build and render the 3D crash sequence for the pitch.

Run:
    blender --background --factory-startup --python scripts/crash_scene.py -- --still 150
    blender --background --factory-startup --python scripts/crash_scene.py -- --render

    --still N   one frame to docs/pitch-assets/still_N.png, for checking framing
    --render    the whole thing to docs/pitch-assets/zetway-crash.mp4
    --save      also write the .blend, so it can be opened and nudged by hand

Everything is built from primitives in code rather than modelled, for one
reason: the scene has to stay honest about numbers that may still change.
The impact frame, the countdown length and the 3.1g threshold are constants
at the top of this file, read from the app, and the animation is derived from
them. A hand-modelled file would drift the first time one of them moved.

Written against Blender 5.2 specifically. Two things there are not what older
tutorials say: the engine id is 'BLENDER_EEVEE' again, and the Principled BSDF
emission sockets are 'Emission Color' and 'Emission Strength'. Both were
checked against this build before a line of scene code was written, because
getting either wrong fails halfway through a render with nothing to show.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

# --------------------------------------------------------------- the numbers
# These come from src/lib/crashWatch.ts. The animation is timed from them so
# the picture cannot quietly disagree with the product.
THRESHOLD_G = 30 / 9.8  # IMPACT_THRESHOLD_MS2
PEAK_G = 5.3            # measured against production
FPS = 24

F_START = 1
F_IMPACT = 54           # the moment of contact
F_SETTLE = 96           # everything has come to rest
F_SCREEN = 108          # the phone takes over
F_END = 210

OUT_DIR = os.path.join("docs", "pitch-assets")

# Zetway's palette, linear-ish. Blender wants scene-referred values, so these
# are the sRGB hex values roughly de-gammaed by eye rather than converted
# exactly; this is a stylised night scene, not a colour-managed product shot.
INK = (0.015, 0.018, 0.028, 1)
BRAND = (0.016, 0.26, 0.60, 1)
RED = (0.62, 0.025, 0.025, 1)
YELLOW = (0.85, 0.52, 0.0, 1)
TARMAC = (0.022, 0.024, 0.030, 1)
SKIN = (0.09, 0.10, 0.13, 1)


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name: str, colour, *, rough=0.55, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        # Blender 4.0 renamed these; 5.2 keeps the new names.
        bsdf.inputs["Emission Color"].default_value = emit
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def put(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, material=None, parent=None):
    obj.location = loc
    obj.rotation_euler = Euler(rot)
    if scale:
        obj.scale = scale
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def cube(name, **kw):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    return put(o, **kw)


def cyl(name, r=0.5, d=1.0, verts=24, **kw):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, vertices=verts)
    o = bpy.context.object
    o.name = name
    return put(o, **kw)


def torus(name, major=0.5, minor=0.12, **kw):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=28, minor_segments=12)
    o = bpy.context.object
    o.name = name
    return put(o, **kw)


def ball(name, r=0.5, **kw):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=24, ring_count=14)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    return put(o, **kw)


def empty(name, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


def key(obj, frame: int, *, loc=None, rot=None, scale=None, interp="BEZIER"):
    """Insert a keyframe, with the interpolation this move wants.

    Interpolation is set through the preference that governs newly created
    keyframes rather than by walking the action afterwards. Blender 4.4
    replaced actions with slotted actions and removed Action.fcurves, so the
    old walk raises AttributeError here — and the preference route is both
    shorter and indifferent to which version is running.
    """
    prefs = getattr(bpy.context.preferences, "edit", None)
    previous = None
    if prefs is not None and hasattr(prefs, "keyframe_new_interpolation_type"):
        previous = prefs.keyframe_new_interpolation_type
        prefs.keyframe_new_interpolation_type = interp
    try:
        if loc is not None:
            obj.location = loc
            obj.keyframe_insert("location", frame=frame)
        if rot is not None:
            obj.rotation_euler = Euler(rot)
            obj.keyframe_insert("rotation_euler", frame=frame)
        if scale is not None:
            obj.scale = scale
            obj.keyframe_insert("scale", frame=frame)
    finally:
        if previous is not None:
            prefs.keyframe_new_interpolation_type = previous


# -------------------------------------------------------------------- scene
def build_road():
    road = cube("Road", loc=(0, 0, -0.02), scale=(16, 400, 0.04),
                material=mat("Tarmac", TARMAC, rough=0.82))

    verge_m = mat("Verge", (0.012, 0.020, 0.013, 1), rough=0.95)
    for side in (-1, 1):
        cube(f"Verge{side}", loc=(side * 13.5, 0, -0.1),
             scale=(11, 400, 0.2), material=verge_m)

    # Lane markings, emissive just enough to catch the eye at night.
    dash_m = mat("Dash", (0.35, 0.35, 0.33, 1), rough=0.7,
                 emit=(0.5, 0.5, 0.45, 1), emit_strength=0.35)
    for i in range(-24, 40):
        cube(f"Dash{i}", loc=(0, i * 9.0, 0.015),
             scale=(0.36, 4.0, 0.02), material=dash_m)

    # A hillside, so the frame is not empty on the left.
    hill_m = mat("Hill", (0.015, 0.023, 0.020, 1), rough=0.95)
    for i, (x, y, s) in enumerate([(-42, 60, 26), (-54, 150, 34), (-38, 240, 22)]):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=s, subdivisions=2, location=(x, y, -s * 0.55))
        o = bpy.context.object
        o.name = f"Hill{i}"
        o.scale = (1.5, 2.1, 0.6)
        o.data.materials.append(hill_m)

    return road


def build_bike(parent):
    """A stylised motorcycle. Enough mass to read as a motorbike in one frame,
    no more: this is a diagram that moves, not a model."""
    body_m = mat("BikeBody", BRAND, rough=0.32, metal=0.55)
    dark_m = mat("BikeDark", (0.02, 0.022, 0.03, 1), rough=0.5, metal=0.3)
    rubber = mat("Rubber", (0.012, 0.012, 0.014, 1), rough=0.9)

    frame = empty("BikeFrame")
    frame.parent = parent

    # wheels, lying in the direction of travel (+Y)
    for nm, y in (("WheelRear", -0.78), ("WheelFront", 0.82)):
        w = torus(nm, major=0.42, minor=0.13,
                  loc=(0, y, 0.42), rot=(0, math.radians(90), 0),
                  material=rubber, parent=frame)
        cyl(nm + "Rim", r=0.19, d=0.1, loc=(0, y, 0.42),
            rot=(0, math.radians(90), 0), material=dark_m, parent=frame)

    cube("Engine", loc=(0, 0.0, 0.52), scale=(0.34, 0.72, 0.38),
         material=dark_m, parent=frame)
    cube("Tank", loc=(0, 0.18, 0.86), scale=(0.36, 0.86, 0.3),
         material=body_m, parent=frame)
    cube("Seat", loc=(0, -0.52, 0.84), scale=(0.3, 0.62, 0.17),
         material=dark_m, parent=frame)
    cyl("Fork", r=0.055, d=0.95, loc=(0, 0.74, 0.78),
        rot=(math.radians(16), 0, 0), material=dark_m, parent=frame)
    cyl("Bars", r=0.045, d=0.78, loc=(0, 0.72, 1.14),
        rot=(0, math.radians(90), 0), material=dark_m, parent=frame)

    # headlight: a real light, not a painted-on disc
    head = ball("HeadlightGlass", r=0.15, loc=(0, 0.92, 1.0), parent=frame,
                material=mat("Headlight", (1, 0.96, 0.85, 1),
                             emit=(1.0, 0.95, 0.8, 1), emit_strength=22))
    beam = bpy.data.lights.new("Beam", type="SPOT")
    beam.energy = 900
    beam.spot_size = math.radians(52)
    beam.spot_blend = 0.5
    beam.color = (1.0, 0.95, 0.85)
    bo = bpy.data.objects.new("BeamObj", beam)
    bpy.context.collection.objects.link(bo)
    bo.parent = frame
    bo.location = (0, 1.0, 1.0)
    bo.rotation_euler = Euler((math.radians(78), 0, 0))

    return frame, head


def build_rider(parent):
    kit = mat("Kit", (0.05, 0.055, 0.075, 1), rough=0.6)
    hi_vis = mat("HiVis", YELLOW, rough=0.45,
                 emit=(0.5, 0.3, 0.0, 1), emit_strength=0.6)

    rider = empty("Rider")
    rider.parent = parent

    cube("Torso", loc=(0, -0.18, 1.32), rot=(math.radians(-24), 0, 0),
         scale=(0.42, 0.34, 0.66), material=hi_vis, parent=rider)
    ball("Helmet", r=0.25, loc=(0, 0.12, 1.78), material=hi_vis, parent=rider)
    ball("Visor", r=0.20, loc=(0, 0.22, 1.76), parent=rider,
         material=mat("Visor", (0.01, 0.01, 0.015, 1), rough=0.15, metal=0.8))
    # arms to the bars, legs to the pegs
    cyl("ArmL", r=0.075, d=0.72, loc=(-0.26, 0.30, 1.32),
        rot=(math.radians(62), 0, 0), material=kit, parent=rider)
    cyl("ArmR", r=0.075, d=0.72, loc=(0.26, 0.30, 1.32),
        rot=(math.radians(62), 0, 0), material=kit, parent=rider)
    cyl("LegL", r=0.095, d=0.72, loc=(-0.24, -0.34, 0.80),
        rot=(math.radians(-28), 0, 0), material=kit, parent=rider)
    cyl("LegR", r=0.095, d=0.72, loc=(0.24, -0.34, 0.80),
        rot=(math.radians(-28), 0, 0), material=kit, parent=rider)
    return rider


def build_phone():
    """The phone on the bar mount, and the thing the camera ends on.

    Its screen is a separate emissive plane whose colour and strength are
    keyframed: calm while riding, red and pulsing once the alert fires. The
    detail of what the screen says lives in the 2D walkthrough; here it only
    has to read, from across a room, as "the phone has woken up and it is
    shouting"."""
    body = cube("Phone", scale=(0.085, 0.012, 0.17),
                material=mat("PhoneBody", (0.01, 0.01, 0.013, 1), rough=0.35, metal=0.6))
    screen_m = mat("Screen", (0.02, 0.03, 0.04, 1), rough=0.1,
                   emit=(0.03, 0.14, 0.26, 1), emit_strength=2.0)
    screen = cube("Screen", loc=(0, -0.0075, 0),
                  scale=(0.075, 0.002, 0.155), material=screen_m, parent=body)

    # A light so the screen actually throws colour onto the road and the rider.
    gl = bpy.data.lights.new("ScreenGlow", type="AREA")
    gl.energy = 12
    gl.size = 0.3
    gl.color = (0.1, 0.5, 1.0)
    glo = bpy.data.objects.new("ScreenGlowObj", gl)
    bpy.context.collection.objects.link(glo)
    glo.parent = body
    glo.location = (0, -0.1, 0)
    glo.rotation_euler = Euler((math.radians(-90), 0, 0))

    return body, screen_m, gl


def build_lights():
    moon = bpy.data.lights.new("Moon", type="SUN")
    moon.energy = 0.45
    moon.color = (0.52, 0.64, 1.0)
    mo = bpy.data.objects.new("MoonObj", moon)
    bpy.context.collection.objects.link(mo)
    mo.rotation_euler = Euler((math.radians(56), 0, math.radians(32)))

    # One street lamp, so there is a pool of light for the crash to land in
    # and the scene is not uniformly black.
    lamp = bpy.data.lights.new("Lamp", type="SPOT")
    lamp.energy = 14000
    lamp.spot_size = math.radians(96)
    lamp.spot_blend = 0.6
    lamp.color = (1.0, 0.83, 0.55)
    lo = bpy.data.objects.new("LampObj", lamp)
    bpy.context.collection.objects.link(lo)
    lo.location = (-7.5, 26, 9.5)
    lo.rotation_euler = Euler((math.radians(26), 0, 0))
    cyl("LampPost", r=0.13, d=9.5, loc=(-7.8, 26, 4.75),
        material=mat("Post", (0.02, 0.02, 0.024, 1), rough=0.7, metal=0.4))

    world = bpy.data.worlds.new("Night")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.006, 0.009, 0.018, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world


# ---------------------------------------------------------------- animation
def animate(rig, bike, rider, phone, screen_m, glow, cam, cam_target):
    """Ride, crash, settle, then let the phone take the frame.

    Timed off F_IMPACT so the whole sequence moves together if that changes.
    """
    # --- the bike travels up +Y, then is thrown
    key(rig, F_START, loc=(0, -26, 0), rot=(0, 0, 0), interp="LINEAR")
    key(rig, F_IMPACT, loc=(0, 4, 0), rot=(0, 0, 0), interp="LINEAR")
    # the tumble: forward, over, and off to the verge
    key(rig, F_IMPACT + 10, loc=(1.1, 9.5, 0.75), rot=(math.radians(-38), math.radians(26), 0))
    key(rig, F_IMPACT + 22, loc=(2.8, 13.4, 0.18), rot=(math.radians(-96), math.radians(68), math.radians(14)))
    key(rig, F_SETTLE, loc=(3.6, 15.1, 0.0), rot=(math.radians(-104), math.radians(88), math.radians(18)))

    # --- the rider separates from the bike and slides
    key(rider, F_START, loc=(0, 0, 0), rot=(0, 0, 0))
    key(rider, F_IMPACT, loc=(0, 0, 0), rot=(0, 0, 0))
    key(rider, F_IMPACT + 12, loc=(-0.7, 2.6, 0.55), rot=(math.radians(-52), 0, math.radians(-22)))
    key(rider, F_IMPACT + 26, loc=(-1.9, 5.0, -0.42), rot=(math.radians(-96), 0, math.radians(-54)))
    key(rider, F_SETTLE, loc=(-2.4, 5.8, -0.46), rot=(math.radians(-98), 0, math.radians(-62)))

    # --- the phone is flung off the mount and lands screen-up
    key(phone, F_START, loc=(0.16, 0.74, 1.14), rot=(math.radians(66), 0, 0))
    key(phone, F_IMPACT, loc=(0.16, 0.74, 1.14), rot=(math.radians(66), 0, 0))
    key(phone, F_IMPACT + 14, loc=(-1.4, 4.4, 1.5), rot=(math.radians(220), math.radians(140), 0))
    key(phone, F_IMPACT + 30, loc=(-2.9, 7.4, 0.06), rot=(math.radians(360), math.radians(352), math.radians(18)))
    key(phone, F_END, loc=(-2.9, 7.4, 0.06), rot=(math.radians(360), math.radians(352), math.radians(18)))

    # --- the screen: calm, then red and pulsing
    bsdf = screen_m.node_tree.nodes["Principled BSDF"]
    col = bsdf.inputs["Emission Color"]
    stg = bsdf.inputs["Emission Strength"]

    col.default_value = (0.03, 0.14, 0.26, 1); col.keyframe_insert("default_value", frame=F_SCREEN - 1)
    stg.default_value = 2.0; stg.keyframe_insert("default_value", frame=F_SCREEN - 1)
    col.default_value = (0.75, 0.03, 0.03, 1); col.keyframe_insert("default_value", frame=F_SCREEN)
    glow.color = (1.0, 0.1, 0.1); glow.keyframe_insert("color", frame=F_SCREEN)
    glow.energy = 10; glow.keyframe_insert("energy", frame=F_SCREEN - 1)

    # a heartbeat, so it reads as alarming rather than merely lit
    f = F_SCREEN
    high = True
    while f < F_END:
        stg.default_value = 16.0 if high else 4.0
        stg.keyframe_insert("default_value", frame=f)
        glow.energy = 70 if high else 18
        glow.keyframe_insert("energy", frame=f)
        high = not high
        f += 7

    # --- camera: tracking alongside, then pushing in on the phone
    key(cam, F_START, loc=(9.5, -30, 3.4))
    key(cam, F_IMPACT, loc=(9.5, 0.5, 3.4))
    key(cam, F_IMPACT + 24, loc=(9.0, 10.0, 3.9))
    key(cam, F_SETTLE, loc=(6.4, 12.0, 3.0))
    key(cam, F_SCREEN + 30, loc=(1.4, 10.2, 1.5))
    key(cam, F_END, loc=(-0.9, 9.0, 0.78))

    key(cam_target, F_START, loc=(0, -24, 1.1))
    key(cam_target, F_IMPACT, loc=(0, 4, 1.1))
    key(cam_target, F_SETTLE, loc=(0.4, 11.0, 0.5))
    key(cam_target, F_SCREEN + 30, loc=(-2.4, 7.8, 0.15))
    key(cam_target, F_END, loc=(-2.9, 7.4, 0.06))


# ------------------------------------------------------------------- render
def setup_render(scene, *, samples=24, resolution=(1280, 720)):
    scene.render.engine = "BLENDER_EEVEE"   # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = F_START, F_END
    scene.eevee.taa_render_samples = samples
    scene.eevee.use_shadows = True
    try:
        scene.eevee.use_raytracing = True   # nicer reflections on the tarmac
    except Exception:
        pass
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    still = None
    do_render = "--render" in argv
    do_save = "--save" in argv
    if "--still" in argv:
        still = int(argv[argv.index("--still") + 1])

    clear()
    scene = bpy.context.scene

    build_road()
    build_lights()

    rig = empty("Rig")
    bike, _head = build_bike(rig)
    rider = build_rider(rig)
    phone, screen_m, glow = build_phone()
    phone.parent = rig

    cam_target = empty("CamTarget")
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 40
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    trk = cam.constraints.new("TRACK_TO")
    trk.target = cam_target
    trk.track_axis = "TRACK_NEGATIVE_Z"
    trk.up_axis = "UP_Y"

    animate(rig, bike, rider, phone, screen_m, glow, cam, cam_target)
    setup_render(scene)

    os.makedirs(OUT_DIR, exist_ok=True)

    if still is not None:
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(OUT_DIR, f"still_{still:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"WROTE {scene.render.filepath}")
    elif do_render:
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "HIGH"
        scene.render.filepath = os.path.join(OUT_DIR, "zetway-crash.mp4")
        bpy.ops.render.render(animation=True)
        print(f"WROTE {scene.render.filepath}")

    if do_save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "zetway-crash.blend"))
        print("WROTE blend")

    return 0


if __name__ == "__main__":
    sys.exit(main())
