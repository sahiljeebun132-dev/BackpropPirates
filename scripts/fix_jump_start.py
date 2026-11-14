"""Build and render the jump-start diagram for the 'wont-start' guide.

Run:
    blender --background --factory-startup --python scripts/fix_jump_start.py -- --still 280
    blender --background --factory-startup --python scripts/fix_jump_start.py -- --render
    blender --background --factory-startup --python scripts/fix_jump_start.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/jump_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-jump-start.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the nine 'wont-start' steps in src/lib/breakdown.ts, in their
order, because the app captions this clip with those steps and a picture that
drifts from the words printed under it is worse than no picture.

The one thing this clip exists to get right is the order of the four clamps,
which is the part people reverse: dead positive, donor positive, donor
negative, and then an unpainted metal lug on the dead car's own engine block
rather than its negative terminal. That last clamp gets its own beat, its own
framing and a travel long enough to watch, and the dead battery's negative
post is left visibly bare beside it for the whole of it. Removal runs the
same four in reverse.

Where the clip and the text are not a line-for-line match, five places, all
deliberate:

  - Steps 1 to 3 are diagnoses rather than actions: what you hear when you
    turn the key. A silent diagram cannot play a click, so each is drawn as a
    symptom on two readouts the rest of the clip then keeps using - the
    headlamp, and the crank pulley on the engine. Dark and still is "nothing
    at all"; lit, with the pulley snatching and the lamp dipping on the same
    beat, is "a rapid clicking"; lit, with the pulley turning steadily and no
    exhaust, is "turns over but never fires".
  - Step 3 ends by saying that case is a garage job. There is no way to draw
    that without text, so the clip shows the symptom and stops; the caption
    carries the conclusion.
  - Step 4 asks for both handbrakes on as well as both engines off. Engines
    off is drawn - both lamps dark, nothing turning - and the gap between the
    bumpers is bracketed. A handbrake cannot be drawn from outside the car,
    so it is left to the caption.
  - Step 6's caution says the last connection is the one that sparks. The
    clip shows that spark, at the lug on the engine block, a car's length
    from any battery. Drawing it anywhere else would have been drawing the
    mistake.
  - Step 8 reads "drive for at least twenty minutes... remove the leads in
    the reverse order". The clip removes the leads first and then drives off,
    because that is the order the two things actually happen in. It drives
    off backwards, which the step does not mention and which is not a slip:
    two cars parked nose to nose leave the revived one no forward path, so
    backing out is genuinely its first move, and sending it the other way
    would need twice the distance across the wide framing in the same
    second. Watched at speed it reads as leaving, not as reversing.

Two conveniences that are not deviations, only hard cuts doing their job.
The engine bay is a permanent cutaway panel in the bodywork, not a bonnet
that opens: there is no bonnet anywhere in this clip, so nothing is
inconsistent, and it keeps the leads from having to thread past a raised
panel. And the dead car, which drives away at the end of step 8, is back in
its parking spot for step 9 while the donor has gone; the cut between them is
hard, so neither jump is ever seen.

No text, no faces, nothing identifiable. Style is the house one: a diagram
that moves, not a film. Orthographic side elevation, pure emission materials
and the Standard view transform, so every pixel is exactly the hex value it
was given, and hard cuts between framings, because a hard cut costs no
bitrate and this file has to fit in an APK.

Written against Blender 5.2, and the things scripts/fix_tyre.py and
scripts/fix_chain.py learned the hard way all apply: the engine id is
'BLENDER_EEVEE', image_settings.media_type has to be VIDEO before FFMPEG can
be assigned, the output path must be absolute or the render lands next to the
.blend, Action.fcurves is not where the curves live on 5.2, and
keyframe_new_interpolation_type does nothing on this build - so the keys are
flattened to LINEAR after insertion rather than before.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler

TWO_PI = 2.0 * math.pi

# ------------------------------------------------------------------ timeline
FPS = 24

# One beat per written step, length in frames. Starts are derived, so retiming
# one beat moves everything after it rather than overlapping the next.
BEATS = (
    ("dead", 48),      # 1  nothing at all: check both terminals
    ("click", 34),     # 2  a rapid clicking
    ("crank", 38),     # 3  turns over but never fires
    ("park", 44),      # 4  the good car, close but not touching
    ("leads", 72),     # 5  dead +, good +, good -
    ("block", 60),     # 6  and the last one on bare metal on the block
    ("run", 46),       # 7  run the good car, then try the flat one
    ("remove", 74),    # 8  leads off in reverse order, then drive
    ("replace", 36),   # 9  flat again means a new battery
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

B_DEAD = F["dead"]
B_CLICK = F["click"]
B_CRANK = F["crank"]
B_PARK = F["park"]
B_LEADS = F["leads"]
B_BLOCK = F["block"]
B_RUN = F["run"]
B_REMOVE = F["remove"]
B_REPLACE = F["replace"]

# ------------------------------------------------------------------- palette
# src/index.css, so the clip and the app agree, plus the slate ramp the UI
# already uses for page background and body text.
BG = "#f1f5f9"
ROAD = "#e2e8f0"
TEXT = "#0f172a"
INK = "#15181f"
INK_SOFT = "#1e2430"
SLATE = "#334155"
STEEL = "#94a3b8"
BARE = "#cbd5e1"          # unpainted metal: the lug the last clamp goes on
BRAND = "#189edb"
BRAND_DEEP = "#0e6fa3"
RED = "#d83030"           # flag red: the positive lead
YELLOW = "#f0c000"
LAMP_OFF = "#334155"      # an unlit lamp on an ink-soft body

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller y
# is nearer the lens, so this table is the draw order read top to bottom.
LAY = {
    "fill": 1.60,
    "ground": 1.50,
    "puff": 1.20,
    "body": 1.00,
    "cut": 0.96,
    "bay": 0.92,
    "window": 0.88,
    "trim": 0.84,
    "frame": 0.80,
    "block": 0.76,
    "pulley": 0.72,
    "pad": 0.68,
    "battery": 0.64,
    "post": 0.60,
    "collar": 0.56,
    "lamp": 0.52,
    "cable": 0.40,
    "clamp": 0.34,
    "mark": 0.28,
    "spark": 0.24,
}
PLATE = 0.02  # thickness of every plate; layers are 0.04 apart so none touch

# ------------------------------------------------------------------ geometry
# Side elevation, metres. The two cars are nose to nose, which is how they are
# parked for this job and, conveniently, the one arrangement where a single
# side view shows both engine bays and every clamp at once.
DEAD_X = -2.35            # the flat car, facing right
GOOD_X = 2.35             # the donor, facing left (built mirrored)

REAR_X = -1.55
FRONT_X = 1.55
TYRE_R = 0.32
HALO_R = 0.355
RIM_R = 0.205
CAP_R = 0.075
SPOKE_LEN = 0.145

BODY_BOTTOM = 0.45
BODY_TOP = 0.95

# The engine bay, drawn as a cutaway in the bodywork rather than an opened
# bonnet. Open at the top, so the clamps and leads rise out of it.
BAY_X0, BAY_X1 = 0.88, 1.84
BAY_Z0, BAY_Z1 = 0.54, 0.97

BLOCK_C = (1.12, 0.71)
BLOCK_W, BLOCK_H = 0.44, 0.30
PULLEY_C = (1.10, 0.695)
PULLEY_R = 0.105
# The whole top face of the block is unpainted metal, and the lug standing on
# it is what the fourth clamp bites. Drawn in the lightest metal in the
# palette on the darkest block, and set at the far end of the bay from the
# battery, so there is no mistaking one for the other.
BARE_C, BARE_W, BARE_H, BARE_Z = 1.16, 0.30, 0.05, 0.875
LUG_X, LUG_Z = 1.18, 0.945
LUG_W, LUG_H = 0.075, 0.09

BATT_C = (1.58, 0.70)
BATT_W, BATT_H = 0.32, 0.24
POST_DX = 0.09                 # positive is the one nearer the nose
POST_W, POST_H = 0.07, 0.09
POST_Z = 0.865
COLLAR_Z = 0.8425              # the car's own terminal, the thing step 1 checks

LAMP_C = (1.97, 0.74)
LAMP_R = 0.075
EXHAUST = (-1.98, 0.30)
PUFF_DRIFT = (-0.20, 0.28)

# Where every clamp ends up, in world coordinates. A clamp grips from above,
# so its root sits just below the top of whatever it is on.
DEAD_POS = (DEAD_X + BATT_C[0] + POST_DX, 0.895)     # (-0.68, 0.895)
GOOD_POS = (GOOD_X - BATT_C[0] - POST_DX, 0.895)     # ( 0.68, 0.895)
GOOD_NEG = (GOOD_X - BATT_C[0] + POST_DX, 0.895)     # ( 0.86, 0.895)
LUG_CLAMP = (DEAD_X + LUG_X, 0.975)                  # (-1.17, 0.975)

CLAMP_LEAD = 0.095        # from a clamp's root to where its cable leaves it
CLAMP_TOP = 0.0925        # and to the top of its body
PARK = (7.50, 0.30)       # off the right of every framing

# Holds: where a clamp waits, in shot, before it is put on.
A_HOLD = (DEAD_POS[0], 1.42)
B_HOLD = (GOOD_POS[0], 1.42)
C_HOLD = (GOOD_NEG[0], 1.40)
D_HOLD = (1.55, 1.40)
D_OVER = (LUG_CLAMP[0], 1.30)

N_CABLE = 26
CABLE_W = 0.020
# How high a lead hangs. It has to clear the nose of both cars and the clamp
# already sitting on the next post along, and still stay inside the tight
# framing the fourth clamp is watched in, which is what sets these two.
ARCH_K, ARCH_B = 0.32, 0.10

# ------------------------------------------------------------------ framings
# (centre x, centre z), orthographic scale. Hard cuts between them.
WIDE = ((0.00, 0.80), 9.40)
PAIR = ((0.00, 0.82), 3.60)
BAY = ((-1.05, 0.72), 2.80)
TERM = ((-0.77, 0.80), 1.30)
BLOCKV = ((-0.90, 0.88), 2.30)

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(_REPO, "public", "guides")
OUT_MP4 = os.path.join(OUT_DIR, "fix-jump-start.mp4")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _linear_channel(channel: float) -> float:
    # Blender wants scene-referred values. With the Standard view transform
    # the encode on the way out is the exact inverse of this, so a hex here
    # comes back as the same hex in the file.
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def rgba(hex_string: str):
    h = hex_string.lstrip("#")
    return tuple(_linear_channel(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def mix_rgba(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def flat(name: str, hex_string: str):
    """A material that is only its own colour, with no lighting at all.

    A bare Emission node cannot be lit by accident, which is the whole point
    of a diagram.
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


