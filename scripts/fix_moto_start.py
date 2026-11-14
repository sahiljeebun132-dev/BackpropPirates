"""Build and render the "it will not start" diagram for the moto-wont-start guide.

Run:
    blender --background --factory-startup --python scripts/fix_moto_start.py -- --still 60
    blender --background --factory-startup --python scripts/fix_moto_start.py -- --render
    blender --background --factory-startup --python scripts/fix_moto_start.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/motostart_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-moto-start.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'moto-wont-start' steps in src/lib/breakdown.ts, in their
order, because the app captions this clip with those steps: kill switch, side
stand, neutral or clutch, fuel, battery, kick start. A picture that drifts
from the words printed under it is worse than no picture. Five places where
this clip and the text are not a line-for-line match, all deliberate:

  - The clip opens before step one, with the bike rolled off the tarmac onto
    the verge. That is the guide's own `before` list -- "get the bike off the
    carriageway first, even if that means pushing it" -- and fix_tyre.py opens
    on its `before` list the same way. A blue arrow says push; no rider is
    drawn, because no figure appears in any of these clips.
  - A side elevation has one side, and this one is the left: the side the
    stand and the fuel tap are on, and the side fix_chain.py already draws
    this bike from. The kill switch lives by the right thumb and most kick
    levers are on the right too, so both are drawn on the near bar and the
    near side of the engine. Drawing the bike from the right instead would
    only have moved the lie onto the stand, which has to be seen to fold.
  - The key is already in the run position at frame one. It has to be: the
    neutral lamp in the third beat cannot light with the ignition off, and
    that beat comes before the one about the battery. So the battery beat
    turns the key off and back on, and points at the headlight -- which is
    what that step actually says to watch.
  - "Look in the tank rather than trusting the gauge" is drawn as a cutaway
    through the tank with the level sitting low. There is no text in this
    clip and no gauge face on the cluster, so the tank is opened instead.
  - Step six is "if the battery is flat and the bike has a kick start, use
    it. Otherwise this is a call." The clip draws the first half: the lever
    swings, the ignition lamp goes out and the headlight comes up steady.
    The "otherwise this is a call" half has no picture, and the caption
    under the clip carries it.

Style is a diagram that moves, not a film: an orthographic side elevation,
pure emission materials and the Standard view transform, so every pixel is
exactly the hex value it was given. Cuts between the four framings are hard,
because a hard cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, same build as scripts/fix_tyre.py, and the same
things bite: the engine id is 'BLENDER_EEVEE', image_settings.media_type has
to be VIDEO before FFMPEG can be assigned, the output path must be absolute
or the render lands next to the .blend, keyframe_new_interpolation_type does
nothing on this build so keyframe_points[].interpolation is set after the
keys are inserted, and Action.fcurves is empty for some IDs so the curves are
dug out of the slotted action's channelbags instead.
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
    ("clear_road", 44),   # before: get it off the carriageway, pushing if need be
    ("kill", 56),         # 1: the red switch by your right thumb, into run
    ("stand", 52),        # 2: side stand up
    ("neutral", 56),      # 3: neutral, or the clutch pulled fully in
    ("fuel", 62),         # 4: look in the tank; tap on, then reserve
    ("battery", 60),      # 5: turn the key and watch the headlight
    ("kick", 64),         # 6: kick it, if it has a kick start
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# The values fix_tyre.py defines, which are the ones in src/index.css, so the
# clip and the app agree. The machine is the dark subject on a light page, the
# same way round as fix_chain.py draws this bike.
BG = "#f1f5f9"
INK = "#15181f"
INK_SOFT = "#1e2430"
TEXT = "#0f172a"
BRAND = "#189edb"
BRAND_DEEP = "#0e6fa3"
YELLOW = "#f0c000"
GREEN = "#007848"
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"
STUD_GREY = "#64748b"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller y
# is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "fill": 1.60,     # the carriageway
    "ground": 1.50,   # the ground line and the road dashes
    "wheel": 1.05,
    "frame": 1.00,    # frame members, fork, swingarm, bars
    "mass": 0.95,     # engine
    "body": 0.90,     # tank, seat, tail
    "window": 0.85,   # the cutaway through the tank
    "fuel": 0.80,     # what is left in it
    "trim": 0.75,     # cluster case, filler cap, tap body, key barrel
    "lamp": 0.70,     # headlight glow
    "lens": 0.65,
    "dot": 0.60,      # warning lamps
    "near": 0.50,     # near-side controls: kill switch, clutch, kick lever
    "toggle": 0.45,
    "mark": 0.30,     # the pointer ring, in front of everything
}
PLATE = 0.008  # thickness of every plate; layers are 0.05 apart so none touch

# ------------------------------------------------------------------ geometry
# Metres, left side elevation, front of the bike to the left of frame, which
# is what you see standing on that side. The proportions are the ones in
# scripts/fix_chain.py, so the two motorcycle clips are the same machine.
WHEEL_R = 0.30
WHEELBASE = 1.40
REAR_C = (0.0, 0.0)
FRONT_AXLE = (-WHEELBASE, 0.0)
SWING_PIVOT = (-0.520, 0.020)
HEAD = (-1.180, 0.560)
GROUND_Z = -WHEEL_R

# The carriageway edge, and how far the bike is rolled to get clear of it.
# The camera stays with the machine and the road slides underneath instead,
# which is the trick fix_chain.py uses to roll a bike without losing it out
# of frame. Both wheels are on the tarmac at the start and clear of it at the
# end, which is what sets this distance: the bike is two metres long.
ROAD_EDGE = 0.45
ROLL_D = 2.80

# Controls. The bar end carries the grip, the clutch perch and the kill
# switch, in that order inboard; see the note about sides in the docstring.
BAR_A = (-1.260, 0.620)
BAR_B = (-1.020, 0.665)
GRIP_C = (-1.268, 0.618)
KILL_C = (-1.150, 0.652)
KILL_THROW = 0.013              # how far the toggle slides between detents
# The toggle rides on an empty of its own, and that empty is keyed in world
# coordinates like everything else here, so both detents are written out in
# full. Keying it to a bare offset parks the switch on the rear axle.
KILL_STOP = (KILL_C[0], 0, KILL_C[1] - KILL_THROW)
KILL_RUN = (KILL_C[0], 0, KILL_C[1] + KILL_THROW)
CLUTCH_PIVOT = (-1.205, 0.618)
CLUTCH_LEN = 0.165
CLUTCH_REST = math.radians(186)   # screen angle of the lever, out from the bar
CLUTCH_IN = math.radians(172)     # pulled back towards the grip
YOKE_C = (-1.070, 0.686)
CLUSTER_C = (-1.080, 0.760)
IGN_C = (-1.116, 0.760)
NEU_C = (-1.044, 0.760)
KEY_C = (-0.995, 0.700)
KEY_LEN = 0.048
KEY_ON = math.radians(-20)        # stem out of the barrel, lying back
KEY_OFF = math.radians(-110)      # and turned a quarter down
LAMP_C = (-1.336, 0.430)
LAMP_R = 0.078
TANK_C = (-0.840, 0.530)
TANK_W, TANK_H = 0.430, 0.175
CAP_HINGE = (-0.858, 0.624)
CAP_LEN = 0.085
CAP_OPEN = 0.95                   # radians the lid swings up
TAP_C = (-0.845, 0.418)
TAP_LEN = 0.058
TAP_OFF = math.radians(0)         # lever back: fuel off
TAP_ON = math.radians(-90)        # lever down: on
TAP_RES = math.radians(-180)      # lever forward: reserve
STAND_PIVOT = (-0.660, 0.010)
STAND_UP = math.radians(-112)     # folded back along the swingarm
KICK_PIVOT = (-0.470, 0.120)
KICK_LEN = 0.175
KICK_FOLD = math.radians(45)      # stowed against the engine
KICK_TOP = math.radians(15)       # swung out, ready
KICK_DOWN = math.radians(-80)     # and trodden through

POINT_R = 0.10   # the pointer ring is built at this radius and scaled per target

# The four framings: ((centre x, centre z), ortho scale). Hard cuts between.
WIDE = ((-0.62, 0.24), 2.70)
BARS = ((-1.20, 0.545), 1.08)
TANK_VIEW = ((-0.86, 0.46), 1.30)
STAND_VIEW = ((-0.56, -0.02), 1.42)

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MP4 = os.path.join(_REPO, "public", "guides", "fix-moto-start.mp4")
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


def arc(name, centre, radius, a0, a1, segments, w, y, material, parent=None):
    """A curve built out of short straight bars.

    Mudguards are the cheapest thing that stops a two-wheeler reading as a
    bicycle, and a mudguard is an arc. There is no curve primitive in this
    file because everything else is a rectangle or a circle.
    """
    # Each bar overhangs its neighbours by a sixth of a segment. Butted end
    # to end they leave a notch on the outside of every joint, and six
    # notches along a mudguard read as a dashed line rather than a curve.
    for i in range(segments):
        t0 = a0 + (a1 - a0) * (i - 0.17) / segments
        t1 = a0 + (a1 - a0) * (i + 1.17) / segments
        bar("%s%d" % (name, i),
            (centre[0] + radius * math.cos(t0), centre[1] + radius * math.sin(t0)),
            (centre[0] + radius * math.cos(t1), centre[1] + radius * math.sin(t1)),
            w, y, material, parent=parent)


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


def triangle(name, r, loc, *, material=None, parent=None, spin=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    # Blender starts a circle's vertices at local +Y, which the quarter turn
    # about X that faces the prism at the lens carries round to world +Z. The
    # spin then aims that tip: a quarter turn back points it along -X, which
    # is the way the bike is being pushed.
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

    preferences.edit.keyframe_new_interpolation_type does nothing on this 5.2
    build -- the preference reads back as set and the keyframe is still born
    BEZIER -- so the keys are corrected after insertion instead. Every hard
    cut and every lamp in this clip depends on it.
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


def spin_to(phi):
    """The Y rotation that points a child bar at screen angle phi.

    The camera looks along +Y, so a positive Y rotation reads as clockwise.
    Every lever here -- clutch, fuel tap, key, kick -- is a bar built along
    its parent local +X, and the parent carries this rotation.
    """
    return (0, -phi, 0)


# --------------------------------------------------------------- the ground
def build_ground(mats):
    """A ground line that stays, and a carriageway that slides.

    Everything that belongs to the road is parented to one empty, so the whole
    carriageway moves rearward as the bike is pushed forward off it. The
    ground line is not: the verge is ground too.
    """
    plate("GroundLine", 40.0, 0.013, (0, LAY["ground"], GROUND_Z - 0.0065),
          material=mats["text"])

    world = empty("World", (-ROLL_D, 0, 0))
    plate("Carriageway", 24.0, 1.40,
          (ROAD_EDGE + 12.0, LAY["fill"], GROUND_Z - 0.70),
          material=mats["road"], parent=world)
    # Tarmac and verge are two steps of the same pale ramp and four per cent
    # apart, which is the house choice everywhere else but is not enough on
    # its own when the whole beat is about crossing the join. The edge gets
    # a line of its own so the moment the bike is clear of it is visible.
    plate("RoadEdge", 0.016, 0.30, (ROAD_EDGE, LAY["ground"], GROUND_Z - 0.15),
          material=mats["stud"], parent=world)
    # The lane markings are what make the tarmac read as a carriageway rather
    # than a kerb, and they are the only thing that shows it moving.
    x = ROAD_EDGE + 0.95
    i = 0
    while x < ROAD_EDGE + 11.0:
        plate("Dash%d" % i, 0.19, 0.016, (x, LAY["ground"], GROUND_Z - 0.17),
              material=mats["steel"], parent=world)
        x += 0.40
        i += 1
    return world


# ----------------------------------------------------------------- the bike
def build_wheel(name, centre, mats):
    """A wheel that can be seen to turn. The spokes are the whole point."""
    hub = empty(name, (centre[0], 0, centre[1]))
    # A fat tyre on a small rim. The first cut of this had a thin tyre and
    # thin spokes, and at the wide framing the result was a bicycle.
    ring(name + "Tyre", WHEEL_R - 0.015, 0.032, (0, LAY["wheel"], 0),
         material=mats["ink"], parent=hub)
    ring(name + "Rim", WHEEL_R - 0.072, 0.013, (0, LAY["wheel"], 0),
         material=mats["steel"], parent=hub)
    # Five fat spokes, not a lacing pattern: a cast wheel, so the thing in the
    # frame reads as a motorcycle rather than a bicycle.
    for i in range(5):
        a = i * 2 * math.pi / 5
        r0, r1 = 0.030, WHEEL_R - 0.072
        bar("%sSpoke%d" % (name, i),
            (math.cos(a) * r0, math.sin(a) * r0),
            (math.cos(a) * r1, math.sin(a) * r1),
            0.024, LAY["wheel"], mats["steel"], parent=hub)
    disc(name + "Hub", 0.044, (0, LAY["wheel"] - 0.01, 0),
         material=mats["slate"], parent=hub)
    return hub


def build_bike(mats):
    """The mass of a motorcycle is the engine and the tank between the wheels.

    Those are drawn solid and everything else is the few members that join
    them up. Any more detail and the controls stop being the subject; any
    less and the thing on screen is a bicycle.
    """
    m = mats["slate"]
    m_dim = mats["steel"]
    m_mid = mats["stud"]

    bar("Swingarm", SWING_PIVOT, REAR_C, 0.028, LAY["frame"], m)
    bar("Shock", (-0.260, 0.010), (-0.360, 0.400), 0.018, LAY["frame"], m_dim)
    bar("Spine", HEAD, (-0.600, 0.470), 0.024, LAY["frame"], m)
    bar("DownTube", (-1.160, 0.520), (-0.800, 0.200), 0.022, LAY["frame"], m)
    bar("Cradle", (-0.800, 0.200), (-0.430, 0.060), 0.020, LAY["frame"], m)

    # The engine, in three pieces rather than one box: a wide crankcase, a
    # cylinder leaning into the frame and a head on top of it. A square slab
    # here was the single biggest reason the first cut looked like a moped.
    plate("Crankcase", 0.400, 0.200, (-0.620, LAY["mass"], 0.125), material=m)
    plate("Cylinder", 0.165, 0.215, (-0.700, LAY["mass"], 0.300),
          material=m_mid, spin=math.radians(-13))
    plate("Head", 0.185, 0.060, (-0.728, LAY["mass"], 0.408),
          material=m_dim, spin=math.radians(-13))

    plate("Tank", TANK_W, TANK_H, (TANK_C[0], LAY["body"], TANK_C[1]), material=m)
    plate("Seat", 0.420, 0.075, (-0.390, LAY["body"], 0.495), material=m)
    plate("Tail", 0.190, 0.070, (-0.175, LAY["body"], 0.520), material=m)
    bar("Fork", FRONT_AXLE, HEAD, 0.024, LAY["frame"], m)

    # Mudguards. An arc over each wheel, which no bicycle in this style has.
    arc("GuardFront", FRONT_AXLE, 0.335, math.radians(56), math.radians(126),
        6, 0.026, LAY["frame"], m)
    arc("GuardRear", REAR_C, 0.345, math.radians(58), math.radians(132),
        6, 0.026, LAY["frame"], m)

    # The drive chain, which is the other thing that says motorcycle at a
    # glance. Same drivetrain as scripts/fix_chain.py draws in close-up, two
    # runs and two sprockets rather than a hundred links, because here it is
    # scenery and there it is the subject.
    disc("SprocketRear", 0.098, (REAR_C[0], LAY["frame"] + 0.01, REAR_C[1]),
         material=m_mid)
    disc("SprocketFront", 0.044,
         (SWING_PIVOT[0], LAY["frame"] + 0.01, SWING_PIVOT[1]), material=m_mid)
    bar("ChainTop", (SWING_PIVOT[0], SWING_PIVOT[1] + 0.044),
        (REAR_C[0], REAR_C[1] + 0.098), 0.013, LAY["mass"], m_mid)
    bar("ChainBottom", (SWING_PIVOT[0], SWING_PIVOT[1] - 0.044),
        (REAR_C[0], REAR_C[1] - 0.098), 0.013, LAY["mass"], m_mid)

    # The front end: bars on a riser on a top yoke, with the cluster and the
    # ignition barrel both standing on that yoke. Hung in mid air, as they
    # were in the first cut, they read as three unrelated boxes.
    plate("Yoke", 0.215, 0.028, (YOKE_C[0], LAY["frame"], YOKE_C[1]), material=m)
    plate("Riser", 0.030, 0.048, (-1.100, LAY["frame"], 0.662), material=m)
    bar("Bars", BAR_A, BAR_B, 0.020, LAY["frame"], m)
    bar("Grip", (GRIP_C[0] - 0.048, GRIP_C[1] - 0.009),
        (GRIP_C[0] + 0.048, GRIP_C[1] + 0.009), 0.038, LAY["near"] + 0.02,
        mats["ink"])
    plate("ClusterStem", 0.030, 0.034, (CLUSTER_C[0], LAY["frame"], 0.705),
          material=m)

    rear = build_wheel("RearWheel", REAR_C, mats)
    front = build_wheel("FrontWheel", FRONT_AXLE, mats)
    return rear, front


def build_lamp(mats):
    """Headlight: a glow that grows, a lens that changes colour, three rays.

    Brightness is carried by the scale of the beam rather than by emission
    strength, because a dimmed emission is a dark circle and a dark circle on
    a light page still reads as a shape rather than as a lamp that is out.
    """
    glow = empty("Glow", (LAMP_C[0], 0, LAMP_C[1]))
    disc("LampGlow", LAMP_R + 0.042, (0, LAY["lamp"], 0),
         material=mats["glow"], parent=glow)
    for i, a in enumerate((math.radians(168), math.radians(180), math.radians(192))):
        bar("Ray%d" % i,
            (math.cos(a) * (LAMP_R + 0.030), math.sin(a) * (LAMP_R + 0.030)),
            (math.cos(a) * (LAMP_R + 0.105), math.sin(a) * (LAMP_R + 0.105)),
            0.015, LAY["lamp"], mats["glow"], parent=glow)
    disc("LampLens", LAMP_R, (LAMP_C[0], LAY["lens"], LAMP_C[1]),
         material=mats["lens"])
    # A bracket back to the fork leg, so the lamp is mounted rather than
    # hovering in front of the bike.
    bar("LampStay", (LAMP_C[0] + LAMP_R - 0.010, LAMP_C[1]), (-1.218, 0.446),
        0.022, LAY["trim"], mats["slate"])
    return glow


def build_cluster(mats):
    """Two lamps on the bars: ignition, and neutral.

    This is how "the green light is out" is said without a word of text. The
    off state is slate, not a dimmed green, for the same reason the headlight
    is scaled rather than dimmed.
    """
    plate("Cluster", 0.150, 0.084, (CLUSTER_C[0], LAY["trim"], CLUSTER_C[1]),
          material=mats["slate"])
    disc("IgnDot", 0.021, (IGN_C[0], LAY["dot"], IGN_C[1]), material=mats["ign"])
    disc("NeuDot", 0.021, (NEU_C[0], LAY["dot"], NEU_C[1]), material=mats["neu"])


def build_key(mats):
    disc("KeyBarrel", 0.030, (KEY_C[0], LAY["trim"], KEY_C[1]), material=mats["stud"])
    root = empty("Key", (KEY_C[0], 0, KEY_C[1]))
    plate("KeyStem", KEY_LEN, 0.016, (KEY_LEN / 2, LAY["near"], 0),
          material=mats["slate"], parent=root)
    plate("KeyHead", 0.024, 0.030, (KEY_LEN + 0.010, LAY["near"], 0),
          material=mats["slate"], parent=root)
    return root


def build_kill(mats):
    """The kill switch body, and the toggle that slides inside it.

    The guide calls it the red switch; there is no red in the brand set, so
    the toggle sits yellow in stop and goes green in run, which is the same
    language the rest of these clips use for a thing that has been put right.
    """
    plate("KillBody", 0.070, 0.056, (KILL_C[0], LAY["near"], KILL_C[1]),
          material=mats["stud"])
    root = empty("Kill", (KILL_C[0], 0, KILL_C[1]))
    plate("KillToggle", 0.030, 0.020, (0, LAY["toggle"], 0),
          material=mats["kill"], parent=root)
    return root


def build_clutch(mats):
    plate("ClutchPerch", 0.030, 0.034, (CLUTCH_PIVOT[0], LAY["near"], CLUTCH_PIVOT[1]),
          material=mats["stud"])
    root = empty("Clutch", (CLUTCH_PIVOT[0], 0, CLUTCH_PIVOT[1]))
    plate("ClutchLever", CLUTCH_LEN, 0.020, (CLUTCH_LEN / 2, LAY["near"], 0),
          material=mats["stud"], parent=root)
    return root


def build_tank_cutaway(mats):
    """A window into the tank, and the little that is left in it.

    Scaled away rather than hidden, the same trick fix_tyre.py uses for its
    jack-point mark: an emission strength of zero is black, and a black
    rectangle in the middle of the tank is still a rectangle.
    """
    root = empty("Cutaway", (TANK_C[0] - 0.060, 0, TANK_C[1]))
    plate("CutWindow", 0.300, 0.150, (0, LAY["window"], 0),
          material=mats["bg"], parent=root)
    plate("CutFuel", 0.300, 0.035, (0, LAY["fuel"], -0.0575),
          material=mats["fuel"], parent=root)
    root.scale = (0, 0, 0)

    cap = empty("Cap", (CAP_HINGE[0], 0, CAP_HINGE[1]))
    plate("CapLid", CAP_LEN, 0.022, (-CAP_LEN / 2, LAY["trim"], 0),
          material=mats["stud"], parent=cap)
    return root, cap


def build_tap(mats):
    disc("TapBody", 0.028, (TAP_C[0], LAY["trim"], TAP_C[1]), material=mats["stud"])
    root = empty("Tap", (TAP_C[0], 0, TAP_C[1]))
    plate("TapLever", TAP_LEN, 0.018, (TAP_LEN / 2, LAY["near"], 0),
          material=mats["tap"], parent=root)
    return root


def build_stand(mats):
    """Down while the bike is parked, folded for everything after step two.

    Both wheels are on the ground on a side stand, so the leg has to be seen
    to swing back along the swingarm; that is the whole of step two.
    """
    root = empty("Stand", (STAND_PIVOT[0], 0, STAND_PIVOT[1]))
    bar("StandLeg", (0, 0), (-0.130, -0.310), 0.016, LAY["near"], mats["stand"],
        parent=root)
    plate("StandFoot", 0.070, 0.012, (-0.140, LAY["near"], -0.316),
          material=mats["stand"], parent=root, spin=math.radians(-22))
    return root


def build_kick(mats):
    root = empty("Kick", (KICK_PIVOT[0], 0, KICK_PIVOT[1]))
    plate("KickArm", KICK_LEN, 0.020, (KICK_LEN / 2, LAY["near"], 0),
          material=mats["stud"], parent=root)
    plate("KickPedal", 0.034, 0.040, (KICK_LEN + 0.012, LAY["near"], 0),
          material=mats["stud"], parent=root)
    return root


def build_arrow(mats):
    """Which way the bike goes to get off the road: forwards, over the edge.

    No rider is drawn, here or in any of these clips, so this arrow is the
    only thing that says the bike is being pushed rather than rolling away.
    """
    # Built around its own centre, not around the world origin: an empty at
    # the origin would have shrunk the arrow towards the rear axle on the way
    # in rather than growing it where it belongs.
    root = empty("Arrow", (0.040, 0, 0.615))
    bar("ArrowBar", (0.195, 0), (-0.150, 0), 0.022, LAY["mark"],
        mats["brand"], parent=root)
    triangle("ArrowHead", 0.055, (-0.196, LAY["mark"], 0),
             material=mats["brand"], parent=root, spin=-math.pi / 2)
    root.scale = (0, 0, 0)
    return root


def build_pointer(mats):
    """One ring, moved between the controls while it is scaled away.

    Every move happens behind a scale of zero and on a constant-interpolation
    key, so it never slides across the frame from one control to the next.
    """
    root = empty("Pointer", (0, 0, 0))
    ring("PointerRing", POINT_R, 0.011, (0, LAY["mark"], 0),
         material=mats["brand"], parent=root)
    root.scale = (0, 0, 0)
    return root


# ---------------------------------------------------------------- animation
def point_at(pointer, f_in, f_out, target, radius):
    """Bring the ring up at a control, hold it, take it away again."""
    k = radius / POINT_R
    key(pointer, f_in, loc=(target[0], 0, target[1]), interp="CONSTANT")
    key(pointer, f_in, scale=(0, 0, 0))
    key(pointer, f_in + 6, scale=(k, k, k))
    key(pointer, f_out, scale=(k, k, k))
    key(pointer, f_out + 5, scale=(0, 0, 0))


def animate(rig, cam):
    world = rig["world"]
    rear, front = rig["rear"], rig["front"]
    pointer = rig["pointer"]
    arrow = rig["arrow"]
    stand = rig["stand"]
    kill = rig["kill"]
    clutch = rig["clutch"]
    tap = rig["tap"]
    cap = rig["cap"]
    cutaway = rig["cutaway"]
    keysw = rig["key"]
    kick = rig["kick"]
    glow = rig["glow"]
    mats = rig["mats"]

    # --- camera: four framings, hard cuts, one per beat plus the closing tail.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["kill"], BARS)
    frame_at(F["stand"], STAND_VIEW)
    frame_at(F["neutral"], BARS)
    frame_at(F["fuel"], TANK_VIEW)
    frame_at(F["battery"], BARS)
    frame_at(F["kick"], STAND_VIEW)
    frame_at(F["kick"] + 46, WIDE)     # the tail: the whole bike, running

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(pointer, 1, loc=(0, 0, 0), interp="CONSTANT")
    key(pointer, 1, scale=(0, 0, 0))
    key(arrow, 1, scale=(0, 0, 0))
    key(cutaway, 1, scale=(0, 0, 0))
    key(cap, 1, rot=(0, 0, 0))
    key(keysw, 1, rot=spin_to(KEY_ON), interp="CONSTANT")
    key(kill, 1, loc=KILL_STOP)
    key(clutch, 1, rot=spin_to(CLUTCH_REST))
    key(tap, 1, rot=spin_to(TAP_OFF))
    key(kick, 1, rot=spin_to(KICK_FOLD))
    key(glow, 1, scale=(0, 0, 0))
    key_colour(mats["lens"], 1, STEEL)
    key_colour(mats["kill"], 1, YELLOW)
    key_colour(mats["tap"], 1, STUD_GREY)
    key_colour(mats["stand"], 1, STUD_GREY)
    key_colour(mats["ign"], 1, YELLOW)    # ignition on, engine not running
    key_colour(mats["neu"], 1, STEEL)     # and not in neutral yet

    # --- before the first step: off the carriageway. The road slides rearward
    # by its own length-and-a-bit while the wheels turn the distance that
    # slide is worth, both off the same pair of keys so they cannot drift.
    spin = -ROLL_D / WHEEL_R
    for wheel in (rear, front):
        key(wheel, 1, rot=(0, 0, 0))
        key(wheel, 6, rot=(0, 0, 0))
        key(wheel, 38, rot=(0, spin, 0))
    key(world, 1, loc=(-ROLL_D, 0, 0))
    key(world, 6, loc=(-ROLL_D, 0, 0))
    key(world, 38, loc=(0, 0, 0))
    key(arrow, 4, scale=(0, 0, 0))
    key(arrow, 10, scale=(1, 1, 1))
    key(arrow, 34, scale=(1, 1, 1))
    key(arrow, 40, scale=(0, 0, 0))
    # The stand cannot be down while the bike is being pushed, so it goes down
    # at the end of the push, where a rider would put it. Step two then asks
    # for it back up again, which is exactly the order this happens in on a
    # roadside: park it, fiddle with it, discover the stand is still down.
    key(stand, 1, rot=(0, STAND_UP, 0))
    key(stand, 34, rot=(0, STAND_UP, 0))
    key(stand, 44, rot=(0, 0, 0))

    # --- 1: kill switch into run.
    b = F["kill"]
    point_at(pointer, b, b + 51, KILL_C, 0.085)
    key(kill, b + 16, loc=KILL_STOP)
    key(kill, b + 26, loc=KILL_RUN)
    key_colour(mats["kill"], b + 26, GREEN)

    # --- 2: side stand up.
    b = F["stand"]
    point_at(pointer, b, b + 12, (-0.725, -0.145), 0.125)
    key(stand, b + 14, rot=(0, 0, 0))
    key(stand, b + 34, rot=(0, STAND_UP, 0))
    key_colour(mats["stand"], b + 34, GREEN)

    # --- 3: neutral, or the clutch fully in. Both halves of the step, in the
    # order the sentence puts them.
    b = F["neutral"]
    point_at(pointer, b, b + 20, NEU_C, 0.070)
    key_colour(mats["neu"], b + 16, GREEN)
    point_at(pointer, b + 28, b + 48, (-1.290, 0.610), 0.085)
    key(clutch, b + 32, rot=spin_to(CLUTCH_REST))
    key(clutch, b + 40, rot=spin_to(CLUTCH_IN))
    key(clutch, b + 48, rot=spin_to(CLUTCH_IN))
    key(clutch, b + 54, rot=spin_to(CLUTCH_REST))

    # --- 4: look in the tank, then the tap: on, and then reserve.
    b = F["fuel"]
    point_at(pointer, b, b + 20, (CAP_HINGE[0] - 0.042, CAP_HINGE[1] + 0.010), 0.090)
    key(cap, b + 6, rot=(0, 0, 0))
    key(cap, b + 16, rot=(0, CAP_OPEN, 0))
    key(cutaway, b + 8, scale=(0, 0, 0))
    key(cutaway, b + 18, scale=(1, 1, 1))
    point_at(pointer, b + 28, b + 56, TAP_C, 0.085)
    key(tap, b + 30, rot=spin_to(TAP_OFF))
    key(tap, b + 40, rot=spin_to(TAP_ON))
    key_colour(mats["tap"], b + 40, GREEN)
    key(tap, b + 44, rot=spin_to(TAP_ON))
    key(tap, b + 54, rot=spin_to(TAP_RES))
    key(cutaway, b + 48, scale=(1, 1, 1))
    key(cutaway, b + 58, scale=(0, 0, 0))
    key(cap, b + 48, rot=(0, CAP_OPEN, 0))
    key(cap, b + 58, rot=(0, 0, 0))

    # --- 5: turn the key and watch the headlight. Bright and steady first,
    # for a reference, then the sag and the fast flicker that is what a flat
    # battery looks like from the saddle.
    b = F["battery"]
    point_at(pointer, b, b + 50, LAMP_C, 0.150)
    key(keysw, b + 8, rot=spin_to(KEY_ON), interp="CONSTANT")
    key(keysw, b + 14, rot=spin_to(KEY_OFF), interp="CONSTANT")
    key(keysw, b + 22, rot=spin_to(KEY_ON), interp="CONSTANT")
    key_colour(mats["ign"], b + 14, STEEL)
    key_colour(mats["neu"], b + 14, STEEL)
    key_colour(mats["ign"], b + 22, YELLOW)
    key_colour(mats["neu"], b + 22, GREEN)
    key_colour(mats["lens"], b + 23, YELLOW)
    key(glow, b + 22, scale=(0, 0, 0))
    key(glow, b + 25, scale=(1, 1, 1))
    key(glow, b + 34, scale=(1, 1, 1))
    key(glow, b + 40, scale=(0.42, 0.42, 0.42))
    flick = True
    for f in range(b + 41, b + 56, 3):
        key(glow, f, scale=(0.42, 0.42, 0.42) if flick else (0.14, 0.14, 0.14),
            interp="CONSTANT")
        key_colour(mats["lens"], f, YELLOW if flick else STEEL)
        flick = not flick

    # --- 6: kick it. Twice, because one swing of a kick lever almost never
    # does it, and the second one is what the clip ends on.
    b = F["kick"]
    point_at(pointer, b, b + 18, (-0.395, 0.185), 0.115)
    key(kick, b + 10, rot=spin_to(KICK_FOLD))
    key(kick, b + 18, rot=spin_to(KICK_TOP))
    key(kick, b + 25, rot=spin_to(KICK_DOWN))
    key(kick, b + 31, rot=spin_to(KICK_TOP))
    key(kick, b + 37, rot=spin_to(KICK_DOWN))
    key(kick, b + 42, rot=spin_to(KICK_TOP))
    key(kick, b + 50, rot=spin_to(KICK_FOLD))
    # It catches on the second one: the ignition lamp goes out and the
    # headlight comes up steady, which is what a running engine looks like on
    # an instrument panel. The cut to the wide shot is two frames later, so
    # the result is revealed by the cut rather than watched for.
    key_colour(mats["ign"], b + 39, STEEL)
    key_colour(mats["lens"], b + 39, YELLOW)
    key(glow, b + 38, scale=(0.14, 0.14, 0.14), interp="CONSTANT")
    key(glow, b + 39, scale=(1, 1, 1))
    key(glow, b + 44, scale=(1, 1, 1))


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
        "text": flat("Text", TEXT),
        "ink": flat("Ink", INK),
        "ink_soft": flat("InkSoft", INK_SOFT),
        "slate": flat("Slate", SLATE),
        "steel": flat("Steel", STEEL),
        "stud": flat("Stud", STUD_GREY),
        "brand": flat("Brand", BRAND),
        "brand_deep": flat("BrandDeep", BRAND_DEEP),
        "fuel": flat("Fuel", YELLOW),
        "glow": flat("Glow", YELLOW),
        # The five that change colour during the clip, each on its own
        # material so one set of keys cannot tint anything else.
        "lens": flat("Lens", STEEL),
        "kill": flat("Kill", YELLOW),
        "tap": flat("Tap", STUD_GREY),
        "stand": flat("StandMat", STUD_GREY),
        "ign": flat("Ign", YELLOW),
        "neu": flat("Neu", STEEL),
    }

    world = build_ground(mats)
    rear, front = build_bike(mats)
    glow = build_lamp(mats)
    build_cluster(mats)
    keysw = build_key(mats)
    kill = build_kill(mats)
    clutch = build_clutch(mats)
    cutaway, cap = build_tank_cutaway(mats)
    tap = build_tap(mats)
    stand = build_stand(mats)
    kick = build_kick(mats)
    arrow = build_arrow(mats)
    pointer = build_pointer(mats)

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

    animate(dict(world=world, rear=rear, front=front, glow=glow, key=keysw,
                 kill=kill, clutch=clutch, cutaway=cutaway, cap=cap, tap=tap,
                 stand=stand, kick=kick, arrow=arrow, pointer=pointer,
                 mats=mats), cam)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "motostart_%04d.png" % still)
        bpy.ops.render.render(write_still=True)
        print("WROTE " + scene.render.filepath)
    elif do_render:
        os.makedirs(os.path.dirname(OUT_MP4), exist_ok=True)
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
        print("WROTE %s %d bytes (%.2f s, crf %s)"
              % (OUT_MP4, os.path.getsize(OUT_MP4), F_END / float(FPS), crf))

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-start.blend"))
        print("WROTE blend")

    print("FRAMES %d DURATION %.2fs BEATS %s" % (F_END, F_END / float(FPS), F))
    return 0


if __name__ == "__main__":
    sys.exit(main())
