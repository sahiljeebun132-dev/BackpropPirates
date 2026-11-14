"""Build and render the schematic plug-a-tubeless-tyre guide for 'moto-puncture'.

Run:
    blender --background --factory-startup --python scripts/fix_moto_puncture.py -- --still 180
    blender --background --factory-startup --python scripts/fix_moto_puncture.py -- --render
    blender --background --factory-startup --python scripts/fix_moto_puncture.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/moto_puncture_NNNN.png, for framing
    --render     the whole thing to public/guides/fix-moto-puncture.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'moto-puncture' steps in src/lib/breakdown.ts, in their order,
because the app captions this clip with those steps:

    identify -> "Work out whether the wheel is tubeless or tubed."
    find     -> "Find what went in. A nail or screw straight into the tread."
    ream     -> "...follow the kit instructions exactly: ream, plug, trim, inflate."
    plug     -> the same step, second word
    trim     -> the same step, third word
    inflate  -> "Inflate to the pressure printed on the bike, not by feel, and
                 check it holds for a few minutes."   (the fourth word too)
    ride     -> "Ride slowly and directly to a tyre shop."

Nothing comes off the bike. This is not the car wheel change in fix_tyre.py: a
tubeless motorcycle tyre is plugged where it stands, and the wheel never leaves
the swingarm.

THE ONE THING THIS CLIP MUST NOT GET WRONG. The guide's stopAndCall list says
sidewall or shoulder damage cannot be repaired at the roadside, and a viewer
who copies a picture of a plug going into a sidewall is the only way these
drawings could hurt somebody. So the repair is drawn in cross-section, the plug
enters the crown of the tread dead centre, and both shoulders and both
sidewalls carry a flag-red strike for as long as the section is on screen.
The puncture is in the rear tyre, because "it is the front tyre and you are not
completely certain" is itself one of the stop-and-call conditions.

Four places where the clip and the text are not a line-for-line match:

  - The opening beat is from the guide's `before` list rather than its steps:
    the bike is pushed, not ridden, off the carriageway before anything is
    looked at. It is drawn as the tarmac running out into a lay-by and the
    bike being walked past the end of it, because a side elevation cannot
    show sideways: off the carriageway is away from the camera, which is the
    one direction an orthographic side view has no pixels for.
  - That same list says to keep your helmet on. No figure appears in any of
    these clips, so there is nobody to draw a helmet on; the caption carries
    it. The hand on the bars is the whole of the rider, and it is there to say
    pushed rather than ridden.
  - The repair beats are a section through the tyre rather than a side
    elevation of it. In side elevation the tread is the outermost edge of the
    wheel, one pixel of it, and tread-versus-sidewall is exactly the
    distinction this clip exists to make. See above.
  - "Stay well under 60 km/h" is a number, and there is no text in these
    clips. The closing beat shows an unhurried roll that stops at the shop;
    the caption says how slow.

Style is a diagram that moves, not a film: an orthographic projection, pure
emission materials and the Standard view transform, so every pixel is exactly
the hex value it was given. Cuts between the five framings are hard, because a
hard cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, the same build as scripts/fix_tyre.py, and the
things that script learned the hard way all apply here: the engine id is
'BLENDER_EEVEE', image_settings.media_type has to be VIDEO before FFMPEG can be
assigned, the output path must be absolute or the render lands next to the
.blend, keyframe_new_interpolation_type does nothing on this build so the
interpolation is corrected after insertion, Action.fcurves is not where the
curves live, and everything that moves gets an explicit frame-one key.
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
    ("push",     64),   # before: pushed off the carriageway, not ridden
    ("identify", 50),   # tubeless or tubed
    ("find",     56),   # what went in, and whereabouts
    ("ream",     46),   # kit, word one
    ("plug",     54),   # word two
    ("trim",     38),   # word three
    ("inflate",  70),   # word four, to the printed pressure, and it holds
    ("ride",     56),   # slowly, directly, to a tyre shop
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# Same set as fix_tyre.py, plus the flag red that file never needed: this one
# has something to forbid, and grey is not a prohibition.
BG = "#f1f5f9"
INK = "#15181f"
INK_SOFT = "#1e2430"
TEXT = "#0f172a"
BRAND = "#189edb"
BRAND_DEEP = "#0e6fa3"
YELLOW = "#f0c000"
GREEN = "#007848"
RED = "#d83030"
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"
STUD_GREY = "#64748b"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "road": 1.60,
    "dash": 1.55,
    "ground": 1.50,
    "shop": 1.20,
    "shop_mark": 1.15,
    "frame": 0.95,
    "wheel": 0.86,
    "hub": 0.82,
    "valve": 0.78,
    "placard": 0.74,
    "placard_mark": 0.72,
    "tread_mark": 0.68,
    "nail_w": 0.64,
    "arc": 0.60,
    "zone": 0.64,
    "carcass": 0.60,
    "hole": 0.52,
    "plug": 0.46,
    "nail_s": 0.40,
    "tool": 0.34,
    "hose": 0.56,
    "gauge": 0.50,
    "tick": 0.46,
    "needle": 0.42,
    "hand": 0.20,
}
PLATE = 0.006  # thickness of every plate

# ------------------------------------------------------------------ geometry
# Metres, side elevation of the left of the bike, front to the right, so that
# forward is +X and the machine rolls the way the frame reads.
# WHEEL_R and RIM_R are OUTER radii, and the rings are built inside them:
# a torus of major radius r stands minor_radius proud of r, so building the
# tread at WHEEL_R put the contact patch 25 mm under the road and the flat
# 25 mm under that.
WHEEL_R = 0.300
RIM_R = 0.215
TYRE_W = 0.025          # torus minor radius: the tread ring
RIM_W = 0.010
WHEELBASE = 1.400
REAR_AXLE = (0.0, 0.0)
FRONT_AXLE = (WHEELBASE, 0.0)
GROUND_Z = -WHEEL_R

# A flat tyre drops its axle and squashes onto the rim. Both are one number,
# so the bottom of the squashed tread stays exactly on the road: the whole
# bike pivots on the front contact patch by the angle that drop implies.
PIVOT = (WHEELBASE, GROUND_Z)
FLAT_DROP = 0.070
FLAT_SQUASH = 1.0 - FLAT_DROP / WHEEL_R
FLAT_BULGE = 1.05       # a flat spreads sideways; squashing it without this
                        # reads as a smaller wheel, which on a motorcycle is a
                        # different machine rather than a different problem
FLAT_ANGLE = -math.asin(FLAT_DROP / WHEELBASE)

HEAD = (1.180, 0.560)
SWING_PIVOT = (0.520, 0.020)

# The road. Two bands of tarmac with a lay-by between them: the bike is walked
# off the first band into the gap, worked on there, and rides away along the
# second. See the docstring for why "off the carriageway" is drawn this way.
ROAD_BANDS = ((-13.0, 1.80), (4.40, 17.0))
ROAD_TOP = GROUND_Z - 0.004
ROAD_BOTTOM = -0.95
DASH_Z = -0.50
DASH_STEP = 0.34
PUSH_DIST = 2.40
RIDE_DIST = 4.20
SHOP_X = 2.48 + PUSH_DIST + RIDE_DIST   # so it ends up at world x = 2.48
PUSH_TURN = PUSH_DIST / WHEEL_R         # how far the wheel turns getting there

# Where the nail and the valve are to be found once the bike has been pushed
# to where the work happens. They are built at these angles minus the turn the
# push puts in, because a wheel that has rolled eight radians does not care
# where its nail was drawn: the first cut of this had the puncture face down
# on the road and the air line pointing at open sky.
#
# A positive rotation about +Y carries a point clockwise on screen, which is
# the way a wheel rolling to the right turns, so it SUBTRACTS from a screen
# angle. The local angle is therefore the wanted one plus the turn, not minus
# it: getting that backwards put the puncture twice as far round as it
# started.
NAIL_PHI = math.radians(68)     # upper rear quarter: reachable, and in frame
VALVE_PHI = math.radians(-35)   # lower front quarter, pointing at the pump
NAIL_LOCAL = NAIL_PHI + PUSH_TURN
VALVE_LOCAL = VALVE_PHI + PUSH_TURN
VALVE_TIP_R = 0.248             # in the sidewall, inside the tread

# The pump, standing on the road beside the wheel.
GAUGE_C = (0.430, -0.120)
GAUGE_R = 0.105
NEEDLE_LEN = 0.078
# The air line leaves the body of the pump, not the middle of its dial.
HOSE_ROOT = (0.368, -0.182)
HOSE_LEN = 0.200                 # built at this length, then scaled to fit
# Where the needle stops: the figure printed on the bike, which this diagram
# is not allowed to know, so it is drawn as a position on a dial and nothing
# more. breakdown.ts says guessing the number is how a roadside repair goes
# wrong, and a number on screen would be guessing it.
TARGET_P = 0.62
DIAL_FROM = math.radians(225)
DIAL_SWEEP = math.radians(270)

# The tubeless-or-tubed inset, parked well above the road so no framing can
# catch both it and the bike.
INSET_Z = 3.00
INSET_R = 0.260

# The section through the tyre, parked well below. Local z = 0 is the outside
# of the tread, so every tool depth below is a depth into the crown.
SECT_Z = -3.00
CROWN_HALF = 0.215       # how far the flat of the tread runs either side
CARCASS_W = 0.056
HOLE_W = 0.042
PROFILE = (               # centreline of the carcass, right half, local
    (0.000, -0.028),
    (0.215, -0.028),
    (0.325, -0.095),
    (0.368, -0.210),
    (0.340, -0.330),
)
PLUG_LEG_X = 0.014
PLUG_LEG_W = 0.012
PLUG_LEG_H = 0.130
PLUG_DEPTH = -0.072       # where the bend of the plug ends up
TRIM_SCALE = (0.006 - PLUG_DEPTH) / PLUG_LEG_H   # leaves the tail nearly flush
TOOL_PARK = 0.460
REAM_DEEP = -0.062
BLADE_PARK = 0.740        # off the right edge of the section framing

# Framings: centre of frame, and orthographic width.
WIDE = ((0.70, 0.14), 2.80)
INSET = ((0.00, INSET_Z), 1.50)
CLOSE = ((0.06, -0.035), 1.42)
SECTION = ((0.00, SECT_Z - 0.125), 1.16)
RIDE = ((1.02, 0.26), 3.95)

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
    of a diagram. The node keeps its default name so key_colour can find it.
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


def bar(name, p0, p1, w, y, material, parent=None):
    """A straight member between two points in the diagram plane."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    return plate(name, length, w, ((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2),
                 material=material, parent=parent, spin=-math.atan2(dz, dx))


