"""Build and render the schematic engine-oil check that ships in the APK.

Run:
    blender --background --factory-startup --python scripts/fix_oil_check.py -- --render
    blender --background --factory-startup --python scripts/fix_oil_check.py -- --still 240
    blender --background --factory-startup --python scripts/fix_oil_check.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/oil_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-oil-check.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'oil-check' steps in src/lib/breakdown.ts, in their order,
because the app captions this clip with those steps: a picture that drifts
from the words printed under it is worse than no picture. The whole point of
the guide is the second pull of the dipstick, so the wipe-and-reinsert gets
its own long beat and a dead-still pause while the stick sits home, which is
the half-second everybody skips and the only reason the reading means
anything.

Four places where the clip and the text are not a line-for-line match, all
deliberate:

  - The `before` beat ("engine off, level ground, wait five to ten minutes")
    carries one caption but two framings: the car with a spirit level beside
    it, then the sump with the oil running back down a gallery and the level
    rising while a clock sweeps. The wait is only meaningful if the thing it
    is waiting for is on screen, and that thing is inside the engine.
  - Step 2 reads between the marks, deliberately nearer the middle than
    either one: a film sitting exactly on MIN or MAX teaches nothing. Step 3
    is written as a conditional — "if it is below minimum" — so that beat
    opens on a hard cut to a low film, below MIN, and ends back between the
    marks after one small top-up. The low reading is the condition for the
    step, not a different car.
  - Step 3 does not mention the filler cap. Oil cannot be poured through a
    closed one, so the cap comes off and goes back on inside that beat.
  - Step 4 names oil that is gritty, smells burnt, or is past its service
    interval. A diagram can draw grit and darkness; it cannot draw a smell or
    a date. So the beat darkens the film, speckles it, and then shows a drain
    plug and a pan, because "changing rather than topping up" is a drain.

Style is a diagram that moves, not a film: an orthographic side elevation,
pure emission materials and the Standard view transform, so every pixel is
exactly the hex value it was given. The three subjects — the car, the engine,
the dipstick held up to be read — are built side by side in one world at
x = 0, 6 and 12, and the camera hard-cuts between them. A hard cut costs no
bitrate and this file has to fit in an APK; it also means no shot has to
contain both a whole car and a 40 mm oil film.

Written against Blender 5.2, same build as scripts/fix_tyre.py, and the same
things bite: the engine id is 'BLENDER_EEVEE', image_settings.media_type has
to be VIDEO before FFMPEG can be assigned, the output path must be absolute
or the render lands next to the .blend, Action.fcurves is not where the
curves live any more, and keyframe_new_interpolation_type does nothing — the
interpolation is corrected on the keys after they are inserted.
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
    ("settle", 70),      # before: engine off, level ground, wait for the drain
    ("wipe", 140),       # out, wipe, all the way back in, PAUSE, out again
    ("read", 54),        # read where the film ends, between the two marks
    ("topup", 112),      # if below minimum: a little at a time, then re-check
    ("condition", 58),   # gritty or burnt oil wants changing, not topping up
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# The neutrals are the slate family that file already uses. The oil is the
# amber scripts/fix_chain.py introduced for the chain; flag yellow is too
# pale to read as oil on a near-white page.
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
GRIT = "#64748b"
OIL = "#d97706"      # clean oil
OIL_OLD = INK        # and oil that is done: near black, which is what it is

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
# The tube has to be nearer than the blade, the film and the notches, because
# that is the only thing hiding the dipstick while it is pushed home.
LAY = {
    "fill": 1.60,
    "ground": 1.50,
    "body": 1.00,
    "cut": 0.96,
    "window": 0.92,
    "trim": 0.88,
    "mark": 0.84,
    "lvl_win": 0.80,
    "bubble": 0.76,
    "lvl_tick": 0.72,
    "halo": 0.78,
    "tyre": 0.74,
    "rim": 0.70,
    "spoke": 0.66,
    "cap": 0.62,
    "eng": 0.90,
    "channel": 0.86,
    "pool": 0.82,
    "drop": 0.78,
    "acc": 0.74,
    "blade": 0.56,
    "film": 0.52,
    "notch": 0.48,
    "tube": 0.44,
    "fcap": 0.40,
    "handle": 0.36,
    "marks": 0.32,
    "point": 0.28,
    "speck": 0.24,
    "tool": 0.20,
    "panoil": 0.18,
    "glyph": 0.16,
}
PLATE = 0.012  # thickness of every plate; layers are 0.04 apart so none touch

# ------------------------------------------------------- stage 1: the car
REAR_X = -1.55
FRONT_X = 1.55
TYRE_R = 0.32
HALO_R = 0.355
RIM_R = 0.205
CAP_R = 0.075
SPOKE_LEN = 0.145
BODY_BOTTOM = 0.45
BODY_TOP = 0.95

LEVEL_X = 0.00       # the spirit level, on the road the car is parked on
LEVEL_Z = 0.095
BUBBLE_OFF = 0.185   # how far off centre the bubble starts

# ---------------------------------------------------- stage 2: the engine
E = 6.00             # the engine stage's own origin

SUMP_W = 0.84
SUMP_FLOOR_Z = 0.545
SUMP_TOP_Z = 0.86
OIL_BASE_Z = 0.57
OIL_H = 0.24         # the sump's full depth of oil
OIL_LOW = 0.38       # just after running: most of it is still up in the head
OIL_FULL = 0.86      # five to ten minutes later

BLOCK_Z = 1.06
CAM_Z = 1.33
FILLER_X = E - 0.24
FILLER_TOP = 1.47
CAP_Z = 1.515
CAP_ASIDE = (E + 0.10, 1.482)

CHANNEL_X = E + 0.10   # the drain-back gallery the droplets fall down

TUBE_X = E + 0.44
TUBE_TOP = 1.42
BLADE_LEN = 0.36
DIP_SEATED = 1.42
DIP_OUT = TUBE_TOP + BLADE_LEN + 0.03
DIP_ASIDE_X = E + 0.95

# The film on the small blade, as a fraction of its own travel. The smeared
# first pull reaches most of the way up the stick, which is exactly why it
# cannot be read; the second pull sits at the same fraction as the macro one.
FILM_S = 0.33
SMEAR = 0.85
TRUE_S = 0.42

RAG_PARK = (E + 1.85, 1.75)
BOTTLE_PARK = (E + 0.035, 2.45)
BOTTLE_POUR = (E + 0.035, 1.760)
BOTTLE_TIP = -2.20
PAN_PARK_X = E + 2.15
PAN_X = E + 0.25
PLUG = (E + 0.25, 0.495)

CLOCK_FULL = (E + 1.02, 0.95)   # where the clock sits in the wide engine shot
CLOCK_TOP = (E + 0.80, 1.75)    # and in the tight one

# ------------------------------------------------- stage 3: the dipstick
M = 12.00
MAC_Z = 0.90
MAC_BLADE = 0.90
MAC_FILM = 0.62
MIN_X = M + 0.26     # nearer the tip: minimum
MAX_X = M - 0.04     # further up the stick: maximum
TIP_X = M + 0.45
# 39% of the blade: comfortably between the two marks and nearer neither.
LEVEL_OK = 0.565
LEVEL_LOW = 0.21     # short of MIN, which is what step 3 is written about

WIDE = ((0.00, 0.74), 4.70)
ENG_FULL = ((E + 0.05, 0.88), 2.80)
ENG_TOP = ((E + 0.365, 1.475), 1.87)
MACRO = ((M - 0.04, 0.95), 1.44)
MACRO_T = ((M + 0.10, 0.93), 1.10)

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


def triangle(name, r, loc, *, material=None, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=PLATE, vertices=3)
    o = bpy.context.object
    o.name = name
    # No extra spin: Blender starts a circle's vertices at local +Y, which the
    # quarter turn about X that faces the prism at the lens carries round to
    # world +Z, so the point is up.
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
    nothing on this 5.2 build: the preference reads back as CONSTANT and the
    keyframe is still born BEZIER. Every hard cut in this clip depends on
    this, so the keys are corrected after insertion instead.
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


# ------------------------------------------------------- stage 1: the car
def build_car(mats):
    """A car on level ground, a lamp going out, and a level beside the wheel.

    Shape and proportions are lifted from scripts/fix_tyre.py so the two
    clips are plainly the same car; a guide library whose vehicle changes
    between videos reads as two different apps.
    """
    plate("RoadFill", 16.0, 6.4, (0, LAY["fill"], -3.2), material=mats["road"])
    plate("RoadLine", 16.0, 0.06, (0, LAY["ground"], -0.03), material=mats["text"])

    car = empty("Car", (0, 0, 0))
    plate("Body", 4.20, BODY_TOP - BODY_BOTTOM,
          (0.0, LAY["body"], (BODY_TOP + BODY_BOTTOM) / 2),
          material=mats["ink_soft"], parent=car)
    plate("Cabin", 2.45, 0.48, (-0.18, LAY["body"], 1.19),
          material=mats["ink_soft"], parent=car)
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

    # The one thing a side elevation can use to say "engine off": a warning
    # lamp on the dash, sitting where the dash is, that goes out. Same device
    # as the ignition light in scripts/fix_chain.py.
    plate("Lamp", 0.13, 0.09, (0.37, LAY["mark"], 1.09),
          material=mats["lamp"], parent=car)

    for name, cx in (("WheelRear", REAR_X), ("WheelFront", FRONT_X)):
        root = empty(name, (cx, 0, TYRE_R), parent=car)
        # The pale ring is the cheap way to get an outline: the tyre is
        # nearly the same ink as the body it overlaps.
        disc(name + "Halo", HALO_R, (0, LAY["halo"], 0),
             material=mats["bg"], parent=root)
        disc(name + "Tyre", TYRE_R, (0, LAY["tyre"], 0),
             material=mats["ink"], parent=root)
        disc(name + "Rim", RIM_R, (0, LAY["rim"], 0),
             material=mats["steel"], parent=root)
        for i in range(5):
            a = math.radians(90 + 36 + i * 72)
            plate(f"{name}Spoke{i}", SPOKE_LEN, 0.05,
                  (SPOKE_LEN / 2 * math.cos(a), LAY["spoke"],
                   SPOKE_LEN / 2 * math.sin(a)),
                  material=mats["ink_soft"], parent=root, spin=-a)
        disc(name + "Cap", CAP_R, (0, LAY["cap"], 0),
             material=mats["ink"], parent=root)

    # The spirit level. Level ground is a condition, not an action, and a
    # bubble finding its centre is the only way to draw a condition moving.
    plate("LevelBody", 0.96, 0.15, (LEVEL_X, LAY["mark"], LEVEL_Z),
          material=mats["slate"])
    plate("LevelWindow", 0.86, 0.085, (LEVEL_X, LAY["lvl_win"], LEVEL_Z),
          material=mats["bg"])
    bubble = disc("Bubble", 0.036, (LEVEL_X, LAY["bubble"], LEVEL_Z),
                  material=mats["green"])
    for i, dx in enumerate((-0.062, 0.062)):
        plate(f"LevelTick{i}", 0.013, 0.11,
              (LEVEL_X + dx, LAY["lvl_tick"], LEVEL_Z), material=mats["slate"])
    return bubble


# ---------------------------------------------------- stage 2: the engine
def build_engine(mats):
    """The engine in side elevation, with the sump drawn open.

    Only the sump is sectioned, and only because the whole of the opening
    beat is about oil arriving back in it: a solid pan would have made the
    five-to-ten-minute wait a picture of nothing happening. Everything above
    it stays a silhouette, so the one place the eye is asked to look inside
    is the one place that matters.
    """
    # --- sump, drawn as a U so the oil inside it is visible
    plate("SumpFloor", SUMP_W, 0.05, (E, LAY["eng"], SUMP_FLOOR_Z),
          material=mats["ink"])
    for i, dx in enumerate((-SUMP_W / 2 + 0.025, SUMP_W / 2 - 0.025)):
        plate(f"SumpWall{i}", 0.05, SUMP_TOP_Z - 0.52,
              (E + dx, LAY["eng"], (SUMP_TOP_Z + 0.52) / 2), material=mats["ink"])

    oil = empty("SumpOil", (E, 0, OIL_BASE_Z))
    plate("SumpOilPlate", SUMP_W - 0.10, OIL_H, (0, LAY["pool"], OIL_H / 2),
          material=mats["oil_sump"], parent=oil)

    plug = plate("DrainPlug", 0.075, 0.05, (PLUG[0], LAY["acc"], PLUG[1]),
                 material=mats["steel"])

    # --- block, cover, accessories
    plate("Block", 1.00, 0.40, (E, LAY["eng"], BLOCK_Z), material=mats["slate"])
    plate("Bellhousing", 0.26, 0.26, (E - 0.63, LAY["eng"], 1.00),
          material=mats["slate"])
    plate("CamCover", 0.76, 0.14, (E, LAY["eng"], CAM_Z), material=mats["ink_soft"])
    disc("Pulley", 0.135, (E - 0.33, LAY["acc"], 1.03), material=mats["ink_soft"])
    disc("PulleyHub", 0.045, (E - 0.33, LAY["acc"] - 0.02, 1.03),
         material=mats["steel"])

    # The drain-back gallery: a channel through the block with oil running
    # down it. Drawn as a gap rather than a pipe, which is how a section of
    # a casting is drawn everywhere else.
    plate("Channel", 0.075, 0.40, (CHANNEL_X, LAY["channel"], BLOCK_Z),
          material=mats["bg"])
    # The head joint, so the casting reads as a block with a head on it
    # rather than as one undifferentiated box.
    plate("HeadJoint", 0.76, 0.012, (E, LAY["channel"], 1.26),
          material=mats["bg"])
    drops = []
    for i in range(5):
        drops.append(disc(f"Drop{i}", 0.018, (CHANNEL_X, LAY["drop"], 1.24),
                          material=mats["oil"], verts=12))

    # --- filler
    plate("FillerNeck", 0.13, 0.07, (FILLER_X, LAY["eng"], FILLER_TOP - 0.035),
          material=mats["slate"])
    cap = disc("FillerCap", 0.082, (FILLER_X, LAY["fcap"], CAP_Z),
               material=mats["brand"])

    # --- dipstick tube and the dipstick itself
    plate("DipTube", 0.085, 0.54, (TUBE_X, LAY["tube"], 1.15), material=mats["steel"])

    dip = empty("Dip", (TUBE_X, 0, DIP_SEATED))
    plate("Blade", 0.055, BLADE_LEN, (0, LAY["blade"], -BLADE_LEN / 2),
          material=mats["steel"], parent=dip)
    # The same two notches the macro blade carries, at the same fractions of
    # its length, so the hard cut to the close-up reads as the same object.
    for i, frac in enumerate((0.21, 0.54)):
        plate(f"BladeNotch{i}", 0.040, 0.010,
              (0, LAY["notch"], -BLADE_LEN * (1.0 - frac)),
              material=mats["bg"], parent=dip)
    film = empty("DipFilm", (0, 0, -BLADE_LEN), parent=dip)
    plate("DipFilmPlate", 0.045, FILM_S, (0, LAY["film"], FILM_S / 2),
          material=mats["film_s"], parent=film)
    plate("DipNeck", 0.030, 0.05, (0, LAY["handle"], 0.025),
          material=mats["brand"], parent=dip)
    disc("DipLoop", 0.070, (0, LAY["handle"], 0.105),
         material=mats["brand"], parent=dip)
    disc("DipLoopHole", 0.035, (0, LAY["handle"] - 0.02, 0.105),
         material=mats["bg"], parent=dip)

    # --- the rag, which is the middle of the first step and the point of it
    rag = empty("Rag", (RAG_PARK[0], 0, RAG_PARK[1]))
    # Two squares at odds with each other, because one rectangle reads as a
    # sticky note and a cloth in a hand is never square to anything.
    plate("RagA", 0.17, 0.17, (0, LAY["tool"], 0), material=mats["yellow"],
          parent=rag, spin=0.22)
    plate("RagB", 0.15, 0.15, (0.015, LAY["tool"] - 0.01, -0.02),
          material=mats["yellow"], parent=rag, spin=-0.35)

    # --- the bottle and the small pour it makes
    bottle = empty("Bottle", (BOTTLE_PARK[0], 0, BOTTLE_PARK[1]))
    plate("BottleBody", 0.16, 0.26, (0, LAY["tool"], 0.13),
          material=mats["brand_deep"], parent=bottle)
    plate("BottleNeck", 0.065, 0.08, (0, LAY["tool"], 0.30),
          material=mats["brand_deep"], parent=bottle)
    stream = empty("PourStream", (FILLER_X, 0, 1.56))
    plate("PourPlate", 0.045, 0.10, (0, LAY["tool"], -0.05),
          material=mats["oil"], parent=stream)

    # --- the drain pan and the dark stream into it
    pan = empty("Pan", (PAN_PARK_X, 0, 0.10))
    plate("PanFloor", 0.62, 0.045, (0, LAY["tool"], 0.0225),
          material=mats["slate"], parent=pan)
    for i, dx in enumerate((-0.2875, 0.2875)):
        plate(f"PanWall{i}", 0.045, 0.16, (dx, LAY["tool"], 0.08),
              material=mats["slate"], parent=pan)
    pan_oil = empty("PanOil", (0, 0, 0.045), parent=pan)
    plate("PanOilPlate", 0.53, 0.10, (0, LAY["panoil"], 0.05),
          material=mats["oil_old"], parent=pan_oil)
    drain = empty("Drain", (PLUG[0], 0, PLUG[1] - 0.025))
    plate("DrainPlate", 0.05, 0.22, (0, LAY["tool"] - 0.01, -0.11),
          material=mats["oil_old"], parent=drain)

    # --- the clock. Five to ten minutes is a number, and a number cannot be
    # drawn here; a hand going most of the way round can.
    clock = empty("Clock", (CLOCK_FULL[0], 0, CLOCK_FULL[1]))
    disc("ClockRim", 0.21, (0, LAY["glyph"], 0), material=mats["slate"], parent=clock)
    disc("ClockFace", 0.175, (0, LAY["glyph"] - 0.02, 0),
         material=mats["bg"], parent=clock)
    for i in range(4):
        a = math.radians(90 + i * 90)
        plate(f"ClockTick{i}", 0.012, 0.035,
              (0.152 * math.cos(a), LAY["glyph"] - 0.04, 0.152 * math.sin(a)),
              material=mats["slate"], parent=clock, spin=-a + math.pi / 2)
    hand = empty("ClockHand", (0, 0, 0), parent=clock)
    plate("ClockHandBar", 0.016, 0.17, (0, LAY["glyph"] - 0.06, 0.085),
          material=mats["brand"], parent=hand)
    disc("ClockHub", 0.022, (0, LAY["glyph"] - 0.08, 0),
         material=mats["slate"], parent=clock)

    return dict(oil=oil, plug=plug, drops=drops, cap=cap, dip=dip, film=film,
                rag=rag, bottle=bottle, stream=stream, pan=pan, pan_oil=pan_oil,
                drain=drain, clock=clock, hand=hand)


# ------------------------------------------------- stage 3: the dipstick
def build_macro(mats):
    """The blade on its own, held level, tip to the right.

    Everything about the reading beat is a fraction of this blade's length,
    so the marks, the film and the small one in the engine are all generated
    from the same two numbers: minimum at 21% of the blade from the tip,
    maximum at 54%. A film that ends at 39% is then between them by
    construction rather than by eye, which is the only way to be sure the
    clip is not quietly teaching someone to run an engine dry.
    """
    root = empty("MacroDip", (M, 0, MAC_Z))
    plate("MacroBlade", MAC_BLADE, 0.075, (0, LAY["blade"], 0),
          material=mats["steel"], parent=root)
    for i, frac in enumerate((0.21, 0.54)):
        plate(f"MacroNotch{i}", 0.018, 0.020,
              (MAC_BLADE / 2 - MAC_BLADE * frac, LAY["notch"], 0),
              material=mats["bg"], parent=root)
    plate("MacroNeck", 0.11, 0.045, (-0.50, LAY["handle"], 0),
          material=mats["brand"], parent=root)
    disc("MacroLoop", 0.100, (-0.62, LAY["handle"], 0),
         material=mats["brand"], parent=root)
    disc("MacroLoopHole", 0.050, (-0.62, LAY["handle"] - 0.02, 0),
         material=mats["bg"], parent=root)

    # The film grows out of the tip, because that is the end that was in the
    # oil. Scaling the anchor in x is what wipes it and what fills it.
    film = empty("MacroFilm", (MAC_BLADE / 2, 0, 0), parent=root)
    plate("MacroFilmPlate", MAC_FILM, 0.062, (-MAC_FILM / 2, LAY["film"], 0),
          material=mats["film_m"], parent=film)

    specks = empty("Specks", (0, 0, 0), parent=root)
    scatter = ((0.14, 0.016), (0.19, -0.014), (0.235, 0.008), (0.27, -0.020),
               (0.315, 0.018), (0.355, -0.006), (0.40, 0.014))
    for i, (dx, dz) in enumerate(scatter):
        disc(f"Speck{i}", 0.011, (dx, LAY["speck"], dz),
             material=mats["grit"], parent=specks, verts=8)

    # The two marks are annotation, not part of the stick, so they are not
    # parented to it: they arrive once the blade has settled and they do not
    # tilt with it.
    marks = empty("Marks", ((MIN_X + MAX_X) / 2, 0, MAC_Z + 0.10))
    plate("MarkMin", 0.020, 0.105,
          ((MIN_X - MAX_X) / 2, LAY["marks"], -0.0075),
          material=mats["text"], parent=marks)
    plate("MarkMax", 0.020, 0.105,
          (-(MIN_X - MAX_X) / 2, LAY["marks"], -0.0075),
          material=mats["text"], parent=marks)
    plate("MarkRail", MIN_X - MAX_X + 0.02, 0.018, (0, LAY["marks"], 0.054),
          material=mats["text"], parent=marks)

    pointer = triangle("Pointer", 0.055, (TIP_X, LAY["point"], 0.80),
                       material=mats["brand"])
    return dict(root=root, film=film, specks=specks, marks=marks, pointer=pointer)


# ---------------------------------------------------------------- animation
def animate(mats, bubble, eng, mac, cam):
    dip, film = eng["dip"], eng["film"]
    clock, hand = eng["clock"], eng["hand"]

    # --- camera: five framings, every change a hard cut. Three of them are
    # three different subjects standing side by side in the world, so a cut
    # is not a jump in space the viewer has to reconstruct: it is a page
    # turn, and the app's caption turns with it.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(39, ENG_FULL)
    frame_at(71, ENG_TOP)
    frame_at(211, MACRO)
    frame_at(265, MACRO_T)
    frame_at(293, ENG_TOP)
    frame_at(353, MACRO)
    frame_at(377, MACRO_T)
    frame_at(399, ENG_FULL)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(dip, 1, loc=(TUBE_X, 0, DIP_SEATED), interp="CONSTANT")
    key(film, 1, scale=(1, 1, SMEAR), interp="CONSTANT")
    key(eng["rag"], 1, loc=(RAG_PARK[0], 0, RAG_PARK[1]), interp="CONSTANT")
    key(eng["bottle"], 1, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]),
        rot=(0, 0, 0), interp="CONSTANT")
    key(eng["stream"], 1, scale=(1, 1, 0.001), interp="CONSTANT")
    key(eng["cap"], 1, loc=(FILLER_X, LAY["fcap"], CAP_Z), interp="CONSTANT")
    key(eng["plug"], 1, loc=(PLUG[0], LAY["acc"], PLUG[1]), interp="CONSTANT")
    key(eng["pan"], 1, loc=(PAN_PARK_X, 0, 0.10), interp="CONSTANT")
    key(eng["pan_oil"], 1, scale=(1, 1, 0.001), interp="CONSTANT")
    key(eng["drain"], 1, scale=(1, 1, 0.001), interp="CONSTANT")
    key(clock, 1, loc=(CLOCK_FULL[0], 0, CLOCK_FULL[1]), scale=(0, 0, 0),
        interp="CONSTANT")
    key(hand, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(mac["root"], 1, rot=(0, 0.07, 0), interp="CONSTANT")
    key(mac["film"], 1, scale=(LEVEL_OK, 1, 1), interp="CONSTANT")
    key(mac["marks"], 1, scale=(0, 0, 0), interp="CONSTANT")
    key(mac["specks"], 1, scale=(0, 0, 0), interp="CONSTANT")
    key(mac["pointer"], 1, loc=(TIP_X, LAY["point"], 0.80), scale=(0, 0, 0),
        interp="CONSTANT")
    key_colour(mats["film_m"], 1, OIL)
    key_colour(mats["oil_sump"], 1, OIL)

    # ================================================= 1. engine off, level,
    #                                                       and wait for it
    # The lamp is switched by swapping in the body's own colour, which reads
    # as off. Dimming the emission instead gives a dark amber square, which
    # still looks lit.
    key_colour(mats["lamp"], 1, YELLOW)
    key_colour(mats["lamp"], 13, INK_SOFT)

    key(bubble, 1, loc=(LEVEL_X + BUBBLE_OFF, LAY["bubble"], LEVEL_Z),
        interp="CONSTANT")
    key(bubble, 20, loc=(LEVEL_X - 0.035, LAY["bubble"], LEVEL_Z))
    key(bubble, 28, loc=(LEVEL_X + 0.012, LAY["bubble"], LEVEL_Z))
    key(bubble, 34, loc=(LEVEL_X, LAY["bubble"], LEVEL_Z))

    # The sump filling is the reason for the wait, so it is the thing the
    # clock is timing rather than a decoration beside it.
    key(eng["oil"], 1, scale=(1, 1, OIL_LOW), interp="CONSTANT")
    key(eng["oil"], 39, scale=(1, 1, OIL_LOW))
    key(eng["oil"], 68, scale=(1, 1, OIL_FULL))

    for i, drop in enumerate(eng["drops"]):
        start = 41 + i * 4
        key(drop, 1, loc=(CHANNEL_X, LAY["drop"], 1.24), scale=(0, 0, 0),
            interp="CONSTANT")
        key(drop, start - 1, scale=(1, 1, 1), interp="CONSTANT")
        key(drop, start, loc=(CHANNEL_X, LAY["drop"], 1.24), interp="LINEAR")
        key(drop, start + 13, loc=(CHANNEL_X, LAY["drop"], 0.78),
            interp="CONSTANT")
        key(drop, 71, scale=(0, 0, 0), interp="CONSTANT")

    key(clock, 39, scale=(0, 0, 0), interp="CONSTANT")
    key(clock, 40, scale=(0.02, 0.02, 0.02))
    key(clock, 46, scale=(1, 1, 1))
    key(clock, 64, scale=(1, 1, 1))
    key(clock, 68, scale=(0, 0, 0), interp="CONSTANT")
    key(hand, 45, rot=(0, 0, 0))
    key(hand, 64, rot=(0, 5.2, 0))

    # ===================================== 2. out, wipe, all the way back in,
    #                                           a pause, and out again
    key(dip, 78, loc=(TUBE_X, 0, DIP_SEATED))
    key(dip, 98, loc=(TUBE_X, 0, DIP_OUT))
    key(dip, 110, loc=(DIP_ASIDE_X, 0, DIP_OUT))
    key(dip, 138, loc=(DIP_ASIDE_X, 0, DIP_OUT))
    key(dip, 150, loc=(TUBE_X, 0, DIP_OUT))
    key(dip, 166, loc=(TUBE_X, 0, DIP_SEATED))
    # A short press past the seat and back: "all the way back in" is the
    # half of this step that gets skipped, so it is shown happening.
    key(dip, 170, loc=(TUBE_X, 0, DIP_SEATED - 0.015))
    key(dip, 173, loc=(TUBE_X, 0, DIP_SEATED))
    # Frames 173 to 195 are dead still. Nothing in the frame moves, which is
    # the point: the stick is sitting in the tube picking up the only reading
    # that is worth anything.
    key(dip, 195, loc=(TUBE_X, 0, DIP_SEATED))
    key(dip, 207, loc=(TUBE_X, 0, DIP_OUT))
    key(dip, 210, loc=(TUBE_X, 0, DIP_OUT), interp="CONSTANT")
    # Put away on the cut, so the stick is back in its tube for the top-up
    # beat rather than hanging in mid-air through it.
    key(dip, 211, loc=(TUBE_X, 0, DIP_SEATED), interp="CONSTANT")

    key(eng["rag"], 102, loc=(RAG_PARK[0], 0, RAG_PARK[1]))
    key(eng["rag"], 112, loc=(DIP_ASIDE_X, 0, 1.79), interp="LINEAR")
    key(eng["rag"], 130, loc=(DIP_ASIDE_X, 0, 1.43), interp="LINEAR")
    key(eng["rag"], 138, loc=(RAG_PARK[0], 0, 1.43))

    # The film goes with the rag, not before or after it.
    key(film, 112, scale=(1, 1, SMEAR), interp="LINEAR")
    key(film, 130, scale=(1, 1, 0.001), interp="LINEAR")
    # Keyed while the blade is inside the tube and nothing can be seen: the
    # second pull comes out carrying the reading the guide wants read.
    key(film, 194, scale=(1, 1, TRUE_S), interp="CONSTANT")
    key(film, 211, scale=(1, 1, 0.001), interp="CONSTANT")

    # ================================================ 3. read where it ends
    key(mac["root"], 211, rot=(0, 0.07, 0), interp="CONSTANT")
    key(mac["root"], 220, rot=(0, 0, 0))
    key(mac["marks"], 221, scale=(0, 0, 0), interp="CONSTANT")
    key(mac["marks"], 222, scale=(0.02, 0.02, 0.02))
    key(mac["marks"], 230, scale=(1, 1, 1))
    key(mac["pointer"], 231, scale=(0, 0, 0), interp="CONSTANT")
    key(mac["pointer"], 232, loc=(TIP_X, LAY["point"], 0.80), scale=(1, 1, 1),
        interp="CONSTANT")
    key(mac["pointer"], 246,
        loc=(TIP_X - MAC_FILM * LEVEL_OK, LAY["point"], 0.80))

    # ====================================== 4. if it is below minimum, a
    #                                           little at a time, then re-check
    # The hard cut carries the "if": the caption under this beat opens with
    # it, and the film below MIN is the condition it names.
    key(mac["film"], 265, scale=(LEVEL_LOW, 1, 1), interp="CONSTANT")
    key(mac["pointer"], 265,
        loc=(TIP_X - MAC_FILM * LEVEL_LOW, LAY["point"], 0.80), interp="CONSTANT")

    key(eng["cap"], 297, loc=(FILLER_X, LAY["fcap"], CAP_Z))
    key(eng["cap"], 301, loc=(FILLER_X, LAY["fcap"], 1.67))
    key(eng["cap"], 307, loc=(CAP_ASIDE[0], LAY["fcap"], CAP_ASIDE[1]))
    key(eng["cap"], 342, loc=(CAP_ASIDE[0], LAY["fcap"], CAP_ASIDE[1]))
    key(eng["cap"], 346, loc=(FILLER_X, LAY["fcap"], 1.67))
    key(eng["cap"], 351, loc=(FILLER_X, LAY["fcap"], CAP_Z))

    key(eng["bottle"], 305, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), rot=(0, 0, 0))
    key(eng["bottle"], 315, loc=(BOTTLE_POUR[0], 0, BOTTLE_POUR[1]), rot=(0, 0, 0))
    key(eng["bottle"], 321, rot=(0, BOTTLE_TIP, 0))
    key(eng["bottle"], 333, rot=(0, BOTTLE_TIP, 0))
    key(eng["bottle"], 333, loc=(BOTTLE_POUR[0], 0, BOTTLE_POUR[1]))
    key(eng["bottle"], 343, rot=(0, 0, 0))
    key(eng["bottle"], 345, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]))

    # Six frames of oil. "A little at a time" is a quantity, and the only way
    # to draw a quantity of pour is to stop it early.
    key(eng["stream"], 322, scale=(1, 1, 0.001), interp="CONSTANT")
    key(eng["stream"], 323, scale=(1, 1, 1.0))
    key(eng["stream"], 329, scale=(1, 1, 1.0))
    key(eng["stream"], 333, scale=(1, 1, 0.001), interp="CONSTANT")

    # "Give it a minute to drain down between top-ups": the same clock, a
    # shorter sweep, moved to where this framing can see it.
    key(clock, 293, loc=(CLOCK_TOP[0], 0, CLOCK_TOP[1]), interp="CONSTANT")
    key(hand, 293, rot=(0, 0, 0), interp="CONSTANT")
    key(clock, 335, scale=(0, 0, 0), interp="CONSTANT")
    key(clock, 337, scale=(0.02, 0.02, 0.02))
    key(clock, 341, scale=(1, 1, 1))
    key(hand, 341, rot=(0, 0, 0))
    key(hand, 350, rot=(0, 2.2, 0))
    key(clock, 348, scale=(1, 1, 1))
    key(clock, 351, scale=(0, 0, 0), interp="CONSTANT")

    # Back between the marks, and nearer the middle than either of them.
    key(mac["film"], 353, scale=(LEVEL_OK, 1, 1), interp="CONSTANT")
    key(mac["pointer"], 353,
        loc=(TIP_X - MAC_FILM * LEVEL_OK, LAY["point"], 0.80), interp="CONSTANT")

    # ============================= 5. gritty or burnt oil wants changing
    key_colour(mats["film_m"], 377, OIL_OLD)
    key(mac["specks"], 379, scale=(0, 0, 0), interp="CONSTANT")
    key(mac["specks"], 380, scale=(0.02, 0.02, 0.02))
    key(mac["specks"], 392, scale=(1, 1, 1))

    key_colour(mats["oil_sump"], 398, OIL_OLD)
    key(eng["pan"], 399, loc=(PAN_PARK_X, 0, 0.10))
    key(eng["pan"], 408, loc=(PAN_X, 0, 0.10))
    key(eng["plug"], 407, loc=(PLUG[0], LAY["acc"], PLUG[1]))
    key(eng["plug"], 414, loc=(E + 0.40, LAY["acc"], 0.17))
    key(eng["drain"], 412, scale=(1, 1, 0.001), interp="CONSTANT")
    key(eng["drain"], 419, scale=(1, 1, 1.0))
    key(eng["drain"], 428, scale=(1, 1, 1.0))
    key(eng["drain"], 433, scale=(1, 1, 0.001))
    key(eng["oil"], 413, scale=(1, 1, OIL_FULL))
    key(eng["oil"], 430, scale=(1, 1, 0.06))
    key(eng["pan_oil"], 413, scale=(1, 1, 0.001), interp="CONSTANT")
    key(eng["pan_oil"], 416, scale=(1, 1, 0.04))
    key(eng["pan_oil"], 430, scale=(1, 1, 0.90))


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
        "grit": flat("Grit", GRIT),
        "brand": flat("Brand", BRAND),
        "brand_deep": flat("BrandDeep", BRAND_DEEP),
        "yellow": flat("Yellow", YELLOW),
        "green": flat("Green", GREEN),
        "oil": flat("Oil", OIL),
        "oil_sump": flat("OilSump", OIL),
        "oil_old": flat("OilOld", OIL_OLD),
        "film_s": flat("FilmSmall", OIL),
        "film_m": flat("FilmMacro", OIL),
        "lamp": flat("Lamp", YELLOW),
    }

    bubble = build_car(mats)
    eng = build_engine(mats)
    mac = build_macro(mats)

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

    animate(mats, bubble, eng, mac, cam)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"oil_{still:04d}.png")
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
        out = os.path.join(OUT_DIR, "fix-oil-check.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        print(f"WROTE {out} {os.path.getsize(out)} bytes")

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-oil-check.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
