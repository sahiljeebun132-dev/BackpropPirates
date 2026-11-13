"""Build and render the "put the chain back on" diagram for the moto-chain guide.

Run:
    blender --background --factory-startup --python scripts/fix_chain.py -- --still 230
    blender --background --factory-startup --python scripts/fix_chain.py -- --render

    --still N   one frame to docs/pitch-assets/chain_N.png, for checking framing
    --render    the whole thing to public/guides/fix-chain.mp4
    --save      also write the .blend, so it can be opened and nudged by hand

This is a diagram that moves, not a scene. Everything is flat emissive colour
under a Standard view transform, so what renders is the hex value from
src/index.css and nothing else: no lights, no shading, no tone curve to argue
with. That is what keeps it readable at 300 px wide on a phone, which is the
only size it will ever be watched at.

The steps it shows are the ones in src/lib/breakdown.ts for 'moto-chain':
engine off and in neutral before hands go near it, the chain walked back on by
hand with the wheel rolled slowly forwards, and a look at the slack afterwards.
No figure appears on screen. The free play is a number from the bike's manual
and the guide says so; a diagram cannot know it, so it only shows where to
look. The app captions the rest.

Written against Blender 5.2, same build as scripts/crash_scene.py, and the
same three things bite here: the engine id is 'BLENDER_EEVEE', video output
needs image_settings.media_type set to VIDEO before FFMPEG can be assigned,
and a relative render path resolves against the .blend rather than the working
directory, so the output path below is absolute.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

# ------------------------------------------------------------------ timing
FPS = 24

F_START = 1
F_IGN_OFF = 24        # the ignition light goes out
F_NEUTRAL = 40        # the neutral light comes on
F_PUSH = 54           # camera leaves the wide shot
F_CLOSE = 92          # camera has arrived at the drivetrain
F_HAND_IN = 96
F_LIFT_A = 112        # the hand has the hanging chain
F_LIFT_B = 158        # the chain is over the top of the rear sprocket
F_PRESS = 172         # and pressed down onto the teeth
F_HAND_OUT = 186
F_STAND_UP = 190      # stand folds: the bike is about to be rolled
F_ROLL_START = 202
F_SEAT_END = 262      # every link has walked down into a tooth by here
F_ROLL_END = 290
F_STAND_DOWN = 300
F_SLACK_IN = 308      # the free-play marks appear
F_SLACK_END = 350
F_END = 360           # 360 frames at 24 fps = 15 s

# ------------------------------------------------------------------- layout
# Metres, side view, looking at the left of the bike - which is the side the
# chain and the side stand are both on, so one view shows the whole job.
# The front of the bike is to the left of frame, which is what you see
# standing on that side. X runs rearward, Z up, and the diagram plane is Y=0.
WHEEL_R = 0.30
WHEELBASE = 1.40
REAR_C = (0.0, 0.0)             # rear axle, and the rear sprocket with it
FRONT_AXLE = (-WHEELBASE, 0.0)
FRONT_C = (-0.52, 0.020)        # countershaft sprocket, at the swingarm pivot
GROUND_Z = -WHEEL_R

# Tooth counts first, radii derived from them. A sprocket's pitch radius is
# fixed by its teeth and the chain pitch, so deriving it this way is the only
# way the chain can sit in the teeth instead of near them.
TEETH_REAR = 23
TEETH_FRONT = 7
PITCH = 0.026                   # one schematic link; a real 520 chain is half
R_REAR = PITCH / (2 * math.sin(math.pi / TEETH_REAR))
R_FRONT = PITCH / (2 * math.sin(math.pi / TEETH_FRONT))
TOOTH_H = 0.011                 # how far a tooth stands above the pitch circle

# Where the chain hangs when it is off: a loop still round the front sprocket
# but draped below and behind the rear one, clear of the teeth.
OFF_C = (0.042, -0.140)
TOP_C = (0.030, 0.052)          # held over the top of the sprocket, mid-lift
TIP_LIFT = 0.016                # riding on the tooth tips before it seats

TURN = 2 * math.pi * 1.05       # how far the wheel is rolled, in radians
SAG_BASE = 0.010                # resting droop of the lower run, drawn not measured
SAG_SWING = 0.024               # how far the free-play check moves it

# Depth order. Nothing here is lit, so Y only decides what covers what:
# the hand in front of everything, the ground behind it all.
Y_HAND = -0.14
Y_ARROW = -0.10
Y_CHAIN = -0.06
Y_SPROCKET = -0.02
Y_BIKE = 0.02
Y_STAND = 0.08
Y_GROUND = 0.30

# Absolute: see the module docstring.
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MP4 = os.path.join(_REPO, "public", "guides", "fix-chain.mp4")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")


# ------------------------------------------------------------------ colour
def lin(hexstr: str, a: float = 1.0):
    """sRGB hex to the linear values Blender wants.

    Converted exactly rather than by eye, because with a Standard view
    transform the render is these hex values back again, and the diagram
    should be the same blue as the app.
    """
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], a)


# src/index.css, plus the slate ramp the UI already uses everywhere.
INK = "#15181f"
MACHINE = "#94a3b8"      # slate-400: the bike itself
MACHINE_DIM = "#475569"  # slate-600: rims, ground, things behind
STEEL = "#cbd5e1"        # slate-300: the sprocket, the part being aimed at
CHAIN = "#f0c000"        # flag yellow: the one thing to follow
HAND = "#189edb"         # brand blue
GREEN = "#007848"        # flag green: the neutral light
MARK = "#189edb"         # the free-play marks


# ---------------------------------------------------------------- plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def flat(name: str, hexstr: str, strength: float = 1.0):
    """A material that renders as exactly its own colour.

    Black base, all the output from emission. With no lights in the scene and
    Standard as the view transform, nothing can tint or roll off the result.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    b.inputs["Roughness"].default_value = 1.0
    b.inputs["Emission Color"].default_value = lin(hexstr)
    b.inputs["Emission Strength"].default_value = strength
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