def disc(name, r, loc, *, material=None, parent=None, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=verts)
    o = bpy.context.object
    o.name = name
    # A cylinder stands up the Z axis; a quarter turn about X lays its face
    # flat against the lens, which is what every round thing here wants.
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def ring(name, r, w, loc, *, material=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=64, minor_segments=6)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def wedge(name, r, loc, *, material=None, parent=None, spin=0.0):
    """A three-sided prism: a blade, or the point of a reamer."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    # No extra spin on top of the quarter turn about X: Blender starts a
    # circle's vertices at local +Y, which that turn carries round to world
    # +Z, so a bare triangle points straight up.
    return put(o, loc=loc, rot=(math.pi / 2, spin, 0), material=material, parent=parent)


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
    nothing at all on this 5.2 build: the preference reads back as set and the
    keyframe is still born BEZIER. Every hard cut and every instant appearance
    in this clip depends on CONSTANT actually being CONSTANT, so the keys are
    corrected after insertion instead.
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


def show(obj, frame, on, *, interp="CONSTANT"):
    """In or out of the picture. Scaled away rather than dimmed, because an
    emission strength of zero is black and a black shape is still a shape."""
    key(obj, frame, scale=(1.0, 1.0, 1.0) if on else (0.0, 0.0, 0.0), interp=interp)


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def tilt_point(x, z, theta):
    """Where a point rigid with the bike ends up when the bike tilts.

    Used to aim the pump hose at the valve while the tyre is coming up: the
    valve is on the wheel, the wheel is on the bike, and the bike stands up as
    it inflates. Working it out rather than eyeballing it is what keeps the
    hose on the valve instead of near it.
    """
    px, pz = PIVOT
    dx, dz = x - px, z - pz
    return (px + dx * math.cos(theta) + dz * math.sin(theta),
            pz - dx * math.sin(theta) + dz * math.cos(theta))


# ------------------------------------------------------------------ the road
def build_road(mats):
    """Tarmac, lane dashes, and one ground line that runs the whole way.

    All of it hangs off one empty that slides in X: the camera stays with the
    machine, so the road is what moves. Distance travelled is therefore one
    number, and the wheels are turned from that same number rather than keyed
    against it by eye.
    """
    world = empty("World")
    for b, (x0, x1) in enumerate(ROAD_BANDS):
        plate(f"Tarmac{b}", x1 - x0, ROAD_TOP - ROAD_BOTTOM,
              ((x0 + x1) / 2, LAY["road"], (ROAD_TOP + ROAD_BOTTOM) / 2),
              material=mats["road"], parent=world)
        x = x0 + 0.20
        i = 0
        while x < x1 - 0.20:
            plate(f"Dash{b}_{i}", 0.17, 0.022, (x, LAY["dash"], DASH_Z),
                  material=mats["text"], parent=world)
            x += DASH_STEP
            i += 1
    plate("GroundLine", 34.0, 0.008, (0.0, LAY["ground"], GROUND_Z + 0.004),
          material=mats["stud"], parent=world)
    return world


def build_shop(mats, world):
    """A tyre shop: a shed with a tyre on the front of it.

    No sign, because there is no text in these clips, and no attempt at a real
    place. It is a destination, and the only thing it has to say is that the
    plugged tyre is going somewhere it can be fixed properly.
    """
    root = empty("Shop", (SHOP_X, 0, 0), parent=world)
    plate("ShopWall", 0.80, 0.70, (0.0, LAY["shop"], GROUND_Z + 0.35),
          material=mats["slate"], parent=root)
    plate("ShopAwning", 0.94, 0.060, (0.0, LAY["shop"], GROUND_Z + 0.73),
          material=mats["brand"], parent=root)
    plate("ShopDoor", 0.20, 0.42, (0.22, LAY["shop_mark"], GROUND_Z + 0.21),
          material=mats["bg"], parent=root)
    ring("ShopTyre", 0.125, 0.034, (-0.19, LAY["shop_mark"], GROUND_Z + 0.42),
         material=mats["ink"], parent=root)
    # A couple stacked outside, which is what a tyre shop looks like from the
    # road and costs two rings to say.
    ring("ShopStackA", 0.070, 0.026, (-0.49, LAY["shop_mark"], GROUND_Z + 0.055),
         material=mats["ink"], parent=root)
    ring("ShopStackB", 0.070, 0.026, (-0.49, LAY["shop_mark"], GROUND_Z + 0.155),
         material=mats["ink"], parent=root)
    return root


# ------------------------------------------------------------------- the bike
def build_wheel(name, parent, mats, *, spokes=5, r=WHEEL_R, rim=RIM_R,
                squash=False):
    """Tread ring, rim, spokes, hub.

    The spokes are what make a roll read as a roll; a plain disc turns
    invisibly.

    Two things about the hierarchy, both learned by rendering it wrong. The
    rim hangs off the wheel directly and the tread off a squash empty, so a
    flat tyre collapses onto a rim that stays round, which is what a flat
    looks like. And that squash sits ABOVE the part that turns, not below it:
    a non-uniform scale underneath a rotation is applied in the wheel's own
    axes, so the flat spot went round with the wheel and the tyre came out
    squashed sideways and standing taller than the good one.
    """
    root = empty(name, parent=parent)
    flat_part = empty(name + "Squash", parent=root) if squash else root
    spin_tread = empty(name + "SpinTread", parent=flat_part)
    spin_hub = empty(name + "Spin", parent=root)
    # Built inside the radius it is given, so r is where the rubber meets the
    # road and the contact patch is exact rather than a torus-width out.
    ring(name + "Tyre", r - TYRE_W, TYRE_W, (0, LAY["wheel"], 0),
         material=mats["ink"], parent=spin_tread)
    ring(name + "Rim", rim - RIM_W, RIM_W, (0, LAY["wheel"], 0),
         material=mats["steel"], parent=spin_hub)
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        w = 0.028 if spokes <= 6 else 0.009
        r0 = 0.036 if spokes <= 6 else 0.048
        bar(f"{name}Spoke{i}", (math.cos(a) * r0, math.sin(a) * r0),
            (math.cos(a) * rim, math.sin(a) * rim), w, LAY["wheel"],
            mats["steel"], parent=spin_hub)
    disc(name + "Hub", 0.042 if spokes <= 6 else 0.052, (0, LAY["hub"], 0),
         material=mats["steel"], parent=spin_hub)
    return dict(root=root, flat=flat_part, tread=spin_tread, hub=spin_hub,
                spins=(spin_tread, spin_hub))


def build_bike(mats, world):
    """Enough motorcycle to be a motorcycle, and no more.

    The mass of a bike is the engine and the tank between the wheels, so those
    are solid and the rest is the members that join them up. Any more detail
    and the puncture stops being the subject; any less and it is a bicycle.
    """
    tilt = empty("BikeTilt", (PIVOT[0], 0, PIVOT[1]))
    bike = empty("Bike", (-PIVOT[0], 0, -PIVOT[1]), parent=tilt)

    bar("Swingarm", SWING_PIVOT, REAR_AXLE, 0.024, LAY["frame"], mats["slate"], bike)
    bar("Shock", (0.260, 0.010), (0.360, 0.400), 0.016, LAY["frame"], mats["steel"], bike)
    # The engine is the mass of the machine, and it has to read as mass: the
    # first cut had it in the pale secondary grey, which made it a pannier on
    # a bicycle. Dark, with fins, it is an engine.
    plate("Engine", 0.380, 0.340, (0.610, LAY["frame"], 0.190),
          material=mats["slate"], parent=bike)
    for i, z in enumerate((0.250, 0.292, 0.334)):
        plate(f"Fin{i}", 0.300, 0.020, (0.628, LAY["placard"], z),
              material=mats["steel"], parent=bike)
    bar("Spine", HEAD, (0.600, 0.470), 0.020, LAY["frame"], mats["slate"], bike)
    bar("DownTube", (1.160, 0.520), (0.800, 0.200), 0.018, LAY["frame"], mats["slate"], bike)
    plate("Tank", 0.430, 0.180, (0.840, LAY["frame"], 0.515),
          material=mats["slate"], parent=bike)
    plate("Seat", 0.440, 0.100, (0.400, LAY["frame"], 0.510),
          material=mats["slate"], parent=bike)
    plate("Tail", 0.260, 0.070, (0.230, LAY["frame"], 0.430),
          material=mats["steel"], parent=bike)
    bar("Fork", FRONT_AXLE, HEAD, 0.020, LAY["frame"], mats["slate"], bike)
    bar("Bars", (1.260, 0.620), (1.020, 0.665), 0.016, LAY["frame"], mats["slate"], bike)

    # The chain guard, where the pressure figure is printed on a great many
    # bikes. The mark on it is a position, not a number: see TARGET_P.
    plate("Placard", 0.200, 0.065, (0.320, LAY["placard"], 0.098),
          material=mats["steel"], parent=bike)
    # Wrapped in an empty, because a plate's scale IS its size: keying scale
    # straight onto the plate to make it pulse turned a 72 mm mark into a
    # 1.45 m slab of brand blue across the whole frame, for every frame.
    placard_mark = empty("PlacardMark", (0.296, 0, 0.098), parent=bike)
    plate("PlacardMarkBar", 0.072, 0.024, (0, LAY["placard_mark"], 0),
          material=mats["brand"], parent=placard_mark)

    rear = build_wheel("Rear", bike, mats, squash=True)
    rear["root"].location = (REAR_AXLE[0], 0, REAR_AXLE[1])
    front = build_wheel("Front", bike, mats)
    front["root"].location = (FRONT_AXLE[0], 0, FRONT_AXLE[1])
    squash = rear["flat"]
    tread = rear["tread"]

    # The valve lives in the sidewall, between the rim and the inside of the
    # tread, because that is where a tubeless valve is: through the rim. It
    # is only on screen while the air line is on it, so it cannot be mistaken
    # for a second thing sticking out of the tyre during the push.
    valve = empty("Valve", parent=rear["hub"])
    bar("ValveStem",
        (math.cos(VALVE_LOCAL) * 0.198, math.sin(VALVE_LOCAL) * 0.198),
        (math.cos(VALVE_LOCAL) * VALVE_TIP_R, math.sin(VALVE_LOCAL) * VALVE_TIP_R),
        0.022, LAY["valve"], mats["steel"], parent=valve)

    # What went in, drawn on the tread so it stays with it wherever it has
    # got to, and squashed with it while the tyre is down.
    nail = empty("NailWheel", parent=tread)
    nail_at = (math.cos(NAIL_LOCAL) * WHEEL_R, math.sin(NAIL_LOCAL) * WHEEL_R)
    bar("NailWShank", nail_at,
        (math.cos(NAIL_LOCAL) * (WHEEL_R + 0.078),
         math.sin(NAIL_LOCAL) * (WHEEL_R + 0.078)),
        0.015, LAY["nail_w"], mats["steel"], parent=nail)
    disc("NailWHead", 0.024,
         (math.cos(NAIL_LOCAL) * (WHEEL_R + 0.084), LAY["nail_w"],
          math.sin(NAIL_LOCAL) * (WHEEL_R + 0.084)),
         material=mats["steel"], parent=nail)

    # The marker that says found it, and later the plug that replaced it.
    found = empty("Found", (math.cos(NAIL_LOCAL) * WHEEL_R, 0,
                            math.sin(NAIL_LOCAL) * WHEEL_R), parent=tread)
    ring("FoundRing", 0.062, 0.010, (0, LAY["nail_w"], 0),
         material=mats["brand"], parent=found)
    plugged = empty("Plugged", (math.cos(NAIL_LOCAL) * (WHEEL_R - 0.013), 0,
                                math.sin(NAIL_LOCAL) * (WHEEL_R - 0.013)),
                    parent=tread)
    disc("PluggedDot", 0.026, (0, LAY["tread_mark"], 0),
         material=mats["plugged"], parent=plugged)

    # The search: a short arc of brand that runs round the tread looking for
    # it. On the tread too, so it hugs a flat tyre instead of floating off
    # the top of where a round one would have been.
    arc = empty("SearchArc", parent=tread)
    for i in range(5):
        a = math.radians(-16 + i * 8)
        plate(f"ArcSeg{i}", 0.030, 0.014,
              (math.cos(a) * (WHEEL_R + 0.052), LAY["arc"],
               math.sin(a) * (WHEEL_R + 0.052)),
              material=mats["brand"], parent=arc, spin=-a + math.pi / 2)

    return dict(tilt=tilt, bike=bike, squash=squash, valve=valve,
                spins=tuple(rear["spins"]) + tuple(front["spins"]),
                nail=nail, found=found, plugged=plugged, arc=arc,
                placard_mark=placard_mark)


def build_hand(mats, bike):
    """A glove on the bar. It says pushed, not ridden, which is the whole of
    the opening beat that the caption cannot draw."""
    root = empty("Hand", (1.295, 0, 0.672), parent=bike)
    root.rotation_euler = Euler((0, -0.30, 0))
    m = mats["brand"]
    plate("Palm", 0.080, 0.082, (0.030, LAY["hand"], 0), material=m, parent=root)
    for i, dz in enumerate((0.026, 0.0, -0.026)):
        plate(f"Finger{i}", 0.052, 0.018, (-0.036, LAY["hand"], dz),
              material=m, parent=root)
    plate("Thumb", 0.050, 0.020, (-0.012, LAY["hand"], 0.050),
          material=m, parent=root, spin=math.radians(26))
    plate("Cuff", 0.034, 0.092, (0.080, LAY["hand"], 0), material=m, parent=root)
    return root


# ------------------------------------------------------------- the two wheels
def build_inset(mats):
    """Cast against spoked, side by side, which is the whole of step one.

    breakdown.ts: cast alloy wheels are usually tubeless, spoked wheels
    usually run a tube, and a plug in a tubed tyre does nothing at all. So one
    of these is ringed green and the other is struck through in red, and the
    clip never shows the struck one again.

    The rubber on both stays the ink it would really be. Recolouring the
    tyre itself to say "this one" drew a green tyre, which is a thing that
    does not exist; the marks around them carry the verdict instead.
    """
    root = empty("Inset", (0, 0, INSET_Z))
    cast = build_wheel("InsetCast", root, mats, spokes=5, r=INSET_R, rim=0.190)
    cast["root"].location = (-0.340, 0, 0)
    spoked = build_wheel("InsetSpoked", root, mats, spokes=24, r=INSET_R,
                         rim=0.190)
    spoked["root"].location = (0.340, 0, 0)

    tick = empty("InsetTick", (-0.340, 0, 0), parent=root)
    ring("InsetTickRing", INSET_R + 0.052, 0.012, (0, LAY["arc"], 0),
         material=mats["green"], parent=tick)
    strike = empty("InsetStrike", (0.340, 0, 0), parent=root)
    plate("InsetStrikeBar", 2 * (INSET_R + 0.052), 0.030, (0, LAY["arc"], 0),
          material=mats["red"], parent=strike, spin=math.radians(-40))
    return dict(root=root, cast=cast, spoked=spoked, tick=tick, strike=strike)


# ------------------------------------------------------- the tyre in section
def build_section(mats):
    """A cut through the tyre, tread at the top, rim at the bottom.

    This is the only view in which the thing that matters is unambiguous. In
    side elevation the tread is the outer edge of the wheel and the sidewall
    is the whole face of it, so a plug drawn into the face of the wheel - the
    only place there is room to draw one - is a plug in the sidewall, which is
    exactly the picture this clip must never show.
    """
    root = empty("Section", (0, 0, SECT_Z))

    for sign in (1, -1):
        tag = "R" if sign > 0 else "L"
        pts = [(x * sign, z) for x, z in PROFILE]
        for i in range(len(pts) - 1):
            bar(f"Carcass{tag}{i}", pts[i], pts[i + 1],
                CARCASS_W, LAY["carcass"], mats["ink"], parent=root)
        # Every bend between two bars leaves a notch on its outside. There is
        # no outline pass here to hide it, so each corner gets a disc of the
        # same ink to round it off.
        for i, (px, pz) in enumerate(pts[1:], start=1):
            disc(f"CarcassJoint{tag}{i}", CARCASS_W / 2,
                 (px, LAY["carcass"], pz), material=mats["ink"],
                 parent=root, verts=16)
        plate(f"Bead{tag}", 0.075, 0.048, (0.340 * sign, LAY["carcass"], -0.352),
              material=mats["steel"], parent=root)
        plate(f"Flange{tag}", 0.030, 0.070, (0.386 * sign, LAY["carcass"], -0.358),
              material=mats["steel"], parent=root)
    plate("SectionRim", 0.800, 0.042, (0, LAY["carcass"], -0.392),
          material=mats["steel"], parent=root)

    # The zone marks, on screen for every frame of the repair. Brand over the
    # crown: here, and dead centre of it. Red over both shoulders and both
    # sidewalls: not there, ever, and that is a stop-and-call in the guide
    # rather than a matter of taste.
    zones = empty("Zones", parent=root)
    plate("ZoneTread", 2 * 0.185, 0.016, (0, LAY["zone"], 0.074),
          material=mats["brand"], parent=zones)
    for sign in (1, -1):
        plate(f"ZoneTreadEnd{'R' if sign > 0 else 'L'}", 0.016, 0.048,
              (0.185 * sign, LAY["zone"], 0.050),
              material=mats["brand"], parent=zones)
    for sign in (1, -1):
        tag = "R" if sign > 0 else "L"
        a = (PROFILE[2][0] * sign, PROFILE[2][1])
        b = (PROFILE[3][0] * sign, PROFILE[3][1])
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        # Outward, away from the tyre. The first cut of this had the sign the
        # other way round and planted both warnings inside the casing, which
        # is the one place on a tyre they do not belong.
        nx, nz = (-dz / length) * sign, (dx / length) * sign
        cx, cz = mx + nx * 0.062, mz + nz * 0.062
        ang = math.atan2(dz, dx)
        plate(f"ZoneWall{tag}", 0.115, 0.014, (cx, LAY["zone"], cz),
              material=mats["red"], parent=zones, spin=-ang)
        plate(f"ZoneWallStrike{tag}", 0.062, 0.014, (cx, LAY["zone"], cz),
              material=mats["red"], parent=zones,
              spin=-(ang + math.pi / 2))

    # The hole is wrapped too: the reamer opens it up, and that is a scale
    # key, which on a bare plate would have made a one-metre square of page
    # colour sitting over the whole section. See PlacardMark.
    hole = empty("Hole", (0, 0, -0.028), parent=root)
    plate("HoleGap", HOLE_W, 0.092, (0, LAY["hole"], 0),
          material=mats["bg"], parent=hole)

    nail = empty("NailSection", parent=root)
    plate("NailShank", 0.016, 0.185, (0, LAY["nail_s"], 0.012),
          material=mats["steel"], parent=nail)
    plate("NailHead", 0.052, 0.020, (0, LAY["nail_s"], 0.112),
          material=mats["steel"], parent=nail)

    plug = empty("Plug", (0, 0, TOOL_PARK), parent=root)
    plate("PlugBend", 0.046, 0.013, (0, LAY["plug"], 0),
          material=mats["plug"], parent=plug)
    legs = empty("PlugLegs", parent=plug)
    for sign in (1, -1):
        plate(f"PlugLeg{'R' if sign > 0 else 'L'}", PLUG_LEG_W, PLUG_LEG_H,
              (PLUG_LEG_X * sign, LAY["plug"], PLUG_LEG_H / 2),
              material=mats["plug"], parent=legs)
    offcut = empty("Offcut", (0, 0, 0.030), parent=root)
    plate("OffcutBit", 0.034, 0.048, (0, LAY["plug"], 0),
          material=mats["plug"], parent=offcut)

    reamer = build_tool("Reamer", root, mats["brand_deep"], mats["brand"])
    inserter = build_tool("Inserter", root, mats["brand"], mats["brand_deep"],
                          shaft_w=0.016)

    blade = empty("Blade", (BLADE_PARK, 0, 0.009), parent=root)
    plate("BladeEdge", 0.105, 0.011, (0, LAY["tool"], 0),
          material=mats["steel"], parent=blade)
    plate("BladeGrip", 0.090, 0.034, (0.090, LAY["tool"], 0.006),
          material=mats["slate"], parent=blade)

    return dict(root=root, hole=hole, nail=nail, plug=plug, legs=legs,
                offcut=offcut, reamer=reamer, inserter=inserter, blade=blade,
                zones=zones)


def build_tool(name, parent, shaft_mat, tip_mat, *, shaft_w=0.028):
    """A T-handled probe, built with its working tip at the origin, so that
    the object's own z is the depth of the tip into the tread and nothing has
    to be offset by hand."""
    root = empty(name, (0, 0, TOOL_PARK), parent=parent)
    wedge(name + "Tip", 0.021, (0, LAY["tool"], -0.004),
          material=tip_mat, parent=root, spin=math.pi)
    plate(name + "Shaft", shaft_w, 0.300, (0, LAY["tool"], 0.160),
          material=shaft_mat, parent=root)
    plate(name + "Handle", 0.170, 0.038, (0, LAY["tool"], 0.330),
          material=shaft_mat, parent=root)
    return root


# ---------------------------------------------------------------- the pump
def build_pump(mats):
    """Dial, needle, and a hose to the valve.

    Ticks and no numbers. The pressure is the one figure breakdown.ts says not
    to guess, and a diagram that printed one would be guessing it for every
    bike on the island.
    """
    root = empty("Pump", (GAUGE_C[0], 0, GAUGE_C[1]))
    plate("PumpBody", 0.100, 0.100, (0, LAY["gauge"], -0.125),
          material=mats["brand_deep"], parent=root)
    disc("GaugeFace", GAUGE_R, (0, LAY["gauge"], 0), material=mats["steel"], parent=root)
    disc("GaugeBezel", GAUGE_R - 0.012, (0, LAY["tick"], 0),
         material=mats["bg"], parent=root)
    for i in range(7):
        a = DIAL_FROM - DIAL_SWEEP * i / 6.0
        bar(f"Tick{i}", (math.cos(a) * (GAUGE_R - 0.030), math.sin(a) * (GAUGE_R - 0.030)),
            (math.cos(a) * (GAUGE_R - 0.014), math.sin(a) * (GAUGE_R - 0.014)),
            0.010, LAY["tick"], mats["ink"], parent=root)

    target = empty("Target", parent=root)
    for i in range(3):
        a = DIAL_FROM - DIAL_SWEEP * (TARGET_P + (i - 1) * 0.030)
        bar(f"TargetSeg{i}", (math.cos(a) * (GAUGE_R - 0.034), math.sin(a) * (GAUGE_R - 0.034)),
            (math.cos(a) * (GAUGE_R - 0.012), math.sin(a) * (GAUGE_R - 0.012)),
            0.014, LAY["tick"], mats["target"], parent=target)

    needle = empty("Needle", parent=root)
    plate("NeedleBar", NEEDLE_LEN, 0.013, (NEEDLE_LEN / 2, LAY["needle"], 0),
          material=mats["needle"], parent=needle)
    disc("NeedlePin", 0.018, (0, LAY["needle"], 0), material=mats["ink"], parent=root)

    hose = empty("Hose", (HOSE_ROOT[0], 0, HOSE_ROOT[1]))
    plate("HoseBar", HOSE_LEN, 0.018, (HOSE_LEN / 2, LAY["hose"], 0),
          material=mats["brand_deep"], parent=hose)
    return dict(root=root, needle=needle, target=target, hose=hose)


# ---------------------------------------------------------------- animation
def hose_to(valve):
    """Rotation and stretch that put the far end of the hose on the valve."""
    dx, dz = valve[0] - HOSE_ROOT[0], valve[1] - HOSE_ROOT[1]
    return (0, -math.atan2(dz, dx), 0), (math.hypot(dx, dz) / HOSE_LEN, 1.0, 1.0)


def roll(rig, world, frame, dist, *, interp="LINEAR"):
    """Slide the road and turn both wheels from one distance.

    Rolling right by d means the world goes left by d and each wheel turns by
    d/r. Keying them from the same number is the only way they cannot drift:
    a wheel that skates is the one mistake in a diagram everybody sees.
    """
    key(world, frame, loc=(-dist, 0, 0), interp=interp)
    for spin in rig["spins"]:
        key(spin, frame, rot=(0, dist / WHEEL_R, 0), interp=interp)


def flat_scale(u=0.0):
    """The rear tyre's shape, from flat at u=0 to inflated at u=1."""
    return (FLAT_BULGE + (1.0 - FLAT_BULGE) * u, 1.0,
            FLAT_SQUASH + (1.0 - FLAT_SQUASH) * u)


