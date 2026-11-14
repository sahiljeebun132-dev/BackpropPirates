"""Build and render the schematic "lights have failed" guide that ships in the APK.

Run:
    blender --background --factory-startup --python scripts/fix_moto_lights.py -- --render
    blender --background --factory-startup --python scripts/fix_moto_lights.py -- --still 190
    blender --background --factory-startup --python scripts/fix_moto_lights.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/lights_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-moto-lights.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'moto-lights' steps in src/lib/breakdown.ts, in their order,
because the app captions this clip with those steps: a picture that drifts from
the words printed under it is worse than no picture. Written step 2 is the long
one — find the box, read the fuse, fit the same rating — so it gets three beats
of its own rather than being squeezed into one. Four places where the clip and
the text are not a line-for-line match, all deliberate:

  - The written steps are a list of checks, not one repair in sequence. So the
    clip is a list too: the fuse goes again and the box is shut, and the next
    beat starts clean on the connector with a light that works. Every hard cut
    is a new panel, the way each step is a new line. Running them as one
    continuous story would have meant either dropping "if it blows again,
    stop" or drawing a rider ignoring it.
  - The fuse's rating is drawn as a row of pips on its body, not as a number,
    because this clip carries no text. The replacement is accepted when its
    pips light one for one against the blown one's, and a four-pip fuse is
    offered first and sent back. That is the caution — same rating, never a
    higher one — said without a word.
  - The blown fuse is already parted when the clip cuts to it. It is shown
    beside an unbroken one and the two are ringed in turn, which is what the
    step asks for; animating the break would have claimed it happened at that
    moment, which is not what the rider is looking at.
  - The last step says to push on the kerb side and to wear anything
    reflective. Neither is drawn. This is a side elevation, so there is no
    kerb side to move to, and no figure appears anywhere in this clip, so
    there is nobody to put a reflective band on. What is drawn is the half a
    side view can carry honestly: the bike moving with nobody on it, and a
    phone torch aimed back down the road at the traffic.

No hand appears at the fuse box. A glove drawn to scale against a 20 mm fuse
covers the thing the beat is about, so the fuse is marked with a ring and
lifts out on its own, the way the nuts lay themselves out in a row in
fix_tyre.py. The hand is kept for the two places where it is the instruction:
pushing a plug home, and holding the torch.

Style is a diagram that moves, not a film: an orthographic side elevation,
pure emission materials and the Standard view transform, so every pixel is
exactly the hex value it was given. Cuts between the five framings are hard,
because a hard cut costs no bitrate and this file has to fit in an APK.

Written against Blender 5.2, the same build as scripts/fix_tyre.py, and the
things that script learned the hard way apply here too: the engine id is
'BLENDER_EEVEE', image_settings.media_type has to be VIDEO before FFMPEG can
be assigned, the output path must be absolute or the render lands next to the
.blend, keyframe_new_interpolation_type does nothing on this build so the
interpolation is set on the keyframe points afterwards, and Action.fcurves is
not where the curves live.

One more, learned here: a plate in this file is a unit cube wearing its size
as its object scale, so keying scale to (1, 1, 1) to make something visible
does not reveal it, it inflates it to a one-metre cube. Every object records
the scale it was built at and show() restores that.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

# ------------------------------------------------------------------ timeline
FPS = 24

# Each beat is a step of the guide, with its length in frames. The start frames
# are derived, so retiming one beat moves everything after it rather than
# silently overlapping the next. Written step 2 is three beats: finding the
# box, reading the fuse, and fitting the right one.
BEATS = (
    ("switch", 46),      # step 1: the light switch, and the dip position
    ("fuse_find", 50),   # step 2a: the cover off, the suspect fuse out
    ("fuse_look", 68),   # step 2b: parted and blackened, against an unbroken one
    ("fuse_fit", 96),    # step 2c: the same rating, pip for pip
    ("blows", 46),       # step 3: it goes again straight away, so stop
    ("connector", 56),   # step 4: a plug shaken loose behind the headlight
    ("push", 54),        # step 5: push it, do not ride it
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
BRAND_DEEP = "#0e6fa3"
YELLOW = "#f0c000"
GREEN = "#007848"
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"
STUD_GREY = "#64748b"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller y
# is nearer the lens, so this table is the draw order read top to bottom. The
# road line is deliberately in front of the wheel halos: a halo is a little
# wider than its tyre, so it hangs below the tarmac and has to be covered.
LAY = {
    "fill": 1.60,
    "dash": 1.45,
    "frame": 1.00,
    "body": 0.95,
    "halo": 0.90,
    "ground": 0.88,
    "tyre": 0.85,
    "rim": 0.80,
    "spoke": 0.75,
    "cap": 0.70,
    "loom": 0.70,
    "glow": 0.69,
    "boxcase": 0.68,
    "blade": 0.68,
    "dbody": 0.66,
    "slot": 0.66,
    "shell": 0.64,
    "fuse": 0.62,
    "delem": 0.61,
    "lens": 0.60,
    "dscorch": 0.59,
    "dring": 0.58,
    "pod": 0.58,
    "conn": 0.57,
    "dpip": 0.56,
    "panel": 0.50,
    "toggle": 0.48,
    "mark": 0.45,
    "beam": 0.32,
    "hand": 0.30,
    "phone": 0.28,
}
PLATE = 0.004  # thickness of every plate; the layers above all clear it

# ------------------------------------------------------------------ the bike
# Metres, side elevation, the left of the bike, front to the right of frame.
# Road at z = 0, so a wheel centre is one radius up. The front faces right for
# the same reason the car in fix_tyre.py does: the push at the end then runs
# the way the frame is read.
WHEEL_R = 0.30
HALO_R = 0.330
RIM_R = 0.185
CAP_R = 0.055
SPOKE_LEN = 0.125

REAR_X = -0.72
FRONT_X = 0.72
AXLE_R = (REAR_X, WHEEL_R)
AXLE_F = (FRONT_X, WHEEL_R)
PIVOT = (-0.16, 0.34)          # swingarm pivot
HEAD_TOP = (0.58, 0.86)        # top of the fork

HEADLIGHT = (0.86, 0.74)
HEADLIGHT_R = 0.115
LENS_R = 0.082

POD = (0.38, 0.955)            # the switch pod on the bars
POD_W, POD_H = 0.140, 0.080
TOGGLE_DX = 0.036              # how far the toggle slides either side of centre

# The connector, in the loom above and behind the headlight, which is where
# breakdown.ts says the loom moves most. The socket half is fixed; the plug
# half is the one that has shaken loose. It sits clear of the frame members so
# that the close framing is a plug and a lamp and nothing else.
CONN_Z = 0.900
CONN_W, CONN_H = 0.062, 0.095
CONN_SOCKET_X = 0.720
CONN_PLUG_HOME = 0.655
CONN_PLUG_LOOSE = 0.575

# The fuse box, under the seat behind a side cover.
BOX_C = (-0.47, 0.615)
BOX_W, BOX_H = 0.300, 0.160
SLOT_COUNT = 4
SLOT_STEP = 0.066
SLOT_X0 = BOX_C[0] - SLOT_STEP * (SLOT_COUNT - 1) / 2
SLOT_Z = 0.610
SMALL_FUSE_W, SMALL_FUSE_H = 0.048, 0.085
SUSPECT = 1                    # which slot the blown one is in
FUSE_OUT_Z = 0.900             # above the close framing, where a fuse waits
PANEL_W, PANEL_H = 0.320, 0.182
PANEL_OFF_X = -1.00            # where the cover goes when it comes off

# ------------------------------------------------- the fuse detail, off stage
# Drawn five times the size of the ones in the box and parked well off to the
# right, the way fix_tyre.py parks its spare wheel. A hard cut to it reads as a
# close-up, and at this size the strip inside is a shape rather than a
# suggestion of one.
DET_Z = 0.62
DET_A_X = 4.66                 # the one that came out: parted, blackened
DET_C_X = 5.00                 # the wrong one: one pip too many
DET_B_X = 5.34                 # the right one: unbroken strip, same pips
DET_ABOVE_Z = 1.35             # where the wrong one waits, out of the framing

FUSE_W, FUSE_H = 0.260, 0.340
BLADE_W, BLADE_H = 0.044, 0.100
BLADE_DX = 0.075
ELEM_W = 0.020                 # the strip inside
ELEM_TOP_DZ = 0.030            # height of the span, from the body centre
ELEM_FOOT_DZ = -0.120
PIP_S = 0.030                  # one notch of rating
PIP_STEP = 0.046
PIP_DZ = 0.120
BREAK_SCALE = 0.50             # how far back each half of a parted strip pulls

# ---------------------------------------------------------------- the framing
# (centre, ortho_scale). ortho_scale is the width of the view, so the height is
# that times 9/16.
WIDE = ((0.00, 0.48), 2.60)
BAR = ((0.64, 0.84), 0.98)
BOX = ((-0.47, 0.615), 0.46)
DETAIL = ((5.00, 0.60), 1.20)
HEAD = ((0.76, 0.82), 0.74)

# Where the hand waits, just outside the framing it is used in, so that the
# pop from hidden to visible always happens off screen.
PARK_HEAD = (0.30, 0.900)
PARK_PUSH = (-1.48, 0.780)
TORCH_HOLD = (-0.92, 0.780)

HAND_REACH = 0.059             # hand origin to fingertips

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(_REPO, "public", "guides")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _linear(channel: float) -> float:
    # Blender wants scene-referred values. With the Standard view transform the
    # encode on the way out is the exact inverse of this, so a hex here comes
    # back as the same hex in the file.
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def rgba(hex_string: str):
    h = hex_string.lstrip("#")
    return tuple(_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def flat(name: str, hex_string: str):
    """A material that is only its own colour, with no lighting at all.

    A bare Emission node cannot be lit by accident, which is the whole point of
    a diagram.
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
    # The scale this thing was built at, so show() can put it back.
    obj["base"] = tuple(obj.scale)
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


