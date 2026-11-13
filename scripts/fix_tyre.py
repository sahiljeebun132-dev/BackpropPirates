"""Build and render the schematic wheel-change guide that ships in the APK.

Run:
    blender --background --factory-startup --python scripts/fix_tyre.py -- --render
    blender --background --factory-startup --python scripts/fix_tyre.py -- --still 180
    blender --background --factory-startup --python scripts/fix_tyre.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/tyre_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-tyre.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'flat-tyre' steps in src/lib/breakdown.ts, in their order,
because the app captions this clip with those steps: a picture that drifts
from the words printed under it is worse than no picture. Two places where
the clip and the text are not a line-for-line match, both deliberate:

  - The opening beat shows a chock going in behind the rear wheel. The guide's
    `before` list secures the car with the handbrake and gear rather than a
    chock, so this beat reads as "the car cannot move" generally, alongside
    the hazard lights that list does ask for.
  - breakdown.ts snugs the nuts in a star pattern while the car is still up,
    then lowers and tightens firmly in the same order. There is not room for
    two star passes inside the length budget, so the hand-start beat runs in
    star order and the one full star pass is the firm one after lowering.

Style is a diagram that moves, not a film: an orthographic side elevation,
pure emission materials and the Standard view transform, so every pixel is
exactly the hex value it was given. Cuts between the two framings are hard,
because a hard cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, the same build as scripts/crash_scene.py, and
the three things that script learned the hard way apply here too: the engine
id is 'BLENDER_EEVEE', image_settings.media_type has to be VIDEO before
FFMPEG can be assigned, and the output path must be absolute or the render
lands next to the .blend instead of where it was asked for.
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
    ("secure", 40),      # hazards on, chock in
    ("loosen", 66),      # quarter turn on each nut, wheel still on the ground
    ("jack", 60),        # jack point, then lift
    ("wheel_off", 58),   # nuts off into a row, wheel off
    ("spare_on", 34),    # spare in
    ("hand", 40),        # every nut started by hand before any is tightened
    ("lower", 36),       # back down onto the road
    ("star", 66),        # firm, in a star pattern
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# breakdown.ts: "loosen each nut about a quarter turn".
LOOSEN_TURN = math.radians(90)

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# The neutrals are the slate family that file already uses for the page
# background and body text, plus two mid steps for the rim and the studs.
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
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "fill": 1.60,
    "ground": 1.50,
    "jack": 1.10,
    "body": 1.00,
    "window": 0.95,
    "trim": 0.90,
    "mark": 0.85,
    "halo": 0.75,
    "hubhalo": 0.70,
    "hub": 0.65,
    "stud": 0.60,
    "tyre": 0.55,
    "rim": 0.50,
    "spoke": 0.45,
    "cap": 0.40,
    "line": 0.35,
    "nut": 0.30,
    "chock": 0.25,
    "brace": 0.20,
}
PLATE = 0.02  # thickness of every plate; layers are 0.05 apart so none touch

# ------------------------------------------------------------------ geometry
REAR_X = -1.55
FRONT_X = 1.55
WHEELBASE = FRONT_X - REAR_X

TYRE_R = 0.32
HALO_R = 0.355
RIM_R = 0.205
CAP_R = 0.075
SPOKE_LEN = 0.145

HUB_R = 0.175
STUD_R = 0.028
NUT_R = 0.055
NUT_RING_R = 0.145
NUT_COUNT = 5
# A five-stud wheel is tightened by skipping one each time: 0, 2, 4, 1, 3.
STAR_ORDER = (0, 2, 4, 1, 3)

BODY_BOTTOM = 0.45
BODY_TOP = 0.95
JACK_X = 1.05
JACK_HEAD_Z = 0.44
JACK_PARK_X = 3.9

# "Raise the car until the flat tyre is just clear of the ground, no higher."
# The whole car pivots on the rear contact patch, so the jack extension and
# the tilt are two views of the same number rather than two guesses.
LIFT = 0.22
LIFT_ANGLE = -math.asin(LIFT / WHEELBASE)
JACK_RISE = (JACK_X - REAR_X) * math.sin(-LIFT_ANGLE)
LIFT_SCALE = (JACK_HEAD_Z + JACK_RISE) / JACK_HEAD_Z

BRACE_LEN = 0.60
# The brace always works across the top of the wheel, whichever nut it is on.
# Swinging it out radially put the handle through the road on the low nuts.
BRACE_PHI_OUT = math.radians(60)    # tight end of the sweep
BRACE_PHI_BACK = math.radians(150)  # loose end

WHEEL_PARK = (3.70, 0.32)   # just off the right edge of the close framing
WHEEL_GONE = (4.30, -0.90)  # and then out of the scene entirely
SPARE_PARK_X = 7.00

TRAY_X0 = 0.52
TRAY_STEP = 0.15
TRAY_Z = NUT_R

WIDE = ((0.15, 0.80), 5.0)
CLOSE = ((1.58, 0.52), 2.8)

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


def triangle(name, r, loc, *, material=None, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    # No extra spin: Blender starts a circle's vertices at local +Y, which the
    # same quarter turn about X that faces the prism at the lens carries round
    # to world +Z. Adding a Y quarter turn, as looked right on paper, rendered
    # an arrow pointing along the sill instead of up at the jack point.
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


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

    The obvious route, preferences.edit.keyframe_new_interpolation_type, is
    the one scripts/crash_scene.py uses, and on this 5.2 build it does
    nothing at all: the preference reads back as CONSTANT and the keyframe
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


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 20.0, 6.4, (0, LAY["fill"], -3.2), material=mats["road"])
    plate("RoadLine", 20.0, 0.06, (0, LAY["ground"], -0.03), material=mats["text"])


# ------------------------------------------------------------------- the car
def build_wheel(name, parent, mats, *, rim_mat):
    """Tyre, rim, spokes, cap, and a pale ring behind the lot.

    The ring is the cheap way to get an outline: the tyre is nearly the same
    ink as the body it overlaps, so without it the wheel disappears into the
    car exactly where the clip needs it to be the clearest thing on screen.
    """
    root = empty(name, parent=parent)
    disc(name + "Halo", HALO_R, (0, LAY["halo"], 0), material=mats["bg"], parent=root)
    disc(name + "Tyre", TYRE_R, (0, LAY["tyre"], 0), material=mats["ink"], parent=root)
    disc(name + "Rim", RIM_R, (0, LAY["rim"], 0), material=rim_mat, parent=root)
    for i in range(NUT_COUNT):
        # Offset from the studs so a spoke never sits under a nut. They are
        # here so that a roll reads as a roll; a plain disc spins invisibly.
        a = math.radians(90 + 36 + i * 72)
        plate(f"{name}Spoke{i}", SPOKE_LEN, 0.05,
              (SPOKE_LEN / 2 * math.cos(a), LAY["spoke"], SPOKE_LEN / 2 * math.sin(a)),
              material=mats["ink_soft"], parent=root, spin=-a)
    disc(name + "Cap", CAP_R, (0, LAY["cap"], 0), material=mats["ink"], parent=root)
    return root


def build_car(mats):
    pivot = empty("Pivot", (REAR_X, 0, 0))
    car = empty("Car", (-REAR_X, 0, 0), parent=pivot)

    plate("Body", 4.20, BODY_TOP - BODY_BOTTOM,
          (0.0, LAY["body"], (BODY_TOP + BODY_BOTTOM) / 2),
          material=mats["ink_soft"], parent=car)
    plate("Cabin", 2.45, 0.48, (-0.18, LAY["body"], 1.19),
          material=mats["ink_soft"], parent=car)
    for i, x in enumerate((0.34, -0.70)):
        plate(f"Window{i}", 0.86, 0.30, (x, LAY["window"], 1.19),
              material=mats["bg"], parent=car)
    plate("Sill", 3.90, 0.07, (0.0, LAY["trim"], BODY_BOTTOM + 0.035),
          material=mats["slate"], parent=car)

    hazards = [
        plate(f"Hazard{i}", 0.26, 0.16, (x, LAY["mark"], 0.86),
              material=mats["hazard"], parent=car)
        for i, x in enumerate((-1.95, 1.95))
    ]

    # The jack point. breakdown.ts: "a reinforced pad under the sill, usually
    # marked with a notch, arrow or triangle in the trim."
    mark = triangle("JackMark", 0.075, (JACK_X, LAY["mark"], BODY_BOTTOM + 0.055),
                    material=mats["brand"], parent=car)

    rear = build_wheel("Rear", car, mats, rim_mat=mats["steel"])
    rear.location = (REAR_X, 0, TYRE_R)

    disc("HubHalo", HUB_R + 0.035, (FRONT_X, LAY["hubhalo"], TYRE_R),
         material=mats["bg"], parent=car)
    disc("Hub", HUB_R, (FRONT_X, LAY["hub"], TYRE_R), material=mats["slate"], parent=car)
    for i in range(NUT_COUNT):
        a = math.radians(90 + i * 72)
        disc(f"Stud{i}", STUD_R,
             (FRONT_X + NUT_RING_R * math.cos(a), LAY["stud"],
              TYRE_R + NUT_RING_R * math.sin(a)),
             material=mats["stud"], parent=car, verts=16)

    wheel = build_wheel("Front", car, mats, rim_mat=mats["steel"])
    wheel.location = (FRONT_X, 0, TYRE_R)

    # The spare is told apart by its rim colour and nothing else, because the
    # guide does not say what kind of spare the car is carrying.
    spare = build_wheel("Spare", car, mats, rim_mat=mats["spare_rim"])
    spare.location = (SPARE_PARK_X, 0, TYRE_R)

    nuts = []
    for i in range(NUT_COUNT):
        a = math.radians(90 + i * 72)
        nuts.append(disc(
            f"Nut{i}", NUT_R,
            (FRONT_X + NUT_RING_R * math.cos(a), LAY["nut"],
             TYRE_R + NUT_RING_R * math.sin(a)),
            material=mats["nut"][i], parent=car, verts=6))

    chock = plate("Chock", 0.30, 0.24, (-3.50, LAY["chock"], 0.12),
                  material=mats["chock"], parent=car, spin=math.radians(-20))

    return dict(pivot=pivot, car=car, wheel=wheel, spare=spare, nuts=nuts,
                mark=mark, hazards=hazards, chock=chock)


def build_jack(mats, car):
    """Foot on the road, column that grows, head against the sill.

    The column is a child of an empty whose Z scale is animated, so it grows
    from the road upward. Scaling the column itself would have grown it from
    its own middle and buried half the jack in the tarmac.
    """
    root = empty("JackRoot", (JACK_PARK_X, 0, 0), parent=car)
    plate("JackFoot", 0.30, 0.05, (0, LAY["jack"], 0.025),
          material=mats["brand_deep"], parent=root)
    lift = empty("JackLift", (0, 0, 0), parent=root)
    plate("JackColumn", 0.11, 0.42, (0, LAY["jack"], 0.21),
          material=mats["brand_deep"], parent=lift)
    plate("JackHead", 0.24, 0.08, (0, LAY["jack"], JACK_HEAD_Z),
          material=mats["brand"], parent=lift)
    return root, lift


def build_brace(mats, car):
    root = empty("Brace", (0, 0, -3.0), parent=car)
    disc("BraceSocket", 0.105, (0, LAY["brace"], 0), material=mats["brand"], parent=root)
    plate("BraceBar", BRACE_LEN - 0.08, 0.07,
          (0.08 + (BRACE_LEN - 0.08) / 2, LAY["brace"], 0),
          material=mats["text"], parent=root)
    disc("BraceKnob", 0.075, (BRACE_LEN + 0.02, LAY["brace"], 0),
         material=mats["text"], parent=root)
    return root


def build_star_lines(mats, car, nut_positions):
    """One bar per leg of the star, each grown from nothing along its leg.

    Drawn rather than implied, because the order is the whole instruction and
    there is no caption inside the frame to say it.
    """
    lines = []
    seq = list(STAR_ORDER) + [STAR_ORDER[0]]
    for j in range(len(seq) - 1):
        ax, az = nut_positions[seq[j]]
        bx, bz = nut_positions[seq[j + 1]]
        length = math.hypot(bx - ax, bz - az)
        root = empty(f"StarLine{j}", (ax, 0, az), parent=car)
        root.rotation_euler = Euler((0, -math.atan2(bz - az, bx - ax), 0))
        root.scale = (0.0, 1.0, 1.0)
        plate(f"StarBar{j}", length, 0.045, (length / 2, LAY["line"], 0),
              material=mats["brand"], parent=root)
        lines.append(root)
    return lines


# ---------------------------------------------------------------- animation
def brace_rot(phi):
    """The Y rotation that points the brace bar at screen angle phi.

    The camera looks along +Y, so a positive Y rotation reads as clockwise:
    tightening. Loosening is the other way, which is why the sweeps below run
    from BRACE_PHI_OUT backwards when the nuts are being cracked off.
    """
    return (0, -phi, 0)


def animate(rig, jack_root, jack_lift, brace, lines, cam, nut_positions):
    nuts = rig["nuts"]
    wheel = rig["wheel"]
    spare = rig["spare"]
    pivot = rig["pivot"]
    mark = rig["mark"]
    chock = rig["chock"]

    # --- hazard lights, on for the whole clip. Blinked by swapping in the
    # body's own colour, which reads as off; dimming the emission instead
    # just gave a dark amber square that still looked lit.
    haz = rig["hazards"][0].data.materials[0]
    on = True
    for f in range(1, F_END + 10, 9):
        key_colour(haz, f, YELLOW if on else INK_SOFT)
        on = not on

    # --- camera: two framings, hard cuts.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["loosen"], CLOSE)
    frame_at(F["jack"], WIDE)
    frame_at(F["wheel_off"], CLOSE)
    frame_at(F["lower"], WIDE)
    frame_at(F["star"], CLOSE)

    # --- secure: the chock goes in behind the rear wheel.
    key(chock, F["secure"], loc=(-3.50, LAY["chock"], 0.12), interp="LINEAR")
    key(chock, F["secure"] + 11, loc=(-3.50, LAY["chock"], 0.12))
    key(chock, F["secure"] + 28, loc=(-2.02, LAY["chock"], 0.12))

    # The jack point mark is hidden by being scaled away rather than dimmed:
    # an emission strength of zero is black, and a black triangle on a slate
    # sill is still a triangle on a slate sill.
    key(mark, 1, scale=(0, 0, 0), interp="CONSTANT")

    # --- loosen: a quarter turn on each nut, in order round the wheel, with
    # the wheel still on the road so it cannot spin.
    per_nut = 12
    for i in range(NUT_COUNT):
        s = F["loosen"] + 3 + i * per_nut
        nx, nz = nut_positions[i]
        key(brace, s, loc=(nx, 0, nz), rot=brace_rot(BRACE_PHI_OUT), interp="CONSTANT")
        key(brace, s + 1, rot=brace_rot(BRACE_PHI_OUT))
        key(brace, s + 9, rot=brace_rot(BRACE_PHI_OUT + LOOSEN_TURN))
        key_colour(nuts[i].data.materials[0], s + 9, YELLOW)
    key(brace, F["loosen"] + 3 + NUT_COUNT * per_nut, loc=(0, 0, -3.0), interp="CONSTANT")

    # --- jack: find the point, then lift.
    big = True
    for f in range(F["jack"], F["jack"] + 20, 4):
        key(mark, f, scale=(1.0, 1.0, 1.0) if big else (0.68, 1.0, 0.68), interp="CONSTANT")
        big = not big
    key(mark, F["jack"] + 20, scale=(1.0, 1.0, 1.0), interp="CONSTANT")

    key(jack_root, F["jack"] + 16, loc=(JACK_PARK_X, 0, 0), interp="LINEAR")
    key(jack_root, F["jack"] + 34, loc=(JACK_X, 0, 0))
    key(jack_lift, F["jack"] + 36, scale=(1, 1, 1))
    key(jack_lift, F["jack"] + 57, scale=(1, 1, LIFT_SCALE))
    key(pivot, F["jack"] + 36, rot=(0, 0, 0))
    key(pivot, F["jack"] + 57, rot=(0, LIFT_ANGLE, 0))

    # --- nuts off into a row on the road, then the wheel off. The row is
    # there so the nuts are somewhere the clip can fetch them back from.
    for i in range(NUT_COUNT):
        nx, nz = nut_positions[i]
        s = F["wheel_off"] + 3 + i * 7
        key(nuts[i], s, loc=(nx, LAY["nut"], nz))
        key(nuts[i], s + 11, loc=(TRAY_X0 + i * TRAY_STEP, LAY["nut"], TRAY_Z))

    off = F["wheel_off"] + 39
    key(wheel, off, loc=(FRONT_X, 0, TYRE_R), rot=(0, 0, 0))
    key(wheel, off + 18, loc=(WHEEL_PARK[0], 0, WHEEL_PARK[1]), rot=(0, 2.6, 0))
    # Only once it is past the right edge does it drop out of the scene, so
    # it is never seen sinking through the road.
    key(wheel, off + 19, loc=(WHEEL_GONE[0], 0, WHEEL_GONE[1]), rot=(0, 2.6, 0),
        interp="CONSTANT")

    # --- the spare goes on.
    key(spare, F["spare_on"] + 3, loc=(SPARE_PARK_X, 0, TYRE_R), rot=(0, -2.6, 0))
    key(spare, F["spare_on"] + 29, loc=(FRONT_X, 0, TYRE_R), rot=(0, 0, 0))

    # --- every nut started by hand before any of them is tightened, and in
    # star order, which is the snug pass breakdown.ts asks for before lowering.
    for j, i in enumerate(STAR_ORDER):
        nx, nz = nut_positions[i]
        s = F["hand"] + 3 + j * 6
        key(nuts[i], s, loc=(TRAY_X0 + i * TRAY_STEP, LAY["nut"], TRAY_Z))
        key(nuts[i], s + 12, loc=(nx, LAY["nut"], nz))
        key_colour(nuts[i].data.materials[0], s + 12, BRAND)

    # --- down onto the road, then the jack comes out.
    key(jack_lift, F["lower"] + 3, scale=(1, 1, LIFT_SCALE))
    key(jack_lift, F["lower"] + 27, scale=(1, 1, 1))
    key(pivot, F["lower"] + 3, rot=(0, LIFT_ANGLE, 0))
    key(pivot, F["lower"] + 27, rot=(0, 0, 0))
    key(jack_root, F["lower"] + 28, loc=(JACK_X, 0, 0), interp="LINEAR")
    key(jack_root, F["lower"] + 35, loc=(JACK_PARK_X, 0, 0))
    key(mark, F["lower"] + 35, scale=(0, 0, 0), interp="CONSTANT")

    # --- the star pattern, drawn as it is worked.
    step = 12
    for j, i in enumerate(STAR_ORDER):
        s = F["star"] + 3 + j * step
        nx, nz = nut_positions[i]
        key(brace, s, loc=(nx, 0, nz), rot=brace_rot(BRACE_PHI_BACK), interp="CONSTANT")
        key(brace, s + 1, rot=brace_rot(BRACE_PHI_BACK))
        key(brace, s + 9, rot=brace_rot(BRACE_PHI_OUT))
        key_colour(nuts[i].data.materials[0], s + 9, GREEN)
        if j > 0:
            leg = lines[j - 1]
            key(leg, s - 6, scale=(0.0, 1, 1))
            key(leg, s, scale=(1.0, 1, 1))
    last = F["star"] + 3 + (NUT_COUNT - 1) * step + 9
    key(brace, last + 2, loc=(0, 0, -3.0), interp="CONSTANT")
    # The leg that closes the star, so the clip ends on the whole figure.
    key(lines[-1], last, scale=(0.0, 1, 1))
    key(lines[-1], last + 7, scale=(1.0, 1, 1))


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

    # Both hazard squares share one material so one set of keys blinks both.
    hazard_mat = flat("Hazard", YELLOW)
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
        "spare_rim": flat("SpareRim", YELLOW),
        "hazard": hazard_mat,
        "chock": flat("Chock", YELLOW),
        "nut": [flat(f"NutMat{i}", INK) for i in range(NUT_COUNT)],
    }

    build_road(mats)
    rig = build_car(mats)
    jack_root, jack_lift = build_jack(mats, rig["car"])
    brace = build_brace(mats, rig["car"])

    nut_positions = [
        (FRONT_X + NUT_RING_R * math.cos(math.radians(90 + i * 72)),
         TYRE_R + NUT_RING_R * math.sin(math.radians(90 + i * 72)))
        for i in range(NUT_COUNT)
    ]
    lines = build_star_lines(mats, rig["car"], nut_positions)

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

    animate(rig, jack_root, jack_lift, brace, lines, cam, nut_positions)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"tyre_{still:04d}.png")
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
        scene.render.filepath = os.path.join(OUT_DIR, "fix-tyre.mp4")
        bpy.ops.render.render(animation=True)
        print(f"WROTE {scene.render.filepath}")

    if do_save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(STILL_DIR, "fix-tyre.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