def ring(name, r, w, loc, *, material=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=56, minor_segments=6)
    o = bpy.context.object
    o.name = name
    return put(o, loc=loc, rot=(math.pi / 2, 0, 0), material=material, parent=parent)


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


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def seg(f: float, a: float, b: float) -> float:
    if b <= a:
        return 1.0 if f >= b else 0.0
    return min(1.0, max(0.0, (f - a) / float(b - a)))


def mix(a, b, t):
    return a + (b - a) * t


def mix2(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


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


def linearize(holders):
    """Flatten every key to LINEAR, after insertion.

    preferences.edit.keyframe_new_interpolation_type does nothing on this 5.2
    build - the preference reads back as set and the key is still born BEZIER
    - so the curves are corrected once at the end instead. Every value in this
    clip is already shaped frame by frame by state(), so bezier handles could
    only add overshoot the maths did not ask for.
    """
    for h in holders:
        for curve in _curves(h):
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 34.0, 6.4, (0, LAY["fill"], -3.2), material=mats["road"])
    plate("RoadLine", 34.0, 0.06, (0, LAY["ground"], -0.03), material=mats["text"])


# ------------------------------------------------------------------ the cars
def build_wheel(name, parent, mats):
    """Tyre, rim, spokes, cap, and a pale ring behind the lot.

    The ring is the cheap way to get an outline: the tyre is nearly the same
    ink as the body it overlaps, so without it the wheel disappears into the
    car. The spokes are here so a roll reads as a roll; a plain disc spins
    invisibly, and both cars roll in this clip.
    """
    root = empty(name, parent=parent)
    disc(name + "Halo", HALO_R, (0, LAY["body"] - 0.01, 0), material=mats["bg"], parent=root)
    disc(name + "Tyre", TYRE_R, (0, LAY["cut"], 0), material=mats["ink"], parent=root)
    disc(name + "Rim", RIM_R, (0, LAY["bay"], 0), material=mats["steel"], parent=root)
    for i in range(5):
        a = math.radians(90 + i * 72)
        plate(f"{name}Spoke{i}", SPOKE_LEN, 0.05,
              (SPOKE_LEN / 2 * math.cos(a), LAY["window"], SPOKE_LEN / 2 * math.sin(a)),
              material=mats["ink_soft"], parent=root, spin=-a)
    disc(name + "Cap", CAP_R, (0, LAY["trim"], 0), material=mats["ink"], parent=root)
    return root