def member(name, p0, p1, w, layer, material, parent=None):
    """A straight frame member between two points in the diagram plane."""
    (x0, z0), (x1, z1) = p0, p1
    dx, dz = x1 - x0, z1 - z0
    length = math.hypot(dx, dz)
    return plate(name, length, w, ((x0 + x1) / 2, layer, (z0 + z1) / 2),
                 material=material, parent=parent, spin=-math.atan2(dz, dx))


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    o["base"] = (1.0, 1.0, 1.0)
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
    """On or off, by scale, back to whatever scale the thing was built at.

    Hidden by being scaled away rather than dimmed: an emission strength of
    zero is black, and a black shape on a pale page is still a shape.
    """
    base = tuple(obj["base"]) if "base" in obj else (1.0, 1.0, 1.0)
    key(obj, frame, scale=base if on else (0.0, 0.0, 0.0), interp=interp)


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 20.0, 6.4, (0, LAY["fill"], -3.2), material=mats["road"])
    # Thick enough, and near enough the lens, to cover the strip of wheel halo
    # that hangs below the tarmac.
    plate("RoadLine", 20.0, 0.060, (0, LAY["ground"], -0.030), material=mats["text"])
    # The dashes are the only thing that shows the bike is being pushed: the
    # camera stays with the machine, so the road is what moves.
    dashes = empty("Dashes")
    x = -2.6
    i = 0
    while x < 2.6:
        plate("Dash%d" % i, 0.085, 0.018, (x, LAY["dash"], -0.095),
              material=mats["steel"], parent=dashes)
        x += 0.185
        i += 1
    return dashes


