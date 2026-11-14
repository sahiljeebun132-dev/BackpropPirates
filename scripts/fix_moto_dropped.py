"""Build and render the "you dropped it" checklist diagram for moto-dropped.

Run:
    blender --background --factory-startup --python scripts/fix_moto_dropped.py -- --still 60
    blender --background --factory-startup --python scripts/fix_moto_dropped.py -- --render
    blender --background --factory-startup --python scripts/fix_moto_dropped.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/dropped_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-moto-dropped.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'moto-dropped' steps in src/lib/breakdown.ts, in their
order, because the app prints those steps under this clip: a picture that
drifts from the words beside it is worse than no picture. In order they are
pick the bike up, levers, brakes, lights, wheels and chain, drips.

Four places where the clip and the text are not a line-for-line match, all
deliberate, and in each case the text is the one to follow:

  - Step one is "pick the bike up with your back straight, facing away from
    it, pushing with your legs". There is no figure anywhere in this file, so
    the technique cannot be drawn; the beat shows the bike coming upright and
    the step's own caution instead, the fuel tap going off before it is
    righted. The caption carries the rest, which is where the instruction
    that matters actually lives.
  - The guide's `before` list is about the rider, not the machine: check
    yourself first, ambulance 114 if anyone is hurt. Nothing there is
    drawable without a person on screen, so none of it is drawn.
  - Step five is "wheels and chain", and the chain is on the left of a bike
    while the front brake lever and the rear brake pedal, which steps two and
    three both name, are on the right. One side elevation cannot show both.
    This clip stands on the right, so the beat shows what that step actually
    instructs - rolling it forward a few metres and listening - and the chain
    is on the far side, unseen.
  - Step four asks for the brake light. There is no red in the brand palette
    and inventing one would put a colour on screen that is in no other part
    of the app, so the brake light is drawn as the tail lamp growing and
    switching to the brand yellow: brighter, which is the thing being
    checked.

The fall itself is not a cheat. Everything here is a flat shape in the plane
Y=0 seen down an orthographic axis, and a bike rolling about its own
longitudinal axis projects onto that view as nothing but a vertical squash
about the tyre contact line: a point at height z comes back at z*cos(theta).
So the whole machine hangs off one empty whose Z scale is animated, and the
bike going over and coming back up is exactly right rather than merely
suggestive. The wheels turning into thin ellipses is the same maths, free.

Style is the house one: a diagram that moves, not a film. Orthographic side
elevation, pure emission materials, the Standard view transform, so every
pixel is exactly the hex it was given. Cuts between the four framings are
hard, because a hard cut costs no bitrate and this file ships in an APK.

Written against Blender 5.2, and the things scripts/fix_tyre.py and
scripts/fix_chain.py learned the hard way all apply: the engine id is
'BLENDER_EEVEE', image_settings.media_type has to be VIDEO before FFMPEG can
be assigned, the output path must be absolute or the render lands next to the
.blend, keyframe_new_interpolation_type does nothing on this build so the
interpolation is corrected on the keyframe points after insertion, and
Action.fcurves is empty for some IDs so the curves are fetched through the
slotted action's layers.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

# ------------------------------------------------------------------ timeline
FPS = 24

# One beat per written step, with its length in frames. Start frames are
# derived, so retiming one beat pushes the rest along instead of quietly
# overlapping the next.
BEATS = (
    ("lift", 78),     # pick it up - fuel tap off first, then upright
    ("levers", 54),   # clutch and front brake levers: snapped, or bent
    ("brakes", 60),   # front lever pulled, rear pedal pressed
    ("lights", 78),   # front, rear, brake light, both indicators
    ("roll", 74),     # roll it forward a few metres and listen
    ("drips", 76),    # look underneath for petrol, oil, coolant
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# The values in src/index.css, same set fix_tyre.py defines, so the three
# clips and the app all agree. Nothing outside this list appears on screen.
BG = "#f1f5f9"
INK = "#15181f"
INK_SOFT = "#1e2430"
TEXT = "#0f172a"
BRAND = "#189edb"
YELLOW = "#f0c000"
GREEN = "#007848"
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"
STUD_GREY = "#64748b"

# -------------------------------------------------------------------- layers
# Every shape is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "arrow": -0.30,
    "lever": -0.24,
    "lamp": -0.18,
    "stalk": -0.14,
    "pipe": -0.11,
    # Fork legs, swingarm and mudguard sit outboard of the wheels on a real
    # machine, so here they sit nearer the lens than any part of one.
    "limb": -0.085,
    "wheel": -0.04,   # the tyre; the rest of the wheel steps forward of it
    "mass": 0.02,
    "frame": 0.06,
    "band": 0.14,
    "road": 0.30,
}
# Thin enough that the closest pair of layers, 0.008 apart inside a wheel,
# still cannot interpenetrate and z-fight.
PLATE = 0.004

# ------------------------------------------------------------------ geometry
# Metres, side elevation, standing on the right of the bike - the side the
# front brake lever and the rear brake pedal are both on, which is what two
# of the six steps are about. The front of the bike is therefore to the right
# of frame. X runs forward, Z up, and the diagram plane is Y=0.
WHEEL_R = 0.30
GROUND_Z = -WHEEL_R
REAR_AXLE = (0.00, 0.00)
FRONT_AXLE = (1.40, 0.00)

HEAD = (1.160, 0.540)        # steering head
PIVOT = (0.460, -0.020)      # swingarm pivot
BAR_BACK = (1.020, 0.655)
BAR_FRONT = (1.220, 0.600)
GUARD_R = 0.330              # the front mudguard, hugging the tyre

# The two lever blades hang off perches at the front of the bar. The upper
# one is the front brake, the lower the clutch on the other side of the bike.
# In a true side elevation they would be all but on top of each other, so
# they are pulled apart far enough to be counted - the step says levers,
# plural, and a single blade would be drawing the wrong instruction. The
# brake is the upper of the two so that pulling it swings away from the
# clutch rather than straight through it.
LEVER_PERCH = (1.214, 0.620)
LEVER_TIP = (0.178, -0.028)        # local to the perch
CLUTCH_PERCH = (1.218, 0.582)
CLUTCH_TIP = (0.155, -0.040)
LEVER_PULL = -0.40                 # radians, blade tip up toward the grip
LEVER_SLIDE = -0.035               # and back along the bar: a squeeze
LEVER_WIGGLE = 0.085

PEG = (0.400, 0.000)
PEDAL_TIP = (0.235, 0.018)         # local to the peg
PEDAL_PRESS = 0.26                 # radians, tip down

HEADLAMP = (1.320, 0.445)
HEADLAMP_R = 0.082
TAILLAMP = (0.070, 0.520)
TAILLAMP_R = 0.042
IND_FRONT = (1.448, 0.390)
IND_REAR = (0.030, 0.395)
IND_R = 0.028

# The bike lying down. 76 degrees off vertical: a machine on its side is not
# quite flat, but anything less than this reads in a still frame as a low
# bike rather than a fallen one.
DOWN_ANGLE = math.radians(76)
DOWN_SCALE = math.cos(DOWN_ANGLE)

TAP = (0.645, 0.350)               # the petcock, under the back of the tank
TAP_R = 0.042

# The lift arrow stands over the tail, which is the lowest part of the back
# of the machine and so the one place it can rise without leaving the frame.
ARROW_X = 0.160
ARROW_BASE = 0.600

# Roll it forward a few metres. Schematic metres: just under one, which is
# three full turns of the wheel and reads as a walk rather than a nudge.
ROLL_TURN = 3.10
ROLL_KEYS = 16

BAND_W = 0.240                     # the strip of road being looked at
BAND_X0 = 0.050
BAND_X1 = 1.150
BAND_Z = GROUND_Z + 0.018

# The four framings. ((x, z), ortho_scale).
WIDE = ((0.70, 0.20), 2.50)
BARS = ((1.28, 0.575), 0.95)
PEG_VIEW = ((0.55, 0.02), 1.50)
UNDER = ((0.58, 0.05), 1.45)

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
    of a diagram: there is nothing in the scene that could tint it.
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
    """A rectangle facing the camera. loc is its centre, w and h its full size."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(0, spin, 0), scale=(w, PLATE, h),
               material=material, parent=parent)


