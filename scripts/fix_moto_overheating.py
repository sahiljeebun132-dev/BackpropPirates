"""Build and render the "it is overheating" diagram for the moto-overheating guide.

Run:
    blender --background --factory-startup --python scripts/fix_moto_overheating.py -- --still 120
    blender --background --factory-startup --python scripts/fix_moto_overheating.py -- --render

    --still N    one frame to docs/pitch-assets/moto_overheat_NNNN.png, for framing
                 ("moto_" because scripts/fix_overheating.py, the car clip,
                 writes overheat_NNNN.png: the two were overwriting each
                 other's check frames, which is a nasty way to verify a clip
                 against someone else's picture)
    --render     the whole thing to public/guides/fix-moto-overheating.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

A diagram that moves, not a film: an orthographic side elevation of the left
of the bike, pure emission materials and the Standard view transform, so every
pixel is exactly the hex value it was given. Cuts between framings are hard,
because a hard cut costs no bitrate and this file has to fit in an APK.

The beats are the 'moto-overheating' steps in src/lib/breakdown.ts, in their
order, because the app prints those steps under the clip:

    before[0]  pull off the road; on a liquid-cooled bike let it idle a
               moment before switching off            -> arrive, idle
    step 1     switch off and wait, thirty minutes at least, and never open
               a cap while it is hot                  -> wait
    step 2     check the level in the reservoir, not the radiator -> level
    step 3     look for the obvious: a packed radiator, a fan that never
               came on                                -> look
    step 4     top it up if it is low                 -> topup
    step 5     ride gently, keep moving for airflow, watch the gauge -> ride

Four places where the clip and the text are not a line-for-line match, all
deliberate:

  - There is a beat between the waiting and the level check that is not a
    step: the air-cooled / liquid-cooled fork. It is in the guide, in
    manualSays ("whether it is air- or liquid-cooled at all. An air-cooled
    engine has no coolant to check") and in before[1]. It is drawn because a
    rider on an air-cooled bike who is told "check the reservoir" goes looking
    for a part that is not fitted, and the clip would have taught them that.
  - before[0] asks for thirty seconds of idling. The clip shows the order -
    idle, then switch off - without counting it. The clock in the wait beat is
    the only timed thing on screen, and a second counter half a second long
    would have read as the same instruction given twice.
  - step 3 names "a cooling fan that never came on" as a thing to look for.
    The fan is marked and left sitting still; it is never shown starting.
    Nothing at the roadside makes a dead fan run, and spinning it up would be
    drawing a repair this guide does not offer.
  - The sun, and the patch of shade the bike is rolled into, are nowhere in
    the written steps: before[0] only says to pull off the road. Shade is
    where a machine is left to cool, the clip has nothing else to say about
    where it was parked, and it costs two shapes.

Written against Blender 5.2, and the things this repo learned painfully all
apply: the engine id is 'BLENDER_EEVEE'; image_settings.media_type has to be
VIDEO before FFMPEG can be assigned; the output path must be absolute or the
render lands next to the .blend; keyframe_new_interpolation_type does nothing
on this build, so interpolation is set on keyframe_points after insertion;
Action.fcurves is empty for some IDs, so the curves are walked out of the
slotted action's layers/strips/channelbags; and every animated object gets an
explicit frame-1 key, because the first key extrapolates backwards.
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
    ("arrive", 52),   # off the road, into the shade, gauge in the red
    ("idle", 32),     # running a moment longer, then the ignition light out
    ("wait", 76),     # half a clock face, steam, and a cap not being opened
    ("fork", 54),     # air-cooled or liquid-cooled: only one has a level
    ("level", 58),    # the reservoir, not the radiator, and it is low
    ("look", 50),     # a packed core cleared; a fan that never came on
    ("topup", 52),    # right coolant in, level between the marks
    ("ride", 56),     # gently, moving, airflow through the core, gauge watched
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# The ride beat carries two framings: close on the front of the bike while it
# is "under way", then a hard cut to the wide as it leaves.
F_RIDE_OUT = F["ride"] + 34
# The idle beat likewise: the whole bike while it is still running, then in on
# the instruments for the moment the ignition light goes out.
F_IDLE_IN = F["idle"] + 16

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# The neutrals are the slate ramp scripts/fix_chain.py already draws the bike
# in; SHADE is the one step between ROAD and DIM that file did not need.
BG = "#f1f5f9"
ROAD = "#e2e8f0"
SHADE = "#cbd5e1"
MACHINE = "#334155"
DIM = "#94a3b8"
STEEL = "#64748b"
BRAND = "#189edb"
BRAND_DEEP = "#0e6fa3"
YELLOW = "#f0c000"
GREEN = "#007848"
RED = "#d83030"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller y
# is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "road": 0.40,
    "shade": 0.38,
    "dash": 0.36,
    "sun": 0.34,
    "frame": 0.06,
    "wheel": 0.04,
    "body": 0.02,
    "rad": 0.00,
    "fin": -0.02,
    "fan": -0.04,
    "res": -0.04,
    "cap": -0.06,
    "fluid": -0.06,
    "tick": -0.08,
    "pipe": -0.10,
    "grit": -0.12,
    "cluster": -0.14,
    "steam": -0.16,
    "bottle": -0.20,
    "hand": -0.22,
    "mark": -0.26,
}
PLATE = 0.010  # thickness of every plate; layers are 0.02 apart so none touch

# ------------------------------------------------------------------ geometry
# Metres, side elevation, front of the bike to the right, so forward is the
# way the frame is read. The road surface is z = 0 and the diagram plane y = 0.
WHEEL_R = 0.30
REAR_C = (-0.70, 0.30)
FRONT_C = (0.70, 0.30)

# The engine and the two things this guide is about: the radiator at the front
# of it, and the reservoir behind it. They are drawn as separate parts with a
# gap between them because telling them apart is step 2 of the guide.
ENG_C, ENG_W, ENG_H = (-0.02, 0.44), 0.34, 0.32

RAD_C, RAD_W, RAD_H = (0.30, 0.60), 0.24, 0.36
RAD_TOP = RAD_C[1] + RAD_H / 2
CAP_C = (RAD_C[0], RAD_TOP + 0.02)
FAN_C, FAN_R = (0.30, 0.645), 0.08

RES_C, RES_W, RES_H = (-0.33, 0.70), 0.18, 0.24
RES_BOT = RES_C[1] - RES_H / 2
RES_TOP = RES_C[1] + RES_H / 2
RES_CAP_C = (RES_C[0], RES_TOP + 0.015)
LEVEL_MIN = 0.655
LEVEL_MAX = 0.775
LEVEL_LOW = 0.625   # below the minimum mark: what the rider finds
LEVEL_OK = 0.720    # between the marks: what it should be

HEAD_C = (0.56, 0.90)
GAUGE_C, GAUGE_R = (0.38, 1.045), 0.062
CLUSTER_C, CLUSTER_W, CLUSTER_H = (0.42, 1.06), 0.26, 0.17
IGN_C, WARN_C, DOT_R = (0.50, 1.010), (0.50, 1.085), 0.028
# The needle, in screen degrees: the hot end of the arc, then the cold end.
GAUGE_HOT = math.radians(38)
GAUGE_COLD = math.radians(142)

CLOCK_C, CLOCK_R = (0.86, 0.95), 0.10
CLOCK_SEGS = 12   # a half sweep, so twelve five-minute bins: thirty minutes

# Where the reservoir cap is put down while the tank is open: laid on the
# seat, which is the nearest flat thing to that filler. Hung in the gap
# between the back of the tank and the front of the seat, as it was first
# drawn, it rested on nothing and read as a cap still being held.
CAP_OFF = (-0.52, LAY["cap"], 0.9825)
# The bottle is built round its own mouth, so the mouth is what these place.
# A positive Y rotation carries the body of it up and to the right, which is
# the way a bottle leans when it is being poured leftwards into a tank.
BOTTLE_IN = (0.16, 0.82)
POUR = (RES_CAP_C[0] + 0.02, RES_CAP_C[1] + 0.045)
POUR_TILT = math.radians(48)

HAND_PARK = (2.60, -1.20)
HAND_REACH = 0.10
BOTTLE_PARK = (2.60, 1.60)

SUN_C, SUN_R = (-1.68, 1.28), 0.10
SHADE_X0, SHADE_X1 = -1.25, 7.40
# The centre line, drawn on the strip of road below the contact patch. High
# enough on that strip to be inside the ride framing as well as the wide: at
# -0.40 it was under the bottom edge of every framing but the widest, and the
# one beat that needs the road to move is not shot wide.
DASH_Z = -0.26

# Out of the tail of the can, up and back, in clear air: the nearest point of
# this path is 0.49 m from the rear axle and the tyre's outer edge is 0.32 m.
PUFF_OUT = (-1.06, 0.70)

ARRIVE_FROM = -2.60   # where the bike enters from, off the left of the wide
RIDE_ROLL = 2.60      # how far the road runs under it while it is "under way"
# And how far it carries on once the camera lets it go. Short enough that the
# instruments are still inside the frame on the last frame - the step says to
# watch the gauge the whole way, and the ring round it is the last thing the
# clip has to say. At 3.80 the machine had left the wide by frame 410 and the
# clip ended on twenty frames of empty road. 1.35 m in the 0.9 s this beat
# lasts is also about the pace "ride gently" describes.
RIDE_AWAY = 1.35

# The two emblems of the cooling fork live out here in world space, well right
# of anything else, so one hard cut reaches them and nothing has to be hidden.
CARD_C = (6.00, 1.00)
AIR_X, LIQ_X = 5.50, 6.50

# Framings: ((centre x, centre z), ortho scale). The scale is the width, so
# the height is nine sixteenths of it.
WIDE = ((0.00, 0.72), 4.00)
MID_FRONT = ((0.42, 0.60), 2.40)
# The ride framing is MID_FRONT dropped and widened until the road is in it.
# The bike holds still in that beat and the road moves, so a framing whose
# bottom edge is above the centre line shows a stationary machine with its
# wheels spinning, which is a bike on a paddock stand, not a bike being
# ridden. The top edge still clears the instruments: that beat is also the
# one that says to watch the gauge.
MID_RIDE = ((0.42, 0.44), 2.80)
CLOSE_CAP = ((0.42, 0.83), 1.30)
CARD = (CARD_C, 2.00)
MID_TANKS = ((0.00, 0.72), 1.50)
CLOSE_RAD = ((0.30, 0.60), 0.70)
CLOSE_FILL = ((-0.30, 0.82), 0.95)

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(_REPO, "public", "guides")
OUT_MP4 = os.path.join(OUT_DIR, "fix-moto-overheating.mp4")
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
    of a diagram: nothing in the scene can tint it and there is no tone curve
    to argue with on the way out.
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
    """A rectangle facing the camera. loc is its centre; spin turns it."""
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
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=48, minor_segments=6)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def bar(name, p0, p1, w, y, material, parent=None):
    """A straight member between two points in the diagram plane."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    return plate(name, length, w, ((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2),
                 material=material, parent=parent, spin=-math.atan2(dz, dx))


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


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
    this 5.2 build: it reads back as whatever it was set to and the keyframe
    is still born BEZIER. Checked, not assumed. Every hard cut in this clip
    depends on it, so the keys are corrected after insertion instead.
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
    """Scaled away rather than dimmed.

    An emission strength of zero is black, and a black ring on a pale page is
    still a ring. Scale is the only honest off switch in a diagram with no
    lighting in it.
    """
    key(obj, frame, scale=(1.0, 1.0, 1.0) if on else (0.0, 0.0, 0.0), interp=interp)