# ------------------------------------------------------------------- the bike
def build_wheel(name, mats):
    """Tyre, rim, spokes, cap, and a pale ring behind the lot.

    The ring is the cheap way to get an outline: the tyre is nearly the same
    ink as the frame it overlaps, and without it the wheel disappears into the
    machine. The spokes are here so that a roll reads as a roll; a plain disc
    spins invisibly.
    """
    root = empty(name)
    disc(name + "Halo", HALO_R, (0, LAY["halo"], 0), material=mats["bg"], parent=root)
    disc(name + "Tyre", WHEEL_R, (0, LAY["tyre"], 0), material=mats["ink"], parent=root)
    disc(name + "Rim", RIM_R, (0, LAY["rim"], 0), material=mats["steel"], parent=root)
    for i in range(5):
        a = math.radians(90 + i * 72)
        plate("%sSpoke%d" % (name, i), SPOKE_LEN, 0.040,
              (SPOKE_LEN / 2 * math.cos(a), LAY["spoke"], SPOKE_LEN / 2 * math.sin(a)),
              material=mats["ink_soft"], parent=root, spin=-a)
    disc(name + "Cap", CAP_R, (0, LAY["cap"], 0), material=mats["ink"], parent=root)
    return root


def build_bike(mats):
    """The mass of a motorcycle is the engine and the tank between the wheels.

    Those are drawn solid and everything else is the few members that join them
    up. Any more detail and the fuse box stops being the subject; any less and
    the thing on screen is a bicycle. The engine is kept well clear of the
    cover over the fuse box: drawn touching, the two merged into one slab and
    the bike lost its waist.
    """
    member("Swingarm", PIVOT, AXLE_R, 0.030, LAY["frame"], mats["ink_soft"])
    member("Shock", (-0.30, 0.34), (-0.26, 0.62), 0.022, LAY["frame"], mats["slate"])
    plate("Engine", 0.400, 0.260, (-0.06, LAY["body"], 0.420), material=mats["ink_soft"])
    member("DownTube", (0.52, 0.80), (0.10, 0.42), 0.026, LAY["frame"], mats["ink_soft"])
    member("Spine", (0.50, 0.82), (-0.12, 0.715), 0.028, LAY["frame"], mats["ink_soft"])
    plate("Tank", 0.400, 0.170, (0.14, LAY["body"], 0.775), material=mats["ink_soft"])
    plate("Seat", 0.440, 0.075, (-0.36, LAY["body"], 0.755), material=mats["ink"])
    plate("Tail", 0.180, 0.062, (-0.665, LAY["body"], 0.740), material=mats["slate"])
    member("Fork", AXLE_F, HEAD_TOP, 0.028, LAY["frame"], mats["ink_soft"])
    member("Bars", (0.58, 0.880), (0.30, 0.950), 0.024, LAY["frame"], mats["ink_soft"])
    member("LampStay", (0.62, 0.800), (0.80, 0.760), 0.026, LAY["frame"],
           mats["ink_soft"])

    rear = build_wheel("Rear", mats)
    rear.location = (AXLE_R[0], 0, AXLE_R[1])
    front = build_wheel("Front", mats)
    front.location = (AXLE_F[0], 0, AXLE_F[1])
    return rear, front


