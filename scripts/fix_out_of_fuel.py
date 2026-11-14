"""Build and render the schematic "ran out of fuel" guide that ships in the APK.

Run:
    blender --background --factory-startup --python scripts/fix_out_of_fuel.py -- --render
    blender --background --factory-startup --python scripts/fix_out_of_fuel.py -- --still 60
    blender --background --factory-startup --python scripts/fix_out_of_fuel.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/fuel_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-out-of-fuel.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'out-of-fuel' guide in src/lib/breakdown.ts, in its order,
because the app captions this clip with those words: a picture that drifts
from the text printed under it is worse than no picture.

    before   -> coast off the carriageway, hazards on
    step 1   -> stop cranking
    step 2a  -> at least five litres in before trying again
    step 2b  -> and then the fork: petrol fires, diesel does not
    step 3   -> do not walk to the filling station; wait where it is safe

Five places where the drawing and the words are not a line-for-line match,
all of them deliberate:

  - "Get the car as far off the road as it will roll" is a move across the
    carriageway, and a side elevation has no across-the-road axis. It is drawn
    as the car coasting forwards until the tarmac ends and all four wheels are
    on the verge, which is the same instruction seen from the only angle this
    clip has.
  - Hazard lights are not in this guide's own `before` list. They are the
    first line of waitingAdvice() for every stopped car, which the app shows
    on the same screen, so the clip puts them on as the car comes to rest.
  - The diesel outcome is a stopAndCall line, which the app prints above the
    steps rather than inside them. It is shown here at the restart attempt,
    because that is the moment the two outcomes actually diverge, and drawing
    a fork any earlier means drawing a fork before there is anything to fork.
  - Nothing on screen can say the words "petrol" and "diesel" - no text is the
    rule. The two branches are told apart by what happens in the fuel line:
    fuel reaching the engine and it fires, or air reaching the engine and it
    does not, which is the mechanism the guide itself names ("draws air into
    the fuel system"). The caption carries the naming.
  - "At least five litres" is drawn as exactly five, because a tank gauge
    taking five segments is the only way to count without a numeral.

Style is a diagram that moves, not a film: an orthographic side elevation,
pure emission materials and the Standard view transform, so every pixel is
exactly the hex value it was given. Cuts between the five framings are hard,
because a hard cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, same build as scripts/fix_tyre.py, and the same
things bite: the engine id is 'BLENDER_EEVEE', image_settings.media_type has
to be VIDEO before FFMPEG can be assigned, the output path must be absolute
or the render lands next to the .blend, keyframe_new_interpolation_type does
nothing so interpolation is corrected after insertion, and Action.fcurves is
not where the curves live on 5.2.
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
    ("coast", 66),    # roll off the carriageway, hazards on
    ("crank", 60),    # stop cranking
    ("fuel", 78),     # five litres in
    ("fork", 132),    # petrol fires; diesel has air in the line and is towed
    ("wait", 64),     # do not walk to the pump
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
BG = "#f1f5f9"
INK = "#15181f"
INK_SOFT = "#1e2430"
TEXT = "#0f172a"
BRAND = "#189edb"
RED = "#d83030"
YELLOW = "#f0c000"
GREEN = "#007848"
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "fill": 1.60,
    "ground": 1.50,
    "verge": 1.45,
    "body": 1.00,
    "cut": 0.97,
    "window": 0.93,
    "trim": 0.90,
    "engine": 0.88,
    "mark": 0.85,
    "halo": 0.75,
    "tyre": 0.55,
    "rim": 0.50,
    "spoke": 0.45,
    "cap": 0.40,
    "gauge": 0.34,
    "fillbar": 0.30,
    "pipe": 0.28,
    "slug": 0.24,
    "can": 0.22,
    "stream": 0.20,
    "arc": 0.16,
    "sign": 0.12,
    "tow": 0.10,
}
PLATE = 0.02  # thickness of every plate; layers are 0.04 apart so none touch

# ------------------------------------------------------------------ geometry
REAR_X = -1.55
FRONT_X = 1.55
TYRE_R = 0.32
HALO_R = 0.355
RIM_R = 0.205
CAP_R = 0.075
SPOKE_LEN = 0.145

BODY_BOTTOM = 0.45
BODY_TOP = 0.95

# Where the tarmac stops. Everything right of this is verge, and the car has
# to end up with both axles past it or the drawing is not saying what the
# first line of the guide says.
VERGE_X = -0.90

# Far enough back that the car is unambiguously on the tarmac when the clip
# opens, which costs a second of it entering from the left edge and buys the
# only thing the first beat has to say.
CAR_START = -4.30
CAR_REST = 0.90

# On the car: the filler, and a five-segment tank gauge low on the flank.
# The gauge is where "empty" and "five litres" are both said without a word.
# The filler sits between the hazard lamp and the gauge: over the rear arch
# it was half behind the lamp, and two shapes that touch read as one.
FILLER = (-1.55, 0.86)
TANK_C = (-0.70, 0.70)
TANK_W, TANK_H = 0.92, 0.26
SEG_N = 5
SEG_W = 0.155
SEG_STEP = 0.17
SEG_X0 = TANK_C[0] - SEG_STEP * (SEG_N - 1) / 2

ENGINE_C = (1.12, 0.70)    # the block, and the centre of the crank arc
CRANK_R = 0.30
SIGN_R = 0.38

CAN_PARK = (-2.70, 2.40)
CAN_POUR = (-1.35, 1.40)
CAN_TILT = 0.50            # clockwise, so the spout goes down at the filler
CAN_SPOUT = (0.46, -0.02)  # spout tip in the can's own axes

# The pump the guide says not to walk to, and the path to it.
PUMP_X = 5.00
PATH_X0, PATH_STEP, PATH_N = 3.30, 0.26, 5
CROSS_X = 3.82

# ------------------------------------------------------------------ the fork
# Two short lanes off to the right of the main stage, outside every other
# framing, so the fork can be cut to and cut away from without hiding anything.
LANE_A_Z = 2.55   # petrol, on top
LANE_B_Z = 0.15   # diesel, underneath
MINI_R = 0.15
MINI_AXLE = 0.72
MINI_X = 10.55
MINI_GONE = 16.40   # the petrol car leaves the frame entirely
MINI_TOWED = 12.25  # the diesel car is still on the rope when the clip ends
MINI_ENGINE = (0.55, 0.36)
MINI_PIPE = ((-0.70, 0.17), (0.45, 0.17))
SPANNER = (14.05, LANE_B_Z + 0.42)
MARK_A = (9.00, LANE_A_Z + 0.42)
MARK_B = (9.00, LANE_B_Z + 0.42)

# ----------------------------------------------------------------- framings
# The clip opens and closes on the same wide shot, because the last beat is
# about staying where the first beat parked.
WIDE = ((0.45, 0.70), 9.8)     # the carriageway, the verge and the pump
ENG = ((1.05, 0.78), 4.5)      # the tank gauge and the engine, in one shot
REAR = ((-0.25, 0.92), 3.9)    # the filler, the gauge and the can above them
FORK = ((11.00, 1.42), 7.3)

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
    """A material that is only its own colour, with no lighting at all."""
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


def disc(name, r, loc, *, material=None, parent=None, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=verts)
    o = bpy.context.object
    o.name = name
    # A cylinder stands up the Z axis; a quarter turn about X lays its face
    # flat against the lens, which is what every round thing here wants.
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def ring(name, r, w, loc, *, material=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=48, minor_segments=6)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def triangle(name, r, loc, *, material=None, parent=None, aim=(0.0, 1.0)):
    """A three-sided prism facing the lens, pointing along `aim` on screen.

    Blender starts a circle's vertices at local +Y, which the quarter turn
    about X that faces the prism at the lens carries round to world +Z, so an
    unrotated triangle points straight up and the aim is one atan2 taken in
    that order.
    """
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, math.atan2(aim[0], aim[1]), 0),
               material=material, parent=parent)


def bar(name, p0, p1, w, y, material, parent=None):
    """A straight member between two points in the diagram plane."""
    (ax, az), (bx, bz) = p0, p1
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz)
    return plate(name, length, w, ((ax + bx) / 2, y, (az + bz) / 2),
                 material=material, parent=parent, spin=-math.atan2(dz, dx))


def grower(name, p0, p1, w, y, material, parent=None):
    """A bar that can be drawn on, from p0 towards p1, by scaling X 0 -> 1."""
    (ax, az), (bx, bz) = p0, p1
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz)
    root = empty(name, (ax, 0, az), parent=parent)
    root.rotation_euler = Euler((0, -math.atan2(dz, dx), 0))
    root.scale = (0.0, 1.0, 1.0)
    plate(name + "Bar", length, w, (length / 2, y, 0),
          material=material, parent=root)
    return root


def corner_cut(name, a, b, toward, material, parent, *, over=0.06, depth=1.0):
    """Notch a corner off a box with a plate the colour of the sky.

    There is no boolean here and no outline pass, so the silhouette is shaped
    by covering the corner rather than cutting it. Both ends of every cut in
    this file run off the cabin into open sky, which is what stops the plate
    biting a hole in the bodywork below.
    """
    (ax, az), (bx, bz) = a, b
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz)
    ux, uz = dx / length, dz / length
    nx, nz = -uz, ux
    mx, mz = (ax + bx) / 2, (az + bz) / 2
    if (toward[0] - mx) * nx + (toward[1] - mz) * nz < 0:
        nx, nz = -nx, -nz
    plate(name, length + 2 * over, depth,
          (mx + nx * depth / 2, LAY["cut"], mz + nz * depth / 2),
          material=material, parent=parent, spin=-math.atan2(uz, ux))


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

    preferences.edit.keyframe_new_interpolation_type does nothing at all on
    this 5.2 build: the preference reads back as CONSTANT and the keyframe is
    still born BEZIER. Every hard cut in this clip depends on getting this
    right, so the keys are corrected after insertion instead.
    """
    if kind == "BEZIER":
        return
    for curve in _curves(holder):
        for point in curve.keyframe_points:
            if abs(point.co[0] - frame) < 0.5:
                point.interpolation = kind