def screen_rot(phi):
    """The Y rotation that points a plate's long axis at screen angle phi.

    The camera looks along +Y, so a positive Y rotation reads as clockwise.
    """
    return (0, -phi, 0)


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 26.0, 0.80, (0.0, LAY["road"], -0.40), material=mats["road"])
    plate("RoadEdge", 26.0, 0.012, (0.0, LAY["dash"], 0.0), material=mats["dim"])

    # Shade on the tarmac rather than a tint over the whole frame: it leaves
    # every close framing on the same page colour as the rest of the app, and
    # a darker patch of road is what shade actually looks like.
    plate("Shade", SHADE_X1 - SHADE_X0, 0.80,
          ((SHADE_X0 + SHADE_X1) / 2, LAY["shade"], -0.40), material=mats["shade"])

    # The dashes are the only thing that shows the bike moving once the camera
    # stops following the road: in the ride beat the machine holds still and
    # these run out from under it.
    dashes = empty("Dashes")
    x = -3.4
    i = 0
    while x < 4.6:
        plate("Dash%d" % i, 0.16, 0.016, (x, LAY["dash"], DASH_Z),
              material=mats["dim"], parent=dashes)
        x += 0.34
        i += 1

    sun = empty("Sun", (SUN_C[0], 0, SUN_C[1]))
    disc("SunDisc", SUN_R, (0, LAY["sun"], 0), material=mats["yellow"], parent=sun)
    for j in range(8):
        a = math.radians(j * 45)
        plate("SunRay%d" % j, 0.07, 0.016,
              ((SUN_R + 0.055) * math.cos(a), LAY["sun"], (SUN_R + 0.055) * math.sin(a)),
              material=mats["yellow"], parent=sun, spin=-a)
    return dashes