def build_headlight(mats):
    """Shell, lens, and a halo behind it for when it finally works.

    The lens is its own material so it can be dull slate for most of the clip
    and lit for the one beat where the fault turns out to be the connector.
    """
    disc("HeadShell", HEADLIGHT_R, (HEADLIGHT[0], LAY["shell"], HEADLIGHT[1]),
         material=mats["ink_soft"])
    lens_mat = flat("LensMat", SLATE)
    disc("HeadLens", LENS_R, (HEADLIGHT[0], LAY["lens"], HEADLIGHT[1]),
         material=lens_mat)
    glow = ring("HeadGlow", HEADLIGHT_R + 0.042, 0.013,
                (HEADLIGHT[0], LAY["glow"], HEADLIGHT[1]), material=mats["yellow"])
    return lens_mat, glow


def build_switch(mats):
    """A pod on the bars with a toggle that snaps between detents.

    breakdown.ts: "Many bikes have a separate light switch, and a dip-beam
    position that can look like a failure." Three detents is what that is.
    """
    plate("Pod", POD_W, POD_H, (POD[0], LAY["pod"], POD[1]), material=mats["slate"])
    toggle = plate("Toggle", 0.040, 0.050, (POD[0], LAY["toggle"], POD[1]),
                   material=mats["brand"])
    halo = ring("PodHalo", 0.092, 0.011, (POD[0], LAY["mark"], POD[1]),
                material=mats["brand"])
    return toggle, halo


def build_connector(mats):
    """Two halves of a plug and the loom that runs from it to the headlight.

    The whole run is parented to one empty and kept hidden except for its own
    beat: drawn all the way through, a floating block and a wire read as
    litter in the wide shot, where nothing has yet said what they are.
    """
    root = empty("Loom")
    loom_mat = flat("LoomMat", SLATE)
    member("LoomBack", (0.44, 0.855), (0.560, 0.900), 0.014, LAY["loom"],
           loom_mat, parent=root)
    member("LoomFront", (0.745, 0.895), (0.850, 0.845), 0.014, LAY["loom"],
           loom_mat, parent=root)
    plate("ConnSocket", CONN_W, CONN_H, (CONN_SOCKET_X, LAY["conn"], CONN_Z),
          material=mats["ink_soft"], parent=root)
    plug = plate("ConnPlug", CONN_W, CONN_H, (CONN_PLUG_LOOSE, LAY["conn"], CONN_Z),
                 material=mats["slate"], parent=root)
    return root, loom_mat, plug