def set_all_interp(holder, kind):
    """Every key on an ID at once, for the things keyed on every frame."""
    for curve in _curves(holder):
        for point in curve.keyframe_points:
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


def show(obj, frame, on):
    """In and out. An emission strength of zero is black, not absent, so the
    only honest way to take a shape off a light page is to scale it away."""
    key(obj, frame, scale=(1.0, 1.0, 1.0) if on else (0.0, 0.0, 0.0),
        interp="CONSTANT")


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def seg(f, a, b) -> float:
    return min(1.0, max(0.0, (f - a) / float(b - a)))


# ------------------------------------------------------------------ the road
def build_road(mats):
    # The tarmac stops at VERGE_X and the page carries on, which in a side
    # elevation is the only way to draw the edge of the carriageway.
    plate("RoadFill", abs(VERGE_X - (-16.0)), 4.0,
          ((VERGE_X + (-16.0)) / 2, LAY["fill"], -2.0), material=mats["road"])
    plate("RoadEdge", 0.06, 0.70, (VERGE_X, LAY["ground"], -0.35),
          material=mats["steel"])
    plate("GroundLine", 22.0, 0.055, (-5.0, LAY["ground"], -0.028),
          material=mats["text"])
    # Two markings, because one is ambiguous: a solid edge line that stops
    # dead where the tarmac does, and a dashed lane line inboard of it. The
    # pair is what makes the left of the frame read as a carriageway rather
    # than as a slightly different grey.
    plate("EdgeLine", abs(VERGE_X - (-15.0)), 0.05,
          ((VERGE_X + (-15.0)) / 2, LAY["ground"], -0.13), material=mats["steel"])
    x = -14.6
    i = 0
    while x < VERGE_X - 0.3:
        plate("Lane%d" % i, 0.45, 0.055, (x, LAY["ground"], -0.34),
              material=mats["steel"])
        x += 0.85
        i += 1
    # Grit, so the verge is not merely an absence of road.
    x = VERGE_X + 0.18
    i = 0
    while x < 5.4:
        plate("Grit%d" % i, 0.07, 0.035,
              (x, LAY["verge"], -0.14 - 0.05 * (i % 2)), material=mats["steel"])
        x += 0.42
        i += 1