def animate(rig, world, hand, inset, sect, pump, cam):
    squash = rig["squash"]
    tilt = rig["tilt"]

    # --- camera: five framings, hard cuts. A cut costs nothing to encode,
    # which a move across a flat-colour frame very much does.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["identify"], INSET)
    frame_at(F["find"], CLOSE)
    frame_at(F["ream"], SECTION)
    frame_at(F["inflate"], CLOSE)
    frame_at(F["ride"], RIDE)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(tilt, 1, rot=(0, FLAT_ANGLE, 0), interp="CONSTANT")
    key(squash, 1, scale=flat_scale(0.0), interp="CONSTANT")
    roll(rig, world, 1, 0.0, interp="CONSTANT")
    # The colour a material was built with lasts exactly until it gets its
    # first key, which then extends backwards over the whole clip. Without
    # these three the plug was green from frame one - sealed before it had
    # been cut off the reel.
    key_colour(sect["plug_mat"], 1, YELLOW)
    key_colour(pump["needle_mat"], 1, INK)
    key_colour(pump["target_mat"], 1, BRAND)
    for obj in (hand, rig["found"], rig["plugged"], rig["arc"], rig["valve"],
                inset["root"], inset["tick"], inset["strike"],
                pump["root"], pump["hose"], pump["target"],
                sect["zones"], sect["offcut"]):
        show(obj, 1, False)
    key(rig["nail"], 1, scale=(1, 1, 1), interp="CONSTANT")
    key(sect["blade"], 1, loc=(BLADE_PARK, 0, 0.009), interp="CONSTANT")
    key(sect["hole"], 1, scale=(0.42, 1.0, 1.0), interp="CONSTANT")
    key(sect["legs"], 1, scale=(1, 1, 1), interp="CONSTANT")
    key(pump["needle"], 1, rot=(0, -DIAL_FROM, 0), interp="CONSTANT")

    # ---------------------------------------------------------------- push
    # before: "Get fully off the carriageway before you look at anything.
    # Push the bike; do not ride it even a short way on a flat."
    f0 = F["push"]
    show(hand, f0 + 3, True)
    for i in range(15):
        t = i / 14.0
        roll(rig, world, f0 + 4 + int(round(t * 54)), PUSH_DIST * ease(t))
    show(hand, f0 + 61, False)

    # ------------------------------------------------------------ identify
    # step: "Work out whether the wheel is tubeless or tubed."
    f0 = F["identify"]
    show(inset["root"], f0, True)
    key(inset["tick"], f0 + 10, scale=(0.0, 0.0, 0.0), interp="LINEAR")
    key(inset["tick"], f0 + 18, scale=(1.0, 1.0, 1.0))
    key(inset["strike"], f0 + 28, scale=(0.0, 1.0, 1.0), interp="LINEAR")
    key(inset["strike"], f0 + 36, scale=(1.0, 1.0, 1.0))
    show(inset["root"], f0 + 49, False)

    # ---------------------------------------------------------------- find
    # step: "Find what went in. A nail or screw straight into the tread."
    # The nail stays in: the guide says leave it until you are ready to plug,
    # or the rest of the air goes with it.
    f0 = F["find"]
    show(rig["arc"], f0 + 2, True)
    key(rig["arc"], f0 + 4, rot=(0, -(NAIL_LOCAL - 2.30), 0), interp="BEZIER")
    key(rig["arc"], f0 + 34, rot=(0, -NAIL_LOCAL, 0))
    show(rig["found"], f0 + 36, True)
    big = True
    for i in range(5):
        key(rig["found"], f0 + 36 + i * 4,
            scale=(1.15, 1.15, 1.15) if big else (0.85, 0.85, 0.85), interp="CONSTANT")
        big = not big
    key(rig["found"], f0 + 56, scale=(1.0, 1.0, 1.0), interp="CONSTANT")

    # ---------------------------------------------------------------- ream
    # step: "...follow the kit instructions exactly: ream, plug, trim,
    # inflate." Word one. The nail comes out only now.
    f0 = F["ream"]
    show(sect["zones"], f0, True)
    show(rig["arc"], f0, False)
    show(rig["found"], f0, False)
    key(sect["nail"], f0 + 2, loc=(0, 0, 0), interp="BEZIER")
    key(sect["nail"], f0 + 15, loc=(0, 0, 0.330))
    show(sect["nail"], f0 + 16, False)
    show(rig["nail"], f0, False)

    reamer = sect["reamer"]
    # A plain first key, not a CONSTANT one: Blender holds the first key's
    # value backwards anyway, and CONSTANT here made the reamer sit in the
    # sky and then appear inside the tread on one frame.
    key(reamer, f0 + 12, loc=(0, 0, TOOL_PARK))
    for fr, z in ((20, 0.030), (26, REAM_DEEP), (31, 0.015),
                  (36, REAM_DEEP), (41, 0.030), (47, TOOL_PARK)):
        key(reamer, f0 + fr, loc=(0, 0, z))
    # The hole opens up as it is reamed, which is what a reamer is for.
    key(sect["hole"], f0 + 24, scale=(0.42, 1.0, 1.0), interp="BEZIER")
    key(sect["hole"], f0 + 38, scale=(1.0, 1.0, 1.0))

    # ---------------------------------------------------------------- plug
    # Word two. The plug is a strand doubled over the tool: the bend goes in,
    # both tails stay out, and the tool comes back without it.
    f0 = F["plug"]
    tool = sect["inserter"]
    key(tool, f0, loc=(0, 0, TOOL_PARK))
    key(sect["plug"], f0, loc=(0, 0, TOOL_PARK))
    for fr, z in ((12, 0.140), (26, PLUG_DEPTH)):
        key(tool, f0 + fr, loc=(0, 0, z))
        key(sect["plug"], f0 + fr, loc=(0, 0, z))
    key(tool, f0 + 34, loc=(0, 0, PLUG_DEPTH))
    key(tool, f0 + 44, loc=(0, 0, 0.220))
    key(tool, f0 + 52, loc=(0, 0, TOOL_PARK))
    key(sect["plug"], f0 + 53, loc=(0, 0, PLUG_DEPTH))

    # ---------------------------------------------------------------- trim
    # Word three. The blade passes once and the tails are flush.
    f0 = F["trim"]
    blade = sect["blade"]
    key(blade, f0, loc=(BLADE_PARK, 0, 0.009), interp="BEZIER")
    key(blade, f0 + 14, loc=(0.0, 0, 0.009))
    key(blade, f0 + 26, loc=(-0.560, 0, 0.009))
    key(blade, f0 + 27, loc=(BLADE_PARK, 0, 0.009), interp="CONSTANT")
    key(sect["legs"], f0 + 13, scale=(1.0, 1.0, 1.0), interp="CONSTANT")
    key(sect["legs"], f0 + 14, scale=(1.0, 1.0, TRIM_SCALE), interp="CONSTANT")
    show(sect["offcut"], f0 + 14, True)
    key(sect["offcut"], f0 + 14, loc=(0, 0, 0.030), interp="BEZIER")
    key(sect["offcut"], f0 + 26, loc=(-0.190, 0, 0.200))
    show(sect["offcut"], f0 + 27, False)
    key_colour(sect["plug_mat"], f0 + 30, GREEN)

    # ------------------------------------------------------------- inflate
    # step: "Inflate to the pressure printed on the bike, not by feel, and
    # check it holds for a few minutes."
    f0 = F["inflate"]
    show(pump["root"], f0, True)
    show(pump["hose"], f0, True)
    show(rig["valve"], f0, True)
    rot, hscale = hose_to(tilt_point(math.cos(VALVE_PHI) * VALVE_TIP_R,
                                     math.sin(VALVE_PHI) * VALVE_TIP_R, FLAT_ANGLE))
    key(pump["hose"], f0, rot=rot, scale=hscale, interp="CONSTANT")

    # Read the figure off the bike first: the mark on the chain guard and the
    # mark on the dial are the same blue, and they pulse one after the other,
    # which is as close as a wordless diagram gets to saying "that, there".
    big = True
    for i in range(4):
        key(rig["placard_mark"], f0 + 6 + i * 4,
            scale=(1.45, 1.0, 1.45) if big else (1.0, 1.0, 1.0), interp="CONSTANT")
        big = not big
    key(rig["placard_mark"], f0 + 22, scale=(1.0, 1.0, 1.0), interp="CONSTANT")
    key(pump["target"], f0 + 16, scale=(0.0, 0.0, 0.0), interp="LINEAR")
    key(pump["target"], f0 + 22, scale=(1.0, 1.0, 1.0))

    # Four strokes of a pump, not one smooth swell: the tyre, the bike and the
    # needle all come off the same number, so none of them can disagree.
    schedule = ((20, 0.00), (28, 0.36), (31, 0.38), (38, 0.70),
                (41, 0.72), (49, 1.00), (64, 1.00))
    for fr, u in schedule:
        f = f0 + fr
        key(squash, f, scale=flat_scale(u), interp="LINEAR")
        key(tilt, f, rot=(0, FLAT_ANGLE * (1.0 - u), 0), interp="LINEAR")
        key(pump["needle"], f, rot=(0, -(DIAL_FROM - DIAL_SWEEP * TARGET_P * u), 0),
            interp="LINEAR")
        valve = tilt_point(math.cos(VALVE_PHI) * VALVE_TIP_R,
                           math.sin(VALVE_PHI) * VALVE_TIP_R,
                           FLAT_ANGLE * (1.0 - u))
        rot, hscale = hose_to(valve)
        key(pump["hose"], f, rot=rot, scale=hscale, interp="LINEAR")
    # The plug is in the tyre from the first frame of this beat, where the
    # nail used to be: the cut lands on it, so the green the section beat
    # just ended on is the green this one opens with.
    show(rig["plugged"], f0, True)
    # It held. Fifteen frames of nothing moving is the check; the colour is
    # the verdict, and it is the same green the inset used for the right wheel.
    key_colour(pump["needle_mat"], f0 + 62, GREEN)
    key_colour(pump["target_mat"], f0 + 62, GREEN)

    # ---------------------------------------------------------------- ride
    # step: "Ride slowly and directly to a tyre shop."
    f0 = F["ride"]
    show(pump["root"], f0, False)
    show(pump["hose"], f0, False)
    show(rig["valve"], f0, False)
    for i in range(13):
        t = i / 12.0
        roll(rig, world, f0 + 4 + int(round(t * 44)),
             PUSH_DIST + RIDE_DIST * ease(t))
    roll(rig, world, F_END, PUSH_DIST + RIDE_DIST)


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

    # The ones that get recoloured need an instance each, or a key on one of
    # them turns up on everything that happened to share it.
    plug_mat = flat("PlugMat", YELLOW)
    needle_mat = flat("NeedleMat", INK)
    target_mat = flat("TargetMat", BRAND)
    mats = {
        "bg": flat("Bg", BG),
        "road": flat("Road", ROAD),
        "text": flat("Text", TEXT),
        "ink": flat("Ink", INK),
        "ink_soft": flat("InkSoft", INK_SOFT),
        "slate": flat("Slate", SLATE),
        "steel": flat("Steel", STEEL),
        "stud": flat("Stud", STUD_GREY),
        "brand": flat("Brand", BRAND),
        "brand_deep": flat("BrandDeep", BRAND_DEEP),
        "green": flat("Green", GREEN),
        "red": flat("Red", RED),
        "plugged": flat("Plugged", GREEN),
        "plug": plug_mat,
        "needle": needle_mat,
        "target": target_mat,
    }

    world = build_road(mats)
    build_shop(mats, world)
    rig = build_bike(mats, world)
    hand = build_hand(mats, rig["bike"])
    inset = build_inset(mats)
    sect = build_section(mats)
    sect["plug_mat"] = plug_mat
    pump = build_pump(mats)
    pump["needle_mat"] = needle_mat
    pump["target_mat"] = target_mat

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = WIDE[1]
    cam_data.clip_start = 0.1
    cam_data.clip_end = 60.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.pi / 2, 0, 0))
    scene.camera = cam

    world_bg = bpy.data.worlds.new("Paper")
    world_bg.use_nodes = True
    world_bg.node_tree.nodes["Background"].inputs[0].default_value = rgba(BG)
    world_bg.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world_bg

    animate(rig, world, hand, inset, sect, pump, cam)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"moto_puncture_{still:04d}.png")
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
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.audio_codec = "NONE"
        out = os.path.join(OUT_DIR, "fix-moto-puncture.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print(f"WROTE {out} {os.path.getsize(out)} bytes crf={crf}")

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-puncture.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
