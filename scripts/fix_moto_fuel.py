"""Build and render the "out of fuel on a bike" diagram for moto-out-of-fuel.

Run:
    blender --background --factory-startup --python scripts/fix_moto_fuel.py -- --still 60
    blender --background --factory-startup --python scripts/fix_moto_fuel.py -- --render
    blender --background --factory-startup --python scripts/fix_moto_fuel.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/moto_fuel_NNNN.png, for framing
    --render     the whole thing to public/guides/fix-moto-fuel.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'moto-out-of-fuel' steps in src/lib/breakdown.ts, in their
order, because the app captions this clip with those steps and a picture that
drifts from the words printed under it is worse than no picture. The reserve
is the whole point of the guide and it gets the longest beat: the tap turns
from ON to RES, and the two standpipes inside the tank say why that is worth
knowing - the main pickup stands above what is left, the reserve pickup sits
on the floor under it.

Five places where the clip and the text are not a line-for-line match:

  - The clip opens on the `before` line, "get to the kerb side while you still
    have momentum": the bike coasts in and stops beside a kerb. The same
    licence scripts/fix_tyre.py takes when it opens on a chock.
  - Steps 1 and 2 are two different machines - a carburettor bike with a tap,
    and an injected one with a pump and no tap. The clip draws one bike and
    swaps its fuel system on the cut into step 2. Drawing two bikes would have
    halved the size each one gets on a phone screen.
  - Step 3 is "upright, not on the side stand", and a side elevation cannot
    show a lean at all. That beat cuts to a head-on elevation of the same
    machine, still orthographic and still flat. The tank is drawn in section
    with the tunnel the frame runs through, because that tunnel is the reason
    a leaning tank reads empty: the fuel all goes to the low lobe and the
    filler looks down onto a dry ridge. The amount of fuel does not change
    between the two framings - the surface height is solved for equal area,
    not chosen by eye, which is the one claim this beat is making.
  - Step 4 says push with your helmet on. Nobody is drawn: no faces, nothing
    identifiable. A helmet and a glove stand in for the rider, which is the
    same shorthand scripts/fix_chain.py uses for "by hand".
  - Step 5 says "after refuelling". The clip shows fuel going in at the filler
    and the level rising; it does not show a filling station.

Style is a diagram that moves, not a film: orthographic elevation, pure
emission materials and the Standard view transform, so every pixel is exactly
the hex it was given. Cuts between the five framings are hard, because a hard
cut costs no bitrate and this file ships inside an APK. Colours are the ones
scripts/fix_chain.py uses, so the two motorcycle clips are the same machine.

Written against Blender 5.2, and the things this repo learned the hard way all
apply: the engine id is 'BLENDER_EEVEE', image_settings.media_type has to be
VIDEO before FFMPEG can be assigned, the output path must be absolute or the
render lands next to the .blend, keyframe_new_interpolation_type does nothing
so interpolation is corrected after insertion, Action.fcurves is not where the
curves live on 5.2, and everything that moves gets an explicit frame-1 key.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

# ------------------------------------------------------------------ timeline
FPS = 24

# Each beat is one line of the guide, with its length in frames. Start frames
# are derived, so retiming one beat moves everything after it rather than
# silently overlapping the next.
BEATS = (
    ("coast", 44),      # before: get to the kerb side while you still roll
    ("reserve", 104),   # step 1: find the tap, turn it to RES
    ("injected", 70),   # step 2: no tap on an injected bike, just the light
    ("upright", 84),    # step 3: look in the tank upright, not on the stand
    ("push", 54),       # step 4: push on the kerb side, helmet on
    ("prime", 68),      # step 5: cycle the ignition to prime, then it fires
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# src/index.css, and the same slate ramp scripts/fix_chain.py drew its bike
# with, so a rider who has watched that clip is looking at the same machine.
BG = "#f1f5f9"           # the page
MACHINE = "#334155"      # slate-700: the bike itself
MACHINE_DIM = "#94a3b8"  # slate-400: rims, ground, things behind
STEEL = "#64748b"        # slate-500: the parts being aimed at
FUEL = "#d97706"         # amber-600: petrol, and the low-fuel light
BRAND = "#189edb"        # the blue in WAY
GREEN = "#007848"        # flag green: it runs
KERB = "#e2e8f0"         # the pavement in the foreground

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller y
# is nearer the lens, so this table is the draw order read top to bottom.
# Shapes of different colours never share a layer: two coplanar faces in EEVEE
# flicker against each other, and the cheapest fix is to never let them meet.
LAY = {
    "kerb": 0.10,       # the pavement, in front of the whole machine
    "glyph": 0.38,      # helmet, glove, pointer rings
    "sight": 0.42,      # the look-in-the-tank line
    "lamp": 0.46,
    "lever": 0.50,
    "case": 0.54,       # the instrument housing
    "tap": 0.58,
    "fill": 0.60,       # fuel inside a pipe, in front of the pipe
    "pipe": 0.62,       # standpipes, pump, fuel line
    "outline": 0.66,    # the tank wall in the head-on section
    "fluid": 0.70,      # fuel, wherever it is
    "hollow": 0.76,     # the inside of a tank, which is page colour
    "stage": 0.80,      # the head-on machine, and the side-on tank shell
    "mask": 0.86,       # what clips the head-on fuel to the tank
    "bike": 0.90,       # the side-on frame members
    "engine": 0.92,
    "wheel": 0.94,
    "fuelfront": 1.00,  # the head-on fuel body, behind its mask
    "ground": 1.20,
}
PLATE = 0.02  # thickness of every plate; layers are 0.02 apart at the closest

# ------------------------------------------------- the machine, side on (m)
# X runs rearward and the bike faces left, which is the view from its left -
# the side the tap and the stand are both on, so one elevation shows the job.
WHEEL_R = 0.300
REAR_C = (0.0, 0.0)
FRONT_AXLE = (-1.400, 0.0)
PIVOT_C = (-0.520, 0.020)          # swingarm pivot
HEAD = (-1.180, 0.560)
GROUND_Z = -WHEEL_R

TANK_C = (-0.840, 0.545)
TANK_W, TANK_H = 0.430, 0.190
WALL = 0.014
IN_W, IN_H = TANK_W - 2 * WALL, TANK_H - 2 * WALL
IN_Z0 = TANK_C[1] - IN_H / 2       # the tank floor, inside

# How much is left, as a depth above that floor. The first number is the point
# of the guide: not empty, just below the main pickup.
LEVEL_CARB = 0.040
LEVEL_FI = 0.012                   # the injected bike really is empty
LEVEL_FULL = 0.120

TAP_C = (-0.686, 0.436)
TAP_R = 0.030
PIPE_W = 0.018
PIPE_BOTTOM = 0.452
PIPE_TALL_X = -0.705               # ON: mouth above what is left
PIPE_SHORT_X = -0.667              # RES: mouth on the floor, under it
PIPE_TALL_TOP = 0.540
PIPE_SHORT_TOP = 0.480

# Three detents round the tap. ON and RES are at the two ends of the sweep so
# that turning one to the other never passes through OFF, which is how a tap
# with a sixty degree throw is actually arranged.
GLYPH_R = 0.132
LEVER_LEN = 0.034
LEVER_KNOB = 0.052
A_OFF = math.radians(205)
A_ON = math.radians(270)
A_RES = math.radians(320)

LINE_Z = 0.436                     # the fuel line out of the tap
LINE_X1 = -0.520                   # where it turns down for the carburettor
CARB_C = (-0.490, 0.312)
CARB_W, CARB_H = 0.110, 0.085

CLUSTER_C = (-1.090, 0.738)
CLUSTER_W, CLUSTER_H = 0.215, 0.082
LAMP_FUEL = (-1.158, 0.738)
LAMP_RUN = (-1.100, 0.738)
LAMP_R = 0.020
BARREL_C = (-1.035, 0.738)       # the key lives in the console, where most
BARREL_R = 0.026                 # of the bikes this guide is for keep it

STAND_PIVOT = (-0.660, 0.010)
STAND_FOLD = math.radians(-104)

KERB_TOP = GROUND_Z + 0.060        # a low kerb; it hides a sliver of tyre

ENTER_X = 0.60                     # where the bike coasts in from
PUSH_DX = -0.34                    # and how far it is pushed at the end

# ------------------------------------------- the same machine, head on (m)
# Parked far enough right that it can never wander into a side-on framing.
# Its own ground is its own: the head-on drawing is a schematic of the top
# half of the bike, not the side elevation turned ninety degrees.
STAGE_X = 6.00
STAGE_GZ = -0.120
LEAN = math.radians(-16)           # a side stand holds a bike about this far
                                   # over; negative leans it to the left
STAND_FOOT_X = -0.255              # where the foot meets the road, at lean

T2_LZ = 0.405                      # tank centre, measured up from the tyre
T2_IN_W, T2_IN_H = 0.340, 0.170    # the section inside the walls
T2_TUN_W, T2_TUN_H = 0.110, 0.055  # the tunnel the frame runs through
T2_WALL = 0.014
T2_NECK_W = 0.084                  # the filler, open: the cap is off to look
T2_NECK_H = 0.032
# What is left, as a height in the tank's own frame. It has to be below the
# tunnel roof, and that is the whole mechanism of this beat: with the fuel
# below the roof the two lobes are separate basins, so leaning empties one of
# them into the other. Were the fuel over the roof the tank would be one
# basin, and leaning a symmetric basin cannot change its depth at the centre
# at all - the first cut of this clip drew exactly that and said nothing.
T2_LEVEL = -0.043

WIDE = ((-0.78, 0.24), 2.60)
TAP_VIEW = ((-0.76, 0.450), 0.82)
LAMP_VIEW = ((-0.898, 0.600), 0.72)
FRONT_VIEW = ((STAGE_X, 0.185), 1.16)
PRIME_VIEW = ((-0.816 + PUSH_DX, 0.524), 0.94)

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

    Principled would work, but then every shape would also pick up the world
    and need its base colour zeroed. A bare Emission node cannot be lit by
    accident, which is the whole point of a diagram.
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
    """An axis-aligned rectangle facing the camera. loc is its centre.

    A positive Y rotation turns a shape clockwise on screen, so `spin` is the
    negative of the screen angle wanted. Everything angled goes through bar(),
    which does that conversion once and in one place.
    """
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
                                     major_segments=56, minor_segments=4)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


def triangle(name, r, loc, *, material=None, parent=None, spin=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    # Blender starts a circle's vertices at local +Y, which the quarter turn
    # about X carries round to world +Z: the point faces up unless spun.
    return put(o, loc=loc, rot=(math.pi / 2, spin, 0), material=material, parent=parent)


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

    The obvious route, preferences.edit.keyframe_new_interpolation_type, does
    nothing on this build: the preference reads back as set and the keyframe
    is still born BEZIER. Every hard cut in this clip depends on CONSTANT, so
    the keys are corrected after insertion instead.
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
    """In or out of the picture, by scale.

    Nothing is hidden by dimming it: an emission strength of zero is black,
    and a black shape on a near-white page is still a shape.
    """
    key(obj, frame, scale=(1.0, 1.0, 1.0) if on else (0.0, 0.0, 0.0), interp=interp)


# ------------------------------------------------------------------- ground
def build_ground(mats):
    """The pavement, in the foreground.

    The rider is on the kerb side of the road and the camera is standing on
    the kerb, so the kerb hides the bottom sliver of both tyres. That is the
    only thing a side elevation can honestly say about which side of the road
    the bike is on, and the app's caption says the rest.
    """
    plate("Pavement", 24.0, 3.0, (0, LAY["kerb"], KERB_TOP - 1.5),
          material=mats["kerb"])
    plate("KerbEdge", 24.0, 0.014, (0, LAY["kerb"] - 0.02, KERB_TOP),
          material=mats["dim"])


# --------------------------------------------------------- the machine, side
def build_wheel(name, centre, mats, parent):
    """A wheel that can be seen to turn. The spokes are the whole point: a
    plain disc rolls invisibly."""
    hub = empty(name, (centre[0], 0, centre[1]), parent=parent)
    ring(name + "Tyre", WHEEL_R - 0.034, 0.034, (0, LAY["wheel"], 0),
         material=mats["machine"], parent=hub)
    ring(name + "Rim", WHEEL_R - 0.080, 0.010, (0, LAY["wheel"], 0),
         material=mats["dim"], parent=hub)
    for i in range(5):
        a = i * 2 * math.pi / 5
        r0, r1 = 0.030, WHEEL_R - 0.080
        bar("%sSpoke%d" % (name, i),
            (math.cos(a) * r0, math.sin(a) * r0),
            (math.cos(a) * r1, math.sin(a) * r1),
            0.030, LAY["wheel"], mats["dim"], parent=hub)
    disc(name + "Hub", 0.044, (0, LAY["wheel"] - 0.004, 0),
         material=mats["machine"], parent=hub)
    return hub


def arc(name, centre, r, a0, a1, segs, w, y, material, parent):
    """A curved member, drawn as a few tangent bars. The front mudguard is
    the cheapest shape there is for stopping a two-wheeler reading as a
    bicycle, and it needs this."""
    for i in range(segs):
        t0 = a0 + (a1 - a0) * i / segs
        t1 = a0 + (a1 - a0) * (i + 1) / segs
        bar("%s%d" % (name, i),
            (centre[0] + r * math.cos(t0), centre[1] + r * math.sin(t0)),
            (centre[0] + r * math.cos(t1), centre[1] + r * math.sin(t1)),
            w, y, material, parent=parent)


def build_bike(mats):
    """The frame, the engine and the wheels.

    Enough machine that the opening shot is unmistakably a motorcycle - a
    dark engine mass low between fat tyres, a mudguard, a headlight - and
    nothing at all in the gap under the tank, which is where the tap and its
    three positions have to be legible a beat later.
    """
    root = empty("Bike", (0, 0, 0))

    plate("Engine", 0.460, 0.255, (-0.640, LAY["engine"], 0.137),
          material=mats["machine"], parent=root)
    plate("Cylinder", 0.150, 0.115, (-0.930, LAY["engine"], 0.342),
          material=mats["machine"], parent=root)
    bar("Silencer", (-0.330, 0.140), (0.090, 0.195), 0.058, LAY["bike"] - 0.01,
        mats["dim"], parent=root)
    bar("Swingarm", PIVOT_C, REAR_C, 0.028, LAY["bike"], mats["machine"], parent=root)
    bar("Shock", (-0.260, 0.010), (-0.370, 0.455), 0.018, LAY["bike"],
        mats["dim"], parent=root)
    bar("Subframe", (-0.600, 0.472), (-0.140, 0.452), 0.022, LAY["bike"],
        mats["machine"], parent=root)
    bar("Spine", HEAD, (-0.600, 0.480), 0.022, LAY["bike"], mats["machine"],
        parent=root)
    bar("DownTube", (-1.160, 0.520), (-0.960, 0.370), 0.020, LAY["bike"],
        mats["machine"], parent=root)
    plate("Seat", 0.430, 0.095, (-0.400, LAY["bike"] - 0.004, 0.512),
          material=mats["machine"], parent=root)
    plate("Tail", 0.200, 0.072, (-0.150, LAY["bike"] - 0.002, 0.500),
          material=mats["machine"], parent=root)
    bar("Fork", FRONT_AXLE, HEAD, 0.030, LAY["bike"], mats["machine"], parent=root)
    disc("Headlight", 0.075, (-1.272, LAY["bike"], 0.460),
         material=mats["machine"], parent=root)
    arc("Mudguard", FRONT_AXLE, 0.340, math.radians(52), math.radians(142), 5,
        0.026, LAY["bike"], mats["machine"], root)
    bar("Bars", (-1.260, 0.618), (-1.020, 0.665), 0.018, LAY["bike"],
        mats["machine"], parent=root)
    bar("ClusterStem", (-1.090, 0.640), (-1.090, 0.712), 0.020, LAY["bike"],
        mats["machine"], parent=root)

    rear = build_wheel("RearWheel", REAR_C, mats, root)
    front = build_wheel("FrontWheel", FRONT_AXLE, mats, root)

    # The tank is drawn in section the whole way through, because every beat
    # but one is about what is or is not inside it.
    plate("TankBody", TANK_W, TANK_H, (TANK_C[0], LAY["stage"], TANK_C[1]),
          material=mats["machine"], parent=root)
    plate("TankCap", 0.070, 0.020,
          (TANK_C[0], LAY["stage"], TANK_C[1] + TANK_H / 2 + 0.010),
          material=mats["machine"], parent=root)
    plate("TankHollow", IN_W, IN_H, (TANK_C[0], LAY["hollow"], TANK_C[1]),
          material=mats["bg"], parent=root)

    fuel_root = empty("FuelRoot", (TANK_C[0], 0, IN_Z0), parent=root)
    plate("Fuel", IN_W, 1.0, (0, LAY["fluid"], 0.5),
          material=mats["fuel"], parent=fuel_root)

    # What goes in at the filler when the bike is refuelled.
    pour = empty("Pour", (TANK_C[0], 0, TANK_C[1] + TANK_H / 2 + 0.020), parent=root)
    plate("PourStream", 0.020, 0.090, (0, LAY["fluid"], 0.045),
          material=mats["fuel"], parent=pour)

    stand = empty("Stand", (STAND_PIVOT[0], 0, STAND_PIVOT[1]), parent=root)
    bar("StandLeg", (0, 0), (-0.130, -0.310), 0.018, LAY["bike"],
        mats["machine"], parent=stand)
    plate("StandFoot", 0.070, 0.012, (-0.140, LAY["bike"], -0.316),
          material=mats["machine"], parent=stand, spin=math.radians(22))

    return dict(root=root, rear=rear, front=front, fuel=fuel_root,
                pour=pour, stand=stand)


def build_tap(mats, parent):
    """The petcock, its three detents, and the two pickups it chooses between.

    The glyph beside each detent is a small drawing of what that position
    does: a tall pipe, a short pipe, a capped one. No text appears anywhere in
    this clip, so the positions have to be readable as shapes - and a shape
    that is a picture of the mechanism is the only honest way to do that.
    """
    group = empty("TapGroup", parent=parent)

    plate("PipeTall", PIPE_W, PIPE_TALL_TOP - PIPE_BOTTOM,
          (PIPE_TALL_X, LAY["pipe"], (PIPE_TALL_TOP + PIPE_BOTTOM) / 2),
          material=mats["steel"], parent=group)
    plate("PipeTallMouth", 0.032, 0.008,
          (PIPE_TALL_X, LAY["pipe"] - 0.01, PIPE_TALL_TOP),
          material=mats["steel"], parent=group)
    plate("PipeShort", PIPE_W, PIPE_SHORT_TOP - PIPE_BOTTOM,
          (PIPE_SHORT_X, LAY["pipe"], (PIPE_SHORT_TOP + PIPE_BOTTOM) / 2),
          material=mats["pipe_short"], parent=group)
    plate("PipeShortMouth", 0.032, 0.008,
          (PIPE_SHORT_X, LAY["pipe"] - 0.01, PIPE_SHORT_TOP),
          material=mats["pipe_short"], parent=group)

    disc("TapBody", TAP_R, (TAP_C[0], LAY["tap"], TAP_C[1]),
         material=mats["steel"], parent=group)

    glyphs = empty("Glyphs", parent=group)
    for name, a, mat in (("Off", A_OFF, mats["g_off"]),
                         ("On", A_ON, mats["g_on"]),
                         ("Res", A_RES, mats["g_res"])):
        g = empty("Glyph" + name,
                  (TAP_C[0] + GLYPH_R * math.cos(a), 0,
                   TAP_C[1] + GLYPH_R * math.sin(a)),
                  parent=glyphs)
        # A common baseline under all three, so "tall" and "short" read as a
        # comparison rather than as two unrelated marks.
        plate("Base" + name, 0.054, 0.010, (0, LAY["tap"], -0.021),
              material=mat, parent=g)
        if name == "On":
            plate("StemOn", 0.018, 0.070, (0, LAY["tap"], 0.019),
                  material=mat, parent=g)
        elif name == "Res":
            plate("StemRes", 0.018, 0.032, (0, LAY["tap"], 0.000),
                  material=mat, parent=g)
        else:
            plate("StemOff", 0.018, 0.022, (0, LAY["tap"], -0.005),
                  material=mat, parent=g)
            plate("CapOff", 0.048, 0.010, (0, LAY["tap"], 0.013),
                  material=mat, parent=g)

    lever = empty("Lever", (TAP_C[0], 0, TAP_C[1]), parent=group)
    plate("LeverBar", LEVER_LEN, 0.016, (0.010 + LEVER_LEN / 2, LAY["lever"], 0),
          material=mats["machine"], parent=lever)
    disc("LeverKnob", 0.010, (LEVER_KNOB, LAY["lever"] - 0.01, 0),
         material=mats["steel"], parent=lever)

    return dict(group=group, lever=lever, glyphs=glyphs)


def build_pump(mats, parent):
    """What an injected bike has instead: a pump in the tank, and no choice."""
    group = empty("PumpGroup", parent=parent)
    plate("PumpBody", 0.062, 0.042, (TAP_C[0], LAY["pipe"], IN_Z0 + 0.023),
          material=mats["steel"], parent=group)
    plate("PumpStrainer", 0.044, 0.010, (TAP_C[0], LAY["pipe"] - 0.01, IN_Z0 + 0.005),
          material=mats["dim"], parent=group)
    plate("PumpDrop", 0.012, 0.046, (TAP_C[0], LAY["pipe"], IN_Z0 - 0.023),
          material=mats["steel"], parent=group)
    return group


def build_fuel_line(mats, parent):
    """Tap or pump, out to the engine, and the fuel that later fills it."""
    group = empty("LineGroup", parent=parent)
    run = abs(TAP_C[0] - LINE_X1)
    plate("LineFlat", run, 0.012, ((TAP_C[0] + LINE_X1) / 2, LAY["pipe"], LINE_Z),
          material=mats["steel"], parent=group)
    drop_h = LINE_Z - (CARB_C[1] + CARB_H / 2)
    plate("LineDrop", 0.012, drop_h, (LINE_X1, LAY["pipe"], LINE_Z - drop_h / 2),
          material=mats["steel"], parent=group)
    plate("Carb", CARB_W, CARB_H, (CARB_C[0], LAY["pipe"], CARB_C[1]),
          material=mats["steel"], parent=group)

    flat_fill = empty("FlatFill", (TAP_C[0], 0, LINE_Z), parent=group)
    plate("FlatFillBar", run, 0.007, (run / 2, LAY["fill"], 0),
          material=mats["fuel"], parent=flat_fill)
    drop_fill = empty("DropFill", (LINE_X1, 0, LINE_Z), parent=group)
    plate("DropFillBar", 0.007, drop_h, (0, LAY["fill"], -drop_h / 2),
          material=mats["fuel"], parent=drop_fill)
    bowl = empty("Bowl", (CARB_C[0], 0, CARB_C[1] - CARB_H / 2 + 0.008), parent=group)
    plate("BowlFill", CARB_W - 0.030, 0.050, (0, LAY["fill"], 0.025),
          material=mats["fuel"], parent=bowl)

    return dict(group=group, flat=flat_fill, drop=drop_fill, bowl=bowl)


def build_cluster(mats, parent):
    """Two lamps and an ignition barrel. This is how "the light has been on"
    and "cycle the ignition" get said without a word of text."""
    plate("ClusterCase", CLUSTER_W, CLUSTER_H,
          (CLUSTER_C[0], LAY["case"], CLUSTER_C[1]),
          material=mats["dim"], parent=parent)
    disc("LampFuel", LAMP_R, (LAMP_FUEL[0], LAY["lamp"], LAMP_FUEL[1]),
         material=mats["lamp_fuel"], parent=parent)
    disc("LampRun", LAMP_R, (LAMP_RUN[0], LAY["lamp"], LAMP_RUN[1]),
         material=mats["lamp_run"], parent=parent)

    disc("Barrel", BARREL_R, (BARREL_C[0], LAY["case"], BARREL_C[1]),
         material=mats["steel"], parent=parent)
    slot = empty("BarrelSlot", (BARREL_C[0], 0, BARREL_C[1]), parent=parent)
    plate("SlotBar", 0.032, 0.009, (0, LAY["lamp"], 0),
          material=mats["machine"], parent=slot)

    ring_lamp = empty("RingLampRoot", (LAMP_FUEL[0], 0, LAMP_FUEL[1]), parent=parent)
    ring("RingLamp", 0.032, 0.005, (0, LAY["glyph"], 0),
         material=mats["brand"], parent=ring_lamp)
    ring_key = empty("RingKeyRoot", (BARREL_C[0], 0, BARREL_C[1]), parent=parent)
    ring("RingKey", 0.040, 0.005, (0, LAY["glyph"], 0),
         material=mats["brand"], parent=ring_key)

    return dict(slot=slot, ring_lamp=ring_lamp, ring_key=ring_key)


def build_rider(mats, parent):
    """A helmet and a glove. Nobody is drawn: no faces, nothing identifiable,
    and a whole figure would be the largest thing in a clip about a tap."""
    helmet = empty("Helmet", (-1.330, 0, 0.858), parent=parent)
    disc("HelmetShell", 0.086, (0, LAY["glyph"], 0),
         material=mats["machine"], parent=helmet)
    plate("HelmetChin", 0.098, 0.050, (-0.052, LAY["glyph"], -0.044),
          material=mats["machine"], parent=helmet, spin=math.radians(-12))
    plate("HelmetVisor", 0.100, 0.034, (-0.030, LAY["glyph"] - 0.02, 0.016),
          material=mats["brand"], parent=helmet)

    glove = empty("Glove", (-1.248, 0, 0.614), parent=parent)
    disc("GlovePalm", 0.040, (0, LAY["glyph"], 0),
         material=mats["brand"], parent=glove)
    plate("GloveCuff", 0.032, 0.070, (0.034, LAY["glyph"], 0.014),
          material=mats["brand"], parent=glove, spin=math.radians(-14))

    return dict(helmet=helmet, glove=glove)


# ----------------------------------------------------- the machine, head on
def _tank_samples():
    """Points evenly covering the inside of the sectioned tank.

    Local to the tank centre, tunnel excluded. Used to solve for a fuel
    surface at equal area, which is the one claim the lean beat makes.
    """
    pts = []
    nx, nz = 170, 90
    for i in range(nx):
        x = -T2_IN_W / 2 + (i + 0.5) * T2_IN_W / nx
        for j in range(nz):
            z = -T2_IN_H / 2 + (j + 0.5) * T2_IN_H / nz
            if abs(x) < T2_TUN_W / 2 and z < -T2_IN_H / 2 + T2_TUN_H:
                continue
            pts.append((x, z))
    return pts


def _surface(theta, fraction, pts):
    """The world height of a horizontal fuel surface with `fraction` of the
    tank's section below it, when the bike is leaned by theta.

    A Y rotation of theta about the tyre's contact patch sends a stage-local
    point (x, z) to z' = -x sin(theta) + z cos(theta). Sorting the samples by
    that height and cutting at the fraction is the same thing as conserving
    area, without a bisection to get wrong.
    """
    s, c = math.sin(theta), math.cos(theta)
    vals = sorted(STAGE_GZ + (-x * s + (T2_LZ + z) * c) for x, z in pts)
    k = int(round(fraction * len(vals)))
    return vals[min(max(k, 1), len(vals)) - 1]


def fuel_surfaces():
    """Where the surface sits upright and at full lean, for the same fuel."""
    pts = _tank_samples()
    frac = sum(1 for _, z in pts if z <= T2_LEVEL) / float(len(pts))
    return _surface(0.0, frac, pts), _surface(LEAN, frac, pts), frac


def build_front_stage(mats):
    """The same bike seen head on, so a lean can be drawn at all.

    Everything but the fuel hangs off a pivot at the tyre's contact patch,
    which is what a bike actually leans about. The fuel is a plain rectangle
    in world space with its top edge at the surface height: the tank shape is
    cut out of it by page-coloured masks that lean with the machine, so fuel
    can only ever be seen where there is tank to hold it. No handlebars - from
    behind they would sit exactly where the line of sight into the filler is,
    and the filler is what this beat is about.
    """
    lean = empty("Lean", (STAGE_X, 0, STAGE_GZ))
    s = LAY["stage"]
    t_z = T2_LZ

    plate("StageGround", 2.6, 0.012, (STAGE_X, s + 0.02, STAGE_GZ - 0.006),
          material=mats["dim"])

    plate("StageBlock", 0.230, 0.110, (0, s + 0.02, 0.120),
          material=mats["dim"], parent=lean)
    plate("StageTyre", 0.120, 0.170, (0, s - 0.01, 0.085),
          material=mats["machine"], parent=lean)
    for i, x in enumerate((-0.180, 0.180)):
        plate("StagePeg%d" % i, 0.075, 0.018, (x, s, 0.115),
              material=mats["machine"], parent=lean)
    plate("StageGuard", 0.200, 0.075, (0, s, 0.2075),
          material=mats["machine"], parent=lean)
    plate("StageTail", 0.265, 0.065, (0, s, 0.2775),
          material=mats["machine"], parent=lean)

    # The tank, in section: walls, floor either side of the tunnel the frame
    # runs through, roof either side of the open filler.
    t_out_w = T2_IN_W + 2 * T2_WALL
    plate("T2Left", T2_WALL, T2_IN_H + 2 * T2_WALL,
          (-(T2_IN_W + T2_WALL) / 2, LAY["outline"], t_z),
          material=mats["machine"], parent=lean)
    plate("T2Right", T2_WALL, T2_IN_H + 2 * T2_WALL,
          ((T2_IN_W + T2_WALL) / 2, LAY["outline"], t_z),
          material=mats["machine"], parent=lean)
    floor_w = (t_out_w - T2_TUN_W) / 2
    roof_w = (t_out_w - T2_NECK_W) / 2
    for i, sign in enumerate((-1, 1)):
        plate("T2Floor%d" % i, floor_w, T2_WALL,
              (sign * (T2_TUN_W + floor_w) / 2, LAY["outline"],
               t_z - (T2_IN_H + T2_WALL) / 2),
              material=mats["machine"], parent=lean)
        plate("T2Roof%d" % i, roof_w, T2_WALL,
              (sign * (T2_NECK_W + roof_w) / 2, LAY["outline"],
               t_z + (T2_IN_H + T2_WALL) / 2),
              material=mats["machine"], parent=lean)
        plate("T2TunWall%d" % i, T2_WALL, T2_TUN_H,
              (sign * (T2_TUN_W + T2_WALL) / 2, LAY["outline"],
               t_z - T2_IN_H / 2 + T2_TUN_H / 2),
              material=mats["machine"], parent=lean)
        plate("T2Neck%d" % i, T2_WALL, T2_NECK_H,
              (sign * (T2_NECK_W + T2_WALL) / 2, LAY["outline"],
               t_z + T2_IN_H / 2 + T2_WALL + T2_NECK_H / 2),
              material=mats["machine"], parent=lean)
    plate("T2TunRoof", T2_TUN_W + 2 * T2_WALL, T2_WALL,
          (0, LAY["outline"], t_z - T2_IN_H / 2 + T2_TUN_H + T2_WALL / 2),
          material=mats["machine"], parent=lean)

    # The stand, placed so its foot is exactly on the road at full lean: the
    # local position is the world one turned back through the lean.
    c, sn = math.cos(-LEAN), math.sin(-LEAN)
    foot = (STAND_FOOT_X * c, -STAND_FOOT_X * sn)
    bar("StandArm", (-0.055, 0.145), foot, 0.015, s, mats["machine"], parent=lean)
    plate("StandPad", 0.060, 0.012, (foot[0], s, foot[1] + 0.006),
          material=mats["machine"], parent=lean)

    # Masks: page colour, leaning with the tank, clipping the fuel to it.
    half = T2_IN_W / 2
    plate("MaskLeft", 0.80, 1.20, (-half - 0.40, LAY["mask"], t_z),
          material=mats["bg"], parent=lean)
    plate("MaskRight", 0.80, 1.20, (half + 0.40, LAY["mask"], t_z),
          material=mats["bg"], parent=lean)
    plate("MaskBelow", 1.80, 0.80, (0, LAY["mask"], t_z - T2_IN_H / 2 - 0.40),
          material=mats["bg"], parent=lean)
    plate("MaskAbove", 1.80, 0.80, (0, LAY["mask"], t_z + T2_IN_H / 2 + 0.40),
          material=mats["bg"], parent=lean)
    plate("MaskTunnel", T2_TUN_W, T2_TUN_H + 0.024,
          (0, LAY["mask"] - 0.01, t_z - T2_IN_H / 2 + T2_TUN_H / 2 - 0.012),
          material=mats["machine"], parent=lean)

    fuel = plate("FrontFuel", 0.72, 0.60, (STAGE_X, LAY["fuelfront"], 0.0),
                 material=mats["fuel"])

    # What looking in actually shows: not one line straight down, but the
    # two lobes either side of the tunnel. Both of them lean with the filler,
    # because looking into a leaning tank is looking down a leaning neck.
    sight = empty("Sight", parent=lean)
    triangle("SightTip", 0.020, (0, LAY["sight"], 0.578),
             material=mats["brand"], parent=sight, spin=math.pi)
    for side in (-1, 1):
        p0 = (0.0, 0.545)
        p1 = (side * 0.100, 0.380)
        for i in range(4):
            u0 = (i * 2 + 0.0) / 7.0
            u1 = (i * 2 + 1.0) / 7.0
            bar("SightDash%d_%d" % (side + 1, i),
                (p0[0] + (p1[0] - p0[0]) * u0, p0[1] + (p1[1] - p0[1]) * u0),
                (p0[0] + (p1[0] - p0[0]) * u1, p0[1] + (p1[1] - p0[1]) * u1),
                0.012, LAY["sight"], mats["brand"], parent=sight)

    return dict(lean=lean, fuel=fuel, sight=sight)


# ---------------------------------------------------------------- animation
def animate(rig, tap, pump, line, cluster, rider, stage, cam, mats, surf):
    root = rig["root"]
    up_z, lean_z, _frac = surf

    # --- camera: five framings, hard cuts, nothing in between.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -8.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["reserve"], TAP_VIEW)
    frame_at(F["injected"] + 24, LAMP_VIEW)
    frame_at(F["upright"], FRONT_VIEW)
    frame_at(F["push"], WIDE)
    frame_at(F["prime"], PRIME_VIEW)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(rig["fuel"], 1, scale=(1, 1, LEVEL_CARB), interp="CONSTANT")
    key(tap["lever"], 1, rot=(0, -A_ON, 0), interp="CONSTANT")
    show(tap["group"], 1, True)
    show(tap["glyphs"], 1, False)
    show(pump, 1, False)
    show(line["flat"], 1, False)
    show(line["drop"], 1, False)
    show(line["bowl"], 1, False)
    show(rig["pour"], 1, False)
    show(cluster["ring_lamp"], 1, False)
    show(cluster["ring_key"], 1, False)
    show(rider["helmet"], 1, False)
    show(rider["glove"], 1, False)
    show(stage["sight"], 1, False)
    key(cluster["slot"], 1, rot=(0, 0, 0), interp="CONSTANT")
    key(stage["lean"], 1, rot=(0, LEAN, 0), interp="CONSTANT")
    key(stage["fuel"], 1, loc=(STAGE_X, LAY["fuelfront"], lean_z - 0.30),
        interp="CONSTANT")
    key_colour(mats["g_on"], 1, BRAND)
    key_colour(mats["g_res"], 1, MACHINE_DIM)
    key_colour(mats["g_off"], 1, MACHINE_DIM)
    key_colour(mats["pipe_short"], 1, STEEL)
    # It ran out before the clip started, so the low-fuel lamp is already lit.
    key_colour(mats["lamp_fuel"], 1, FUEL)
    key_colour(mats["lamp_run"], 1, STEEL)

    # --- coast: in on the last of its momentum, slowing to a stop at the
    # kerb. Keyed as samples of an ease-out rather than as one bezier pair,
    # because a bezier between two keys would have it creep away from the
    # right edge before it had moved at all.
    for i in range(6):
        u = i / 5.0
        f = 1 + int(round(u * 34))
        x = ENTER_X * (1.0 - u) ** 2
        key(root, f, loc=(x, 0, 0), interp="LINEAR")
        for w in (rig["rear"], rig["front"]):
            # Rolling forwards is leftwards here, and a wheel that rolls to
            # x turns by x / r. One expression for both wheels, so they can
            # never drift out of step with the ground or each other.
            key(w, f, rot=(0, x / WHEEL_R, 0), interp="LINEAR")
    key(rig["stand"], 1, rot=(0, STAND_FOLD, 0))
    key(rig["stand"], F["coast"] - 22, rot=(0, STAND_FOLD, 0))
    key(rig["stand"], F["coast"] - 6, rot=(0, 0, 0))

    # --- reserve: the tap, and what the two pickups are for. The level sits
    # above the short pipe's mouth and below the tall one's, which is the
    # whole of why a reserve exists.
    s = F["reserve"]
    show(tap["glyphs"], s + 4, True)
    key(tap["lever"], s + 16, rot=(0, -A_ON, 0))
    key(tap["lever"], s + 34, rot=(0, -A_RES, 0))
    key_colour(mats["g_on"], s + 34, MACHINE_DIM)
    key_colour(mats["g_res"], s + 34, BRAND)
    # The pickup now in use takes the same blue as the position that chose
    # it. Painting it fuel colour, as the first cut did, made it disappear
    # into the fuel it is standing in.
    key_colour(mats["pipe_short"], s + 40, BRAND)

    key(line["flat"], s + 44, scale=(0, 1, 1), interp="LINEAR")
    key(line["flat"], s + 62, scale=(1, 1, 1), interp="LINEAR")
    key(line["drop"], s + 62, scale=(1, 1, 0), interp="LINEAR")
    key(line["drop"], s + 74, scale=(1, 1, 1), interp="LINEAR")
    key(line["bowl"], s + 74, scale=(1, 1, 0), interp="LINEAR")
    key(line["bowl"], s + 88, scale=(1, 1, 1), interp="LINEAR")

    # --- injected: the other kind of bike, swapped in on the cut. No tap at
    # all, a pump in the tank, and a tank that really is empty.
    s = F["injected"]
    show(tap["group"], s, False)
    show(pump, s, True)
    show(line["flat"], s, False)
    show(line["drop"], s, False)
    show(line["bowl"], s, False)
    key(rig["fuel"], s, scale=(1, 1, LEVEL_FI), interp="CONSTANT")
    key_colour(mats["pipe_short"], s, STEEL)

    # The lamp has been on a long time, so it is steady, not blinking. The
    # ring is what says "this one", and it breathes rather than flashes.
    show(cluster["ring_lamp"], s + 26, True)
    for i in range(3):
        key(cluster["ring_lamp"], s + 30 + i * 12, scale=(1.0, 1.0, 1.0))
        key(cluster["ring_lamp"], s + 36 + i * 12, scale=(1.12, 1.0, 1.12))
    key(cluster["ring_lamp"], s + 66, scale=(1.0, 1.0, 1.0))

    # --- upright: on the stand the fuel is all in one lobe and the filler
    # looks down on a dry ridge; held upright the same fuel lies across both.
    s = F["upright"]
    show(cluster["ring_lamp"], s, False)
    show(stage["sight"], s + 8, True)
    key(stage["lean"], s + 26, rot=(0, LEAN, 0))
    key(stage["lean"], s + 58, rot=(0, 0, 0))
    key(stage["fuel"], s + 26, loc=(STAGE_X, LAY["fuelfront"], lean_z - 0.30))
    key(stage["fuel"], s + 58, loc=(STAGE_X, LAY["fuelfront"], up_z - 0.30))

    # --- push: stand up, helmet on, hand on the bar, and away on foot.
    s = F["push"]
    show(stage["sight"], s, False)
    key(rig["stand"], s + 2, rot=(0, 0, 0))
    key(rig["stand"], s + 14, rot=(0, STAND_FOLD, 0))
    show(rider["helmet"], s + 6, True)
    show(rider["glove"], s + 6, True)
    for i in range(5):
        u = i / 4.0
        f = s + 10 + int(round(u * 38))
        x = PUSH_DX * ease(u)
        key(root, f, loc=(x, 0, 0), interp="LINEAR")
        for w in (rig["rear"], rig["front"]):
            key(w, f, rot=(0, x / WHEEL_R, 0), interp="LINEAR")

    # --- prime: fuel in, light out, ignition cycled, and it fires.
    s = F["prime"]
    show(rider["helmet"], s, False)
    show(rider["glove"], s, False)
    show(rig["pour"], s + 2, True)
    key(rig["fuel"], s + 2, scale=(1, 1, LEVEL_FI), interp="LINEAR")
    key(rig["fuel"], s + 18, scale=(1, 1, LEVEL_FULL), interp="LINEAR")
    show(rig["pour"], s + 19, False)
    key_colour(mats["lamp_fuel"], s + 20, STEEL)

    show(cluster["ring_key"], s + 22, True)
    # Two full turns of the key, with the pump pushing fuel up to the engine
    # on each one: that priming is the only reason the step exists.
    for i in range(2):
        a = s + 24 + i * 12
        key(cluster["slot"], a, rot=(0, 0, 0), interp="LINEAR")
        key(cluster["slot"], a + 6, rot=(0, math.radians(-90), 0), interp="LINEAR")
        key(cluster["slot"], a + 12, rot=(0, 0, 0), interp="LINEAR")
        key(line["flat"], a + 2, scale=(0, 1, 1), interp="LINEAR")
        key(line["flat"], a + 8, scale=(1, 1, 1), interp="LINEAR")
        key(line["drop"], a + 4, scale=(1, 1, 0), interp="LINEAR")
        key(line["drop"], a + 10, scale=(1, 1, 1), interp="LINEAR")
        if i == 0:
            key(line["flat"], a + 11, scale=(0, 1, 1), interp="CONSTANT")
            key(line["drop"], a + 11, scale=(1, 1, 0), interp="CONSTANT")
    key(cluster["slot"], s + 48, rot=(0, 0, 0), interp="LINEAR")
    key(cluster["slot"], s + 54, rot=(0, math.radians(-90), 0), interp="LINEAR")
    key(line["bowl"], s + 48, scale=(1, 1, 0), interp="LINEAR")
    key(line["bowl"], s + 58, scale=(1, 1, 1), interp="LINEAR")
    key_colour(mats["lamp_run"], s + 58, GREEN)
    show(cluster["ring_key"], s + 60, False)


# ------------------------------------------------------------------- render
def setup_render(scene, *, samples=16):
    scene.render.engine = "BLENDER_EEVEE"   # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, F_END
    scene.eevee.taa_render_samples = samples
    # Nothing is lit and every surface is emission, so shadows and raytracing
    # have nothing to add but render time.
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

    # Anything whose colour is keyed gets a material of its own, so one key
    # can never reach across and repaint something it was not aimed at.
    mats = {
        "bg": flat("Bg", BG),
        "machine": flat("Machine", MACHINE),
        "dim": flat("MachineDim", MACHINE_DIM),
        "steel": flat("Steel", STEEL),
        "fuel": flat("Fuel", FUEL),
        "brand": flat("Brand", BRAND),
        "kerb": flat("Kerb", KERB),
        "lamp_fuel": flat("LampFuelMat", FUEL),
        "lamp_run": flat("LampRunMat", STEEL),
        "pipe_short": flat("PipeShortMat", STEEL),
        "g_off": flat("GlyphOff", MACHINE_DIM),
        "g_on": flat("GlyphOn", BRAND),
        "g_res": flat("GlyphRes", MACHINE_DIM),
    }

    build_ground(mats)
    rig = build_bike(mats)
    tap = build_tap(mats, rig["root"])
    pump = build_pump(mats, rig["root"])
    line = build_fuel_line(mats, rig["root"])
    cluster = build_cluster(mats, rig["root"])
    rider = build_rider(mats, rig["root"])
    stage = build_front_stage(mats)
    surf = fuel_surfaces()

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = WIDE[1]
    cam_data.clip_start = 0.1
    cam_data.clip_end = 40.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.pi / 2, 0, 0))
    scene.camera = cam

    world = bpy.data.worlds.new("Paper")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = rgba(BG)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    animate(rig, tap, pump, line, cluster, rider, stage, cam, mats, surf)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "moto_fuel_%04d.png" % still)
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
        out = os.path.join(OUT_DIR, "fix-moto-fuel.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print("WROTE %s %d bytes (%.2f s)"
              % (out, os.path.getsize(out), F_END / float(FPS)))

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-fuel.blend"))
        print("WROTE blend")

    print("FRAMES %d DURATION %.2fs BEATS %s" % (F_END, F_END / FPS, F))
    print("FUEL upright %.4f leaned %.4f fill %.3f" % (surf[0], surf[1], surf[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