# ------------------------------------------------------------------ the bike
def build_wheel(name, centre, mats, parent):
    """A wheel that can be seen to turn. The spokes are the whole point."""
    hub = empty(name, (centre[0], 0, centre[1]), parent=parent)
    ring(name + "Tyre", WHEEL_R, 0.022, (0, LAY["wheel"], 0),
         material=mats["machine"], parent=hub)
    ring(name + "Rim", WHEEL_R - 0.046, 0.008, (0, LAY["wheel"], 0),
         material=mats["dim"], parent=hub)
    for i in range(5):
        a = i * 2 * math.pi / 5
        r0, r1 = 0.030, WHEEL_R - 0.046
        bar("%sSpoke%d" % (name, i),
            (math.cos(a) * r0, math.sin(a) * r0),
            (math.cos(a) * r1, math.sin(a) * r1),
            0.016, LAY["wheel"], mats["dim"], parent=hub)
    disc(name + "Hub", 0.036, (0, LAY["wheel"] - 0.01, 0),
         material=mats["machine"], parent=hub)
    return hub


def build_bike(mats):
    """The machine, in the fewest members that still read as a motorcycle.

    Any more detail and the radiator stops being the subject; any less and the
    thing on screen is a bicycle.
    """
    root = empty("Bike")

    rear = build_wheel("RearWheel", REAR_C, mats, root)
    front = build_wheel("FrontWheel", FRONT_C, mats, root)

    bar("Swingarm", REAR_C, (-0.16, 0.33), 0.024, LAY["frame"], mats["machine"],
        parent=root)
    bar("Spine", (HEAD_C[0], 0.88), (0.10, 0.84), 0.022, LAY["frame"],
        mats["machine"], parent=root)
    bar("DownTube", (0.54, 0.84), (0.26, 0.50), 0.018, LAY["frame"], mats["machine"],
        parent=root)
    # Into the reservoir, which is nearer the lens and hides the middle of it,
    # and out again: the same way the real member disappears behind the
    # bottle it is bolted next to.
    bar("SubframeA", (-0.24, 0.66), (-0.46, 0.84), 0.020, LAY["frame"],
        mats["machine"], parent=root)
    bar("SubframeB", (-0.46, 0.84), (-0.80, 0.885), 0.022, LAY["frame"],
        mats["machine"], parent=root)
    bar("Fork", FRONT_C, HEAD_C, 0.020, LAY["frame"], mats["machine"], parent=root)
    bar("Bars", (0.58, 0.97), (0.34, 1.00), 0.016, LAY["frame"], mats["machine"],
        parent=root)
    disc("Head", 0.035, (HEAD_C[0], LAY["frame"], HEAD_C[1]),
         material=mats["machine"], parent=root)

    plate("Engine", ENG_W, ENG_H, (ENG_C[0], LAY["body"], ENG_C[1]),
          material=mats["machine"], parent=root)
    # The tank overhangs the engine at both ends and the airbox fills the
    # void between them, because a slab of the same width stacked on a slab
    # reads as one block rather than as a motorcycle.
    plate("Airbox", 0.26, 0.17, (-0.02, LAY["frame"], 0.690),
          material=mats["dim"], parent=root)
    plate("Tank", 0.44, 0.18, (-0.04, LAY["body"], 0.86),
          material=mats["machine"], parent=root)
    # The side cover, which is what stops the seat reading as a bar floating
    # over the back wheel.
    plate("SideCover", 0.26, 0.16, (-0.56, LAY["frame"], 0.78),
          material=mats["dim"], parent=root)
    plate("Seat", 0.38, 0.085, (-0.59, LAY["body"], 0.925),
          material=mats["machine"], parent=root)
    # A headlight, purely so the thing in the frame reads as a motorcycle
    # facing right rather than a frame with wheels on it.
    plate("Headlight", 0.12, 0.15, (0.655, LAY["body"], 0.855),
          material=mats["machine"], parent=root)

    # A high pipe: the header climbs behind the cylinder and the can runs back
    # in the wedge between the top of the rear tyre and the side cover. Every
    # point of it is further from the rear axle than the tyre's outer edge, so
    # it never crosses the wheel. Two lower routes were drawn first and both
    # failed the same way - a grey bar lying across a spoked wheel reads as a
    # bar through the wheel, and the exhaust puffs then left the can from
    # somewhere inside the tyre.
    bar("Header", (0.08, 0.30), (-0.36, 0.49), 0.030, LAY["pipe"], mats["steel"],
        parent=root)
    bar("Muffler", (-0.34, 0.48), (-0.98, 0.66), 0.095, LAY["pipe"], mats["steel"],
        parent=root)

    return dict(root=root, wheels=(rear, front))


def build_radiator(mats, parent):
    """Core, fin lines, filler cap, and the fan sitting behind the core.

    Drawn face-on inside a side elevation, which is a liberty - from the side
    a radiator is a slab - but the same liberty scripts/fix_tyre.py takes with
    five lug nuts on a wheel seen edge-on, and for the same reason: the face
    is the thing the step is about.
    """
    plate("RadCore", RAD_W, RAD_H, (RAD_C[0], LAY["rad"], RAD_C[1]),
          material=mats["steel"], parent=parent)
    for i in range(7):
        x = RAD_C[0] - RAD_W / 2 + RAD_W * (i + 0.5) / 7
        plate("RadFin%d" % i, 0.010, RAD_H - 0.03, (x, LAY["fin"], RAD_C[1]),
              material=mats["bg"], parent=parent)

    fan = empty("Fan", (FAN_C[0], 0, FAN_C[1]), parent=parent)
    disc("FanHub", 0.020, (0, LAY["fan"], 0), material=mats["machine"], parent=fan)
    ring("FanRim", FAN_R, 0.007, (0, LAY["fan"], 0),
         material=mats["machine"], parent=fan)
    for i in range(5):
        a = i * 2 * math.pi / 5
        bar("FanBlade%d" % i, (math.cos(a) * 0.018, math.sin(a) * 0.018),
            (math.cos(a) * (FAN_R - 0.008), math.sin(a) * (FAN_R - 0.008)),
            0.026, LAY["fan"], mats["machine"], parent=fan)

    plate("RadNeck", 0.05, 0.04, (CAP_C[0], LAY["cap"], CAP_C[1] - 0.012),
          material=mats["machine"], parent=parent)
    plate("RadCap", 0.10, 0.045, (CAP_C[0], LAY["cap"], CAP_C[1] + 0.014),
          material=mats["machine"], parent=parent)

    # Mud and leaves, already in the core when the clip opens, because they
    # did not arrive while it was parked.
    grit = []
    for i, (gx, gz, gr) in enumerate((
            (-0.07, -0.14, 0.024), (-0.01, -0.16, 0.019), (0.05, -0.13, 0.026),
            (-0.04, -0.09, 0.017), (0.08, -0.17, 0.020), (0.01, -0.10, 0.015))):
        grit.append(disc("Grit%d" % i, gr,
                         (RAD_C[0] + gx, LAY["grit"], RAD_C[1] + gz),
                         material=mats["yellow"], parent=parent))
    return fan, grit