def build_battery(name, parent, mats, *, face, loc, case_hex):
    """A case, a lid, two posts and the car's own terminal on each post.

    Positive is the post nearer the nose on both cars, so the red lead runs
    straight across the gap without crossing the black one. Post offsets are
    measured from where a fitted battery sits, not from wherever this root
    happens to be parked, so the spare waiting above the bay for step 9 is
    the same object and not a pile of loose parts.
    """
    root = empty(name, (face * loc[0], 0, loc[1]), parent=parent)
    plate(name + "Case", BATT_W, BATT_H, (0, LAY["battery"], 0),
          material=flat(name + "CaseMat", case_hex), parent=root)
    plate(name + "Lid", BATT_W, 0.045, (0, LAY["post"], BATT_H / 2 - 0.0225),
          material=mats["slate"], parent=root)
    collars = {}
    for sign, key, hexv in ((+1, "pos", RED), (-1, "neg", INK)):
        px = face * sign * POST_DX
        plate(f"{name}{key.title()}Post", POST_W, POST_H,
              (px, LAY["post"], POST_Z - BATT_C[1]),
              material=flat(f"{name}{key}PostMat", hexv), parent=root)
        collars[key] = plate(f"{name}{key.title()}Collar", 0.11, 0.045,
                             (px, LAY["collar"], COLLAR_Z - BATT_C[1]),
                             material=mats["steel"], parent=root)
    return root, collars


def build_engine(name, parent, mats, *, face):
    """Block, crank pulley, a bare metal top face and the lug on it.

    The lug is the whole reason this clip exists: it is the one place on the
    dead car the fourth clamp may go.
    """
    plate(name + "Block", BLOCK_W, BLOCK_H, (face * BLOCK_C[0], LAY["block"], BLOCK_C[1]),
          material=mats["slate"], parent=parent)
    plate(name + "Bare", BARE_W, BARE_H, (face * BARE_C, LAY["pad"], BARE_Z),
          material=mats["bare"], parent=parent)
    plate(name + "Lug", LUG_W, LUG_H, (face * LUG_X, LAY["pad"], LUG_Z),
          material=mats["bare"], parent=parent)

    pulley = empty(name + "Pulley", (face * PULLEY_C[0], 0, PULLEY_C[1]), parent=parent)
    disc(name + "PulleyFace", PULLEY_R, (0, LAY["pulley"], 0),
         material=mats["steel"], parent=pulley)
    for i in range(3):
        a = math.radians(90 + i * 120)
        plate(f"{name}PulleySpoke{i}", 0.085, 0.026,
              (0.0425 * math.cos(a), LAY["pad"], 0.0425 * math.sin(a)),
              material=mats["slate"], parent=pulley, spin=-a)
    disc(name + "PulleyHub", 0.028, (0, LAY["battery"], 0),
         material=mats["slate"], parent=pulley)
    return pulley


