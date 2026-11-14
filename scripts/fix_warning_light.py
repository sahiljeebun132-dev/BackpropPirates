"""Build and render the dashboard-warning-light triage diagram for the APK.

Run:
    blender --background --factory-startup --python scripts/fix_warning_light.py -- --still 60
    blender --background --factory-startup --python scripts/fix_warning_light.py -- --render
    blender --background --factory-startup --python scripts/fix_warning_light.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/warn_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-warning-light.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'warning-light' steps in src/lib/breakdown.ts, in their
order, because the app captions this clip with those steps: a picture that
drifts from the words printed under it is worse than no picture. This guide
is triage rather than repair, so the subject is an instrument cluster seen
face on and the only thing that happens is lamps lighting in the order the
text names them:

    red     oil pressure, temperature, brakes, charging, airbag
    amber   engine management, ABS, tyre pressure, glow plugs
    info    green and blue

Nothing is shown that the guide does not name. Where the clip and the text
are not a line-for-line match, five places, all deliberate:

  - The opening beat is the `before` line, "colour tells you the urgency".
    It is drawn as the bulb check every cluster does at key-on: every lamp
    lights in its own colour at once and goes out. That is the colour key the
    sentence asks for, and it is a thing the car really does rather than an
    invention.
  - Step 1 says "stop as soon as it is safe", so the red beat ends by cutting
    to a car moving off the running lane onto the hard shoulder and stopping,
    hazards on. That one shot is in plan rather than elevation: seen from the
    side a car that has pulled over looks exactly like a car that has stopped,
    and "off the road" is the whole of the instruction.
  - Step 2 ends with "switch off immediately", drawn as both needles dropping
    to their stops and the cluster going dark. Step 3 then needs a live car
    again, so the needles are back at cruise on the cut into it. That cut is
    hard and the dials are out of frame across it, which is the only reason it
    does not read as a mistake.
  - The ABS tell-tale is lettering, and this clip carries no text. Its ring and
    brackets are drawn, and the letters inside stand as three neutral strokes.
  - The guide names no particular green or blue lamp, only the two colours, so
    those two are featureless coloured chips rather than invented symbols.

The airbag tell-tale is the standard seated figure and bag. Its head is a
bare disc: there is no face on it, and it identifies nobody.

Style is a diagram that moves, not a film: an orthographic elevation, pure
emission materials and the Standard view transform, so every pixel is exactly
the hex value it was given. Cuts between framings are hard, because a hard
cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, same build as scripts/fix_tyre.py, and the same
things bite here: the engine id is 'BLENDER_EEVEE', image_settings.media_type
has to be VIDEO before FFMPEG can be assigned, the output path must be
absolute or the render lands next to the .blend, and
keyframe_new_interpolation_type does nothing, so every key's interpolation is
corrected after it is inserted.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

# ------------------------------------------------------------------ timeline
FPS = 24

# Each beat is one step of the guide, with its length in frames. The start
# frames are derived, so retiming one beat moves everything after it rather
# than silently overlapping the next.
BEATS = (
    ("colour", 40),   # before: colour is the urgency, shown as the bulb check
    ("red", 104),     # step 1: the five red lamps, then pull over
    ("oil", 64),      # step 2: oil pressure alone, then switch off
    ("amber", 80),    # step 3: the four amber lamps
    ("flash", 56),    # step 4: engine management flashing, revs eased off
    ("info", 40),     # step 5: green and blue, steady
    ("after", 48),    # step 6: a red light that came on and went out again
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# The neutrals are the slate family that file already uses.
BG = "#f1f5f9"          # the page
INK = "#15181f"         # the bezel, and the car seen from above
FACE = "#1e2430"        # the cluster face, and what punches a hole in a lamp
SLATE = "#334155"       # an unlit tell-tale, and the tarmac
STUD_GREY = "#64748b"   # dial rings and ticks
STEEL = "#94a3b8"       # needles, and the glasshouse of the car
RED = "#d83030"         # flag red: stop now
AMBER = "#f0c000"       # flag yellow: get it looked at
GREEN = "#007848"       # flag green: information
BRAND = "#189edb"       # the blue in WAY, standing for the blue tell-tales

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "bezel": 1.20,
    "face": 1.10,
    "panel": 1.00,
    "dial": 0.95,
    "tick": 0.90,
    "needle": 0.85,
    "hub": 0.80,
    "lamp": 0.60,
    "lampcut": 0.55,   # the face colour again, punching detail into a lamp
    "mark": 0.45,
    # the pull-over shot, off to the right in X and never in the same frame
    "road": 1.20,
    "shoulder": 1.15,
    "paint": 1.10,
    "halo": 1.00,
    "car": 0.95,
    "glass": 0.90,
    "hazard": 0.85,
}
PLATE = 0.02  # thickness of every plate; layers are 0.05 apart so none touch

# ------------------------------------------------------------------ geometry
# The cluster, seen face on. Its centre sits a little below the origin so the
# lamps - the subject - land on the middle of the frame rather than the dials.
BIN_W = 3.80
BIN_H = 2.70
BIN_CZ = -0.10

R_DIAL = 0.34
TICK_R = 0.275
DIAL_X = 1.40
DIAL_Z = 0.80

# A tell-tale is drawn inside a cell this wide, so nothing in one lamp can
# reach into its neighbour.
CELL = 0.22

RED_Z = 0.16
RED_X = (-1.32, -0.66, 0.00, 0.66, 1.32)   # oil, temp, brake, charge, airbag
AMBER_Z = -0.50
AMBER_X = (-0.99, -0.33, 0.33, 0.99)       # engine, ABS, tyre, glow plugs
INFO_Z = -1.02
INFO_X = (-0.33, 0.33)                      # green, blue

# Needle angles, measured the way a dial is read: anticlockwise from the +X
# axis, so the rest stop at lower left is 225 degrees and the sweep runs
# clockwise from there.
NEEDLE_REST = 225.0
TACHO_CRUISE = 165.0
TACHO_EASED = 198.0
SPEEDO_CRUISE = 95.0
SPEEDO_EASED = 126.0

# The pull-over, built this far along +X so it can never share a frame with
# the cluster: the two framings are 20 apart and both are under 4 wide.
ROAD_X = 20.0
ROAD_W = 9.0
ROAD_H = 2.60
EDGE_Z = -0.50          # the solid line between lane and hard shoulder
DASH_Z = 1.05           # the broken line on the other side of the lane
CAR_START = (-2.40, 0.30)
CAR_MID = (-0.40, 0.14)
CAR_END = (1.50, -0.92)
CAR_YAW = math.radians(9)   # nose swung towards the shoulder, mid-manoeuvre

# Framings. Each is ((x, z), ortho_scale); the vertical extent is 0.5625 of
# the scale, which is what keeps the page from showing past the cluster edge.
CLUSTER = ((0.0, BIN_CZ), 5.10)
RED_CLOSE = ((0.0, RED_Z), 3.40)
OIL_CLOSE = ((RED_X[0], RED_Z), 1.10)
AMBER_CLOSE = ((0.0, AMBER_Z), 2.95)
ENGINE_CLOSE = ((AMBER_X[0], AMBER_Z), 1.30)
INFO_CLOSE = ((0.0, INFO_Z), 1.50)
AFTER_CLOSE = ((0.0, RED_Z), 2.30)
PULLOVER = ((ROAD_X, 0.0), 7.40)

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(_REPO, "public", "guides")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _linear(channel: float) -> float:
    # Blender wants scene-referred values. With the Standard view transform
    # the encode on the way out is the exact inverse of this, so a hex here
    # comes back as the same hex in the file.
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def rgba(hex_string: str):
    h = hex_string.lstrip("#")
    return tuple(_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def flat(name: str, hex_string: str):
    """A material that is only its own colour, with no lighting at all.

    A bare Emission node cannot be lit by accident, which is the whole point
    of a diagram, and it is the one node key_colour below knows how to find.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba(hex_string)
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
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