def build_reservoir(mats, parent):
    """A separate tank, behind the engine, with a sight level and two marks.

    Separate and visibly so: step 2 of the guide is that this is the part to
    look at and the radiator is not, and a diagram that put them in the same
    place would be teaching the opposite.
    """
    plate("ResShell", RES_W, RES_H, (RES_C[0], LAY["res"], RES_C[1]),
          material=mats["steel"], parent=parent)
    cap = plate("ResCap", 0.08, 0.03, (RES_CAP_C[0], LAY["cap"], RES_CAP_C[1]),
                material=mats["machine"], parent=parent)

    fluid_root = empty("FluidRoot", (RES_C[0], 0, RES_BOT), parent=parent)
    plate("Fluid", RES_W - 0.03, 1.0, (0, LAY["fluid"], 0.5),
          material=mats["brand"], parent=fluid_root)

    marks = empty("LevelMarks", parent=parent)
    lo = plate("MarkMin", 0.05, 0.012,
               (RES_C[0] + 0.05, LAY["tick"], LEVEL_MIN),
               material=mats["min"], parent=marks)
    plate("MarkMax", 0.05, 0.012, (RES_C[0] + 0.05, LAY["tick"], LEVEL_MAX),
          material=mats["bg"], parent=marks)
    return dict(cap=cap, fluid=fluid_root, marks=marks, min_mark=lo)


def build_cluster(mats, parent):
    """One gauge and two lights, which is how a temperature is said without
    a word of text. The needle falls through the clip; the warning light
    blinks while it is hot and goes out when it is not."""
    plate("ClusterCase", CLUSTER_W, CLUSTER_H,
          (CLUSTER_C[0], LAY["cluster"], CLUSTER_C[1]),
          material=mats["machine"], parent=parent)

    for i in range(9):
        a = math.radians(150 - i * 15)
        band = mats["brand"] if i < 3 else (mats["red"] if i > 5 else mats["bg"])
        plate("GaugeTick%d" % i, 0.018, 0.010,
              (GAUGE_C[0] + 0.050 * math.cos(a), LAY["cluster"] - 0.02,
               GAUGE_C[1] + 0.050 * math.sin(a)),
              material=band, parent=parent, spin=-a)

    needle = empty("Needle", (GAUGE_C[0], 0, GAUGE_C[1]), parent=parent)
    plate("NeedleBar", 0.048, 0.011, (0.022, LAY["cluster"] - 0.04, 0),
          material=mats["bg"], parent=needle)
    disc("NeedleHub", 0.011, (0, LAY["cluster"] - 0.06, 0),
         material=mats["bg"], parent=needle)

    disc("IgnDot", DOT_R, (IGN_C[0], LAY["cluster"] - 0.02, IGN_C[1]),
         material=mats["ign"], parent=parent)
    disc("WarnDot", DOT_R, (WARN_C[0], LAY["cluster"] - 0.02, WARN_C[1]),
         material=mats["warn"], parent=parent)
    return needle


def build_clock(mats):
    """A ring, a hand, and twelve bins that fill as it sweeps.

    Half a clock face is thirty minutes, which is the one number in step 1
    that a picture can carry on its own.
    """
    root = empty("Clock", (CLOCK_C[0], 0, CLOCK_C[1]))
    ring("ClockRim", CLOCK_R, 0.008, (0, LAY["mark"], 0),
         material=mats["steel"], parent=root)
    for dz in (CLOCK_R, -CLOCK_R):
        plate("ClockTick%d" % int(dz * 1000), 0.012, 0.024,
              (0, LAY["mark"] - 0.02, dz), material=mats["machine"], parent=root)
    segs = []
    for i in range(CLOCK_SEGS):
        a = math.radians(90 - (i + 0.5) * (180.0 / CLOCK_SEGS))
        s = empty("ClockSeg%d" % i,
                  ((CLOCK_R - 0.026) * math.cos(a), 0,
                   (CLOCK_R - 0.026) * math.sin(a)), parent=root)
        plate("ClockBin%d" % i, 0.024, 0.013, (0, LAY["mark"] - 0.04, 0),
              material=mats["brand"], parent=s, spin=-a)
        segs.append(s)
    hand = empty("ClockHand", (0, 0, 0), parent=root)
    plate("ClockHandBar", 0.070, 0.011, (0.035, LAY["mark"] - 0.06, 0),
          material=mats["machine"], parent=hand)
    disc("ClockHub", 0.013, (0, LAY["mark"] - 0.08, 0),
         material=mats["machine"], parent=root)
    return root, hand, segs


def build_no_entry(name, centre, r, mats):
    """A circle and a bar: the one sign that needs no word under it."""
    root = empty(name, (centre[0], 0, centre[1]))
    ring(name + "Ring", r, 0.013, (0, LAY["mark"], 0),
         material=mats["red"], parent=root)
    plate(name + "Bar", 2 * r, 0.020, (0, LAY["mark"] - 0.02, 0),
          material=mats["red"], parent=root, spin=math.radians(45))
    return root