def build_pump(mats):
    """The filling station at the end of the path, and nothing more than a
    pump: the guide's last step is about the walk, not the station."""
    root = empty("Pump", (0, 0, 0))
    root.scale = (0.0, 0.0, 0.0)
    plate("PumpBody", 0.44, 0.92, (PUMP_X, LAY["mark"], 0.46),
          material=mats["slate"], parent=root)
    plate("PumpFace", 0.26, 0.20, (PUMP_X, LAY["sign"], 0.72),
          material=mats["bg"], parent=root)
    bar("PumpHose", (PUMP_X - 0.22, 0.60), (PUMP_X - 0.46, 0.38), 0.055,
        LAY["sign"], mats["slate"], parent=root)
    plate("PumpNozzle", 0.17, 0.09, (PUMP_X - 0.54, LAY["sign"], 0.35),
          material=mats["slate"], parent=root, spin=0.70)
    return root


# ------------------------------------------------------------------- the car
def build_wheel(name, parent, mats):
    """Tyre, rim, spokes, cap, and a pale ring behind the lot.

    The ring is the cheap way to get an outline: the tyre is nearly the same
    ink as the body it overlaps. The spokes are there so that a roll reads as
    a roll, which is what this clip opens on.
    """
    root = empty(name, parent=parent)
    disc(name + "Halo", HALO_R, (0, LAY["halo"], 0), material=mats["bg"], parent=root)
    disc(name + "Tyre", TYRE_R, (0, LAY["tyre"], 0), material=mats["ink"], parent=root)
    disc(name + "Rim", RIM_R, (0, LAY["rim"], 0), material=mats["steel"], parent=root)
    for i in range(5):
        a = math.radians(90 + 36 + i * 72)
        plate("%sSpoke%d" % (name, i), SPOKE_LEN, 0.05,
              (SPOKE_LEN / 2 * math.cos(a), LAY["spoke"], SPOKE_LEN / 2 * math.sin(a)),
              material=mats["ink_soft"], parent=root, spin=-a)
    disc(name + "Cap", CAP_R, (0, LAY["cap"], 0), material=mats["ink"], parent=root)
    return root