def build_car(name, x, face, mats, *, lamp_mat, with_puffs):
    """One car in side elevation, facing +X when face is 1 and -X when -1.

    Mirroring multiplies every local x rather than using a negative parent
    scale, so a child's keyed rotation still means what it says.
    """
    root = empty(name, (x, 0, 0))

    def X(v):
        return face * v

    plate(name + "Body", 4.20, BODY_TOP - BODY_BOTTOM,
          (0.0, LAY["body"], (BODY_TOP + BODY_BOTTOM) / 2),
          material=mats["ink_soft"], parent=root)
    plate(name + "Cabin", 2.45, 0.48, (X(-0.18), LAY["body"], 1.19),
          material=mats["ink_soft"], parent=root)
    # A square-cornered cabin on a slab reads as a pickup truck, which is the
    # wrong vehicle for a guide whose first line says "car". A raked screen at
    # each end is the cheapest thing that fixes it.
    corner_cut(name + "Windscreen", (X(0.30), 1.43), (X(1.045), 1.05),
               (X(1.045), 1.43), mats["bg"], root)
    corner_cut(name + "RearScreen", (X(-0.95), 1.43), (X(-1.405), 1.12),
               (X(-1.405), 1.43), mats["bg"], root)
    plate(name + "WindowFront", 0.62, 0.24, (X(0.18), LAY["window"], 1.15),
          material=mats["bg"], parent=root)
    plate(name + "WindowRear", 0.70, 0.24, (X(-0.78), LAY["window"], 1.15),
          material=mats["bg"], parent=root)
    plate(name + "Sill", 3.90, 0.07, (0.0, LAY["trim"], BODY_BOTTOM + 0.035),
          material=mats["slate"], parent=root)

    # The engine bay: a cutaway, not an opened bonnet. No top bar, so the
    # leads and clamps rise out of it into clear sky.
    plate(name + "Bay", BAY_X1 - BAY_X0, BAY_Z1 - BAY_Z0,
          (X((BAY_X0 + BAY_X1) / 2), LAY["bay"], (BAY_Z0 + BAY_Z1) / 2),
          material=mats["bg"], parent=root)
    for key, bw, bh, bx, bz in (
        ("BayL", 0.03, BAY_Z1 - BAY_Z0, BAY_X0, (BAY_Z0 + BAY_Z1) / 2),
        ("BayR", 0.03, BAY_Z1 - BAY_Z0, BAY_X1, (BAY_Z0 + BAY_Z1) / 2),
        ("BayB", BAY_X1 - BAY_X0 + 0.03, 0.03, (BAY_X0 + BAY_X1) / 2, BAY_Z0),
    ):
        plate(name + key, bw, bh, (X(bx), LAY["frame"], bz),
              material=mats["slate"], parent=root)

    pulley = build_engine(name, root, mats, face=face)
    batt, collars = build_battery(name + "Batt", root, mats,
                                  face=face, loc=BATT_C, case_hex=INK_SOFT)

    disc(name + "LampRing", LAMP_R + 0.016, (X(LAMP_C[0]), LAY["collar"], LAMP_C[1]),
         material=mats["bg"], parent=root)
    disc(name + "Lamp", LAMP_R, (X(LAMP_C[0]), LAY["lamp"], LAMP_C[1]),
         material=lamp_mat, parent=root)

    rear = build_wheel(name + "Rear", root, mats)
    rear.location = (X(REAR_X), 0, TYRE_R)
    front = build_wheel(name + "Front", root, mats)
    front.location = (X(FRONT_X), 0, TYRE_R)

    # Exhaust: the only thing that says an engine caught rather than merely
    # turned. Only the flat car gets it, because the donor's tailpipe sits on
    # the edge of the widest framing and a half-cut puff there is clutter.
    puffs = []
    if with_puffs:
        for i in range(3):
            puffs.append(disc(f"{name}Puff{i}", 0.055,
                              (X(EXHAUST[0]), LAY["puff"], EXHAUST[1]),
                              material=mats["steel"], parent=root, verts=16))

    return dict(root=root, pulley=pulley, batt=batt, collars=collars,
                wheels=(rear, front), puffs=puffs, face=face)


# ----------------------------------------------------------------- the leads
def build_clamp(name, hex_string):
    """A clamp drawn as a C whose mouth faces down, so it can drop onto a
    battery post or onto the lug on the block without being re-drawn, and the
    cable always leaves out of the top of it."""
    root = empty(name)
    m = flat(name + "Mat", hex_string)
    plate(name + "Body", 0.105, 0.075, (0, LAY["clamp"], 0.0525),
          material=m, parent=root)
    for i, dx in enumerate((-0.056, 0.056)):
        plate(f"{name}Jaw{i}", 0.024, 0.095, (dx, LAY["clamp"], -0.0275),
              material=m, parent=root)
    return root


def build_cable(name, hex_string):
    m = flat(name + "Mat", hex_string)
    return [plate(f"{name}{i}", 0.05, CABLE_W, (PARK[0], LAY["cable"], PARK[1]),
                  material=m)
            for i in range(N_CABLE)]