def build_fuse_box(mats):
    """The box, its slots, four small fuses, the cover and a marker ring.

    The fuses in the box are too small to show a strip, which is the whole
    reason the next beat cuts away to a drawn-up pair. What this framing can
    carry is which one is coming out, and later that the box gets shut again.
    """
    plate("BoxCase", BOX_W, BOX_H, (BOX_C[0], LAY["boxcase"], BOX_C[1]),
          material=mats["slate"])
    fuses = []
    for i in range(SLOT_COUNT):
        x = SLOT_X0 + i * SLOT_STEP
        plate("Slot%d" % i, SMALL_FUSE_W + 0.008, SMALL_FUSE_H + 0.008,
              (x, LAY["slot"], SLOT_Z), material=mats["ink"])
        fuses.append(plate("SmallFuse%d" % i, SMALL_FUSE_W, SMALL_FUSE_H,
                           (x, LAY["fuse"], SLOT_Z), material=mats["yellow"]))
    panel = plate("Panel", PANEL_W, PANEL_H, (BOX_C[0], LAY["panel"], BOX_C[1]),
                  material=mats["ink_soft"])
    marker = ring("BoxMarker", 0.062, 0.009,
                  (SLOT_X0 + SUSPECT * SLOT_STEP, LAY["mark"], SLOT_Z),
                  material=mats["brand"])

    # The replacement is a different object from the one that came out, so the
    # clip is fitting a new fuse rather than pushing the dead one back in. It
    # waits above the box, outside the close framing.
    new_mat = flat("NewFuseMat", YELLOW)
    new_fuse = plate("NewFuse", SMALL_FUSE_W, SMALL_FUSE_H,
                     (SLOT_X0 + SUSPECT * SLOT_STEP, LAY["fuse"], FUSE_OUT_Z),
                     material=new_mat)
    new_scorch = disc("NewScorch", 0.015,
                      (SLOT_X0 + SUSPECT * SLOT_STEP, LAY["dscorch"], SLOT_Z),
                      material=mats["ink"], verts=12)
    return fuses, panel, marker, new_fuse, new_mat, new_scorch


# ------------------------------------------------------------- the big fuses
def build_big_fuse(name, x, mats, *, pips, parted):
    """One blade fuse drawn large: body, blades, the strip inside, and pips.

    The strip is a squared arch — up one blade, across, down the other —
    because that is the shape a rider is being asked to look at. On a blown one
    the span is two halves hung off their own corners and pulled back, so the
    gap opens in the middle instead of the strip sliding sideways, with a
    scorch on each broken end. "Parted or blackened" is then one picture.

    The pips are the rating. There is no text in this clip, so the number is a
    count of notches: the replacement is right when its pips light one for one
    against the blown one's.
    """
    root = empty(name, (x, 0, DET_Z))
    plate(name + "Body", FUSE_W, FUSE_H, (0, LAY["dbody"], 0),
          material=mats["yellow"], parent=root)
    strip = mats["ink"] if parted else mats["slate"]
    for s in (-1, 1):
        plate("%sBlade%d" % (name, s), BLADE_W, BLADE_H,
              (s * BLADE_DX, LAY["blade"], -(FUSE_H / 2 + BLADE_H / 2 - 0.02)),
              material=mats["steel"], parent=root)
        plate("%sLeg%d" % (name, s), ELEM_W, ELEM_TOP_DZ - ELEM_FOOT_DZ,
              (s * BLADE_DX, LAY["delem"], (ELEM_TOP_DZ + ELEM_FOOT_DZ) / 2),
              material=strip, parent=root)

    span = 2 * BLADE_DX
    for s in (-1, 1):
        hinge = empty("%sHinge%d" % (name, s), (s * BLADE_DX, 0, ELEM_TOP_DZ),
                      parent=root)
        plate("%sSpan%d" % (name, s), span / 2, ELEM_W,
              (-s * span / 4, LAY["delem"], 0), material=strip, parent=hinge)
        if parted:
            hinge.scale = (BREAK_SCALE, 1.0, 1.0)
            hinge["base"] = tuple(hinge.scale)
            disc("%sScorch%d" % (name, s), 0.015,
                 (s * span / 2 * BREAK_SCALE, LAY["dscorch"], ELEM_TOP_DZ),
                 material=mats["ink"], parent=root, verts=12)

    pip_mats = []
    x0 = -PIP_STEP * (pips - 1) / 2
    for i in range(pips):
        m = flat("%sPip%d" % (name, i), INK)
        plate("%sPipPlate%d" % (name, i), PIP_S, PIP_S,
              (x0 + i * PIP_STEP, LAY["dpip"], PIP_DZ), material=m, parent=root)
        pip_mats.append(m)

    marker = ring(name + "Mark", 0.072, 0.011, (0, LAY["dring"], ELEM_TOP_DZ),
                  material=mats["brand"], parent=root)
    return dict(root=root, pips=pip_mats, marker=marker)