def bar(name, p0, p1, w, y, *, material=None, parent=None):
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


def arc_band(name, centre, r_in, r_out, a0, a1, y, *,
             material=None, parent=None, steps=40):
    """An annular sector facing the camera, built as one mesh.

    A run of chord-shaped plates laid end to end was the obvious way to draw
    a mudguard and it does not work: at this plate thickness every joint
    interpenetrates, the depth buffer picks a different winner along each
    seam, and the arc renders as a comb. One mesh has no seams to fight over.
    """
    verts, faces = [], []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        ca, sa = math.cos(a), math.sin(a)
        verts.append((centre[0] + r_in * ca, y, centre[1] + r_in * sa))
        verts.append((centre[0] + r_out * ca, y, centre[1] + r_out * sa))
    for i in range(steps):
        j = i * 2
        faces.append((j, j + 1, j + 3, j + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return put(o, material=material, parent=parent)


def triangle(name, r, loc, *, material=None, parent=None, spin=0.0):
    """An arrowhead. Points up at spin 0, and along +X at spin pi/2.

    Blender starts a circle's vertices at local +Y, which the quarter turn
    about X that faces the prism at the lens carries round to world +Z; the
    spin about Y then takes it wherever it is wanted. The Euler is applied X
    then Y, so the face stays square to the camera through both.
    """
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
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

    preferences.edit.keyframe_new_interpolation_type does nothing at all on
    this build - it reads back as whatever it was set to and the keyframe is
    still born BEZIER. Every hard cut and every blink in this clip depends on
    CONSTANT actually being constant, so the keys are corrected after they are
    inserted instead of being asked for nicely beforehand.
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


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 10.0, 3.0, (0.7, LAY["road"], GROUND_Z - 1.5),
          material=mats["road"])
    plate("RoadLine", 10.0, 0.010, (0.7, LAY["road"] - 0.02, GROUND_Z - 0.005),
          material=mats["text"])

    # The dashes are the only thing that shows the bike is being rolled: the
    # camera stays with the machine, so it is the road that has to move.
    dashes = empty("Dashes")
    x = -1.70
    i = 0
    while x < 3.30:
        plate("Dash%d" % i, 0.085, 0.009, (x, LAY["road"] - 0.02, GROUND_Z - 0.038),
              material=mats["dash"], parent=dashes)
        x += 0.17
        i += 1
    return dashes


# ------------------------------------------------------------------- the bike
def build_wheel(name, centre, mats, parent):
    """A wheel that can be seen to turn. The spokes are the whole point.

    The hub is its own material because the axles are one of the checkpoints:
    the roll beat lights them and leaves them green.
    """
    hub = empty(name, (centre[0], 0, centre[1]), parent=parent)
    y = LAY["wheel"]
    # The tyre is a disc with discs stacked on it rather than a torus, so
    # that one Z scale on the parent squashes the lot into the ellipse a
    # rolled wheel actually projects as.
    disc(name + "Tyre", WHEEL_R, (0, y, 0), material=mats["ink"], parent=hub)
    disc(name + "Rim", WHEEL_R - 0.052, (0, y - 0.008, 0),
         material=mats["steel"], parent=hub)
    disc(name + "Dish", WHEEL_R - 0.068, (0, y - 0.016, 0),
         material=mats["bg"], parent=hub)
    # Five fat spokes: a cast wheel, so what is on screen reads as a
    # motorcycle rather than a bicycle, and so the roll beat has something
    # that visibly turns.
    for i in range(5):
        a = i * 2 * math.pi / 5
        r0, r1 = 0.030, WHEEL_R - 0.052
        bar("%sSpoke%d" % (name, i),
            (math.cos(a) * r0, math.sin(a) * r0),
            (math.cos(a) * r1, math.sin(a) * r1),
            0.030, y - 0.024, material=mats["steel"], parent=hub)
    disc(name + "Hub", 0.046, (0, y - 0.032, 0),
         material=mats["hub"], parent=hub, verts=20)
    return hub


def build_bike(mats):
    """Everything that goes over when the bike does, under one scale.

    `roll` is pinned to the tyre contact line and only its Z scale moves;
    `bike` sits a wheel radius above it so that every part below can be
    written in ordinary world coordinates. See the module docstring for why a
    vertical squash is the exact projection of a roll and not a fudge.
    """
    roll = empty("Roll", (0, 0, GROUND_Z))
    bike = empty("Bike", (0, 0, -GROUND_Z), parent=roll)

    m = mats["machine"]
    m_dim = mats["machine_dim"]
    m_heavy = mats["machine_heavy"]

    # A motorcycle in side elevation is three things read at once: two big
    # wheels about two diameters apart, a mass of engine and tank slung
    # between them, and a mudguard over the front tyre. The first cut of this
    # drawing had a thin frame with a tank and a seat floating above a gap,
    # and it rendered as a bicycle - so the mass is now drawn as overlapping
    # solids that merge into one silhouette, darkest at the bottom.
    bar("Swingarm", PIVOT, REAR_AXLE, 0.052, LAY["limb"], material=m, parent=bike)
    bar("Shock", (0.300, 0.020), (0.430, 0.340), 0.034, LAY["frame"],
        material=m_dim, parent=bike)
    plate("Engine", 0.420, 0.360, (0.700, LAY["mass"], 0.095),
          material=m_heavy, parent=bike)
    plate("Cylinder", 0.260, 0.220, (0.835, LAY["mass"], 0.300),
          material=m_heavy, parent=bike, spin=0.25)
    # The panel under the front of the seat. Small, and the body colour
    # rather than a paler one: a light rectangle in the middle of the machine
    # reads as a hole in it, and a big one closes the open triangle between
    # engine, seat and swingarm that is half of what says motorcycle.
    plate("SidePanel", 0.230, 0.170, (0.570, LAY["mass"], 0.370),
          material=m, parent=bike)
    bar("DownTube", (1.140, 0.460), (0.940, 0.150), 0.034, LAY["frame"],
        material=m, parent=bike)
    bar("TopSpar", HEAD, (0.700, 0.470), 0.030, LAY["frame"], material=m,
        parent=bike)
    # The tank is a slab tipped nose-down, which is the whole difference
    # between a fuel tank and a packing case.
    plate("Tank", 0.440, 0.190, (0.890, LAY["mass"], 0.495), material=m,
          parent=bike, spin=0.22)
    plate("Seat", 0.440, 0.065, (0.480, LAY["mass"], 0.472), material=m,
          parent=bike)
    bar("Tail", (0.330, 0.470), (0.110, 0.530), 0.105, LAY["mass"],
        material=m, parent=bike)
    bar("ForkLeg", FRONT_AXLE, HEAD, 0.046, LAY["limb"], material=m, parent=bike)
    plate("Clamp", 0.110, 0.050, (1.172, LAY["limb"] - 0.012, 0.516),
          material=m, parent=bike, spin=0.40)
    # The riser. Without it the bar and the levers float clear of the fork
    # with nothing holding them on, which is the one thing a lever check
    # cannot afford to look like.
    bar("Riser", (1.168, 0.524), (1.150, 0.614), 0.032, LAY["frame"],
        material=m, parent=bike)
    plate("HeadLug", 0.078, 0.078, (HEAD[0], LAY["frame"], HEAD[1]),
          material=m, parent=bike)
    bar("Bars", BAR_FRONT, BAR_BACK, 0.030, LAY["frame"], material=m, parent=bike)
    plate("Grip", 0.080, 0.048, (1.202, LAY["frame"] - 0.012, 0.604),
          material=m_dim, parent=bike, spin=0.270)
    plate("Cluster", 0.120, 0.060, (1.120, LAY["frame"] + 0.012, 0.676),
          material=m_dim, parent=bike)
    # The silencer, stopped short of the rear wheel so it never covers the
    # spokes the roll beat needs to be readable.
    bar("Silencer", (0.880, -0.010), (0.300, 0.135), 0.072, LAY["pipe"],
        material=m_dim, parent=bike)
    # The mudguard. It is the single shape that settles what the machine is
    # before anything else on screen has been read.
    arc_band("Guard", FRONT_AXLE, GUARD_R, GUARD_R + 0.042,
             math.radians(32), math.radians(148), LAY["limb"],
             material=m, parent=bike)

    rear = build_wheel("Rear", REAR_AXLE, mats, bike)
    front = build_wheel("Front", FRONT_AXLE, mats, bike)

    # Levers: a pivot empty at each perch so the blade swings about the perch
    # rather than about its own middle.
    lever = empty("LeverPivot", (LEVER_PERCH[0], 0, LEVER_PERCH[1]), parent=bike)
    bar("LeverBlade", (0, 0), LEVER_TIP, 0.022, LAY["lever"],
        material=mats["lever"], parent=lever)
    clutch = empty("ClutchPivot", (CLUTCH_PERCH[0], 0, CLUTCH_PERCH[1]), parent=bike)
    bar("ClutchBlade", (0, 0), CLUTCH_TIP, 0.020, LAY["lever"] + 0.01,
        material=mats["clutch"], parent=clutch)

    # The rear brake pedal, which on this side of the bike is the one that
    # goes with the lever above. It genuinely rotates in the plane of this
    # drawing, so a plain rotation is the whole of it.
    pedal = empty("PedalPivot", (PEG[0], 0, PEG[1]), parent=bike)
    disc("Peg", 0.030, (0, LAY["lever"] + 0.02, 0), material=m_dim,
         parent=pedal, verts=16)
    bar("Pedal", (0, 0), PEDAL_TIP, 0.026, LAY["lever"],
        material=mats["pedal"], parent=pedal)

    # Lamps. Unlit they are steel, which is a lamp that is not on rather than
    # a hole in the bodywork.
    head = disc("HeadLamp", HEADLAMP_R, (HEADLAMP[0], LAY["lamp"], HEADLAMP[1]),
                material=mats["head"], parent=bike, verts=32)
    bar("TailStalk", (0.160, 0.495), (TAILLAMP[0], TAILLAMP[1]), 0.026,
        LAY["stalk"], material=m_dim, parent=bike)
    tail = disc("TailLamp", TAILLAMP_R, (TAILLAMP[0], LAY["lamp"], TAILLAMP[1]),
                material=mats["tail"], parent=bike, verts=24)
    bar("IndFrontStalk", (1.370, 0.420), IND_FRONT, 0.014, LAY["stalk"],
        material=m_dim, parent=bike)
    disc("IndFront", IND_R, (IND_FRONT[0], LAY["lamp"], IND_FRONT[1]),
         material=mats["ind"], parent=bike, verts=20)
    bar("IndRearStalk", (0.100, 0.470), IND_REAR, 0.014, LAY["stalk"],
        material=m_dim, parent=bike)
    disc("IndRear", IND_R, (IND_REAR[0], LAY["lamp"], IND_REAR[1]),
         material=mats["ind"], parent=bike, verts=20)

    return dict(roll=roll, bike=bike, rear=rear, front=front, lever=lever,
                clutch=clutch, pedal=pedal, head=head, tail=tail)


def build_tap(mats):
    """The fuel tap, and the one thing in the clip that is not under `roll`.

    It is a callout, not a part of the machine, so it must not foreshorten
    with the bike: a glyph squashed to a third of its height while the bike
    is down is unreadable at the size this is watched at. Its position is
    keyed against the same squash the bike uses, so it sits on the tap
    throughout without being sheared by it.
    """
    root = empty("Tap", (TAP[0], 0, GROUND_Z + (TAP[1] - GROUND_Z) * DOWN_SCALE))
    disc("TapBody", TAP_R, (0, LAY["lamp"] + 0.01, 0), material=mats["bg"],
         parent=root, verts=24)
    disc("TapRing", TAP_R * 0.78, (0, LAY["lamp"], 0), material=mats["tap"],
         parent=root, verts=24)
    handle = empty("TapHandle", (0, 0, 0), parent=root)
    plate("TapLever", 0.075, 0.020, (0.030, LAY["lamp"] - 0.01, 0),
          material=mats["tap"], parent=handle)
    return root, handle


def build_up_arrow(mats):
    """Which way the bike goes. Up, with no hands on it anywhere.

    Over the tail rather than over the seat: the seat is the tallest thing
    along the back of the machine, and an arrow standing on it would be
    pushed out of the top of the wide framing by the time the bike is up.
    """
    root = empty("UpArrow", (ARROW_X, 0, ARROW_BASE))
    plate("UpShaft", 0.030, 0.130, (0, LAY["arrow"], 0.065),
          material=mats["brand"], parent=root)
    triangle("UpHead", 0.055, (0, LAY["arrow"], 0.175),
             material=mats["brand"], parent=root)
    return root


def build_fwd_arrow(mats):
    """Forwards, which is the direction breakdown.ts asks for by name."""
    root = empty("FwdArrow", (0.06, 0, 0.780))
    plate("FwdShaft", 0.250, 0.030, (0.125, LAY["arrow"], 0),
          material=mats["brand"], parent=root)
    triangle("FwdHead", 0.058, (0.288, LAY["arrow"], 0),
             material=mats["brand"], parent=root, spin=math.pi / 2)
    return root


def build_band(mats):
    """The strip of road being looked at, under the engine.

    It sweeps the length of the machine and then stays as the strip that was
    checked. Nothing is drawn on the road: a drawn drip would be showing the
    stop-and-call case, and this beat is the check, not the finding.
    """
    root = empty("Band", (BAND_X0, 0, BAND_Z))
    plate("BandBar", BAND_W, 0.030, (0, LAY["band"], 0),
          material=mats["band"], parent=root)
    return root


# ---------------------------------------------------------------- animation
def animate(rig, tap, tap_handle, up_arrow, fwd_arrow, band, dashes, cam, mats):
    roll = rig["roll"]
    lever, clutch, pedal = rig["lever"], rig["clutch"], rig["pedal"]
    head, tail = rig["head"], rig["tail"]

    # --- camera: four framings, hard cuts. An orthographic move would cost
    # bitrate on every pixel in frame; a cut costs one frame.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -6.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["levers"], BARS)
    frame_at(F["brakes"] + 31, PEG_VIEW)
    frame_at(F["lights"], WIDE)
    frame_at(F["drips"], UNDER)
    frame_at(F["drips"] + 55, WIDE)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one: without these the
    # bike is already upright and the band already swept during the opening.
    key(roll, 1, scale=(1, 1, DOWN_SCALE), interp="CONSTANT")
    key(lever, 1, loc=(LEVER_PERCH[0], 0, LEVER_PERCH[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(clutch, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(pedal, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(rig["rear"], 1, rot=(0, 0, 0), interp="CONSTANT")
    key(rig["front"], 1, rot=(0, 0, 0), interp="CONSTANT")
    key(dashes, 1, loc=(0, 0, 0), interp="CONSTANT")
    key(head, 1, scale=(1, 1, 1), interp="CONSTANT")
    key(tail, 1, scale=(1, 1, 1), interp="CONSTANT")
    key(up_arrow, 1, scale=(0.001, 0.001, 0.001), interp="CONSTANT")
    key(fwd_arrow, 1, scale=(0.001, 0.001, 0.001), interp="CONSTANT")
    key(band, 1, loc=(BAND_X0, 0, BAND_Z), scale=(0.001, 1, 1), interp="CONSTANT")
    key(tap_handle, 1, rot=(0, 0, 0), interp="CONSTANT")
    for name, colour in (("lever", SLATE), ("clutch", SLATE), ("pedal", SLATE),
                         ("head", STEEL), ("tail", STEEL), ("ind", STEEL),
                         ("hub", STEEL), ("tap", YELLOW), ("band", BRAND)):
        key_colour(mats[name], 1, colour)

    # --- lift: the fuel tap off first, which is this step's own caution, and
    # then the machine comes up. Nobody lifts it, because nobody is drawn.
    key(tap_handle, F["lift"] + 7, rot=(0, 0, 0), interp="LINEAR")
    key(tap_handle, F["lift"] + 19, rot=(0, math.radians(-96), 0))
    key_colour(mats["tap"], F["lift"] + 20, STUD_GREY)

    rise_a, rise_b = F["lift"] + 27, F["lift"] + 65
    key(roll, rise_a, scale=(1, 1, DOWN_SCALE))
    key(roll, rise_b, scale=(1, 1, 1.0))
    # The tap glyph and the lift arrow ride the squash instead of being
    # sheared by it: same frames, same curve, read off the same ease, so they
    # stay with the machine all the way up without foreshortening into
    # unreadable slivers. See build_tap on why that matters.
    for j in range(9):
        t = j / 8.0
        f = rise_a + round(t * (rise_b - rise_a))
        s = DOWN_SCALE + (1.0 - DOWN_SCALE) * ease(t)
        key(tap, f, loc=(TAP[0], 0, GROUND_Z + (TAP[1] - GROUND_Z) * s),
            interp="LINEAR")
        key(up_arrow, f,
            loc=(ARROW_X, 0, GROUND_Z + (ARROW_BASE - GROUND_Z) * s),
            interp="LINEAR")
    key(tap, rise_b + 10, loc=(TAP[0], 0, TAP[1]), interp="CONSTANT")
    key(tap, rise_b + 11, loc=(TAP[0], 0, -4.0), interp="CONSTANT")

    key(up_arrow, rise_a - 3, scale=(0.001, 0.001, 0.001), interp="CONSTANT")
    key(up_arrow, rise_a, scale=(1, 1, 1))
    key(up_arrow, rise_b + 8, scale=(1, 1, 1))
    key(up_arrow, rise_b + 9, scale=(0.001, 0.001, 0.001), interp="CONSTANT")

    # --- levers: snapped, or bent so far you cannot reach them. Each blade
    # lights, is given a nudge, and is left green. Blue is the thing being
    # looked at now; green is the thing that has been looked at and is good.
    key_colour(mats["lever"], F["levers"] + 3, BRAND)
    key(lever, F["levers"] + 4, rot=(0, 0, 0), interp="LINEAR")
    key(lever, F["levers"] + 9, rot=(0, LEVER_WIGGLE, 0))
    key(lever, F["levers"] + 14, rot=(0, -LEVER_WIGGLE, 0))
    key(lever, F["levers"] + 19, rot=(0, 0, 0))
    key_colour(mats["lever"], F["levers"] + 21, GREEN)

    key_colour(mats["clutch"], F["levers"] + 26, BRAND)
    key(clutch, F["levers"] + 27, rot=(0, 0, 0), interp="LINEAR")
    key(clutch, F["levers"] + 32, rot=(0, LEVER_WIGGLE, 0))
    key(clutch, F["levers"] + 37, rot=(0, -LEVER_WIGGLE, 0))
    key(clutch, F["levers"] + 42, rot=(0, 0, 0))
    key_colour(mats["clutch"], F["levers"] + 44, GREEN)

    # --- brakes: pull the front lever, press the rear pedal, both firm. The
    # blade is swung back and slid along the bar at once, because in a true
    # side elevation a squeeze is mostly foreshortening, and foreshortening
    # on its own reads as nothing happening.
    def lever_at(f, amount):
        key(lever, f,
            loc=(LEVER_PERCH[0] + LEVER_SLIDE * amount, 0, LEVER_PERCH[1]),
            rot=(0, LEVER_PULL * amount, 0))

    key_colour(mats["lever"], F["brakes"] + 1, BRAND)
    for f, amount in ((3, 0.0), (10, 1.0), (17, 0.0), (23, 1.0), (29, 0.0)):
        lever_at(F["brakes"] + f, amount)
    key_colour(mats["lever"], F["brakes"] + 30, GREEN)

    key_colour(mats["pedal"], F["brakes"] + 32, BRAND)
    key(pedal, F["brakes"] + 34, rot=(0, 0, 0))
    key(pedal, F["brakes"] + 41, rot=(0, PEDAL_PRESS, 0))
    key(pedal, F["brakes"] + 47, rot=(0, 0, 0))
    key(pedal, F["brakes"] + 52, rot=(0, PEDAL_PRESS, 0))
    key(pedal, F["brakes"] + 57, rot=(0, 0, 0))
    key_colour(mats["pedal"], F["brakes"] + 58, GREEN)

    # --- lights: front, rear, brake light, both indicators, in that order,
    # because that is the order the step names them in.
    key_colour(mats["head"], F["lights"] + 4, BRAND)
    key(head, F["lights"] + 4, scale=(1, 1, 1), interp="LINEAR")
    key(head, F["lights"] + 9, scale=(1.18, 1.18, 1.18))
    key(head, F["lights"] + 14, scale=(1, 1, 1))
    key_colour(mats["head"], F["lights"] + 19, GREEN)

    key_colour(mats["tail"], F["lights"] + 22, BRAND)
    key(tail, F["lights"] + 22, scale=(1, 1, 1), interp="LINEAR")
    key(tail, F["lights"] + 27, scale=(1.18, 1.18, 1.18))
    key(tail, F["lights"] + 32, scale=(1, 1, 1))

    # The brake light is the tail lamp getting brighter when the lever moves,
    # which is exactly how it is checked. Drawn as growth and brand yellow:
    # see the docstring on why it is not drawn red.
    lever_at(F["lights"] + 36, 0.0)
    lever_at(F["lights"] + 42, 1.0)
    key_colour(mats["tail"], F["lights"] + 40, YELLOW)
    key(tail, F["lights"] + 40, scale=(1, 1, 1), interp="LINEAR")
    key(tail, F["lights"] + 44, scale=(1.42, 1.42, 1.42))
    lever_at(F["lights"] + 49, 0.0)
    key(tail, F["lights"] + 50, scale=(1, 1, 1))
    key_colour(mats["tail"], F["lights"] + 51, GREEN)

    # Both indicators, together rather than a side at a time: one side at a
    # time needs a left and a right, and this view only has the one.
    blink = F["lights"] + 54
    for j in range(3):
        key_colour(mats["ind"], blink + j * 7, YELLOW)
        key_colour(mats["ind"], blink + j * 7 + 4, STEEL)
    key_colour(mats["ind"], F["lights"] + 76, GREEN)

    # --- roll it forward a few metres and listen. Two pushes rather than one
    # smooth glide, because that is what walking a bike looks like, and the
    # ground speed and the wheel rotation are read off the same number at the
    # same frames so they cannot drift apart.
    key(fwd_arrow, F["roll"] + 1, scale=(0.001, 0.001, 0.001), interp="CONSTANT")
    key(fwd_arrow, F["roll"] + 4, scale=(1, 1, 1))
    for j in range(ROLL_KEYS + 1):
        t = j / float(ROLL_KEYS)
        f = F["roll"] + 6 + round(t * 60)
        u = 0.5 * ease(t / 0.44) + 0.5 * ease((t - 0.50) / 0.46)
        phi = ROLL_TURN * u
        key(rig["rear"], f, rot=(0, phi, 0), interp="LINEAR")
        key(rig["front"], f, rot=(0, phi, 0), interp="LINEAR")
        key(dashes, f, loc=(-WHEEL_R * phi, 0, 0), interp="LINEAR")
    key_colour(mats["hub"], F["roll"] + 8, BRAND)
    key_colour(mats["hub"], F["roll"] + 62, GREEN)
    key(fwd_arrow, F["roll"] + 66, scale=(1, 1, 1))
    key(fwd_arrow, F["roll"] + 70, scale=(0.001, 0.001, 0.001), interp="CONSTANT")

    # --- drips: the road under the whole machine, looked along and then left
    # as the strip that was checked.
    key(band, F["drips"] + 2, loc=(BAND_X0, 0, BAND_Z), scale=(0.001, 1, 1),
        interp="CONSTANT")
    key(band, F["drips"] + 4, scale=(1, 1, 1), interp="CONSTANT")
    key(band, F["drips"] + 5, loc=(BAND_X0, 0, BAND_Z), interp="LINEAR")
    key(band, F["drips"] + 39, loc=(BAND_X1, 0, BAND_Z))
    key(band, F["drips"] + 41, loc=(BAND_X1, 0, BAND_Z), scale=(1, 1, 1))
    key(band, F["drips"] + 53,
        loc=((BAND_X0 + BAND_X1) / 2, 0, BAND_Z),
        scale=((BAND_X1 - BAND_X0 + BAND_W) / BAND_W, 1, 1))
    key_colour(mats["band"], F["drips"] + 43, GREEN)


# ------------------------------------------------------------------- render
def setup_render(scene, *, samples=24):
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
        "dash": flat("Dash", STEEL),
        "text": flat("Text", TEXT),
        "ink": flat("Ink", INK),
        "machine": flat("Machine", SLATE),
        "machine_dim": flat("MachineDim", STEEL),
        # The engine and the cylinder, darker than the bodywork so the
        # silhouette is heaviest where the weight actually is.
        "machine_heavy": flat("MachineHeavy", INK_SOFT),
        "steel": flat("Steel", STUD_GREY),
        "brand": flat("Brand", BRAND),
        # Everything below changes colour as it is checked, so each gets a
        # material of its own rather than sharing one. The two indicators do
        # share, because they blink together.
        "lever": flat("LeverMat", SLATE),
        "clutch": flat("ClutchMat", SLATE),
        "pedal": flat("PedalMat", SLATE),
        "head": flat("HeadMat", STEEL),
        "tail": flat("TailMat", STEEL),
        "ind": flat("IndMat", STEEL),
        "hub": flat("HubMat", STEEL),
        "tap": flat("TapMat", YELLOW),
        "band": flat("BandMat", BRAND),
    }

    dashes = build_road(mats)
    rig = build_bike(mats)
    tap, tap_handle = build_tap(mats)
    up_arrow = build_up_arrow(mats)
    fwd_arrow = build_fwd_arrow(mats)
    band = build_band(mats)

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

    animate(rig, tap, tap_handle, up_arrow, fwd_arrow, band, dashes, cam, mats)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"dropped_{still:04d}.png")
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
        # MEDIUM comes in at about 870 KB for these 17.5 seconds, which is
        # inside the budget this has to live in, so nothing is given away to
        # buy space it does not need. Flat colour and hard edges survive the
        # setting; the size is printed below so it is checked, not assumed.
        scene.render.ffmpeg.constant_rate_factor = crf
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.audio_codec = "NONE"
        out = os.path.join(OUT_DIR, "fix-moto-dropped.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print(f"WROTE {out} {os.path.getsize(out)} bytes")

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-dropped.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