def cable_point(clamp_xz):
    return (clamp_xz[0], clamp_xz[1] + CLAMP_LEAD)


def place_cable(segs, p0, p1):
    """Lay the segments along a quadratic arch between two clamp tops.

    An arch rather than a sag, because in a side elevation the lead has to get
    over the nose of both cars to reach the other battery, and over whatever
    clamp is already on the post next door. The rise scales with the span, so
    a lead held in mid-air before it is clipped on never loops into the sky.
    """
    (x0, z0), (x1, z1) = p0, p1
    span = math.hypot(x1 - x0, z1 - z0)
    cx = (x0 + x1) / 2
    cz = (z0 + z1) / 2 + ARCH_K * span + ARCH_B
    pts = []
    for i in range(N_CABLE + 1):
        t = i / float(N_CABLE)
        u = 1.0 - t
        pts.append((u * u * x0 + 2 * u * t * cx + t * t * x1,
                    u * u * z0 + 2 * u * t * cz + t * t * z1))
    for i, s in enumerate(segs):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        length = math.hypot(bx - ax, bz - az)
        s.location = ((ax + bx) / 2, LAY["cable"], (az + bz) / 2)
        s.rotation_euler = Euler((0, -math.atan2(bz - az, bx - ax), 0))
        s.scale = (max(length, 1e-4), PLATE, CABLE_W)


# --------------------------------------------------------------- the markers
def build_check_ring(mats):
    root = empty("CheckRing")
    ring("CheckRingBody", 0.105, 0.012, (0, LAY["mark"], 0),
         material=mats["brand"], parent=root)
    return root


def build_lug_ring(mats):
    root = empty("LugRing", (LUG_CLAMP[0], 0, LUG_Z))
    ring("LugRingBody", 0.125, 0.012, (0, LAY["mark"], 0),
         material=mats["brand"], parent=root)
    return root


def build_spark(mats):
    """Six short bars off the contact point. The caution under step 6 says the
    last connection is the one that sparks; this is that spark, drawn where
    the step puts it and nowhere near a battery."""
    root = empty("Spark", (LUG_CLAMP[0], 0, LUG_CLAMP[1] - 0.01))
    for i in range(6):
        a = math.radians(18 + i * 60)
        plate(f"SparkBar{i}", 0.085, 0.018,
              (0.095 * math.cos(a), LAY["spark"], 0.095 * math.sin(a)),
              material=mats["yellow"], parent=root, spin=-a)
    return root


def build_gap(mats):
    """Close but not touching: a bracket between the two bumpers."""
    root = empty("GapMark", (0, 0, 0.30))
    for i, gx in enumerate((DEAD_X + 2.10, GOOD_X - 2.10)):
        plate(f"GapTick{i}", 0.022, 0.22, (gx, LAY["mark"], 0),
              material=mats["brand"], parent=root)
    plate("GapBar", (GOOD_X - 2.10) - (DEAD_X + 2.10), 0.022,
          (0, LAY["mark"], 0), material=mats["brand"], parent=root)
    return root


WAIT_N = 10
WAIT_C = (1.26, 1.62)
WAIT_R = 0.27
WAIT_W, WAIT_H = 0.150, 0.040


def build_wait(mats):
    """Let it run two or three minutes: a ring that fills, segment by segment.

    A clock would need numbers on it and this clip has no text anywhere, so
    the passing of time is a bar that gets longer.
    """
    segs = []
    for i in range(WAIT_N):
        a = math.radians(90 - i * (360.0 / WAIT_N))
        spin = math.atan2(-math.cos(a), -math.sin(a))
        segs.append(plate(
            f"WaitSeg{i}", WAIT_W, WAIT_H,
            (WAIT_C[0] + WAIT_R * math.cos(a), LAY["mark"],
             WAIT_C[1] + WAIT_R * math.sin(a)),
            material=mats["brand"], spin=spin))
    return segs


# ----------------------------------------------------------------- the state
def click_pulse(f):
    """One cycle of a starter solenoid that cannot turn the engine.

    A fast snatch and a slower release, nine times. There is no sound in an
    APK clip, so the click is drawn twice over: the pulley jumps and the
    headlamp dips on the same beat, which is what a flat battery actually
    does.
    """
    u = seg(f, B_CLICK + 4, B_CLICK + 31)
    if u <= 0.0 or u >= 1.0:
        return 0.0
    ph = (u * 9.0) % 1.0
    pull = ease(min(1.0, ph / 0.18))
    rel = ease(max(0.0, (ph - 0.30) / 0.40))
    return max(0.0, pull - rel)


def dead_crank(f):
    """The flat car's crank pulley, as one accumulating angle.

    Built as a sum rather than keyed by eye so it can only ever move one way
    and never jumps backwards between beats.
    """
    a = -0.42 * click_pulse(f)
    a -= TWO_PI * 2.5 * ease(seg(f, B_CRANK + 2, B_CRANK + 35))
    a -= TWO_PI * 1.6 * ease(seg(f, B_RUN + 19, B_RUN + 31))
    if f > B_RUN + 31:
        a -= TWO_PI * 1.6 * (min(f, B_REPLACE - 1) - (B_RUN + 31)) / float(FPS)
    return a