def build_car(mats):
    car = empty("Car", (CAR_START, 0, 0))

    plate("Body", 4.20, BODY_TOP - BODY_BOTTOM,
          (0.0, LAY["body"], (BODY_TOP + BODY_BOTTOM) / 2),
          material=mats["ink_soft"], parent=car)
    plate("Cabin", 2.45, 0.48, (-0.18, LAY["body"], 1.19),
          material=mats["ink_soft"], parent=car)
    # A square-cornered cabin on a slab reads as a pickup truck, which is the
    # wrong vehicle for a guide that says "car" in its first line.
    corner_cut("Windscreen", (0.30, 1.43), (1.045, 1.05), (1.045, 1.43),
               mats["bg"], car)
    corner_cut("RearScreen", (-0.95, 1.43), (-1.405, 1.12), (-1.405, 1.43),
               mats["bg"], car)
    plate("WindowFront", 0.62, 0.24, (0.18, LAY["window"], 1.15),
          material=mats["bg"], parent=car)
    plate("WindowRear", 0.70, 0.24, (-0.78, LAY["window"], 1.15),
          material=mats["bg"], parent=car)
    plate("Sill", 3.90, 0.07, (0.0, LAY["trim"], BODY_BOTTOM + 0.035),
          material=mats["slate"], parent=car)

    # The engine, so the crank arc has something to be about.
    plate("Block", 0.78, 0.34, (ENGINE_C[0], LAY["engine"], ENGINE_C[1]),
          material=mats["steel"], parent=car)

    hazards = [
        plate("Hazard%d" % i, 0.26, 0.16, (x, LAY["mark"], 0.86),
              material=mats["hazard"], parent=car)
        for i, x in enumerate((-1.95, 1.95))
    ]

    disc("Filler", 0.075, (FILLER[0], LAY["mark"], FILLER[1]),
         material=mats["steel"], parent=car)

    # The tank gauge: a well that is empty when the clip opens and takes five
    # segments when the can is poured in. It is the only place in the clip
    # that says how much, and it says it by counting rather than in numerals.
    plate("TankFrame", TANK_W, TANK_H, (TANK_C[0], LAY["gauge"], TANK_C[1]),
          material=mats["steel"], parent=car)
    plate("TankWell", TANK_W - 0.06, TANK_H - 0.06,
          (TANK_C[0], LAY["fillbar"], TANK_C[1]), material=mats["ink"], parent=car)
    # Four dividers, so the thing reads as a gauge with five slots while it
    # is still empty. Without them the first beat has a black letterbox on
    # the flank of the car and no way to know it means anything.
    for i in range(SEG_N - 1):
        plate("TankTick%d" % i, 0.018, TANK_H - 0.08,
              (SEG_X0 + (i + 0.5) * SEG_STEP, LAY["pipe"], TANK_C[1]),
              material=mats["steel"], parent=car)
    segs = []
    for i in range(SEG_N):
        x = SEG_X0 + i * SEG_STEP
        segs.append(grower("Seg%d" % i, (x - SEG_W / 2, TANK_C[1]),
                           (x + SEG_W / 2, TANK_C[1]), TANK_H - 0.10,
                           LAY["slug"], mats["fuel"], parent=car))

    rear = build_wheel("Rear", car, mats)
    rear.location = (REAR_X, 0, TYRE_R)
    front = build_wheel("Front", car, mats)
    front.location = (FRONT_X, 0, TYRE_R)

    return dict(car=car, wheels=(rear, front), hazards=hazards, segs=segs)


def build_crank(name, mats, centre, radius, parent, *, segs=9, span=215.0):
    """A dashed arc with a head on it: the engine being turned over.

    Clockwise on screen is a positive rotation about Y, which is the way an
    engine turns, so the arc is spun by keying the root and nothing else.
    """
    root = empty(name, (centre[0], 0, centre[1]), parent=parent)
    root.scale = (0.0, 0.0, 0.0)
    a0, a1 = math.radians(205.0), math.radians(205.0 - span)
    for i in range(segs):
        t = a0 + (a1 - a0) * (i + 0.5) / segs
        step = radius * abs(a1 - a0) / segs
        plate("%sS%d" % (name, i), step * 0.74, radius * 0.19,
              (radius * math.cos(t), LAY["arc"], radius * math.sin(t)),
              material=mats["brand"], parent=root,
              spin=-math.atan2(math.cos(t), -math.sin(t)))
    triangle(name + "Head", radius * 0.30,
             (radius * math.cos(a1), LAY["arc"], radius * math.sin(a1)),
             material=mats["brand"], parent=root,
             aim=(math.sin(a1), -math.cos(a1)))
    return root


def build_sign(name, mats, centre, radius, parent, colour_key):
    """A ring with a bar across it. No text, and it needs none."""
    root = empty(name, (centre[0], 0, centre[1]), parent=parent)
    root.scale = (0.0, 0.0, 0.0)
    ring(name + "Ring", radius, radius * 0.17, (0, LAY["sign"], 0),
         material=mats[colour_key], parent=root)
    plate(name + "Bar", radius * 1.75, radius * 0.34, (0, LAY["sign"], 0),
          material=mats[colour_key], parent=root, spin=math.radians(45))
    return root