def build_hand(mats):
    """A glove, near enough. It says "by hand", and in the wait beat it says
    the other half of step 1 by stopping short of the cap and leaving."""
    root = empty("Hand", (HAND_PARK[0], 0, HAND_PARK[1]))
    plate("Palm", 0.130, 0.130, (0.050, LAY["hand"], 0),
          material=mats["brand"], parent=root)
    for i, dz in enumerate((0.042, 0.000, -0.042)):
        plate("Finger%d" % i, 0.085, 0.030, (-0.045, LAY["hand"], dz),
              material=mats["brand"], parent=root)
    # Overlapping the palm, not perched on its corner: at z 0.080 the rotated
    # end lifted clear of it and read as a second blue shape floating beside
    # the hand.
    plate("Thumb", 0.082, 0.033, (0.004, LAY["hand"], 0.068),
          material=mats["brand"], parent=root, spin=math.radians(-26))
    plate("Cuff", 0.055, 0.150, (0.140, LAY["hand"], 0),
          material=mats["brand"], parent=root)
    return root


def build_bottle(mats):
    """Built round its own mouth, so tipping it pours from the right place."""
    root = empty("Bottle", (BOTTLE_PARK[0], 0, BOTTLE_PARK[1]))
    plate("BottleBody", 0.110, 0.200, (0.000, LAY["bottle"], 0.130),
          material=mats["brand_deep"], parent=root)
    plate("BottleNeck", 0.050, 0.060, (0.000, LAY["bottle"], 0.010),
          material=mats["brand_deep"], parent=root)
    drops = [disc("Drop%d" % i, 0.016, (0, LAY["bottle"] - 0.02, -0.05),
                  material=mats["brand"]) for i in range(4)]
    return root, drops


def build_airflow(mats):
    """Two chevrons that run back into the core while the bike is moving.

    Both sit above the top of the front tyre, because that is where the air
    that reaches a radiator has come past.
    """
    arrows = []
    for i, z in enumerate((0.645, 0.745)):
        root = empty("Air%d" % i, (1.20, 0, z))
        for j, dz in enumerate((0.055, -0.055)):
            bar("AirBar%d_%d" % (i, j), (0.07, dz), (0.0, 0.0), 0.022,
                LAY["mark"], mats["brand"], parent=root)
        arrows.append(root)
    return arrows


def build_card(mats):
    """The cooling fork, drawn as two emblems side by side.

    Air-cooled on the left: fins, and no tank to check. Liquid-cooled on the
    right: a core, a cap, a tank with a level in it. A bar grows under the
    right-hand pair, because that is the one the rest of the clip is about.
    """
    plate("AirBarrel", 0.22, 0.34, (AIR_X, LAY["body"], 1.10),
          material=mats["steel"])
    plate("AirHead", 0.30, 0.06, (AIR_X, LAY["body"], 1.31), material=mats["machine"])
    for i in range(5):
        plate("AirFin%d" % i, 0.38, 0.026, (AIR_X, LAY["rad"], 0.97 + i * 0.06),
              material=mats["machine"])
    # The air-cooled tank is drawn empty, and in the grey of a part that is
    # not fitted. Crossing out a tank with coolant showing in it says "do not
    # check this full reservoir", and what the guide says is that an
    # air-cooled engine has no reservoir to check at all.
    plate("AirTank", 0.16, 0.20, (AIR_X, LAY["res"], 0.68), material=mats["dim"])
    air_no = build_no_entry("AirNo", (AIR_X, 0.68), 0.145, mats)

    plate("LiqCore", 0.32, 0.36, (LIQ_X, LAY["rad"], 1.12), material=mats["steel"])
    for i in range(7):
        x = LIQ_X - 0.16 + 0.32 * (i + 0.5) / 7
        plate("LiqFin%d" % i, 0.012, 0.32, (x, LAY["fin"], 1.12), material=mats["bg"])
    plate("LiqNeck", 0.06, 0.04, (LIQ_X, LAY["cap"], 1.31), material=mats["machine"])
    plate("LiqCap", 0.12, 0.05, (LIQ_X, LAY["cap"], 1.35), material=mats["machine"])
    plate("LiqTank", 0.16, 0.20, (LIQ_X, LAY["res"], 0.68), material=mats["steel"])
    plate("LiqTankFluid", 0.13, 0.11, (LIQ_X, LAY["fluid"], 0.635),
          material=mats["brand"])

    tick = empty("LiqTick", (LIQ_X + 0.26, 0, 0.68))
    bar("TickShort", (-0.055, -0.010), (-0.015, -0.055), 0.028, LAY["mark"],
        mats["green"], parent=tick)
    bar("TickLong", (-0.015, -0.055), (0.070, 0.075), 0.028, LAY["mark"],
        mats["green"], parent=tick)

    pick = empty("CardPick", (LIQ_X, 0, 0.50))
    plate("CardPickBar", 0.72, 0.035, (0, LAY["mark"], 0),
          material=mats["brand"], parent=pick)
    return air_no, tick, pick


def build_steam(mats):
    """Six puffs off the filler, which is what "it is still hot" looks like.

    They drift forward and away from the instruments rather than straight up,
    so the gauge stays readable underneath the one beat that needs it.
    """
    puffs = []
    for i in range(6):
        puffs.append(disc("Steam%d" % i, 0.040 + 0.006 * (i % 3),
                          (CAP_C[0], LAY["steam"], CAP_C[1]),
                          material=mats["dim"]))
    return puffs


def build_exhaust(mats):
    """Puffs off the can, so "still running" reads from across the wide shot.

    An instrument light is four pixels across at that framing; this is the
    same fact said at a size the opening beat can carry.
    """
    return [disc("Puff%d" % i, 0.045, (PUFF_OUT[0], LAY["steam"], PUFF_OUT[1]),
                 material=mats["dim"]) for i in range(4)]


def build_rings(mats):
    face = ring("InspectFace", 0.080, 0.011, (RAD_C[0], LAY["mark"], 0.490),
                material=mats["inspect_face"])
    fan = ring("InspectFan", 0.092, 0.011, (FAN_C[0], LAY["mark"], FAN_C[1]),
               material=mats["inspect_fan"])
    res = ring("InspectRes", 0.160, 0.012, (RES_C[0] - 0.06, LAY["mark"], RES_C[1]),
               material=mats["inspect_res"])
    # Round the dial, for the last step. "Watch the gauge the whole way" is
    # the only instruction in this guide that is about where to look rather
    # than what to do, and a gauge merely present in the corner of the frame
    # is not the same as a gauge being watched.
    gauge = ring("InspectGauge", 0.078, 0.009, (GAUGE_C[0], LAY["mark"], GAUGE_C[1]),
                 material=mats["inspect_gauge"])
    return face, fan, res, gauge