def good_crank(f):
    a = -TWO_PI * 1.2 * ease(seg(f, B_RUN, B_RUN + 8))
    if f > B_RUN + 8:
        a -= TWO_PI * 1.6 * (min(f, B_REPLACE - 1) - (B_RUN + 8)) / float(FPS)
    return a


def camera_at(f):
    if f < B_DEAD + 14:
        return BAY                       # nothing happens: lamp dark, nothing turning
    if f < B_CLICK:
        return TERM                      # both terminals, tight
    if f < B_PARK:
        return BAY                       # the clicking, then the steady crank
    if f < B_LEADS:
        return WIDE                      # the good car arrives
    if f < B_BLOCK + 23:
        return PAIR                      # three clamps, then the fourth sets off
    if f < B_RUN:
        return BLOCKV                    # and lands on the lug
    if f < B_REMOVE:
        return WIDE                      # both engines
    if f < B_REMOVE + 48:
        return PAIR                      # four clamps off, in reverse
    if f < B_REPLACE:
        return WIDE                      # and away
    return BAY                           # flat again: a new battery


def state(f):
    """Everything that moves, at frame f.

    One function, so the picture cannot disagree with itself: a car's wheel
    rotation is read off the same number as its position, and a lead's shape
    is read off wherever its two clamps happen to be.
    """
    st = {}

    (cx, cz), cs = camera_at(f)
    st["cam"] = (cx, cz, cs)

    # --- where the two cars are. The donor is parked off the right of every
    # framing before it arrives, and again for step 9, which the hard cut into
    # that step hides.
    good_x = GOOD_X + mix(6.6, 0.0, ease(seg(f, B_PARK, B_PARK + 25)))
    if f >= B_REPLACE:
        good_x = GOOD_X + 9.0
    dead_x = DEAD_X
    if B_REMOVE + 48 <= f < B_REPLACE:
        # Accelerating away, because "drive for at least twenty minutes".
        t = seg(f, B_REMOVE + 48, B_REPLACE - 1)
        dead_x = DEAD_X - 4.9 * t * t
    st["good_x"] = good_x
    st["dead_x"] = dead_x
    st["good_spin"] = (good_x - GOOD_X) / TYRE_R
    st["dead_spin"] = (dead_x - DEAD_X) / TYRE_R
    st["dead_crank"] = dead_crank(f)
    st["good_crank"] = good_crank(f)

    # --- headlamps. 0 is an unlit lamp, 1 is full flag yellow. These are the
    # readout for steps 1 to 3 and then for whether an engine is running.
    if f < B_CLICK:
        dead_lamp = 0.0                                   # nothing at all
    elif f < B_CRANK:
        dead_lamp = 1.0 - 0.80 * click_pulse(f)           # lights, but clicking
    elif f < B_PARK:
        dead_lamp = 1.0 - 0.30 * ease(seg(f, B_CRANK + 2, B_CRANK + 12))
    elif f < B_RUN + 19:
        dead_lamp = 0.0                                   # engines off
    elif f < B_RUN + 33:
        dead_lamp = 0.55                                  # cranking on borrowed volts
    elif f < B_REPLACE:
        dead_lamp = 1.0
    else:
        dead_lamp = mix(1.0, 0.0, ease(seg(f, B_REPLACE + 2, B_REPLACE + 9)))
        dead_lamp = max(dead_lamp, ease(seg(f, B_REPLACE + 29, B_REPLACE + 33)))
    st["dead_lamp"] = dead_lamp
    st["good_lamp"] = ease(seg(f, B_RUN + 6, B_RUN + 11)) if f < B_REPLACE else 0.0
    st["dead_puff"] = 1.0 if B_RUN + 33 <= f < B_REPLACE else 0.0

    # --- step 1: check both terminals. The ring visits the positive post,
    # then the negative, which is sitting proud of its post until it is
    # pressed home.
    cr_in = ease(seg(f, B_DEAD + 15, B_DEAD + 21))
    cr_out = ease(seg(f, B_DEAD + 40, B_DEAD + 46))
    cr_move = ease(seg(f, B_DEAD + 25, B_DEAD + 31))
    st["check"] = (mix(DEAD_POS[0], DEAD_X + BATT_C[0] - POST_DX, cr_move),
                   POST_Z, max(0.001, cr_in - cr_out))
    loose = 1.0 - ease(seg(f, B_DEAD + 31, B_DEAD + 40))
    st["collar"] = (0.055 * loose, 0.22 * loose)

    # --- step 4: close but not touching.
    st["gap"] = max(0.001, ease(seg(f, B_PARK + 23, B_PARK + 28))
                    - ease(seg(f, B_PARK + 36, B_PARK + 41)))

    # --- steps 5 and 6: the four clamps, in the order that matters.
    # A red lead and a black lead, each a pair of clamps joined by a cable.
    # They are carried in and out in pairs, so neither cable is ever asked to
    # span half the car park.
    a = b = c = d = PARK

    if f < B_LEADS:
        pass
    elif f < B_BLOCK:
        fly = ease(seg(f, B_LEADS, B_LEADS + 19))
        a = mix2(PARK, A_HOLD, fly)
        b = mix2(PARK, B_HOLD, fly)
        a = mix2(a, DEAD_POS, ease(seg(f, B_LEADS + 19, B_LEADS + 35)))     # 1: dead +
        if f >= B_LEADS + 35:
            b = mix2(B_HOLD, GOOD_POS, ease(seg(f, B_LEADS + 35, B_LEADS + 51)))  # 2: good +
        fly2 = ease(seg(f, B_LEADS + 51, B_LEADS + 63))
        c = mix2(PARK, C_HOLD, fly2)
        d = mix2(PARK, D_HOLD, fly2)
        if f >= B_LEADS + 63:
            c = mix2(C_HOLD, GOOD_NEG, ease(seg(f, B_LEADS + 63, B_LEADS + 71)))  # 3: good -
    elif f < B_REMOVE:
        a, b, c = DEAD_POS, GOOD_POS, GOOD_NEG
        # 4: over the dead car, past its battery, down onto the lug.
        d = mix2(D_HOLD, D_OVER, ease(seg(f, B_BLOCK + 11, B_BLOCK + 33)))
        d = mix2(d, LUG_CLAMP, ease(seg(f, B_BLOCK + 33, B_BLOCK + 43)))
    elif f < B_REMOVE + 48:
        # Off again, the same four in reverse.
        a, b, c = DEAD_POS, GOOD_POS, GOOD_NEG
        d = mix2(LUG_CLAMP, D_OVER, ease(seg(f, B_REMOVE, B_REMOVE + 5)))
        d = mix2(d, D_HOLD, ease(seg(f, B_REMOVE + 5, B_REMOVE + 15)))
        c = mix2(GOOD_NEG, C_HOLD, ease(seg(f, B_REMOVE + 15, B_REMOVE + 21)))
        exit_cd = ease(seg(f, B_REMOVE + 21, B_REMOVE + 28))
        c = mix2(c, PARK, exit_cd)
        d = mix2(d, PARK, exit_cd)
        b = mix2(GOOD_POS, B_HOLD, ease(seg(f, B_REMOVE + 28, B_REMOVE + 34)))
        a = mix2(DEAD_POS, A_HOLD, ease(seg(f, B_REMOVE + 34, B_REMOVE + 40)))
        exit_ab = ease(seg(f, B_REMOVE + 40, B_REMOVE + 48))
        a = mix2(a, PARK, exit_ab)
        b = mix2(b, PARK, exit_ab)
    st["clamps"] = (a, b, c, d)

    # The ring marks the lug and then gets out of the way before the clamp
    # arrives, rather than being drawn on top of it.
    st["lugring"] = max(0.001, ease(seg(f, B_BLOCK, B_BLOCK + 7))
                        - ease(seg(f, B_BLOCK + 30, B_BLOCK + 38)))
    sp = seg(f, B_BLOCK + 43, B_BLOCK + 50)
    st["spark"] = max(0.001, math.sin(math.pi * sp) if 0.0 < sp < 1.0 else 0.0)

    # --- step 7: let it run.
    wait_master = max(0.0, ease(seg(f, B_RUN + 11, B_RUN + 14))
                      - ease(seg(f, B_RUN + 30, B_RUN + 34)))
    st["wait"] = (seg(f, B_RUN + 11, B_RUN + 29) * WAIT_N, wait_master)

    # --- step 9: flat again in a day or two means a new one, not a charge.
    # The spare is held at zero size until it is directly above the bay and
    # out of the top of this framing, so it is never seen waiting there.
    st["old_batt"] = BATT_C[1] + 1.15 * ease(seg(f, B_REPLACE + 8, B_REPLACE + 19))
    st["new_batt"] = BATT_C[1] + 1.15 * (1.0 - ease(seg(f, B_REPLACE + 19, B_REPLACE + 30)))
    st["new_batt_on"] = 1.0 if f >= B_REPLACE + 14 else 0.001
    return st