# ------------------------------------------------------------- hand and torch
def build_hand(mats):
    """A glove, near enough. It says "by hand", which is half the instruction.

    Built pointing along -X, fingers first, so one glyph can push a plug home
    and hold a phone without being redrawn; a half turn about Y points it the
    other way. The torch rides on it as a child with its own switch, so it is
    only there for the last beat.
    """
    root = empty("Hand")
    m = mats["brand"]
    plate("Palm", 0.075, 0.078, (0.028, LAY["hand"], 0), material=m, parent=root)
    for i, dz in enumerate((0.025, 0.0, -0.025)):
        plate("Finger%d" % i, 0.050, 0.017, (-0.034, LAY["hand"], dz),
              material=m, parent=root)
    plate("Thumb", 0.048, 0.019, (-0.012, LAY["hand"], 0.047),
          material=m, parent=root, spin=math.radians(-26))
    plate("Cuff", 0.032, 0.088, (0.076, LAY["hand"], 0), material=m, parent=root)

    torch = empty("Torch", (0, 0, 0), parent=root)
    plate("Phone", 0.055, 0.110, (-0.090, LAY["phone"], 0),
          material=mats["ink_soft"], parent=torch)
    # The beam, aimed back down the road at the traffic rather than forward.
    for i, (dx, h) in enumerate(((-0.150, 0.056), (-0.210, 0.042), (-0.270, 0.030))):
        plate("Beam%d" % i, 0.035, h, (dx, LAY["beam"], 0),
              material=mats["yellow"], parent=torch)
    return root, torch