def plate(name, w, h, loc, *, material=None, parent=None, spin=0.0):
    """An axis-aligned rectangle facing the camera. loc is its centre."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(0, spin, 0), scale=(w, PLATE, h),
               material=material, parent=parent)


def disc(name, r, loc, *, material=None, parent=None, verts=40):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=verts)
    o = bpy.context.object
    o.name = name
    # A cylinder stands up the Z axis; a quarter turn about X lays its face
    # flat against the lens, which is what every round thing here wants.
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def ring(name, r, w, loc, *, material=None, parent=None):
    """An annulus, drawn as a torus rather than a disc with a hole punched in
    it: a punch has to be the colour of whatever is behind, and a lamp that
    lights has to work over the face, the road and nothing at all."""
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=56, minor_segments=6)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def arc(name, parent, material, centre, r0, r1, a0, a1, segs, w, y):
    """A run of short plates laid along an arc, from radius r0 to r1.

    Letting the radius change is what draws the glow-plug coil as one call;
    with r0 == r1 the same helper draws the brackets either side of the brake
    and ABS tell-tales. Angles are in radians, measured anticlockwise.
    """
    cx, cz = centre
    span = a1 - a0
    step = abs(span) / segs
    for i in range(segs):
        t = (i + 0.5) / segs
        a = a0 + span * t
        r = r0 + (r1 - r0) * t
        # A touch longer than the chord, so the joins do not open up.
        seg_len = 2.0 * r * math.sin(step / 2.0) * 1.3
        tangent = a + (math.pi / 2 if span >= 0 else -math.pi / 2)
        plate(f"{name}{i}", seg_len, w,
              (cx + r * math.cos(a), y, cz + r * math.sin(a)),
              material=material, parent=parent, spin=-tangent)


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def _curves(holder):
    """Every fcurve on an ID, whichever way this Blender stores them.

    Blender 4.4 made actions slotted; Action.fcurves survives on 5.2 as a
    compatibility accessor but is empty for some IDs, so fall through to the
    layer/strip/channelbag path rather than trusting either one alone.
    """
    anim = getattr(holder, "animation_data", None)
    if anim is None or anim.action is None:
        return ()
    action = anim.action
    curves = list(getattr(action, "fcurves", ()) or ())
    if curves:
        return curves
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for bag in getattr(strip, "channelbags", ()):
                curves.extend(bag.fcurves)
    return curves


def _set_interp(holder, frame, kind):
    """Force the interpolation of every key this ID has at `frame`.

    The obvious route, preferences.edit.keyframe_new_interpolation_type, does
    nothing at all on this 5.2 build: the preference reads back as CONSTANT
    and the keyframe is still born BEZIER. Every hard cut in this clip depends
    on getting this right, so the keys are corrected after insertion.
    """
    if kind == "BEZIER":
        return
    for curve in _curves(holder):
        for point in curve.keyframe_points:
            if abs(point.co[0] - frame) < 0.5:
                point.interpolation = kind


def key(obj, frame, *, loc=None, rot=None, scale=None, interp="BEZIER"):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = Euler(rot)
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)
    _set_interp(obj, frame, interp)


def key_value(owner, path, frame, value, *, interp="BEZIER"):
    setattr(owner, path, value)
    owner.keyframe_insert(path, frame=frame)
    _set_interp(owner, frame, interp)


def key_colour(material, frame, hex_string, *, interp="CONSTANT"):
    inp = material.node_tree.nodes["Emission"].inputs["Color"]
    inp.default_value = rgba(hex_string)
    inp.keyframe_insert("default_value", frame=frame)
    _set_interp(material.node_tree, frame, interp)


def needle_rot(degrees: float):
    """The Y rotation that points a needle at dial angle `degrees`.

    The camera looks along +Y, so a positive Y rotation reads as clockwise on
    screen; the needle is built pointing along +X and the dial is read
    anticlockwise, so the sign flips here once and nowhere else.
    """
    return (0, -math.radians(degrees), 0)


# ------------------------------------------------------------- the tell-tales
# Each glyph is drawn inside its lamp's own empty, in local coordinates, out
# of parts that all share that lamp's one material: lighting a lamp is one
# colour key, not twenty. Detail that has to read *through* a lit lamp - the
# plus and minus on the battery, say - is punched in the face colour instead,
# one layer nearer the lens.

def g_oil(name, root, mat, cut):
    """The oil can. breakdown.ts calls this one out by name: red, and not a
    low-oil reminder."""
    plate(name + "Body", 0.22, 0.12, (-0.04, LAY["lamp"], -0.02),
          material=mat, parent=root)
    plate(name + "Lid", 0.09, 0.05, (-0.11, LAY["lamp"], 0.07),
          material=mat, parent=root)
    plate(name + "Spout", 0.14, 0.045, (0.135, LAY["lamp"], 0.046),
          material=mat, parent=root, spin=-math.radians(22))
    disc(name + "Drip", 0.033, (0.185, LAY["lamp"], -0.045),
         material=mat, parent=root)


def g_temp(name, root, mat, cut):
    """A thermometer standing in coolant: the temperature warning."""
    plate(name + "Stem", 0.055, 0.26, (0, LAY["lamp"], 0.04),
          material=mat, parent=root)
    disc(name + "Bulb", 0.068, (0, LAY["lamp"], -0.13), material=mat, parent=root)
    for i, (x, z) in enumerate(((-0.17, -0.02), (-0.17, -0.12),
                                (0.17, -0.02), (0.17, -0.12))):
        plate(f"{name}Wave{i}", 0.10, 0.032, (x, LAY["lamp"], z),
              material=mat, parent=root)


def _bang_in_a_ring(name, root, mat):
    ring(name + "Ring", 0.115, 0.026, (0, LAY["lamp"], 0), material=mat, parent=root)
    arc(name + "BrkL", root, mat, (0, 0), 0.185, 0.185,
        math.radians(118), math.radians(242), 5, 0.028, LAY["lamp"])
    arc(name + "BrkR", root, mat, (0, 0), 0.185, 0.185,
        math.radians(-62), math.radians(62), 5, 0.028, LAY["lamp"])


def g_brake(name, root, mat, cut):
    """The brake warning: an exclamation in a circle, in brackets."""
    _bang_in_a_ring(name, root, mat)
    plate(name + "Bar", 0.036, 0.095, (0, LAY["lamp"], 0.028),
          material=mat, parent=root)
    disc(name + "Dot", 0.023, (0, LAY["lamp"], -0.062), material=mat, parent=root)


def g_charge(name, root, mat, cut):
    """A battery: the charging warning."""
    plate(name + "Body", 0.30, 0.17, (0, LAY["lamp"], -0.015),
          material=mat, parent=root)
    for i, x in enumerate((-0.085, 0.085)):
        plate(f"{name}Term{i}", 0.055, 0.045, (x, LAY["lamp"], 0.093),
              material=mat, parent=root)
    plate(name + "PlusH", 0.080, 0.026, (-0.072, LAY["lampcut"], -0.015),
          material=cut, parent=root)
    plate(name + "PlusV", 0.026, 0.080, (-0.072, LAY["lampcut"], -0.015),
          material=cut, parent=root)
    plate(name + "Minus", 0.080, 0.026, (0.072, LAY["lampcut"], -0.015),
          material=cut, parent=root)


def g_airbag(name, root, mat, cut):
    """The airbag warning: a seated figure and the bag.

    The head is a bare disc. There is no face on it and it identifies nobody,
    which is both the house rule and what the real tell-tale looks like.
    """
    disc(name + "Head", 0.050, (-0.125, LAY["lamp"], 0.085), material=mat, parent=root)
    plate(name + "Torso", 0.065, 0.17, (-0.115, LAY["lamp"], -0.035),
          material=mat, parent=root)
    plate(name + "Legs", 0.16, 0.052, (-0.02, LAY["lamp"], -0.145),
          material=mat, parent=root)
    disc(name + "Bag", 0.090, (0.095, LAY["lamp"], 0.0), material=mat, parent=root)
    plate(name + "Dash", 0.040, 0.17, (0.195, LAY["lamp"], -0.02),
          material=mat, parent=root)


def g_engine(name, root, mat, cut):
    """The engine block: engine management, the light the guide says can also
    flash."""
    plate(name + "Block", 0.26, 0.155, (0.0, LAY["lamp"], -0.03),
          material=mat, parent=root)
    plate(name + "Top", 0.13, 0.07, (-0.03, LAY["lamp"], 0.08),
          material=mat, parent=root)
    for i, z in enumerate((0.0, -0.075)):
        plate(f"{name}Nub{i}", 0.06, 0.035, (-0.165, LAY["lamp"], z),
              material=mat, parent=root)
    plate(name + "NubR", 0.06, 0.05, (0.165, LAY["lamp"], -0.02),
          material=mat, parent=root)
    plate(name + "Foot", 0.20, 0.035, (0.0, LAY["lamp"], -0.125),
          material=mat, parent=root)


def g_abs(name, root, mat, cut):
    """ABS. The real tell-tale is three letters in a ring and this clip
    carries no text, so the letters stand as three neutral strokes: the ring
    and the brackets are what actually name it."""
    _bang_in_a_ring(name, root, mat)
    for i, x in enumerate((-0.055, 0.0, 0.055)):
        plate(f"{name}Stroke{i}", 0.022, 0.075, (x, LAY["lamp"], 0),
              material=mat, parent=root)


def g_tyre(name, root, mat, cut):
    """A tyre in section with an exclamation in it: the pressure warning."""
    for i, x in enumerate((-0.155, 0.155)):
        plate(f"{name}Wall{i}", 0.045, 0.22, (x, LAY["lamp"], 0.015),
              material=mat, parent=root)
    plate(name + "Base", 0.355, 0.05, (0, LAY["lamp"], -0.11),
          material=mat, parent=root)
    for i, x in enumerate((-0.105, -0.035, 0.035, 0.105)):
        plate(f"{name}Tread{i}", 0.030, 0.035, (x, LAY["lamp"], -0.155),
              material=mat, parent=root)
    plate(name + "Bar", 0.034, 0.085, (0, LAY["lamp"], 0.045),
          material=mat, parent=root)
    disc(name + "Dot", 0.021, (0, LAY["lamp"], -0.035), material=mat, parent=root)


def g_glow(name, root, mat, cut):
    """The glow-plug coil, drawn as a spiral of a turn and a half with a short
    tail: a coil of wire is the whole symbol."""
    arc(name + "Coil", root, mat, (0, 0), 0.145, 0.045,
        0.0, -math.radians(540), 34, 0.030, LAY["lamp"])
    plate(name + "Tail", 0.062, 0.030, (0.176, LAY["lamp"], 0.0),
          material=mat, parent=root)


def g_chip(name, root, mat, cut):
    """A featureless capsule. The guide names the colours green and blue and
    no particular lamp, so drawing a symbol here would be inventing one."""
    plate(name + "Body", 0.20, 0.135, (0, LAY["lamp"], 0), material=mat, parent=root)
    for i, x in enumerate((-0.10, 0.10)):
        disc(f"{name}End{i}", 0.0675, (x, LAY["lamp"], 0), material=mat, parent=root)


# Order matters: these are the lamps in the order breakdown.ts names them.
RED_GLYPHS = (("Oil", g_oil), ("Temp", g_temp), ("Brake", g_brake),
              ("Charge", g_charge), ("Airbag", g_airbag))
AMBER_GLYPHS = (("Engine", g_engine), ("Abs", g_abs),
                ("Tyre", g_tyre), ("Glow", g_glow))
INFO_GLYPHS = (("Green", g_chip), ("Blue", g_chip))


# -------------------------------------------------------------- the cluster
def build_dial(name, cx, cz, mats):
    root = empty(name, (cx, 0, cz))
    ring(name + "Ring", R_DIAL, 0.020, (0, LAY["dial"], 0),
         material=mats["dial"], parent=root)
    # Seven ticks from the rest stop at lower left round to lower right, which
    # is the way every dial on a car is read.
    for i in range(7):
        a = math.radians(NEEDLE_REST - i * 45.0)
        plate(f"{name}Tick{i}", 0.075, 0.024,
              (TICK_R * math.cos(a), LAY["tick"], TICK_R * math.sin(a)),
              material=mats["dial"], parent=root, spin=-a)
    pivot = empty(name + "Pivot", (0, 0, 0), parent=root)
    plate(name + "Needle", 0.26, 0.030, (0.13, LAY["needle"], 0),
          material=mats["needle"], parent=pivot)
    disc(name + "Hub", 0.048, (0, LAY["hub"], 0),
         material=mats["needle"], parent=root)
    return pivot


def build_lamp(name, x, z, hex_off, glyph, mats):
    """One tell-tale: an empty at its home, and a glyph of parts sharing one
    material, so the lamp lights with a single colour key."""
    mat = flat(name + "Mat", hex_off)
    root = empty(name, (x, 0, z))
    glyph(name, root, mat, mats["cut"])
    return mat


def build_cluster(mats):
    plate("Bezel", BIN_W + 0.16, BIN_H + 0.16, (0, LAY["bezel"], BIN_CZ),
          material=mats["ink"])
    plate("Face", BIN_W, BIN_H, (0, LAY["face"], BIN_CZ), material=mats["face"])
    # A blank panel between the dials. Nothing is written on it: this clip
    # carries no text, and a cluster screen with marks on it would read as
    # words too small to see rather than as a blank screen.
    plate("Panel", 0.90, 0.40, (0, LAY["panel"], DIAL_Z), material=mats["ink"])

    tacho = build_dial("Tacho", -DIAL_X, DIAL_Z, mats)
    speedo = build_dial("Speedo", DIAL_X, DIAL_Z, mats)

    reds = [build_lamp(n, RED_X[i], RED_Z, SLATE, g, mats)
            for i, (n, g) in enumerate(RED_GLYPHS)]
    ambers = [build_lamp(n, AMBER_X[i], AMBER_Z, SLATE, g, mats)
              for i, (n, g) in enumerate(AMBER_GLYPHS)]
    infos = [build_lamp(n, INFO_X[i], INFO_Z, SLATE, g, mats)
             for i, (n, g) in enumerate(INFO_GLYPHS)]

    # The mark left behind in the last beat: a thin red ring round the lamp
    # that went out. It is the lamp's own colour because what it records is
    # that a *red* light happened, and it is grown from nothing rather than
    # faded in, because an emission strength of zero is black, not absent.
    mark = ring("Mark", 0.26, 0.016, (RED_X[2], LAY["mark"], RED_Z),
                material=mats["mark"])

    return dict(tacho=tacho, speedo=speedo, reds=reds, ambers=ambers,
                infos=infos, mark=mark)


# ------------------------------------------------------------- the pull-over
def build_road(mats):
    """Seen from above, which is the one deviation from elevation in the clip.

    From the side, a car that has pulled onto the shoulder and a car that has
    simply stopped are the same picture, and "as soon as it is safe" is about
    getting off the running lane.
    """
    plate("Road", ROAD_W, ROAD_H, (ROAD_X, LAY["road"], 0), material=mats["road"])
    plate("Shoulder", ROAD_W, EDGE_Z + ROAD_H / 2,
          (ROAD_X, LAY["shoulder"], (-ROAD_H / 2 + EDGE_Z) / 2),
          material=mats["face"])
    plate("EdgeLine", ROAD_W, 0.055, (ROAD_X, LAY["paint"], EDGE_Z),
          material=mats["paint"])
    x = -ROAD_W / 2 + 0.2
    i = 0
    while x < ROAD_W / 2:
        plate(f"Dash{i}", 0.42, 0.055, (ROAD_X + x, LAY["paint"], DASH_Z),
              material=mats["paint"])
        x += 0.78
        i += 1

    car = empty("Car", (ROAD_X + CAR_START[0], 0, CAR_START[1]))
    # A pale plate under the car, because an ink car on slate tarmac is one
    # shape with a soft edge rather than two things.
    plate("CarHalo", 1.25, 0.62, (0, LAY["halo"], 0), material=mats["bg"], parent=car)
    plate("CarBody", 1.15, 0.52, (0, LAY["car"], 0), material=mats["ink"], parent=car)
    plate("CarGlass", 0.46, 0.40, (-0.06, LAY["glass"], 0),
          material=mats["glass"], parent=car)
    for i, (hx, hz) in enumerate(((-0.50, 0.19), (-0.50, -0.19),
                                  (0.50, 0.19), (0.50, -0.19))):
        plate(f"Hazard{i}", 0.10, 0.10, (hx, LAY["hazard"], hz),
              material=mats["hazard"], parent=car)
    return car


# ---------------------------------------------------------------- animation
def animate(rig, car, cam, mats):
    reds, ambers, infos = rig["reds"], rig["ambers"], rig["infos"]
    tacho, speedo, mark = rig["tacho"], rig["speedo"], rig["mark"]
    all_lamps = reds + ambers + infos
    lit = [RED] * 5 + [AMBER] * 4 + [GREEN, BRAND]

    # --- camera: one framing per thing being shown, hard cuts between.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    frame_at(1, CLUSTER)
    for mat in all_lamps:
        key_colour(mat, 1, SLATE)
    key_colour(mats["hazard"], 1, INK)
    key(tacho, 1, rot=needle_rot(TACHO_CRUISE), interp="CONSTANT")
    key(speedo, 1, rot=needle_rot(SPEEDO_CRUISE), interp="CONSTANT")
    key(mark, 1, scale=(0, 0, 0), interp="CONSTANT")
    key(car, 1, loc=(ROAD_X + CAR_START[0], 0, CAR_START[1]), rot=(0, 0, 0),
        interp="CONSTANT")

    # --- colour: the bulb check. Every lamp lights in its own colour and goes
    # out again, which is the colour key the `before` line asks for and a
    # thing the car does by itself at key-on.
    for mat, colour in zip(all_lamps, lit):
        key_colour(mat, F["colour"] + 6, colour)
        key_colour(mat, F["colour"] + 28, SLATE)

    # --- red: the five the guide names, in its order, one at a time.
    frame_at(F["red"], RED_CLOSE)
    for i, mat in enumerate(reds):
        key_colour(mat, F["red"] + 6 + i * 12, RED)

    # ...and then "stop as soon as it is safe": off the lane, onto the
    # shoulder, hazards on.
    frame_at(F["red"] + 66, PULLOVER)
    key(car, F["red"] + 69, loc=(ROAD_X + CAR_START[0], 0, CAR_START[1]),
        rot=(0, 0, 0))
    key(car, F["red"] + 81, loc=(ROAD_X + CAR_MID[0], 0, CAR_MID[1]),
        rot=(0, CAR_YAW, 0))
    key(car, F["red"] + 93, loc=(ROAD_X + CAR_END[0], 0, CAR_END[1]),
        rot=(0, 0, 0))
    blink = True
    for f in range(F["red"] + 78, F["red"] + 106, 8):
        key_colour(mats["hazard"], f, AMBER if blink else INK)
        blink = not blink

    # --- oil: the one light in the guide with its own step. Everything else
    # goes out on the cut, so what is left on screen is the symbol being named.
    frame_at(F["oil"], OIL_CLOSE)
    for mat in reds[1:]:
        key_colour(mat, F["oil"], SLATE)
    # Pulsing, because "switch off immediately" is the most urgent line in the
    # whole guide and a steady lamp does not say immediately.
    on = True
    for f in range(F["oil"] + 3, F["oil"] + 33, 6):
        key_colour(reds[0], f, RED if on else SLATE)
        on = not on
    key_colour(reds[0], F["oil"] + 33, RED)

    # Switched off: the needles drop to their stops and the cluster goes dark.
    frame_at(F["oil"] + 34, CLUSTER)
    key(tacho, F["oil"] + 36, rot=needle_rot(TACHO_CRUISE))
    key(speedo, F["oil"] + 36, rot=needle_rot(SPEEDO_CRUISE))
    key(tacho, F["oil"] + 52, rot=needle_rot(NEEDLE_REST))
    key(speedo, F["oil"] + 52, rot=needle_rot(NEEDLE_REST))
    key_colour(reds[0], F["oil"] + 53, SLATE)

    # --- amber: four lamps, in the order the guide names them. The car is
    # running again, which is a hard cut and not a continuity slip: the dials
    # are outside this framing, so the needles go back to cruise unseen.
    frame_at(F["amber"], AMBER_CLOSE)
    key(tacho, F["amber"], rot=needle_rot(TACHO_CRUISE), interp="CONSTANT")
    key(speedo, F["amber"], rot=needle_rot(SPEEDO_CRUISE), interp="CONSTANT")
    for i, mat in enumerate(ambers):
        key_colour(mat, F["amber"] + 8 + i * 14, AMBER)

    # --- flash: the same engine lamp, flashing rather than steady. Halfway
    # through, the shot opens out so the needles can ease off with it.
    frame_at(F["flash"], ENGINE_CLOSE)
    for mat in ambers[1:]:
        key_colour(mat, F["flash"], SLATE)
    on = True
    for f in range(F["flash"], F["flash"] + 56, 4):
        key_colour(ambers[0], f, AMBER if on else SLATE)
        on = not on
    frame_at(F["flash"] + 26, CLUSTER)
    key(tacho, F["flash"] + 28, rot=needle_rot(TACHO_CRUISE))
    key(speedo, F["flash"] + 28, rot=needle_rot(SPEEDO_CRUISE))
    key(tacho, F["flash"] + 50, rot=needle_rot(TACHO_EASED))
    key(speedo, F["flash"] + 50, rot=needle_rot(SPEEDO_EASED))

    # --- info: green and blue, steady and untroubled. Nothing blinks here on
    # purpose; the point of the step is that these are not faults.
    frame_at(F["info"], INFO_CLOSE)
    key_colour(ambers[0], F["info"], SLATE)
    key_colour(infos[0], F["info"] + 6, GREEN)
    key_colour(infos[1], F["info"] + 16, BRAND)

    # --- after: a red light that came on and went out again. The ring stays
    # behind it, which is the step: it still happened.
    frame_at(F["after"], AFTER_CLOSE)
    for mat in infos:
        key_colour(mat, F["after"], SLATE)
    key_colour(reds[2], F["after"] + 6, RED)
    key_colour(reds[2], F["after"] + 26, SLATE)
    key(mark, F["after"] + 26, scale=(0, 0, 0))
    key(mark, F["after"] + 36, scale=(1, 1, 1))


# ------------------------------------------------------------------- render
def setup_render(scene, *, samples=16):
    scene.render.engine = "BLENDER_EEVEE"   # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, F_END
    scene.eevee.taa_render_samples = samples
    # There are no lights in the scene and nothing but emission on every
    # surface, so shadows and raytracing have nothing to add but render time.
    scene.eevee.use_shadows = False
    try:
        scene.eevee.use_raytracing = False
    except Exception:
        pass
    # Standard, not AgX: a diagram has to come out the colour it went in.
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    still = int(argv[argv.index("--still") + 1]) if "--still" in argv else None
    crf = argv[argv.index("--crf") + 1] if "--crf" in argv else "MEDIUM"
    do_render = "--render" in argv
    do_save = "--save" in argv

    clear()
    scene = bpy.context.scene

    mats = {
        "bg": flat("Bg", BG),
        "ink": flat("Ink", INK),
        "face": flat("FaceMat", FACE),
        "cut": flat("Cut", FACE),
        "dial": flat("Dial", STUD_GREY),
        "needle": flat("Needle", STEEL),
        "mark": flat("MarkMat", RED),
        "road": flat("RoadMat", SLATE),
        "paint": flat("Paint", BG),
        "glass": flat("Glass", STEEL),
        "hazard": flat("HazardMat", INK),
    }

    rig = build_cluster(mats)
    car = build_road(mats)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = CLUSTER[1]
    cam_data.clip_start = 0.1
    cam_data.clip_end = 60.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.pi / 2, 0, 0))
    scene.camera = cam

    world = bpy.data.worlds.new("Paper")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = rgba(BG)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    animate(rig, car, cam, mats)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"warn_{still:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"WROTE {scene.render.filepath}")
    elif do_render:
        os.makedirs(OUT_DIR, exist_ok=True)
        # Blender 5 split still and movie output behind media_type. Assigning
        # FFMPEG first raises "enum not found" even though introspection lists
        # it, so the media type is set first and deliberately.
        scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = crf
        scene.render.ffmpeg.audio_codec = "NONE"
        out = os.path.join(OUT_DIR, "fix-warning-light.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print(f"WROTE {out} {os.path.getsize(out)} bytes")

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-warning-light.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