# ---------------------------------------------------------------- animation
def animate(objs, mats_lamp):
    dead = objs["dead"]
    good = objs["good"]
    cam = objs["cam"]
    clamps = objs["clamps"]
    red, black = objs["red"], objs["black"]

    lamp_off = rgba(LAMP_OFF)
    lamp_on = rgba(YELLOW)
    dead_lamp_in = mats_lamp["dead"].node_tree.nodes["Emission"].inputs["Color"]
    good_lamp_in = mats_lamp["good"].node_tree.nodes["Emission"].inputs["Color"]

    for f in range(1, F_END + 1):
        st = state(f)

        for car, xk, spink, crankk in (
            (dead, "dead_x", "dead_spin", "dead_crank"),
            (good, "good_x", "good_spin", "good_crank"),
        ):
            car["root"].location = (st[xk], 0, 0)
            car["root"].keyframe_insert("location", frame=f)
            for w in car["wheels"]:
                w.rotation_euler = Euler((0, st[spink], 0))
                w.keyframe_insert("rotation_euler", frame=f)
            car["pulley"].rotation_euler = Euler((0, st[crankk], 0))
            car["pulley"].keyframe_insert("rotation_euler", frame=f)

        # The puffs ride the car, so they keep coming while it drives off.
        for i, p in enumerate(dead["puffs"]):
            u = ((f / 18.0) + i / 3.0) % 1.0
            p.location = (EXHAUST[0] + PUFF_DRIFT[0] * u, LAY["puff"],
                          EXHAUST[1] + PUFF_DRIFT[1] * u)
            s = max(0.001, math.sin(math.pi * u) * st["dead_puff"])
            p.scale = (s, 1.0, s)
            p.keyframe_insert("location", frame=f)
            p.keyframe_insert("scale", frame=f)

        # The flat car's negative terminal, sitting proud until it is pressed
        # home. Step 1 is the only step that touches it.
        dz, tilt = st["collar"]
        collar = dead["collars"]["neg"]
        collar.location = (dead["face"] * -POST_DX, LAY["collar"],
                           COLLAR_Z - BATT_C[1] + dz)
        collar.rotation_euler = Euler((0, tilt, 0))
        collar.keyframe_insert("location", frame=f)
        collar.keyframe_insert("rotation_euler", frame=f)

        dead["batt"].location = (BATT_C[0], 0, st["old_batt"])
        dead["batt"].keyframe_insert("location", frame=f)
        objs["new_batt"].location = (BATT_C[0], 0, st["new_batt"])
        objs["new_batt"].scale = (st["new_batt_on"],) * 3
        objs["new_batt"].keyframe_insert("location", frame=f)
        objs["new_batt"].keyframe_insert("scale", frame=f)

        a, b, c, d = st["clamps"]
        for clamp, pos in zip(clamps, (a, b, c, d)):
            clamp.location = (pos[0], 0, pos[1])
            clamp.keyframe_insert("location", frame=f)
        place_cable(red, cable_point(a), cable_point(b))
        place_cable(black, cable_point(c), cable_point(d))
        for s in red + black:
            s.keyframe_insert("location", frame=f)
            s.keyframe_insert("rotation_euler", frame=f)
            s.keyframe_insert("scale", frame=f)

        rx, rz, rs = st["check"]
        objs["check"].location = (rx, 0, rz)
        objs["check"].scale = (rs, rs, rs)
        objs["check"].keyframe_insert("location", frame=f)
        objs["check"].keyframe_insert("scale", frame=f)

        for key, obj in (("lugring", objs["lugring"]), ("spark", objs["spark"]),
                         ("gap", objs["gap"])):
            v = st[key]
            obj.scale = (v, 1.0, v)
            obj.keyframe_insert("scale", frame=f)

        filled, master = st["wait"]
        for i, s in enumerate(objs["wait"]):
            v = max(0.001, min(1.0, max(0.0, filled - i)) * master)
            s.scale = (WAIT_W * v, PLATE, WAIT_H * v)
            s.keyframe_insert("scale", frame=f)

        dead_lamp_in.default_value = mix_rgba(lamp_off, lamp_on, st["dead_lamp"])
        dead_lamp_in.keyframe_insert("default_value", frame=f)
        good_lamp_in.default_value = mix_rgba(lamp_off, lamp_on, st["good_lamp"])
        good_lamp_in.keyframe_insert("default_value", frame=f)

        cx, cz, cs = st["cam"]
        cam.location = (cx, -14.0, cz)
        cam.keyframe_insert("location", frame=f)
        cam.data.ortho_scale = cs
        cam.data.keyframe_insert("ortho_scale", frame=f)

    holders = [cam.data, mats_lamp["dead"].node_tree, mats_lamp["good"].node_tree]
    holders += list(bpy.data.objects)
    linearize(holders)