def build_tick(name, mats, centre, radius, parent):
    """A ring with a check in it, which is the other half of the fork."""
    root = empty(name, (centre[0], 0, centre[1]), parent=parent)
    root.scale = (0.0, 0.0, 0.0)
    ring(name + "Ring", radius, radius * 0.17, (0, LAY["sign"], 0),
         material=mats["green"], parent=root)
    bar(name + "A", (-radius * 0.42, 0.0), (-radius * 0.10, -radius * 0.36),
        radius * 0.30, LAY["sign"], mats["green"], parent=root)
    bar(name + "B", (-radius * 0.16, -radius * 0.34), (radius * 0.46, radius * 0.40),
        radius * 0.30, LAY["sign"], mats["green"], parent=root)
    return root


def build_can(mats):
    """A can on the end of somebody else's arm. The guide has the fuel brought
    to the car, so the can arrives from off-frame and leaves the same way."""
    root = empty("Can", (CAN_PARK[0], 0, CAN_PARK[1]))
    plate("CanBody", 0.40, 0.46, (0, LAY["can"], 0), material=mats["fuel"], parent=root)
    plate("CanHandle", 0.26, 0.07, (-0.02, LAY["can"], 0.28),
          material=mats["fuel"], parent=root)
    bar("CanSpout", (0.17, 0.11), CAN_SPOUT, 0.085, LAY["can"], mats["fuel"],
        parent=root)
    return root


def build_fuel_line(name, mats, parent, colour_key, count=4):
    """The pipe from the tank to the engine, and what is travelling up it.

    This is the whole fork in one shape: the same pipe on both branches, with
    fuel in one and air in the other, which is the difference the guide names
    and the only one a drawing can honestly show.
    """
    root = empty(name, (0, 0, 0), parent=parent)
    root.scale = (0.0, 0.0, 0.0)
    (ax, az), (bx, bz) = MINI_PIPE
    # Thin, dark, and slung under the floor. Drawn any heavier, in the same
    # steel as the block it feeds, it stopped being a pipe and became a
    # chassis rail with beads on it.
    bar(name + "Pipe", (ax, az), (bx, bz), 0.05, LAY["pipe"], mats["slate"],
        parent=root)
    slugs = [disc("%sSlug%d" % (name, i), 0.034, (ax, LAY["slug"], az),
                  material=mats[colour_key], parent=root, verts=12)
             for i in range(count)]
    return root, slugs


def build_mini_car(name, mats, lane_z):
    """The same car with the detail taken out, because at this size the detail
    is three pixels of mud. Body, cabin, glass, and two wheels that turn."""
    root = empty(name, (MINI_X, 0, lane_z))
    plate(name + "Body", 1.95, 0.24, (0, LAY["body"], 0.34),
          material=mats["ink_soft"], parent=root)
    plate(name + "Cabin", 1.15, 0.22, (-0.08, LAY["body"], 0.56),
          material=mats["ink_soft"], parent=root)
    corner_cut(name + "Screen", (0.14, 0.74), (0.52, 0.50), (0.52, 0.74),
               mats["bg"], root, over=0.04, depth=0.5)
    plate(name + "Glass", 0.42, 0.11, (0.02, LAY["window"], 0.55),
          material=mats["bg"], parent=root)
    plate(name + "Glass2", 0.30, 0.11, (-0.48, LAY["window"], 0.55),
          material=mats["bg"], parent=root)
    plate(name + "Block", 0.38, 0.17, (MINI_ENGINE[0], LAY["engine"], MINI_ENGINE[1]),
          material=mats["steel"], parent=root)
    wheels = []
    for i, x in enumerate((-MINI_AXLE, MINI_AXLE)):
        w = empty("%sWheel%d" % (name, i), (x, 0, MINI_R), parent=root)
        disc("%sHalo%d" % (name, i), MINI_R * 1.12, (0, LAY["halo"], 0),
             material=mats["bg"], parent=w)
        disc("%sTyre%d" % (name, i), MINI_R, (0, LAY["tyre"], 0),
             material=mats["ink"], parent=w)
        disc("%sRim%d" % (name, i), MINI_R * 0.58, (0, LAY["rim"], 0),
             material=mats["steel"], parent=w)
        for j in range(3):
            a = math.radians(90 + j * 120)
            plate("%sSpoke%d_%d" % (name, i, j), MINI_R * 0.56, 0.035,
                  (MINI_R * 0.29 * math.cos(a), LAY["spoke"],
                   MINI_R * 0.29 * math.sin(a)),
                  material=mats["ink_soft"], parent=w, spin=-a)
        wheels.append(w)
    return root, wheels


def build_fork_stage(mats):
    """Two lanes, a trunk that splits into them, and a spanner at the end of
    the lower one. The split is drawn because a fork that is not drawn is two
    unrelated pictures sitting one above the other."""
    for name, z in (("LaneA", LANE_A_Z), ("LaneB", LANE_B_Z)):
        plate(name, 6.05, 0.055, (11.62, LAY["ground"], z - 0.028),
              material=mats["text"])
    bar("ForkTrunk", (7.35, 1.42), (8.00, 1.42), 0.055, LAY["mark"], mats["steel"])
    bar("ForkArmA", (8.00, 1.42), (8.70, MARK_A[1]), 0.055, LAY["mark"], mats["steel"])
    bar("ForkArmB", (8.00, 1.42), (8.70, MARK_B[1]), 0.055, LAY["mark"], mats["steel"])

    spanner = empty("Spanner", (SPANNER[0], 0, SPANNER[1]))
    spanner.scale = (0.0, 0.0, 0.0)
    ring("SpannerJaw", 0.26, 0.075, (0, LAY["mark"], 0),
         material=mats["slate"], parent=spanner)
    # The jaw is opened by covering one side of the ring with the page, the
    # same trick the cabin corners use.
    plate("SpannerGap", 0.22, 0.26, (-0.26, LAY["sign"], 0),
          material=mats["bg"], parent=spanner)
    bar("SpannerHandle", (0.22, 0.0), (0.58, 0.0), 0.13, LAY["mark"],
        mats["slate"], parent=spanner)
    return spanner