def box(name, **kw):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    return put(o, **kw)


def disc(name, r=0.1, **kw):
    """A circle facing the camera: a cylinder laid on its side."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.004, vertices=48)
    o = bpy.context.object
    o.name = name
    kw.setdefault("rot", (math.radians(90), 0, 0))
    return put(o, **kw)


def ring(name, r=0.3, w=0.014, **kw):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=64, minor_segments=6)
    o = bpy.context.object
    o.name = name
    kw.setdefault("rot", (math.radians(90), 0, 0))
    return put(o, **kw)


def bar(name, p0, p1, w, y, material, parent=None):
    """A straight member between two points in the diagram plane."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    return box(name,
               loc=((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2),
               rot=(0, math.atan2(-dz, dx), 0),
               scale=(length, 0.004, w),
               material=material, parent=parent)


def empty(name, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def seg(f: float, a: float, b: float) -> float:
    return min(1.0, max(0.0, (f - a) / float(b - a)))


def mix(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------- chain
class Belt:
    """The closed path a chain takes round two sprockets.

    Built from the two external tangents and the two arcs rather than sampled,
    so a link can be placed at an exact distance along it. That matters: the
    links are spaced by arc length, which is the one property a real chain has
    and a drawn one usually does not.
    """

    def __init__(self, c1, r1, c2, r2):
        dx, dz = c2[0] - c1[0], c2[1] - c1[1]
        d = math.hypot(dx, dz)
        a = math.atan2(dz, dx)
        b = math.asin((r2 - r1) / d)
        self.c1, self.r1, self.c2, self.r2 = c1, r1, c2, r2
        self.tu = a + math.pi / 2 + b       # where the top run touches, both circles
        self.tl = a - math.pi / 2 - b       # and the bottom run
        self.lt = math.sqrt(d * d - (r2 - r1) ** 2)
        self.wrap2 = self.tu - self.tl      # rear wrap, swept with theta falling
        self.wrap1 = 2 * math.pi - self.wrap2
        self.s1 = self.lt
        self.s2 = self.s1 + r2 * self.wrap2
        self.s3 = self.s2 + self.lt
        self.length = self.s3 + r1 * self.wrap1
        self.p1u = (c1[0] + r1 * math.cos(self.tu), c1[1] + r1 * math.sin(self.tu))
        self.p2u = (c2[0] + r2 * math.cos(self.tu), c2[1] + r2 * math.sin(self.tu))
        self.p2l = (c2[0] + r2 * math.cos(self.tl), c2[1] + r2 * math.sin(self.tl))
        self.p1l = (c1[0] + r1 * math.cos(self.tl), c1[1] + r1 * math.sin(self.tl))

    def at(self, s: float, sag: float = 0.0):
        """Position and heading at distance s, measured from the top run.

        s grows rearward along the top. A chain on a wheel rolling forwards
        travels the other way round the loop, so the caller subtracts travel
        from s rather than adding it.
        """
        s %= self.length
        if s < self.s1:
            u = s / self.lt
            x = mix(self.p1u[0], self.p2u[0], u)
            z = mix(self.p1u[1], self.p2u[1], u)
            dx = (self.p2u[0] - self.p1u[0]) / self.lt
            dz = (self.p2u[1] - self.p1u[1]) / self.lt
        elif s < self.s2:
            t = self.tu - (s - self.s1) / self.r2
            x = self.c2[0] + self.r2 * math.cos(t)
            z = self.c2[1] + self.r2 * math.sin(t)
            dx, dz = math.sin(t), -math.cos(t)
        elif s < self.s3:
            u = (s - self.s2) / self.lt
            x = mix(self.p2l[0], self.p1l[0], u)
            z = mix(self.p2l[1], self.p1l[1], u) - sag * math.sin(math.pi * u)
            dx = (self.p1l[0] - self.p2l[0]) / self.lt
            dz = (self.p1l[1] - self.p2l[1]) / self.lt
        else:
            t = self.tl - (s - self.s3) / self.r1
            x = self.c1[0] + self.r1 * math.cos(t)
            z = self.c1[1] + self.r1 * math.sin(t)
            dx, dz = math.sin(t), -math.cos(t)
        return x, z, dx, dz


# --------------------------------------------------------------------- bike
def build_ground():
    m_line = flat("GroundLine", MACHINE_DIM)
    box("Ground", loc=(0, Y_GROUND, GROUND_Z - 0.006),
        scale=(8.0, 0.004, 0.008), material=m_line)

    # The dashes are the only thing that shows the bike is being rolled: the
    # camera stays with the machine, so the road is what moves.
    dashes = empty("Dashes")
    m_dash = flat("Dash", MACHINE_DIM)
    i = 0
    x = -2.4
    while x < 3.0:
        box("Dash%d" % i, loc=(x, Y_GROUND, GROUND_Z - 0.030),
            scale=(0.085, 0.004, 0.009), material=m_dash, parent=dashes)
        x += 0.17
        i += 1
    return dashes


def build_wheel(name, centre, m_tyre, m_rim):
    """A wheel that can be seen to turn. Spokes are the whole point of it."""
    hub = empty(name)
    hub.location = (centre[0], 0, centre[1])
    ring(name + "Tyre", r=WHEEL_R, w=0.017, loc=(0, Y_BIKE, 0),
         material=m_tyre, parent=hub)
    ring(name + "Rim", r=WHEEL_R - 0.052, w=0.006, loc=(0, Y_BIKE, 0),
         material=m_rim, parent=hub)
    for i in range(5):
        a = i * math.pi / 5
        r = WHEEL_R - 0.055
        bar("%sSpoke%d" % (name, i),
            (-math.cos(a) * r, -math.sin(a) * r),
            (math.cos(a) * r, math.sin(a) * r),
            0.006, Y_BIKE, m_rim, parent=hub)
    disc(name + "Hub", r=0.030, loc=(0, Y_BIKE - 0.005, 0),
         material=m_tyre, parent=hub)
    return hub


def build_sprocket(name, centre, radius, teeth, m_body):
    """Pitch circle, a tooth per pitch, and a plate below the roots.

    The teeth are drawn because the whole job is getting the chain into them;
    a plain disc would make the last step of the animation meaningless.
    """
    hub = empty(name)
    hub.location = (centre[0], 0, centre[1])
    ring(name + "Pitch", r=radius, w=0.0045, loc=(0, Y_SPROCKET, 0),
         material=m_body, parent=hub)
    disc(name + "Plate", r=radius - 0.012, loc=(0, Y_SPROCKET + 0.004, 0),
         material=flat(name + "PlateMat", MACHINE_DIM), parent=hub)
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        box("%sT%d" % (name, i),
            loc=(math.cos(a) * (radius + TOOTH_H / 2), Y_SPROCKET,
                 math.sin(a) * (radius + TOOTH_H / 2)),
            rot=(0, -a, 0),
            scale=(TOOTH_H, 0.004, PITCH * 0.42),
            material=m_body, parent=hub)
    return hub


def build_bike():
    m = flat("Machine", MACHINE)
    m_dim = flat("MachineDim", MACHINE_DIM)

    # Swingarm, frame, tank, seat, forks, bars. Six members and it reads as a
    # motorcycle; any more and the chain stops being the subject.
    bar("Swingarm", FRONT_C, REAR_C, 0.020, Y_BIKE, m)
    box("Engine", loc=(-0.62, Y_BIKE, 0.170), scale=(0.40, 0.004, 0.300),
        material=m_dim)
    bar("Spine", (-1.22, 0.520), (-0.30, 0.470), 0.022, Y_BIKE, m)
    bar("Down", (-1.18, 0.500), (-0.70, 0.150), 0.016, Y_BIKE, m)
    box("Tank", loc=(-0.95, Y_BIKE - 0.004, 0.600), scale=(0.46, 0.004, 0.150),
        material=m)
    box("Seat", loc=(-0.37, Y_BIKE - 0.004, 0.590), scale=(0.44, 0.004, 0.080),
        material=m_dim)
    bar("Fork", FRONT_AXLE, (-1.22, 0.620), 0.018, Y_BIKE, m)
    bar("Bars", (-1.30, 0.660), (-1.10, 0.700), 0.014, Y_BIKE, m)
    return m, m_dim


def build_cluster():
    """Two warning lights on the bars: ignition, and neutral.

    This is how "engine off, and in neutral" is said without a word of text -
    one light goes out, the other comes on, and the caption names them.
    """
    box("Cluster", loc=(-1.14, Y_BIKE - 0.008, 0.790), scale=(0.150, 0.004, 0.085),
        material=flat("ClusterCase", MACHINE_DIM))
    m_ign = flat("IgnLight", CHAIN, strength=1.0)
    m_neu = flat("NeuLight", GREEN, strength=0.08)
    disc("IgnDot", r=0.022, loc=(-1.176, Y_BIKE - 0.016, 0.790), material=m_ign)
    disc("NeuDot", r=0.022, loc=(-1.104, Y_BIKE - 0.016, 0.790), material=m_neu)
    return m_ign, m_neu


def build_stand():
    """Down for the first half, folded for the roll.

    Both wheels are on the ground on a side stand, so the bike cannot be
    rolled with it down. breakdown.ts says to roll the bike slowly forwards to
    walk the chain on, so the stand has to come up first; showing it any other
    way would be drawing something that cannot happen.
    """
    pivot = empty("StandPivot")
    pivot.location = (-0.66, Y_STAND, 0.010)
    m = flat("Stand", MACHINE)
    bar("StandLeg", (0, 0), (-0.130, -0.310), 0.016, 0.0, m, parent=pivot)
    box("StandFoot", loc=(-0.140, 0.0, -0.316), rot=(0, math.radians(-22), 0),
        scale=(0.070, 0.004, 0.012), material=m, parent=pivot)
    return pivot


def build_chain(n_links):
    m = flat("Chain", CHAIN)
    links = []
    for i in range(n_links):
        links.append(box("Link%d" % i, loc=(0, Y_CHAIN, 0),
                         scale=(0.020, 0.004, 0.013), material=m))
    return links


def build_hand():
    """A glove, near enough. It says "by hand", which is half the instruction.

    The guide is explicit that this is done with the engine off and nothing
    turning, so the tool in every shot is a hand.
    """
    root = empty("Hand")
    m = flat("HandMat", HAND)
    box("Palm", loc=(0, Y_HAND, 0), scale=(0.075, 0.004, 0.055),
        material=m, parent=root)
    box("Thumb", loc=(-0.030, Y_HAND, 0.042), rot=(0, math.radians(-28), 0),
        scale=(0.055, 0.004, 0.022), material=m, parent=root)
    box("Cuff", loc=(0.056, Y_HAND, -0.006), scale=(0.045, 0.004, 0.070),
        material=m, parent=root)
    return root


def build_arrow():
    """Which way to roll it. Forwards only - rolling back can throw the chain
    off the front sprocket, and the guide says forwards twice."""
    root = empty("Arrow")
    root.location = (REAR_C[0], 0, REAR_C[1])
    m = flat("ArrowMat", STEEL)
    r = 0.215
    for i in range(9):
        a = math.radians(40 + i * 11)
        box("ArrowSeg%d" % i,
            loc=(math.cos(a) * r, Y_ARROW, math.sin(a) * r),
            rot=(0, math.atan2(math.cos(a), -math.sin(a)), 0),
            scale=(0.030, 0.004, 0.009), material=m, parent=root)
    head = math.radians(151)
    bpy.ops.mesh.primitive_cone_add(radius1=0.026, depth=0.055, vertices=3)
    c = bpy.context.object
    c.name = "ArrowHead"
    # The cone points along its own +Z; aim that down the tangent, which at
    # this end of the arc is the way the sprocket turns as the bike rolls on.
    put(c, loc=(math.cos(head) * r, Y_ARROW, math.sin(head) * r),
        rot=(0, math.atan2(-math.sin(head), math.cos(head)), 0),
        material=m, parent=root)
    return root


def build_marks(belt):
    """Two ticks either side of the lower run, at the point it is checked.

    Deliberately without a scale on them. The amount of free play is a figure
    from the bike's manual, different on every machine, and breakdown.ts says
    it is the one number not to guess - so the diagram points at the place and
    stops there.
    """
    root = empty("Marks")
    mid_s = belt.s2 + belt.lt / 2
    x, z, _, _ = belt.at(mid_s)
    root.location = (x, 0, z)
    m = flat("MarkMat", MARK)
    for i, dz in enumerate((SAG_SWING + 0.012, -SAG_SWING - 0.012)):
        box("Mark%d" % i, loc=(0, Y_ARROW, dz), scale=(0.075, 0.004, 0.007),
            material=m, parent=root)
    box("MarkStem", loc=(-0.042, Y_ARROW, 0),
        scale=(0.006, 0.004, 2 * (SAG_SWING + 0.012)), material=m, parent=root)
    return root


# ---------------------------------------------------------------- the state
def state(f: int):
    """Everything that moves, at frame f.

    One function so the picture cannot disagree with itself: the ground speed,
    the chain travel and both sprocket angles all come out of the same wheel
    rotation rather than being keyed by eye against each other.
    """
    # Two pushes on the tyre rather than one smooth spin, because that is what
    # rolling a bike by hand looks like.
    u = seg(f, F_ROLL_START, F_ROLL_END)
    turn = TURN * (0.5 * ease(seg(u, 0.0, 0.44)) + 0.5 * ease(seg(u, 0.50, 0.96)))
    # Negative about +Y is forwards: a rotation by phi carries the top of the
    # wheel to x = r*sin(phi), so the top only moves towards the front of the
    # bike while phi falls. Chain travel and ground speed are both read off
    # this one sign, so they cannot drift apart.
    phi = -turn

    lift = ease(seg(f, F_LIFT_A, F_LIFT_B))
    press = ease(seg(f, F_LIFT_B, F_PRESS))
    cx = mix(mix(OFF_C[0], TOP_C[0], lift), REAR_C[0], press)
    cz = mix(mix(OFF_C[1], TOP_C[1], lift), REAR_C[1], press)

    # Seated: 0 while it is still being carried, 1 when every link has walked
    # down off the tooth tips into a valley.
    seat = 0.30 * press + 0.70 * ease(seg(f, F_ROLL_START, F_SEAT_END))

    w = seg(f, F_SLACK_IN, F_SLACK_END)
    window = math.sin(math.pi * w) ** 0.6 if 0 < w < 1 else 0.0
    sag = SAG_BASE + SAG_SWING * window * math.sin(2 * math.pi * 2 * w)

    stand = math.radians(-112) * (ease(seg(f, F_STAND_UP, F_ROLL_START))
                                  - ease(seg(f, F_STAND_DOWN, F_SLACK_IN)))

    # Camera: wide enough to see a bike on its stand, then in on the sprocket.
    k = ease(seg(f, F_PUSH, F_CLOSE))
    k2 = ease(seg(f, F_SLACK_IN, F_SLACK_IN + 34))
    cam_x = mix(mix(-0.70, -0.28, k), -0.30, k2)
    cam_z = mix(mix(0.25, -0.03, k), -0.075, k2)
    cam_s = mix(mix(2.50, 1.45, k), 1.28, k2)

    return {
        "phi": phi,
        "centre": (cx, cz),
        "radius": R_REAR + TIP_LIFT * (1 - seat),
        "sag": sag if seat > 0.98 else SAG_BASE * seat,
        "stand": stand,
        "ground": -WHEEL_R * phi,
        "cam": (cam_x, cam_z, cam_s),
        "ign": mix(1.0, 0.06, ease(seg(f, F_IGN_OFF - 6, F_IGN_OFF))),
        "neu": mix(0.08, 1.7, ease(seg(f, F_NEUTRAL - 6, F_NEUTRAL))),
        "arrow": (ease(seg(f, F_STAND_UP, F_ROLL_START))
                  - ease(seg(f, F_ROLL_END, F_STAND_DOWN))),
        "marks": (ease(seg(f, F_SLACK_IN, F_SLACK_IN + 14))
                  - ease(seg(f, F_END - 8, F_END))),
    }


def hand_at(f: int, st):
    """Where the hand is, and whether it is in shot at all.

    Three visits: lift the chain over the sprocket, roll the wheel, then press
    the lower run to see how much play it has.
    """
    if F_HAND_IN <= f <= F_HAND_OUT + 6:
        enter = ease(seg(f, F_HAND_IN, F_LIFT_A))
        out = ease(seg(f, F_HAND_OUT, F_HAND_OUT + 6))
        cx, cz = st["centre"]
        # Rides with the loop it is carrying, a little below and behind it.
        x = mix(0.44, cx + 0.105, enter)
        z = mix(-0.34, cz - 0.070, enter)
        return (mix(x, 0.46, out), mix(z, -0.30, out)), 1.0 - out * 0.9

    if F_STAND_UP + 2 <= f <= F_ROLL_END + 10:
        enter = ease(seg(f, F_STAND_UP + 2, F_ROLL_START))
        out = ease(seg(f, F_ROLL_END, F_ROLL_END + 10))
        # On the tyre, sweeping up its rear face: a wheel rolled forwards has
        # its back edge coming up, so that is the way the hand goes.
        u = seg(f, F_ROLL_START, F_ROLL_END)
        a = math.radians(-24 + 92 * (0.5 * ease(seg(u, 0.0, 0.44))
                                     + 0.5 * ease(seg(u, 0.50, 0.96))))
        tx = math.cos(a) * (WHEEL_R + 0.055)
        tz = math.sin(a) * (WHEEL_R + 0.055)
        return (mix(0.52, tx, enter) + out * 0.22,
                mix(-0.34, tz, enter)), 1.0 - out * 0.9

    if F_SLACK_IN - 10 <= f:
        enter = ease(seg(f, F_SLACK_IN - 10, F_SLACK_IN + 8))
        return (-0.26, mix(-0.34, -0.085 - st["sag"] - 0.040, enter)), enter

    return (0.6, -0.4), 0.0


# ---------------------------------------------------------------- animation
def animate(objs, n_links):
    """Keyframe every frame, with linear interpolation.

    Every curve here is already smooth because state() shapes it, so letting
    Blender guess bezier handles between sparse keys could only add overshoot
    the maths did not ask for - and on a chain, overshoot means links sliding
    through teeth.
    """
    prefs = getattr(bpy.context.preferences, "edit", None)
    previous = None
    if prefs is not None and hasattr(prefs, "keyframe_new_interpolation_type"):
        previous = prefs.keyframe_new_interpolation_type
        prefs.keyframe_new_interpolation_type = "LINEAR"

    ign = objs["ign"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    neu = objs["neu"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]

    try:
        for f in range(F_START, F_END + 1):
            st = state(f)
            phi = st["phi"]

            belt = Belt(FRONT_C, R_FRONT, st["centre"], st["radius"])
            # Links are spaced evenly round whatever loop they are on, so the
            # pitch breathes by well under a percent as the loop is lifted.
            # A real chain holds its pitch and changes its droop instead; at
            # this scale the difference is a fraction of a pixel.
            spacing = belt.length / n_links
            travel = -phi * st["radius"]

            for i, link in enumerate(objs["links"]):
                x, z, dx, dz = belt.at(i * spacing - travel, st["sag"])
                link.location = (x, Y_CHAIN, z)
                link.rotation_euler = Euler((0, math.atan2(-dz, dx), 0))
                link.keyframe_insert("location", frame=f)
                link.keyframe_insert("rotation_euler", frame=f)

            for name, ratio in (("rear_wheel", 1.0), ("front_wheel", 1.0),
                                ("rear_sprocket", 1.0),
                                ("front_sprocket", R_REAR / R_FRONT)):
                o = objs[name]
                o.rotation_euler = Euler((0, phi * ratio, 0))
                o.keyframe_insert("rotation_euler", frame=f)

            objs["dashes"].location = (st["ground"], 0, 0)
            objs["dashes"].keyframe_insert("location", frame=f)

            objs["stand"].rotation_euler = Euler((0, st["stand"], 0))
            objs["stand"].keyframe_insert("rotation_euler", frame=f)

            (hx, hz), hv = hand_at(f, st)
            objs["hand"].location = (hx, 0, hz)
            objs["hand"].scale = (max(hv, 0.001),) * 3
            objs["hand"].keyframe_insert("location", frame=f)
            objs["hand"].keyframe_insert("scale", frame=f)

            for key in ("arrow", "marks"):
                o = objs[key]
                o.scale = (max(st[key], 0.001),) * 3
                o.keyframe_insert("scale", frame=f)

            cx, cz, cs = st["cam"]
            objs["cam"].location = (cx, -3.0, cz)
            objs["cam"].keyframe_insert("location", frame=f)
            objs["cam"].data.ortho_scale = cs
            objs["cam"].data.keyframe_insert("ortho_scale", frame=f)

            ign.default_value = st["ign"]
            ign.keyframe_insert("default_value", frame=f)
            neu.default_value = st["neu"]
            neu.keyframe_insert("default_value", frame=f)
    finally:
        if previous is not None:
            prefs.keyframe_new_interpolation_type = previous


# ------------------------------------------------------------------- render
def setup_render(scene):
    scene.render.engine = "BLENDER_EEVEE"      # 5.2 calls it this again
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = F_START, F_END
    scene.eevee.taa_render_samples = 32        # flat shapes; this is only edges
    scene.eevee.use_shadows = False            # there is nothing to cast one
    # Standard, not AgX. The whole point of this diagram is that a colour on
    # screen is the colour in src/index.css; a film curve would mute it.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("Flat")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = lin(INK)
    bg.inputs[1].default_value = 1.0
    scene.world = world


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    still = int(argv[argv.index("--still") + 1]) if "--still" in argv else None
    do_render = "--render" in argv
    do_save = "--save" in argv

    clear()
    scene = bpy.context.scene

    dashes = build_ground()
    m_machine, m_dim = build_bike()
    m_ign, m_neu = build_cluster()
    stand = build_stand()

    rear_wheel = build_wheel("RearWheel", REAR_C, m_machine, m_dim)
    front_wheel = build_wheel("FrontWheel", FRONT_AXLE, m_machine, m_dim)
    m_steel = flat("Steel", STEEL)
    rear_sprocket = build_sprocket("RearSprocket", REAR_C, R_REAR, TEETH_REAR, m_steel)
    front_sprocket = build_sprocket("FrontSprocket", FRONT_C, R_FRONT, TEETH_FRONT, m_steel)

    seated = Belt(FRONT_C, R_FRONT, REAR_C, R_REAR)
    n_links = int(round(seated.length / PITCH))
    links = build_chain(n_links)

    hand = build_hand()
    arrow = build_arrow()
    marks = build_marks(seated)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.5
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    # Straight on, down +Y. An orthographic camera is what makes this a
    # diagram rather than a photograph: no perspective, so a circle stays a
    # circle and the chain cannot foreshorten into something ambiguous.
    cam.rotation_euler = Euler((math.radians(90), 0, 0))
    scene.camera = cam

    animate({
        "links": links, "rear_wheel": rear_wheel, "front_wheel": front_wheel,
        "rear_sprocket": rear_sprocket, "front_sprocket": front_sprocket,
        "dashes": dashes, "stand": stand, "hand": hand, "arrow": arrow,
        "marks": marks, "cam": cam, "ign": m_ign, "neu": m_neu,
    }, n_links)

    setup_render(scene)
    print("CHAIN %d links, loop %.0f mm, rear r %.1f mm, front r %.1f mm"
          % (n_links, seated.length * 1000, R_REAR * 1000, R_FRONT * 1000))

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "chain_%04d.png" % still)
        bpy.ops.render.render(write_still=True)
        print("WROTE " + scene.render.filepath)
    elif do_render:
        # Blender 5 split still and movie output behind media_type: assigning
        # FFMPEG before switching it raises "enum not found" with a list that
        # omits every video format. Set deliberately, in this order.
        scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        # This ships inside the APK, so the budget is tighter than the picture
        # needs. Flat colour and hard edges survive it; the size is printed at
        # the end of the render so it can be checked rather than assumed.
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        os.makedirs(os.path.dirname(OUT_MP4), exist_ok=True)
        scene.render.filepath = OUT_MP4
        bpy.ops.render.render(animation=True)
        size = os.path.getsize(OUT_MP4)
        print("WROTE %s %d bytes (%.2f s)"
              % (OUT_MP4, size, (F_END - F_START + 1) / float(FPS)))

    if do_save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(STILL_DIR, "fix-chain.blend"))
        print("WROTE blend")

    return 0


if __name__ == "__main__":
    sys.exit(main())