# ------------------------------------------------------------------- render
def setup_render(scene, *, samples=16):
    scene.render.engine = "BLENDER_EEVEE"   # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, F_END
    scene.eevee.taa_render_samples = samples
    # Nothing in the scene is lit and every surface is emission, so shadows
    # and raytracing have nothing to add but render time.
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
        "bare": flat("Bare", BARE),
        "brand": flat("Brand", BRAND),
        "yellow": flat("Yellow", YELLOW),
    }
    lamp_mats = {"dead": flat("DeadLamp", LAMP_OFF), "good": flat("GoodLamp", LAMP_OFF)}

    build_road(mats)
    dead = build_car("Dead", DEAD_X, 1, mats,
                     lamp_mat=lamp_mats["dead"], with_puffs=True)
    good = build_car("Good", GOOD_X, -1, mats,
                     lamp_mat=lamp_mats["good"], with_puffs=False)

    # The replacement, held at zero size above the flat car's bay until step 9.
    new_batt, _ = build_battery("NewBatt", dead["root"], mats, face=1,
                                loc=(BATT_C[0], BATT_C[1] + 1.15),
                                case_hex=BRAND_DEEP)

    clamps = [build_clamp("ClampA", RED), build_clamp("ClampB", RED),
              build_clamp("ClampC", INK), build_clamp("ClampD", INK)]
    red = build_cable("RedLead", RED)
    black = build_cable("BlackLead", INK)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = BAY[1]
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
        "dead": dead, "good": good, "cam": cam, "clamps": clamps,
        "red": red, "black": black, "new_batt": new_batt,
        "check": build_check_ring(mats), "lugring": build_lug_ring(mats),
        "spark": build_spark(mats), "gap": build_gap(mats),
        "wait": build_wait(mats),
    }, lamp_mats)

    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"jump_{still:04d}.png")
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
        scene.render.filepath = OUT_MP4
        bpy.ops.render.render(animation=True)
        size = os.path.getsize(OUT_MP4)
        print("WROTE %s %d bytes (%.2f s, crf %s)"
              % (OUT_MP4, size, F_END / float(FPS), crf))

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-jump-start.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