def build_fill_tick(mats):
    tick = empty("FillTick", (RES_C[0] + 0.22, 0, RES_C[1] + 0.02))
    bar("FillShort", (-0.050, -0.008), (-0.012, -0.050), 0.026, LAY["mark"],
        mats["green"], parent=tick)
    bar("FillLong", (-0.012, -0.050), (0.064, 0.070), 0.026, LAY["mark"],
        mats["green"], parent=tick)
    return tick


# ---------------------------------------------------------------- animation
def roll(bike, wheels, frames_offsets, *, phi_base=0.0):
    """Key the bike's position and both wheels together, from one number.

    Rolling forwards is +x, and a wheel rolling forwards turns clockwise on
    screen, which is a falling Y rotation. Position and rotation come out of
    the same sample so they cannot drift apart, and the keys are LINEAR
    because the easing is already in the samples.
    """
    for f, x in frames_offsets:
        key(bike, f, loc=(x, 0, 0), interp="LINEAR")
        for w in wheels:
            key(w, f, rot=(0, -(phi_base + x) / WHEEL_R, 0), interp="LINEAR")


def animate(scene_objs, mats, cam):
    bike = scene_objs["bike"]
    wheels = scene_objs["wheels"]
    dashes = scene_objs["dashes"]
    needle = scene_objs["needle"]
    clock, clock_hand, clock_segs = scene_objs["clock"]
    cap_no = scene_objs["cap_no"]
    hand = scene_objs["hand"]
    steam = scene_objs["steam"]
    fan = scene_objs["fan"]
    grit = scene_objs["grit"]
    res = scene_objs["res"]
    bottle, drops = scene_objs["bottle"]
    exhaust = scene_objs["exhaust"]
    air_no, liq_tick, card_pick = scene_objs["card"]
    insp_face, insp_fan, insp_res, insp_gauge = scene_objs["rings"]
    fill_tick = scene_objs["fill_tick"]
    airflow = scene_objs["airflow"]

    # --- camera: seven framings, every cut hard.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F_IDLE_IN, MID_FRONT)
    frame_at(F["wait"], CLOSE_CAP)
    frame_at(F["fork"], CARD)
    frame_at(F["level"], MID_TANKS)
    frame_at(F["look"], CLOSE_RAD)
    frame_at(F["topup"], CLOSE_FILL)
    frame_at(F["ride"], MID_RIDE)
    frame_at(F_RIDE_OUT, WIDE)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(dashes, 1, loc=(0, 0, 0), interp="CONSTANT")
    key(needle, 1, rot=screen_rot(GAUGE_HOT), interp="CONSTANT")
    key(hand, 1, loc=(HAND_PARK[0], 0, HAND_PARK[1]), rot=(0, 0, 0), interp="CONSTANT")
    key(bottle, 1, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(res["fluid"], 1, scale=(1.0, 1.0, LEVEL_LOW - RES_BOT), interp="CONSTANT")
    key(res["cap"], 1, loc=(RES_CAP_C[0], LAY["cap"], RES_CAP_C[1]),
        rot=(0, 0, 0), interp="CONSTANT")
    key(fan, 1, rot=(0, 0, 0), interp="CONSTANT")
    for obj in (clock, cap_no, air_no, liq_tick, card_pick, insp_face, insp_fan,
                insp_res, insp_gauge, fill_tick, res["marks"], *airflow, *drops,
                *exhaust):
        show(obj, 1, False)
    for seg in clock_segs:
        show(seg, 1, False)
    for puff in steam:
        show(puff, 1, False)
    for blob in grit:
        show(blob, 1, True)

    # --- arrive: in off the road, slowing, and stopped in the shade.
    samples = []
    span = 44
    for f in range(1, F["arrive"] + span + 1, 3):
        t = (f - 1) / float(span)
        samples.append((f, ARRIVE_FROM * (1.0 - ease(t))))
    samples.append((1 + span, 0.0))
    roll(bike, wheels, samples)

    # The temperature light, blinking from the first frame until it is cold.
    # Blinked by swapping in the instrument case colour, which reads as off;
    # dimming the emission instead gives a dark red dot that still looks lit.
    warn_off = F["wait"] + 62
    lit = True
    for f in range(1, warn_off, 9):
        key_colour(mats["warn"], f, RED if lit else MACHINE)
        lit = not lit
    key_colour(mats["warn"], warn_off, MACHINE)

    # --- idle, then off. The order is the instruction; the thirty seconds is
    # a count the caption carries and the clip does not try to draw.
    key_colour(mats["ign"], 1, YELLOW)
    for i, p in enumerate(exhaust):
        s = F["idle"] + 2 + i * 3
        key(p, s, loc=(PUFF_OUT[0], LAY["steam"], PUFF_OUT[1]), scale=(0.0, 0.0, 0.0),
            interp="CONSTANT")
        key(p, s + 2, scale=(0.9, 0.9, 0.9))
        key(p, s + 13, loc=(PUFF_OUT[0] - 0.26 - 0.04 * i, LAY["steam"],
                            PUFF_OUT[1] + 0.16 + 0.03 * i),
            scale=(0.2, 0.2, 0.2))
        show(p, s + 14, False)
    key_colour(mats["ign"], F_IDLE_IN + 8, YELLOW)
    key_colour(mats["ign"], F_IDLE_IN + 9, MACHINE)

    # --- wait: half a clock face, steam off the filler, and a hand that gets
    # as far as reaching before the sign goes up and it leaves again.
    w0 = F["wait"]
    show(clock, w0 + 3, True)
    key(clock_hand, w0 + 3, rot=screen_rot(math.radians(90)), interp="CONSTANT")
    key(clock_hand, w0 + 6, rot=screen_rot(math.radians(90)), interp="LINEAR")
    key(clock_hand, w0 + 62, rot=screen_rot(math.radians(-90)), interp="LINEAR")
    for i, seg in enumerate(clock_segs):
        show(seg, w0 + 6 + int(round(i * 56.0 / CLOCK_SEGS)), True)

    for i, puff in enumerate(steam):
        s = w0 + 2 + i * 7
        jx = (-0.03, 0.02, -0.01, 0.04, -0.04, 0.01)[i]
        dx = (-0.16, -0.10, -0.20, -0.07, -0.22, -0.13)[i]
        key(puff, s, loc=(CAP_C[0] + jx, LAY["steam"], CAP_C[1] + 0.06),
            scale=(0.0, 0.0, 0.0), interp="CONSTANT")
        key(puff, s + 5, scale=(1.0, 1.0, 1.0))
        key(puff, s + 26, loc=(CAP_C[0] + jx + dx, LAY["steam"], 1.15),
            scale=(1.30, 1.30, 1.30))
        key(puff, s + 27, scale=(0.0, 0.0, 0.0), interp="CONSTANT")

    key(hand, w0 + 10, loc=(1.32, 0, 0.58), rot=(0, 0, 0), interp="CONSTANT")
    key(hand, w0 + 11, loc=(1.32, 0, 0.58))
    # Close enough to be reaching, and stopped with clear daylight between
    # the fingertips and the filler: nothing in this clip ever touches that
    # cap, which is the whole of step 1.
    reach_to = (CAP_C[0] + 0.14 + HAND_REACH, 0, CAP_C[1] - 0.10)
    key(hand, w0 + 26, loc=reach_to)
    key(hand, w0 + 32, loc=reach_to)
    show(cap_no, w0 + 29, True)
    key(hand, w0 + 46, loc=(1.32, 0, 0.58))
    key(hand, w0 + 47, loc=(HAND_PARK[0], 0, HAND_PARK[1]), interp="CONSTANT")

    # The needle falls while the clock runs: the engine going cold is the only
    # thing the waiting is for, so it is the thing that changes on screen.
    key(needle, w0 + 8, rot=screen_rot(GAUGE_HOT))
    key(needle, w0 + 66, rot=screen_rot(GAUGE_COLD))

    # --- fork: air-cooled or liquid-cooled, and only one of them has a level.
    k0 = F["fork"]
    key(air_no, k0 + 8, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(air_no, k0 + 15, scale=(1.0, 1.0, 1.0))
    key(liq_tick, k0 + 22, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(liq_tick, k0 + 29, scale=(1.0, 1.0, 1.0))
    key(card_pick, k0 + 34, scale=(0.0, 1.0, 1.0), interp="CONSTANT")
    key(card_pick, k0 + 44, scale=(1.0, 1.0, 1.0))

    # --- level: the reservoir, not the radiator, and it is below the minimum.
    l0 = F["level"]
    show(insp_res, l0 + 10, False)
    key(insp_res, l0 + 10, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(insp_res, l0 + 18, scale=(1.0, 1.0, 1.0))
    show(res["marks"], l0 + 26, True)
    # The minimum mark turns amber when the clip has said the level is under
    # it: a pale tick and an amber tick is a smaller claim than a red cross.
    key_colour(mats["min"], 1, BG)
    key_colour(mats["min"], l0 + 40, YELLOW)

    # --- look: clear the core, then mark the fan and leave it sitting still.
    o0 = F["look"]
    show(cap_no, o0, False)          # hidden on the cut, so nothing is seen to go
    show(insp_res, o0, False)
    key(insp_face, o0 + 2, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(insp_face, o0 + 8, scale=(1.0, 1.0, 1.0))
    key(hand, o0 + 6, loc=(0.86, 0, 0.465), rot=(0, 0, 0), interp="CONSTANT")
    key(hand, o0 + 8, loc=(0.86, 0, 0.465))
    # The sweep stops at 0.14 rather than 0.02: the fingertips are past the
    # last blob by then, and going further only walks the hand off the left
    # edge of this framing, where half of it is a blue shape leaving frame.
    SWEEP_END = 0.14
    key(hand, o0 + 26, loc=(SWEEP_END, 0, 0.465))
    for i, blob in enumerate(grit):
        # Each blob goes as the fingertips reach its x, so the sweep is doing
        # the clearing rather than happening next to it.
        gx = blob.location[0]
        t = (0.86 - HAND_REACH - gx) / (0.86 - SWEEP_END)
        show(blob, o0 + 8 + int(round(18 * max(0.0, min(1.0, t)))), False)
    key(hand, o0 + 28, loc=(SWEEP_END, 0, 0.465))
    key(hand, o0 + 36, loc=(0.86, 0, 0.465))
    key(hand, o0 + 37, loc=(HAND_PARK[0], 0, HAND_PARK[1]), interp="CONSTANT")
    # Amber, not brand blue, and for two reasons. A packed core is a fault
    # found rather than a place to look, which is what amber means everywhere
    # else in this clip; and the hand sweeping it clean is brand blue, so a
    # blue ring and a blue glove met in the middle of the frame and merged
    # into one shape. It goes green when the core is clear.
    key_colour(mats["inspect_face"], 1, YELLOW)
    key_colour(mats["inspect_face"], o0 + 30, GREEN)
    show(insp_face, o0 + 38, False)
    key(insp_fan, o0 + 38, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(insp_fan, o0 + 43, scale=(1.0, 1.0, 1.0))
    key_colour(mats["inspect_fan"], 1, BRAND)
    key_colour(mats["inspect_fan"], o0 + 47, YELLOW)

    # --- top up: cap off, bottle in, level up between the two marks.
    t0 = F["topup"]
    show(insp_fan, t0, False)
    key(res["cap"], t0 + 2, loc=(RES_CAP_C[0], LAY["cap"], RES_CAP_C[1]),
        rot=(0, 0, 0))
    key(res["cap"], t0 + 10, loc=CAP_OFF, rot=(0, math.radians(-25), 0))
    key(bottle, t0 + 6, loc=(BOTTLE_IN[0], 0, BOTTLE_IN[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(bottle, t0 + 8, loc=(BOTTLE_IN[0], 0, BOTTLE_IN[1]), rot=(0, 0, 0))
    key(bottle, t0 + 20, loc=(POUR[0], 0, POUR[1]), rot=(0, POUR_TILT, 0))
    key(bottle, t0 + 40, loc=(POUR[0], 0, POUR[1]), rot=(0, POUR_TILT, 0))
    for i, drop in enumerate(drops):
        s = t0 + 21 + i * 5
        key(drop, s, loc=(POUR[0] - 0.01, LAY["bottle"] - 0.02, POUR[1] - 0.03),
            scale=(0.0, 0.0, 0.0), interp="CONSTANT")
        key(drop, s + 1, scale=(1.0, 1.0, 1.0), interp="CONSTANT")
        key(drop, s + 7, loc=(POUR[0] - 0.01, LAY["bottle"] - 0.02, LEVEL_OK + 0.02),
            interp="LINEAR")
        key(drop, s + 8, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(res["fluid"], t0 + 20, scale=(1.0, 1.0, LEVEL_LOW - RES_BOT))
    key(res["fluid"], t0 + 42, scale=(1.0, 1.0, LEVEL_OK - RES_BOT))
    key_colour(mats["min"], t0 + 42, BG)
    key(bottle, t0 + 46, loc=(BOTTLE_IN[0], 0, BOTTLE_IN[1]), rot=(0, 0, 0))
    key(bottle, t0 + 47, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), interp="CONSTANT")
    key(fill_tick, t0 + 42, scale=(0.0, 0.0, 0.0), interp="CONSTANT")
    key(fill_tick, t0 + 48, scale=(1.0, 1.0, 1.0))
    key(res["cap"], t0 + 44, loc=CAP_OFF, rot=(0, math.radians(-25), 0))
    key(res["cap"], t0 + 51, loc=(RES_CAP_C[0], LAY["cap"], RES_CAP_C[1]), rot=(0, 0, 0))

    # --- ride: moving, so there is air through the core, and the gauge is
    # watched the whole way. The road runs out from under the bike first, then
    # one hard cut and it is the bike that goes.
    r0 = F["ride"]
    show(fill_tick, r0, False)
    show(res["marks"], r0, False)
    show(clock, r0, False)
    # The dial is ringed for the rest of the clip, including the last wide,
    # because the instruction is to watch it the whole way and not until the
    # bike is rolling.
    key(insp_gauge, r0 + 4, scale=(0.0, 0.0, 0.0))
    key(insp_gauge, r0 + 10, scale=(1.0, 1.0, 1.0))
    key(dashes, r0, loc=(0, 0, 0), interp="LINEAR")
    rolled = []
    for f in range(r0, F_RIDE_OUT + 1, 3):
        t = (f - r0) / float(F_RIDE_OUT - r0 - 1)
        rolled.append((f, RIDE_ROLL * t * t))
    rolled.append((F_RIDE_OUT - 1, RIDE_ROLL))
    for f, d in rolled:
        key(dashes, f, loc=(-d, 0, 0), interp="LINEAR")
        for w in wheels:
            key(w, f, rot=(0, -d / WHEEL_R, 0), interp="LINEAR")

    # Two passes, twelve frames apart, which is exactly the length of one
    # pass: at ten frames apart the third pass was keying the same object
    # back to its start while the second was still in flight, and what
    # rendered was a chevron that jumped backwards and a second one stuck
    # half-size in open air. Both passes are also finished before the cut to
    # the wide, because these arrows are not parented to the bike and would
    # otherwise be left hanging in the road it has just left.
    for i, arrow in enumerate(airflow):
        for pass_no in range(2):
            s = r0 + 6 + pass_no * 12 + i * 4
            z = (0.645, 0.745)[i]
            key(arrow, s, loc=(1.16, 0, z), scale=(0.0, 0.0, 0.0), interp="CONSTANT")
            key(arrow, s + 2, scale=(1.0, 1.0, 1.0), interp="LINEAR")
            key(arrow, s + 11, loc=(RAD_C[0] + RAD_W / 2 + 0.03, 0, z),
                scale=(1.0, 1.0, 1.0), interp="LINEAR")
            key(arrow, s + 12, scale=(0.0, 0.0, 0.0), interp="CONSTANT")

    # The dash row is reset on the cut, where nothing can be seen to jump, so
    # the road is where it was when the bike starts moving through it instead.
    key(dashes, F_RIDE_OUT, loc=(0, 0, 0), interp="CONSTANT")
    away = []
    for f in range(F_RIDE_OUT, F_END + 1, 3):
        t = (f - F_RIDE_OUT) / float(F_END - F_RIDE_OUT)
        away.append((f, RIDE_AWAY * t))
    away.append((F_END, RIDE_AWAY))
    roll(bike, wheels, away, phi_base=RIDE_ROLL)


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
        "road": flat("Road", ROAD),
        "shade": flat("Shade", SHADE),
        "machine": flat("Machine", MACHINE),
        "dim": flat("Dim", DIM),
        "steel": flat("Steel", STEEL),
        "brand": flat("Brand", BRAND),
        "brand_deep": flat("BrandDeep", BRAND_DEEP),
        "yellow": flat("Yellow", YELLOW),
        "green": flat("Green", GREEN),
        "red": flat("Red", RED),
        # Keyed on their own, so each gets a material nothing else shares.
        "warn": flat("WarnDot", RED),
        "ign": flat("IgnDot", YELLOW),
        "min": flat("MinMark", BG),
        "inspect_face": flat("InspectFaceMat", YELLOW),
        "inspect_fan": flat("InspectFanMat", BRAND),
        "inspect_res": flat("InspectResMat", BRAND),
        "inspect_gauge": flat("InspectGaugeMat", BRAND),
    }

    dashes = build_road(mats)
    bike = build_bike(mats)
    fan, grit = build_radiator(mats, bike["root"])
    res = build_reservoir(mats, bike["root"])
    needle = build_cluster(mats, bike["root"])
    clock = build_clock(mats)
    cap_no = build_no_entry("CapNo", CAP_C, 0.075, mats)
    hand = build_hand(mats)
    bottle = build_bottle(mats)
    airflow = build_airflow(mats)
    card = build_card(mats)
    steam = build_steam(mats)
    exhaust = build_exhaust(mats)
    rings = build_rings(mats)
    fill_tick = build_fill_tick(mats)

    # Everything that hangs off the machine rides with it, so the one number
    # that moves the bike moves the annotations pinned to it as well.
    for obj in (clock[0], cap_no, *rings, fill_tick):
        obj.parent = bike["root"]

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = WIDE[1]
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

    animate({
        "bike": bike["root"], "wheels": bike["wheels"], "dashes": dashes,
        "needle": needle, "clock": clock, "cap_no": cap_no, "hand": hand,
        "steam": steam, "exhaust": exhaust, "fan": fan, "grit": grit,
        "res": res, "bottle": bottle,
        "card": card, "rings": rings, "fill_tick": fill_tick, "airflow": airflow,
    }, mats, cam)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "moto_overheat_%04d.png" % still)
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
        scene.render.filepath = OUT_MP4
        bpy.ops.render.render(animation=True)
        print("WROTE %s %d bytes (%.2f s)"
              % (OUT_MP4, os.path.getsize(OUT_MP4), F_END / float(FPS)))

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-overheating.blend"))
        print("WROTE blend")

    print("FRAMES %d DURATION %.2fs BEATS %s" % (F_END, F_END / float(FPS), F))
    return 0


if __name__ == "__main__":
    sys.exit(main())