def build_tow(mats, parent):
    """A rope and a hook on the nose of the diesel car, coming from the right.
    It is parented to the car, so once it is on it stays on."""
    root = empty("Tow", (1.00, 0, MINI_ENGINE[1]), parent=parent)
    root.scale = (0.0, 0.0, 0.0)
    # Just long enough that it reaches the spanner when the car stops, and
    # not so long that it runs through it.
    bar("TowRope", (0.10, 0.0), (0.50, 0.07), 0.05, LAY["tow"], mats["slate"],
        parent=root)
    ring("TowHook", 0.075, 0.028, (0.05, LAY["tow"], 0.0),
         material=mats["slate"], parent=root)
    return root


def build_walk(mats):
    """The path to the pump, and the cross that goes over it."""
    dashes = []
    for i in range(PATH_N):
        d = empty("Walk%d" % i, (PATH_X0 + i * PATH_STEP, 0, 0.10))
        d.scale = (0.0, 0.0, 0.0)
        plate("WalkBar%d" % i, 0.17, 0.055, (0, LAY["mark"], 0),
              material=mats["steel"], parent=d)
        dashes.append(d)
    cross = empty("Cross", (CROSS_X, 0, 0.26))
    cross.scale = (0.0, 0.0, 0.0)
    plate("CrossA", 0.52, 0.075, (0, LAY["sign"], 0), material=mats["red"],
          parent=cross, spin=math.radians(45))
    plate("CrossB", 0.52, 0.075, (0, LAY["sign"], 0), material=mats["red"],
          parent=cross, spin=math.radians(-45))
    return dashes, cross


# ---------------------------------------------------------------- animation
def animate(rig, cam, parts):
    car = rig["car"]
    wheels = rig["wheels"]
    segs = rig["segs"]

    # --- camera: five framings, hard cuts.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -24.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["crank"], ENG)
    frame_at(F["fuel"], REAR)
    frame_at(F["fork"], FORK)
    frame_at(F["wait"], WIDE)

    # --- coast: the car rolls in already moving and runs out of road. The
    # position is keyed every frame off a constant deceleration, and the wheel
    # angle is read off that same number rather than guessed against it, so
    # nothing on the ground can slide.
    stop = F["coast"] + 48
    for f in range(1, stop + 1):
        t = seg(f, 1, stop)
        x = CAR_START + (CAR_REST - CAR_START) * (1 - (1 - t) ** 2)
        car.location = (x, 0, 0)
        car.keyframe_insert("location", frame=f)
        for w in wheels:
            w.rotation_euler = Euler((0, (x - CAR_START) / TYRE_R, 0))
            w.keyframe_insert("rotation_euler", frame=f)
    set_all_interp(car, "LINEAR")
    for w in wheels:
        set_all_interp(w, "LINEAR")
    key(car, F_END, loc=(CAR_REST, 0, 0), interp="CONSTANT")

    # --- hazards, on as it comes to rest and on for the rest of the clip.
    # Blinked by swapping in the body's own colour, which reads as off;
    # dimming the emission instead gives a dark amber square that still
    # looks lit.
    haz = rig["hazards"][0].data.materials[0]
    key_colour(haz, 1, INK_SOFT)
    on = True
    for f in range(F["coast"] + 34, F_END + 10, 9):
        key_colour(haz, f, YELLOW if on else INK_SOFT)
        on = not on

    # --- the tank is empty, and stays empty until the can is poured.
    for s in segs:
        key(s, 1, scale=(0.0, 1.0, 1.0), interp="CONSTANT")

    # --- crank: the engine turns over on an empty tank, twice, and then the
    # sign says stop. The arc does not fade out, it stops and goes.
    crank = parts["crank"]
    sign = parts["sign"]
    show(crank, 1, False)
    show(sign, 1, False)
    show(crank, F["crank"] + 2, True)
    key(crank, F["crank"] + 2, rot=(0, 0, 0))
    key(crank, F["crank"] + 14, rot=(0, 2.2, 0))
    key(crank, F["crank"] + 20, rot=(0, 2.2, 0))
    key(crank, F["crank"] + 32, rot=(0, 4.4, 0))
    show(crank, F["crank"] + 36, False)
    show(sign, F["crank"] + 36, True)
    show(sign, F["fuel"], False)

    # --- fuel: the can comes in, five litres go in, the can goes.
    can = parts["can"]
    stream = parts["stream"]
    show(can, 1, False)
    key(can, 1, loc=(CAN_PARK[0], 0, CAN_PARK[1]), rot=(0, 0, 0), interp="CONSTANT")
    key(stream, 1, scale=(0.0, 1.0, 1.0), interp="CONSTANT")

    pour = F["fuel"] + 16
    show(can, F["fuel"] + 2, True)
    key(can, F["fuel"] + 2, loc=(CAN_PARK[0], 0, CAN_PARK[1]), rot=(0, 0, 0))
    key(can, pour, loc=(CAN_POUR[0], 0, CAN_POUR[1]), rot=(0, CAN_TILT, 0))
    key(stream, pour, scale=(0.0, 1.0, 1.0))
    key(stream, pour + 6, scale=(1.0, 1.0, 1.0))
    for i, s in enumerate(segs):
        a = pour + 8 + i * 9
        key(s, a, scale=(0.0, 1.0, 1.0))
        key(s, a + 9, scale=(1.0, 1.0, 1.0))
    done = pour + 8 + SEG_N * 9
    key(stream, done, scale=(1.0, 1.0, 1.0))
    key(stream, done + 5, scale=(0.0, 1.0, 1.0))
    key(can, done + 5, loc=(CAN_POUR[0], 0, CAN_POUR[1]), rot=(0, CAN_TILT, 0))
    key(can, done + 18, loc=(CAN_PARK[0], 0, CAN_PARK[1]), rot=(0, 0, 0))
    show(can, done + 19, False)

    # --- the fork. Everything in it is keyed every frame off one clock, so
    # the two branches cannot drift out of step: they are the same crank, the
    # same pipe and the same car until the pipe decides.
    animate_fork(parts)

    # --- wait: the gauge goes back to empty at the cut. The fork was the
    # branch where somebody could bring fuel; this last beat is the other
    # one, and a full tank under a caption about walking to a filling
    # station would be the picture arguing with the words.
    for s in segs:
        key(s, F["wait"], scale=(0.0, 1.0, 1.0), interp="CONSTANT")

    # The path to the pump draws itself, and is then crossed out.
    pump = parts["pump"]
    show(pump, 1, False)
    show(pump, F["wait"], True)
    for i, d in enumerate(parts["walk"]):
        show(d, 1, False)
        show(d, F["wait"] + 4 + i * 4, True)
    cross = parts["cross"]
    show(cross, 1, False)
    key(cross, F["wait"] + 32, scale=(0.0, 0.0, 0.0), interp="BEZIER")
    key(cross, F["wait"] + 42, scale=(1.0, 1.0, 1.0))