# ---------------------------------------------------------------- animation
def animate(cam, rig):
    rear, front = rig["rear"], rig["front"]
    dashes = rig["dashes"]
    lens, glow = rig["lens"], rig["glow"]
    toggle, pod_halo = rig["toggle"], rig["pod_halo"]
    loom_root, loom, plug = rig["loom_root"], rig["loom"], rig["plug"]
    fuses, panel = rig["fuses"], rig["panel"]
    marker, new_fuse, new_mat = rig["marker"], rig["new_fuse"], rig["new_mat"]
    new_scorch = rig["new_scorch"]
    hand, torch = rig["hand"], rig["torch"]
    A, B, C = rig["fuse_a"], rig["fuse_b"], rig["fuse_c"]
    suspect = fuses[SUSPECT]
    suspect_x = SLOT_X0 + SUSPECT * SLOT_STEP

    # --- camera: five framings, hard cuts. The clip opens wide for long enough
    # to show what the machine is before the first step takes a piece off it.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["switch"] + 16, BAR)
    frame_at(F["fuse_find"], BOX)
    frame_at(F["fuse_look"], DETAIL)
    frame_at(F["fuse_fit"] + 80, BOX)
    frame_at(F["connector"], HEAD)
    frame_at(F["push"], WIDE)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(panel, 1, loc=(BOX_C[0], LAY["panel"], BOX_C[1]), interp="CONSTANT")
    key(toggle, 1, loc=(POD[0], LAY["toggle"], POD[1]), interp="CONSTANT")
    key(plug, 1, loc=(CONN_PLUG_LOOSE, LAY["conn"], CONN_Z), interp="CONSTANT")
    key(suspect, 1, loc=(suspect_x, LAY["fuse"], SLOT_Z), interp="CONSTANT")
    key(new_fuse, 1, loc=(suspect_x, LAY["fuse"], FUSE_OUT_Z), interp="CONSTANT")
    key(hand, 1, loc=(PARK_HEAD[0], 0, PARK_HEAD[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(rear, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(front, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(dashes, 1, loc=(0, 0, 0), interp="CONSTANT")
    key(C["root"], 1, loc=(DET_C_X, 0, DET_ABOVE_Z), interp="CONSTANT")
    key(B["root"], 1, loc=(DET_B_X, 0, DET_Z), interp="CONSTANT")
    key_colour(lens, 1, SLATE)
    key_colour(loom, 1, SLATE)
    key_colour(new_mat, 1, YELLOW)
    for pip in A["pips"] + B["pips"] + C["pips"]:
        key_colour(pip, 1, INK)
    for obj in (glow, pod_halo, marker, torch, loom_root, hand, new_fuse,
                new_scorch, A["marker"], B["marker"], C["marker"]):
        show(obj, 1, False)
    show(suspect, 1, True)

    # --- step 1: the obvious switch. The toggle snaps through its detents and
    # the lens stays dull the whole way, which is the point of the step.
    s = F["switch"]
    show(pod_halo, s + 19, True)
    key(toggle, s + 20, loc=(POD[0], LAY["toggle"], POD[1]), interp="CONSTANT")
    key(toggle, s + 26, loc=(POD[0] - TOGGLE_DX, LAY["toggle"], POD[1]),
        interp="CONSTANT")
    key(toggle, s + 33, loc=(POD[0] + TOGGLE_DX, LAY["toggle"], POD[1]),
        interp="CONSTANT")
    key(toggle, s + 40, loc=(POD[0], LAY["toggle"], POD[1]), interp="CONSTANT")
    show(pod_halo, s + 43, False)

    # --- step 2a: the cover off, the suspect fuse ringed and drawn out.
    s = F["fuse_find"]
    key(panel, s + 3, loc=(BOX_C[0], LAY["panel"], BOX_C[1]), interp="LINEAR")
    key(panel, s + 19, loc=(PANEL_OFF_X, LAY["panel"], BOX_C[1]))
    show(marker, s + 23, True)
    key(suspect, s + 30, loc=(suspect_x, LAY["fuse"], SLOT_Z), interp="LINEAR")
    key(suspect, s + 44, loc=(suspect_x, LAY["fuse"], FUSE_OUT_Z))
    show(suspect, s + 46, False)
    show(marker, s + 47, False)

    # --- step 2b: what a blown one looks like, against one that is not. The
    # ring goes to the gap first and then to the unbroken span, because that is
    # the order the sentence puts them in.
    s = F["fuse_look"]
    show(A["marker"], s + 8, True)
    show(A["marker"], s + 32, False)
    show(B["marker"], s + 38, True)
    show(B["marker"], s + 64, False)

    # --- step 2c: the same rating. A fuse with one pip too many comes down,
    # three of its pips find a partner and the fourth does not, and it goes
    # back where it came from. Then the right one is counted in and accepted.
    s = F["fuse_fit"]
    key(C["root"], s + 4, loc=(DET_C_X, 0, DET_ABOVE_Z), interp="LINEAR")
    key(C["root"], s + 19, loc=(DET_C_X, 0, DET_Z))
    for i in range(3):
        f = s + 24 + i * 6
        key_colour(A["pips"][i], f, BRAND)
        key_colour(C["pips"][i], f, BRAND)
    for i in range(3):
        key_colour(A["pips"][i], s + 46, INK)
        key_colour(C["pips"][i], s + 46, INK)
    key(C["root"], s + 44, loc=(DET_C_X, 0, DET_Z), interp="LINEAR")
    key(C["root"], s + 58, loc=(DET_C_X, 0, DET_ABOVE_Z))

    for i in range(3):
        f = s + 60 + i * 5
        key_colour(A["pips"][i], f, BRAND)
        key_colour(B["pips"][i], f, BRAND)
    for i in range(3):
        key_colour(A["pips"][i], s + 74, GREEN)
        key_colour(B["pips"][i], s + 74, GREEN)
    key(B["root"], s + 66, loc=(DET_B_X, 0, DET_Z), interp="LINEAR")
    key(B["root"], s + 78, loc=(DET_C_X, 0, DET_Z))

    # Back at the box, the new fuse goes into the empty slot.
    show(new_fuse, s + 81, True)
    key(new_fuse, s + 82, loc=(suspect_x, LAY["fuse"], FUSE_OUT_Z), interp="LINEAR")
    key(new_fuse, s + 93, loc=(suspect_x, LAY["fuse"], SLOT_Z))

    # --- step 3: it goes again straight away. The fuse lights, flashes out,
    # goes dead and scorches, and the cover goes back on: stop, not another
    # one. There is no headlight in this framing — the step is about the fuse,
    # and the picture stays on the thing the caption is naming.
    s = F["blows"]
    key_colour(new_mat, s + 6, BRAND)
    key_colour(new_mat, s + 14, BG)
    key_colour(new_mat, s + 17, SLATE)
    show(new_scorch, s + 19, True)
    key(panel, s + 24, loc=(PANEL_OFF_X, LAY["panel"], BOX_C[1]), interp="LINEAR")
    key(panel, s + 40, loc=(BOX_C[0], LAY["panel"], BOX_C[1]))

    # --- step 4: a plug shaken loose behind the headlight, pushed home. This
    # is a fresh check, not a continuation of the one above, which is why the
    # cut is hard and the light is allowed to work here.
    s = F["connector"]
    show(loom_root, s, True)
    key(hand, s, rot=(0, math.pi, 0), interp="CONSTANT")  # fingers now point +x
    show(hand, s + 3, True)
    key(hand, s + 3, loc=(PARK_HEAD[0], 0, PARK_HEAD[1]), interp="LINEAR")
    push_from = CONN_PLUG_LOOSE - CONN_W / 2 - HAND_REACH
    key(hand, s + 14, loc=(push_from, 0, CONN_Z))
    key(plug, s + 16, loc=(CONN_PLUG_LOOSE, LAY["conn"], CONN_Z), interp="LINEAR")
    key(plug, s + 28, loc=(CONN_PLUG_HOME, LAY["conn"], CONN_Z))
    key(hand, s + 16, loc=(push_from, 0, CONN_Z), interp="LINEAR")
    key(hand, s + 28, loc=(push_from + CONN_PLUG_HOME - CONN_PLUG_LOOSE, 0, CONN_Z))
    key_colour(loom, s + 30, BRAND)
    key_colour(lens, s + 32, YELLOW)
    show(glow, s + 34, True)
    key(hand, s + 34,
        loc=(push_from + CONN_PLUG_HOME - CONN_PLUG_LOOSE, 0, CONN_Z), interp="LINEAR")
    key(hand, s + 46, loc=(PARK_HEAD[0], 0, PARK_HEAD[1]))
    show(hand, s + 48, False)

    # --- step 5: push it, do not ride it. The lights are off again, because
    # this is the step for when they could not be got back. Nobody is on the
    # bike and nobody appears: the only hand in frame is holding the phone, and
    # its beam points back down the road rather than along it.
    s = F["push"]
    key_colour(lens, s, SLATE)
    key_colour(loom, s, SLATE)
    show(glow, s, False)
    show(loom_root, s, False)
    key(hand, s, rot=(0, 0, 0), interp="CONSTANT")
    show(hand, s + 2, True)
    show(torch, s + 2, True)
    key(hand, s + 2, loc=(PARK_PUSH[0], 0, PARK_PUSH[1]), interp="LINEAR")
    key(hand, s + 13, loc=(TORCH_HOLD[0], 0, TORCH_HOLD[1]))
    roll = 2.2
    key(rear, s + 6, rot=(0, 0, 0), interp="LINEAR")
    key(front, s + 6, rot=(0, 0, 0), interp="LINEAR")
    key(dashes, s + 6, loc=(0, 0, 0), interp="LINEAR")
    key(rear, s + 48, rot=(0, roll, 0))
    key(front, s + 48, rot=(0, roll, 0))
    # The ground moves the other way by exactly what the wheels rolled, so the
    # two cannot drift apart and the bike cannot appear to skate.
    key(dashes, s + 48, loc=(-WHEEL_R * roll, 0, 0))


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
        "yellow": flat("Yellow", YELLOW),
        "green": flat("Green", GREEN),
    }

    dashes = build_road(mats)
    rear, front = build_bike(mats)
    lens, glow = build_headlight(mats)
    toggle, pod_halo = build_switch(mats)
    loom_root, loom, plug = build_connector(mats)
    fuses, panel, marker, new_fuse, new_mat, new_scorch = build_fuse_box(mats)
    hand, torch = build_hand(mats)

    fuse_a = build_big_fuse("FuseA", DET_A_X, mats, pips=3, parted=True)
    fuse_b = build_big_fuse("FuseB", DET_B_X, mats, pips=3, parted=False)
    fuse_c = build_big_fuse("FuseC", DET_C_X, mats, pips=4, parted=False)
    fuse_c["root"].location = (DET_C_X, 0, DET_ABOVE_Z)

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

    animate(cam, dict(
        rear=rear, front=front, dashes=dashes, lens=lens, glow=glow,
        toggle=toggle, pod_halo=pod_halo, loom_root=loom_root, loom=loom,
        plug=plug, fuses=fuses, panel=panel, marker=marker, new_fuse=new_fuse,
        new_mat=new_mat, new_scorch=new_scorch, hand=hand, torch=torch,
        fuse_a=fuse_a, fuse_b=fuse_b, fuse_c=fuse_c,
    ))
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, "lights_%04d.png" % still)
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
        out = os.path.join(OUT_DIR, "fix-moto-lights.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print("WROTE %s %d bytes (%.2f s, crf %s)"
              % (out, os.path.getsize(out), F_END / float(FPS), crf))

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-moto-lights.blend"))
        print("WROTE blend")

    print("FRAMES %d DURATION %.2fs BEATS %s" % (F_END, F_END / FPS, F))
    return 0


if __name__ == "__main__":
    sys.exit(main())