def animate_fork(parts):
    """One pass over the fork beat, keying both lanes from the same clock."""
    base = F["fork"]
    end = base + BEATS[3][1] - 1

    car_a, wheels_a = parts["mini_a"]
    car_b, wheels_b = parts["mini_b"]
    line_a, slugs_a = parts["line_a"]
    line_b, slugs_b = parts["line_b"]
    crank_a, crank_b = parts["crank_a"], parts["crank_b"]
    tick, bad = parts["tick"], parts["bad"]
    tow, spanner = parts["tow"], parts["spanner"]

    for o in (line_a, line_b, crank_a, crank_b, tick, bad, tow, spanner):
        show(o, 1, False)

    def bursts(k, times):
        a = 0.0
        for s, e in times:
            a += 2.2 * ease(seg(k, s, e))
        return a

    A_BURST = ((6, 18), (24, 36), (42, 54))
    B_BURST = ((6, 18), (24, 36), (42, 54), (60, 72))

    show(line_a, base, True)
    show(line_b, base, True)
    show(crank_a, base, True)
    show(crank_b, base, True)

    (px, pz), (qx, qz) = MINI_PIPE
    for f in range(base, end + 1):
        k = f - base

        crank_a.rotation_euler = Euler((0, bursts(k, A_BURST), 0))
        crank_a.keyframe_insert("rotation_euler", frame=f)
        crank_b.rotation_euler = Euler((0, bursts(k, B_BURST), 0))
        crank_b.keyframe_insert("rotation_euler", frame=f)

        # Fuel up one pipe, air up the other, both running while the engine
        # is being turned over.
        for slugs, start in ((slugs_a, 6), (slugs_b, 10)):
            for i, s in enumerate(slugs):
                u = ((k - start) / 26.0 + i / float(len(slugs))) % 1.0
                s.location = (px + (qx - px) * u, LAY["slug"], pz + (qz - pz) * u)
                s.keyframe_insert("location", frame=f)

        # Petrol: it fires, and goes. Constant acceleration away, with the
        # wheels read off the distance so it cannot skate.
        xa = MINI_X + (MINI_GONE - MINI_X) * seg(k, 62, 122) ** 2
        car_a.location = (xa, 0, LANE_A_Z)
        car_a.keyframe_insert("location", frame=f)
        for w in wheels_a:
            w.rotation_euler = Euler((0, (xa - MINI_X) / MINI_R, 0))
            w.keyframe_insert("rotation_euler", frame=f)

        # Diesel: it does not, and it leaves on a rope instead.
        xb = MINI_X + (MINI_TOWED - MINI_X) * ease(seg(k, 96, end - base))
        car_b.location = (xb, 0, LANE_B_Z)
        car_b.keyframe_insert("location", frame=f)
        for w in wheels_b:
            w.rotation_euler = Euler((0, (xb - MINI_X) / MINI_R, 0))
            w.keyframe_insert("rotation_euler", frame=f)

    for o in ((crank_a, crank_b, car_a, car_b) + tuple(wheels_a) + tuple(wheels_b)
              + tuple(slugs_a) + tuple(slugs_b)):
        set_all_interp(o, "LINEAR")

    # The outcomes, keyed after that pass so its blanket LINEAR cannot flatten
    # the CONSTANT scale keys these depend on.
    show(crank_a, base + 58, False)
    show(line_a, base + 58, False)
    show(tick, base + 58, True)

    show(crank_b, base + 84, False)
    show(bad, base + 84, True)
    show(spanner, base + 88, True)
    show(tow, base + 92, True)

    # The fork does not belong to the last beat: cut it away at the cut.
    for o in (tick, bad, spanner, tow, line_b):
        show(o, F["wait"], False)


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

    hazard_mat = flat("Hazard", YELLOW)
    mats = {
        "bg": flat("Bg", BG),
        "road": flat("Road", ROAD),
        "text": flat("Text", TEXT),
        "ink": flat("Ink", INK),
        "ink_soft": flat("InkSoft", INK_SOFT),
        "slate": flat("Slate", SLATE),
        "steel": flat("Steel", STEEL),
        "brand": flat("Brand", BRAND),
        "red": flat("Red", RED),
        "green": flat("Green", GREEN),
        "fuel": flat("Fuel", YELLOW),
        "air": flat("Air", BG),
        "hazard": hazard_mat,
    }

    build_road(mats)
    rig = build_car(mats)
    car = rig["car"]

    parts = {}
    parts["crank"] = build_crank("Crank", mats, ENGINE_C, CRANK_R, car)
    parts["sign"] = build_sign("Stop", mats, ENGINE_C, SIGN_R, car, "red")
    parts["can"] = build_can(mats)

    # The stream is in world space, not on the can: it has to reach from the
    # spout to a filler that is on a different parent, and the tilt is what
    # aims the spout, not what carries the fuel.
    tip = (CAN_POUR[0] + CAN_SPOUT[0] * math.cos(CAN_TILT) + CAN_SPOUT[1] * math.sin(CAN_TILT),
           CAN_POUR[1] - CAN_SPOUT[0] * math.sin(CAN_TILT) + CAN_SPOUT[1] * math.cos(CAN_TILT))
    # Narrower than the spout it leaves, so the two do not read as one rod.
    parts["stream"] = grower("Stream", tip,
                             (CAR_REST + FILLER[0], FILLER[1]), 0.062,
                             LAY["stream"], mats["fuel"])
    parts["pump"] = build_pump(mats)
    parts["walk"], parts["cross"] = build_walk(mats)

    parts["spanner"] = build_fork_stage(mats)
    parts["mini_a"] = build_mini_car("MiniA", mats, LANE_A_Z)
    parts["mini_b"] = build_mini_car("MiniB", mats, LANE_B_Z)
    parts["line_a"] = build_fuel_line("LineA", mats, parts["mini_a"][0], "fuel")
    parts["line_b"] = build_fuel_line("LineB", mats, parts["mini_b"][0], "air")
    parts["crank_a"] = build_crank("CrankA", mats, MINI_ENGINE, 0.21,
                                   parts["mini_a"][0], segs=7)
    parts["crank_b"] = build_crank("CrankB", mats, MINI_ENGINE, 0.21,
                                   parts["mini_b"][0], segs=7)
    parts["tick"] = build_tick("Tick", mats, MARK_A, 0.26, None)
    parts["bad"] = build_sign("Bad", mats, MARK_B, 0.26, None, "red")
    parts["tow"] = build_tow(mats, parts["mini_b"][0])

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = WIDE[1]
    cam_data.clip_start = 0.1
    cam_data.clip_end = 80.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.pi / 2, 0, 0))
    scene.camera = cam

    world = bpy.data.worlds.new("Paper")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = rgba(BG)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    animate(rig, cam, parts)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "fuel_%04d.png" % still)
        bpy.ops.render.render(write_still=True)
        print("WROTE " + scene.render.filepath)
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
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.audio_codec = "NONE"
        scene.render.filepath = os.path.join(OUT_DIR, "fix-out-of-fuel.mp4")
        bpy.ops.render.render(animation=True)
        print("WROTE " + scene.render.filepath)

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-out-of-fuel.blend"))
        print("WROTE blend")

    print("FRAMES %d DURATION %.2fs BEATS %s" % (F_END, F_END / FPS, F))
    return 0


if __name__ == "__main__":
    sys.exit(main())
