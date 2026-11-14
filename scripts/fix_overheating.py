"""Build and render the schematic overheating guide that ships in the APK.

Run:
    blender --background --factory-startup --python scripts/fix_overheating.py -- --render
    blender --background --factory-startup --python scripts/fix_overheating.py -- --still 200
    blender --background --factory-startup --python scripts/fix_overheating.py -- --render --crf LOW

    --still N    one frame to docs/pitch-assets/overheat_NNNN.png, for checking framing
    --render     the whole thing to public/guides/fix-overheating.mp4
    --crf NAME   Blender's constant_rate_factor; a lower setting is a smaller file
    --save       also write the .blend, so it can be opened and nudged by hand

The beats are the 'overheating' steps in src/lib/breakdown.ts, in their order,
because the app prints those steps under this clip: a picture that drifts from
the words beneath it is worse than no picture. The whole clip is built around
the one thing in that guide that can burn someone — the cap. It is reached for
twice and refused twice, and it only comes off after the wait is over.

  beat 1  the `before` list: pull over, engine off
  beat 2  step 1  "Engine off. Leave the bonnet shut if you can see steam"
  beat 3  step 2  the wait, thirty minutes of it
  beat 4  step 2  "Never open the radiator cap ... while the engine is hot"
  beat 5  step 3  the level, read against the min and max marks
  beat 6  step 4  topping up
  beat 7  step 5  start up and watch the gauge

Five places where the clip and the text are not a line-for-line match, all
deliberate:

  - The `before` list also says to turn the air conditioning off and the heater
    to full hot with the fan high. That is a cabin control, and this is an
    exterior elevation; drawing it would need either an interior the rest of
    the clip does not have or a word of text, which this house style does not
    use. The app prints that line above the steps, where it is unmissable.
  - The guide never says to raise the bonnet. It says to leave it shut if you
    can see steam. So the bonnet here goes up only after the steam has stopped,
    both to vent the bay and because the tank cannot be reached with it down.
    If the clip is read as "open the bonnet", the frame before it says when.
  - Step 3 is read through the side of the tank, which is why the cap is still
    on for it. That is what the text asks for — the level is checked against
    marks "on the side" — and it is the safer habit, so the clip draws it that
    way rather than unscrewing anything to look in.
  - The close framing is a cutaway. From the side of a real car you see a wing,
    not an expansion tank, so once the bonnet is up the panel over the bay is
    drawn as an opening and the tank, radiator and cap are drawn inside it.
  - Step 5 ends "If it climbs again, switch off". The clip shows the gauge
    starting cold and settling in the normal band, and stops there. Drawing the
    second overheat would be inventing an outcome this guide does not predict,
    and drawing only the good one is why the condition stays in the caption.

Style is a diagram that moves, not a film: an orthographic side elevation, pure
emission materials and the Standard view transform, so every pixel is exactly
the hex value it was given. Cuts between the two framings are hard, because a
hard cut costs no bitrate and this file has to fit in an APK. No text, no
faces, nothing identifiable.

Written against Blender 5.2, same build as scripts/fix_tyre.py, and the same
things bite: the engine id is 'BLENDER_EEVEE', image_settings.media_type has to
be VIDEO before FFMPEG can be assigned, the output path must be absolute or the
render lands next to the .blend, keyframe_new_interpolation_type does nothing
on this build so the keys are corrected after insertion, and Action.fcurves is
not where the curves live any more.
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
    ("pullover", 48),     # the before list: pull over, engine off
    ("engine_off", 48),   # engine off, bonnet stays shut while there is steam
    ("wait", 76),         # the steam stops, the bonnet vents, the clock runs
    ("no_cap", 56),       # the cap, refused while it is still hot
    ("check", 58),        # cool enough to touch, then read the level
    ("top_up", 82),       # cap off, top up between the marks, cap on
    ("watch", 52),        # start up, watch the gauge
)

F = {}
_cursor = 1
for _name, _length in BEATS:
    F[_name] = _cursor
    _cursor += _length
F_END = _cursor - 1

# ------------------------------------------------------------------- palette
# Brand values are the ones in src/index.css, so the clip and the app agree.
# The neutrals are the slate family that file already uses for the page
# background and body text.
BG = "#f1f5f9"
INK = "#15181f"
INK_SOFT = "#1e2430"
TEXT = "#0f172a"
BRAND = "#189edb"
BRAND_DEEP = "#0e6fa3"
YELLOW = "#f0c000"
GREEN = "#007848"
RED = "#d83030"       # --color-flag-red: the hot end of the gauge, and the refusals
ROAD = "#e2e8f0"
STEEL = "#94a3b8"
SLATE = "#334155"
STUD_GREY = "#64748b"

# -------------------------------------------------------------------- layers
# Everything is a flat plate facing the camera, which sits at -Y. A smaller
# y is nearer the lens, so this table is the draw order read top to bottom.
#
# The one thing worth knowing here: the wheels sit between the bodywork and
# the bay. A car's front wheel is directly under its engine bay, and in a side
# elevation the two overlap, so the wheel has to be in front of the body (it
# is, or there would be no wheel arch) and behind everything the cutaway draws
# (it is, or a tyre would cross the tank). The bay's own floor is what covers
# the top of that wheel once the cutaway opens.
LAY = {
    "fill": 1.60,
    "ground": 1.50,
    "dash": 1.44,
    "body": 1.00,
    "cut": 0.97,
    "window": 0.93,
    "trim": 0.90,
    "wing": 0.87,       # the panel over the bay; it becomes the opening
    "bonnet": 0.84,
    # 0.75 .. 0.55 belong to the wheels; see build_wheel
    "floor": 0.52,      # the bay floor, which hides the top of the front wheel
    "shell": 0.49,      # the tank's outline, and the radiator
    "tank": 0.46,
    "coolant": 0.43,
    "mark": 0.40,
    "cap": 0.37,
    "steam": 0.34,
    "stream": 0.31,
    "bottle": 0.28,
    "dial": 0.25,       # gauge and clock, drawn in the sky
    "dial_hole": 0.22,
    "dial_tick": 0.19,
    "dial_hand": 0.16,
    "dial_hub": 0.13,
    "hand": 0.10,
    "no": 0.07,         # the refusals sit over everything they refuse
}
PLATE = 0.02  # thickness of every plate; the layers above are 0.03 apart

# ------------------------------------------------------------------ geometry
REAR_X = -1.55
FRONT_X = 1.55
TYRE_R = 0.32
HALO_R = 0.355
RIM_R = 0.205
CAP_R = 0.075
SPOKE_LEN = 0.145

BODY_BOTTOM = 0.45
BODY_TOP = 0.95

# The bonnet is a lid hinged at its rear edge, by the windscreen, and the front
# of it lifts — which is the way round every bonnet on the island opens.
HINGE = (1.06, BODY_TOP)
LID_LEN = 1.03
LID_H = 0.090
BONNET_OPEN = math.radians(48)

# The bay, and the opening that is drawn over it once the bonnet is up.
BAY = (1.58, 0.725)      # centre
BAY_W, BAY_H = 0.96, 0.41

TANK = (1.42, 0.72)      # the expansion tank, centre
TANK_W, TANK_H = 0.34, 0.30
TANK_BOTTOM = TANK[1] - TANK_H / 2
TANK_TOP = TANK[1] + TANK_H / 2
CAP_POS = (TANK[0], TANK_TOP + 0.028)
# Where the cap waits while the tank is open: clear of the tank, clear of the
# radiator, and reached by lifting it straight up first — dragged across on
# the diagonal it cut through the corner of the tank it had just come off.
CAP_ASIDE = (1.72, 0.800)
CAP_LIFT = (1.42, 1.000)
# The marks the level is read against. Deliberately two ticks and nothing else:
# no numbers, because a tick is what is moulded into the side of a real tank.
MIN_Z = 0.665
MAX_Z = 0.810
MARKS_X = TANK[0] - TANK_W / 2 + 0.058

# Coolant is drawn as a block growing from the floor of the tank, so the level
# is its top edge. Below the minimum to start with, between the two marks after.
LEVEL_LOW = 0.030
LEVEL_OK = 0.155

RAD = (1.93, 0.72)
RAD_W, RAD_H = 0.20, 0.34

# The two instruments. Both are drawn in the sky: they are readouts, not parts
# of the car, and nothing in an exterior elevation can show a dashboard.
GAUGE = (1.45, 1.80)
GAUGE_R = 0.33
NEEDLE_LEN = 0.225
# Screen angles: the left stop is cold, the right stop is hot.
G_COLD = math.radians(168)
G_WARM = math.radians(103)
G_NORMAL = math.radians(90)
G_HOT = math.radians(20)

CLOCK_WIDE = (-0.75, 1.85)
CLOCK_R = 0.28
CLOCK_CLOSE = (2.08, 1.08)

# Both parks are outside their own framing, so nothing waits in shot.
HAND_PARK_WIDE = (3.10, 1.30)
HAND_PARK_CLOSE = (2.45, 0.74)
HAND_REACH = 0.078       # from the hand's origin to its fingertips
# A hand at life size is 48 px across in the wide shot, which is noise rather
# than a hand. It is drawn larger there and at life size in the close one,
# the same way the clock is: both are glyphs, not parts of the car.
WIDE_GLYPH = 1.9

BOTTLE_PARK = (3.20, 1.10)
BOTTLE_PARK_CLOSE = (2.58, 1.02)
BOTTLE_POUR = (1.61, 0.995)
BOTTLE_TILT = math.radians(120)
BOTTLE_CARRY = math.radians(100)   # how it is held on the way in and out
BOTTLE_MOUTH = 0.22      # from the bottle's centre to the lip

WIDE = ((0.15, 0.80), 5.0)
# The close shot is framed to start just above the top of the front wheel:
# any lower and a tyre arc runs across the bottom of the bay, which is the
# one place this clip cannot afford to look busy.
CLOSE = ((1.60, 0.8375), 1.20)
# How much smaller a thing drawn for the wide shot has to be drawn to look the
# same size in the close one. Used for the clock, which is in both.
CLOSE_K = CLOSE[1] / WIDE[1]

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


def ring(name, r, w, loc, hole_y, *, material=None, bg=None, parent=None):
    """An outline, drawn as a smaller disc of sky laid over a larger one.

    For the instruments, where a solid face is wanted: a gauge has one.
    """
    disc(name, r, loc, material=material, parent=parent)
    disc(name + "Hole", r - w, (loc[0], hole_y, loc[2]), material=bg, parent=parent)


def annulus(name, r, w, loc, *, material=None, parent=None):
    """A ring with a real hole in it, for the refusals.

    A disc of sky over a disc of red would hide the very thing being refused.
    Nothing here is transparent, so the hole has to be geometry.
    """
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=w,
                                     major_segments=64, minor_segments=6)
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
    build, so the keys are corrected after insertion instead.

    BEZIER is set explicitly rather than left alone, which is the one place
    this file departs from scripts/fix_tyre.py, and it is not cosmetic. Once a
    curve on this build holds a run of CONSTANT keys, every key inserted after
    it is born CONSTANT too — inherited from the key before it, not taken from
    the preference. Skipping the BEZIER case, as the template does, therefore
    leaves whole curves stepped: before this was found, the bonnet teleported
    open instead of lifting, the hand jumped to the tank instead of reaching
    for it, and every wisp of steam popped through four poses instead of
    rising. It rendered, it just was not animation. Checked by reading the
    keyframe_points back, not assumed.
    """
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
    """On or off, by scale.

    Dimming is not an option: an emission strength of zero is black, and a
    black gauge in the sky is still a gauge in the sky.
    """
    key(obj, frame, scale=(1.0, 1.0, 1.0) if on else (0.0, 0.0, 0.0), interp=interp)


def ease_out(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return 1.0 - (1.0 - t) ** 2


def ease_in(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t


# ------------------------------------------------------------------ the road
def build_road(mats):
    plate("RoadFill", 20.0, 6.4, (0, LAY["fill"], -3.2), material=mats["road"])
    plate("RoadLine", 20.0, 0.06, (0, LAY["ground"], -0.03), material=mats["text"])
    # The car never moves across the frame, so the road is what shows motion:
    # these slide left while it is rolling and stop when it stops.
    dashes = empty("Dashes")
    x = -7.0
    i = 0
    while x < 7.0:
        plate(f"Dash{i}", 0.30, 0.05, (x, LAY["dash"], -0.17),
              material=mats["steel"], parent=dashes)
        x += 0.62
        i += 1
    return dashes


# ------------------------------------------------------------------- the car
def build_wheel(name, parent, mats):
    """Tyre, rim, spokes, cap, and a pale ring behind the lot.

    The ring is the cheap way to get an outline: the tyre is nearly the same
    ink as the body it overlaps. The spokes are there so that a roll reads as
    a roll; a plain disc spins invisibly.
    """
    root = empty(name, parent=parent)
    disc(name + "Halo", HALO_R, (0, 0.75, 0), material=mats["bg"], parent=root)
    disc(name + "Tyre", TYRE_R, (0, 0.70, 0), material=mats["ink"], parent=root)
    disc(name + "Rim", RIM_R, (0, 0.65, 0), material=mats["steel"], parent=root)
    for i in range(5):
        a = math.radians(18 + i * 72)
        plate(f"{name}Spoke{i}", SPOKE_LEN, 0.05,
              (SPOKE_LEN / 2 * math.cos(a), 0.60, SPOKE_LEN / 2 * math.sin(a)),
              material=mats["ink_soft"], parent=root, spin=-a)
    disc(name + "Cap", CAP_R, (0, 0.55, 0), material=mats["ink"], parent=root)
    return root


def build_car(mats):
    car = empty("Car", (0, 0, 0))

    plate("Body", 4.20, BODY_TOP - BODY_BOTTOM,
          (0.0, LAY["body"], (BODY_TOP + BODY_BOTTOM) / 2),
          material=mats["ink_soft"], parent=car)
    plate("Cabin", 2.45, 0.48, (-0.18, LAY["body"], 1.19),
          material=mats["ink_soft"], parent=car)
    # A square-cornered cabin on a slab reads as a pickup truck, which is the
    # wrong vehicle for a guide that says "car" in its first line.
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

    # The panel over the engine bay. It is bodywork until the bonnet is up,
    # then it becomes the opening the bay is drawn inside: see the docstring.
    plate("Wing", BAY_W, BAY_H, (BAY[0], LAY["wing"], BAY[1]),
          material=mats["wing"], parent=car)

    # The lid, hanging off its hinge so that raising it is one rotation. The
    # slate strip along its outer face is a panel gap while it is shut and the
    # thing that stops it reading as a pole once it is up.
    hinge = empty("BonnetHinge", (HINGE[0], 0, HINGE[1]), parent=car)
    plate("BonnetLid", LID_LEN, LID_H, (LID_LEN / 2, LAY["bonnet"], -LID_H / 2),
          material=mats["ink_soft"], parent=hinge)
    plate("BonnetEdge", LID_LEN, 0.018, (LID_LEN / 2, LAY["bonnet"] - 0.03, -0.009),
          material=mats["slate"], parent=hinge)

    rear = build_wheel("Rear", car, mats)
    rear.location = (REAR_X, 0, TYRE_R)
    front = build_wheel("Front", car, mats)
    front.location = (FRONT_X, 0, TYRE_R)

    return dict(car=car, hinge=hinge, wheels=(rear, front))


def build_bay(mats, car):
    """What is under the bonnet, drawn only once the bonnet is up.

    Hidden by scale rather than by a hide flag, because the reveal has to land
    on an exact frame and scale keys can be made CONSTANT; a visibility flag
    on this build animates as a float and fades.
    """
    root = empty("Bay", (0, 0, 0), parent=car)

    # The floor of the bay. It is here because the front wheel is directly
    # under the engine in a side elevation: without it, the top of that wheel
    # cuts across the bottom of the cutaway.
    plate("BayFloor", BAY_W, 0.22, (BAY[0], LAY["floor"], BAY[1] - BAY_H / 2 + 0.09),
          material=mats["road"], parent=root)

    # Radiator: a core with its fins, so the thing the heat came out of is in
    # the frame next to the tank it is confused with.
    plate("Rad", RAD_W, RAD_H, (RAD[0], LAY["shell"], RAD[1]),
          material=mats["steel"], parent=root)
    for i in range(5):
        plate(f"RadFin{i}", RAD_W - 0.03, 0.014,
              (RAD[0], LAY["tank"], RAD[1] - RAD_H / 2 + 0.055 + i * 0.058),
              material=mats["road"], parent=root)

    # Tank: a pale bottle with a slate outline, because the level has to be
    # legible through it and the recess behind it is pale too.
    plate("TankShell", TANK_W + 0.022, TANK_H + 0.022,
          (TANK[0], LAY["shell"], TANK[1]), material=mats["slate"], parent=root)
    plate("TankBody", TANK_W, TANK_H, (TANK[0], LAY["tank"], TANK[1]),
          material=mats["bg"], parent=root)

    # The coolant grows up from the floor of the tank: a plate one unit tall
    # under an empty whose Z scale is the level. Scaling the plate itself
    # would have grown it from its own middle, out of both ends.
    level = empty("Level", (TANK[0], 0, TANK_BOTTOM + 0.011), parent=root)
    plate("Coolant", TANK_W - 0.022, 1.0, (0, LAY["coolant"], 0.5),
          material=mats["brand"], parent=level)

    marks = empty("Marks", (MARKS_X, 0, (MIN_Z + MAX_Z) / 2), parent=root)
    for i, z in enumerate((MIN_Z, MAX_Z)):
        plate(f"Mark{i}", 0.110, 0.020, (0, LAY["mark"], z - (MIN_Z + MAX_Z) / 2),
              material=mats["slate"], parent=marks)

    cap = empty("Cap", (CAP_POS[0], 0, CAP_POS[1]), parent=root)
    plate("CapBody", 0.13, 0.055, (0, LAY["cap"], 0), material=mats["yellow"],
          parent=cap)
    plate("CapNeck", 0.085, 0.030, (0, LAY["cap"], -0.040), material=mats["slate"],
          parent=cap)

    return dict(root=root, level=level, marks=marks, cap=cap)


# ------------------------------------------------------------- the readouts
def build_gauge(mats):
    """The temperature gauge, drawn in the sky above the bonnet.

    Cold on the left, hot on the right, the normal band picked out in green
    and the last three ticks in flag red, which is the only way this clip can
    say "climbing" without a word of text.
    """
    place = empty("GaugePlace", (GAUGE[0], 0, GAUGE[1]))
    root = empty("Gauge", (0, 0, 0), parent=place)
    ring("GaugeRing", GAUGE_R, 0.022, (0, LAY["dial"], 0), LAY["dial_hole"],
         material=mats["slate"], bg=mats["bg"], parent=root)

    for i in range(13):
        a = math.radians(168 - i * 13)
        if a <= math.radians(40):
            mat = mats["red"]
        elif math.radians(76) <= a <= math.radians(104):
            mat = mats["green"]
        else:
            mat = mats["slate"]
        r = GAUGE_R - 0.075
        plate(f"GaugeTick{i}", 0.075, 0.030,
              (r * math.cos(a), LAY["dial_tick"], r * math.sin(a)),
              material=mat, parent=root, spin=-a)

    needle = empty("Needle", (0, 0, 0), parent=root)
    plate("NeedleBar", NEEDLE_LEN, 0.028, (NEEDLE_LEN / 2, LAY["dial_hand"], 0),
          material=mats["ink"], parent=needle)
    disc("NeedleHub", 0.042, (0, LAY["dial_hub"], 0), material=mats["ink"],
         parent=root, verts=16)
    return dict(place=place, root=root, needle=needle)


def build_clock(mats):
    """Thirty minutes, drawn as half a turn of a minute hand.

    Twelve ticks, because half a turn of an unmarked dial is half of nothing.
    It is the only thing on screen during the wait, and the wait is the step.
    """
    place = empty("ClockPlace", (CLOCK_WIDE[0], 0, CLOCK_WIDE[1]))
    root = empty("Clock", (0, 0, 0), parent=place)
    ring("ClockRing", CLOCK_R, 0.020, (0, LAY["dial"], 0), LAY["dial_hole"],
         material=mats["slate"], bg=mats["bg"], parent=root)
    for i in range(12):
        a = math.radians(90 - i * 30)
        r = CLOCK_R - 0.055
        plate(f"ClockTick{i}", 0.040, 0.016,
              (r * math.cos(a), LAY["dial_tick"], r * math.sin(a)),
              material=mats["stud"], parent=root, spin=-a)
    hand = empty("ClockHand", (0, 0, 0), parent=root)
    plate("ClockBar", CLOCK_R - 0.085, 0.026,
          ((CLOCK_R - 0.085) / 2, LAY["dial_hand"], 0),
          material=mats["brand"], parent=hand)
    disc("ClockHub", 0.034, (0, LAY["dial_hub"], 0), material=mats["brand"],
         parent=root, verts=16)
    return dict(place=place, root=root, hand=hand)


# ---------------------------------------------------------------- the tools
def build_hand(mats):
    """A glove, near enough. It says "by hand", which is half of two steps.

    Built pointing along -X, fingers first, so one glyph can reach for the
    bonnet, reach for the cap, rest flat on the tank and carry the cap back
    without being redrawn.
    """
    root = empty("Hand", (HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]))
    plate("Palm", 0.100, 0.105, (0.038, LAY["hand"], 0), material=mats["brand"],
          parent=root)
    for i, dz in enumerate((0.033, 0.0, -0.033)):
        plate(f"Finger{i}", 0.065, 0.023, (-0.045, LAY["hand"], dz),
              material=mats["brand"], parent=root)
    plate("Thumb", 0.062, 0.025, (-0.015, LAY["hand"], 0.062),
          material=mats["brand"], parent=root, spin=-math.radians(26))
    plate("Cuff", 0.042, 0.115, (0.100, LAY["hand"], 0), material=mats["brand"],
          parent=root)
    return root


def build_no(name, radius, loc, mats):
    """A circle and a bar: the one symbol that needs no language.

    Two of them, one sized for each framing, rather than one that is moved and
    rescaled across the cut. A refusal that changed size mid-clip would be the
    only thing in the frame doing it.
    """
    root = empty(name, (loc[0], 0, loc[1]))
    annulus(name + "Ring", radius, radius * 0.11, (0, LAY["no"], 0),
            material=mats["red"], parent=root)
    plate(name + "Bar", radius * 1.78, radius * 0.22, (0, LAY["no"] - 0.03, 0),
          material=mats["red"], parent=root, spin=-math.radians(45))
    return root


def build_bottle(mats):
    """The coolant. Floating, because every tool in this house style floats:
    the hand is reserved for the two steps that say to use one."""
    root = empty("Bottle", (BOTTLE_PARK[0], 0, BOTTLE_PARK[1]))
    plate("BottleBody", 0.150, 0.260, (0, LAY["bottle"], 0),
          material=mats["brand_deep"], parent=root)
    plate("BottleLabel", 0.110, 0.075, (0, LAY["bottle"] - 0.01, -0.030),
          material=mats["brand"], parent=root)
    plate("BottleNeck", 0.055, 0.090, (0, LAY["bottle"], 0.175),
          material=mats["brand_deep"], parent=root)
    return root


STREAM_TOP = 0.885       # at the bottle's lip once it is tipped
STREAM_LEN = 0.210       # down past the surface, so it reads as going in


def build_stream(mats):
    """The pour, grown downward from the bottle's lip into the tank.

    One plate under an empty whose Z scale is the length, so it grows from the
    lip. Scaling the plate itself would have grown it out of both ends, which
    on a pour means coolant appearing in mid-air above the bottle.
    """
    root = empty("Stream", (TANK[0], 0, STREAM_TOP))
    plate("StreamBar", 0.038, STREAM_LEN, (0, LAY["stream"], -STREAM_LEN / 2),
          material=mats["brand"], parent=root)
    return root


def build_steam(mats):
    """Four wisps off the bonnet seam.

    Slate, not white: the page is already near-white, and steam that cannot be
    seen is not a warning. They thin out and stop before the bonnet is touched,
    which is the whole condition in step 1.
    """
    puffs = []
    for i in range(4):
        root = empty(f"Puff{i}", (0, 0, -2.0))
        disc(f"Puff{i}A", 0.052, (0, LAY["steam"], 0), material=mats["steel"],
             parent=root, verts=16)
        disc(f"Puff{i}B", 0.040, (0.046, LAY["steam"], 0.034), material=mats["steel"],
             parent=root, verts=16)
        disc(f"Puff{i}C", 0.034, (-0.040, LAY["steam"], 0.028), material=mats["steel"],
             parent=root, verts=16)
        puffs.append(root)
    return puffs


# ---------------------------------------------------------------- animation
def point(phi):
    """The Y rotation that aims a needle or a hand at screen angle phi.

    The camera looks along +Y, so a positive Y rotation reads as clockwise.
    """
    return (0, -phi, 0)


def roll(dashes, wheels, f0, f1, distance, shape, *, start=0.0, turned=0.0, step=3):
    """Move the road and turn the wheels off one number.

    The car never crosses the frame, so the road is what shows motion and the
    wheels have to agree with it: both come out of the same distance here
    rather than being keyed by eye against each other.

    Sampled rather than keyed at both ends, because a car arriving at a stop
    does not ease in — it is already going — and bezier handles between two
    keys would have drawn it setting off slowly every time.
    """
    span = max(1, f1 - f0)
    for f in list(range(f0, f1, step)) + [f1]:
        d = distance * shape(min(1.0, (f - f0) / span))
        key(dashes, f, loc=(start - d, 0, 0), interp="LINEAR")
        for w in wheels:
            key(w, f, rot=(0, turned + d / TYRE_R, 0), interp="LINEAR")


def animate(rig, bay, gauge, clock, hand, no_bonnet, no_cap, bottle, stream,
            puffs, dashes, cam, mats):
    wheels = rig["wheels"]
    hinge = rig["hinge"]

    # --- camera: two framings, hard cuts, and nothing in between.
    def frame_at(f, which):
        (cx, cz), scale = which
        key(cam, f, loc=(cx, -14.0, cz), interp="CONSTANT")
        key_value(cam.data, "ortho_scale", f, scale, interp="CONSTANT")

    frame_at(1, WIDE)
    frame_at(F["no_cap"], CLOSE)
    frame_at(F["watch"], WIDE)

    # --- the starting state, keyed explicitly. A value an object was merely
    # built with is overwritten the moment it gets a keyframe anywhere, since
    # the first key extrapolates backwards to frame one.
    key(hinge, 1, rot=(0, 0, 0), interp="CONSTANT")
    key(hand, 1, loc=(HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]), rot=(0, 0, 0),
        scale=(WIDE_GLYPH, WIDE_GLYPH, WIDE_GLYPH), interp="CONSTANT")
    key(bottle, 1, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(stream, 1, scale=(1, 1, 0.001), interp="CONSTANT")
    show(bay["root"], 1, False)
    key(bay["level"], 1, scale=(1, 1, LEVEL_LOW), interp="CONSTANT")
    key(bay["cap"], 1, loc=(CAP_POS[0], 0, CAP_POS[1]), interp="CONSTANT")
    key(bay["marks"], 1, scale=(1, 1, 1), interp="CONSTANT")
    show(no_bonnet, 1, False)
    show(no_cap, 1, False)
    key_colour(mats["wing"], 1, INK_SOFT)
    for puff in puffs:
        key(puff, 1, loc=(0, 0, -2.0), scale=(0.001, 0.001, 0.001), interp="CONSTANT")

    key(gauge["place"], 1, scale=(1, 1, 1), interp="CONSTANT")
    show(gauge["root"], 1, True)
    key(gauge["needle"], 1, rot=point(G_WARM), interp="CONSTANT")
    key(clock["place"], 1, loc=(CLOCK_WIDE[0], 0, CLOCK_WIDE[1]), scale=(1, 1, 1),
        interp="CONSTANT")
    show(clock["root"], 1, False)
    key(clock["hand"], 1, rot=point(math.radians(90)), interp="CONSTANT")

    # --- pullover: the gauge climbs into the red, the car comes to a stop.
    # The needle goes first and the car stops after it, because that is the
    # order it happens in: the gauge is what tells you to pull over.
    key(gauge["needle"], F["pullover"], rot=point(G_WARM), interp="LINEAR")
    key(gauge["needle"], F["pullover"] + 40, rot=point(G_HOT), interp="LINEAR")
    roll(dashes, wheels, F["pullover"], F["pullover"] + 42, 3.0, ease_out)

    # Steam from the bonnet seam while the engine is hot. Four wisps on
    # staggered cycles, each one smaller than the last, and all of them done
    # before anything goes near the bonnet.
    seam = (1.74, 1.88, 1.64, 1.96)
    for i, puff in enumerate(puffs):
        t0 = F["pullover"] + 14 + i * 9
        while t0 <= F["pullover"] + 85:
            s = 1.10 if t0 < 50 else (0.85 if t0 < 75 else 0.60)
            x0 = seam[i]
            # No hard keys in here: a wisp is 0.001 across at both ends of
            # its cycle, so the walk back down to the seam between cycles is
            # already invisible and a CONSTANT key would only freeze it.
            key(puff, t0, loc=(x0, 0, 0.97), scale=(0.001, 0.001, 0.001))
            key(puff, t0 + 8, loc=(x0 + 0.02, 0, 1.14), scale=(0.70 * s,) * 3)
            key(puff, t0 + 22, loc=(x0 + 0.06, 0, 1.46), scale=(1.25 * s,) * 3)
            key(puff, t0 + 32, loc=(x0 + 0.09, 0, 1.70), scale=(0.001,) * 3)
            t0 += 34

    # --- engine off: the instrument dies rather than the needle falling.
    # A needle swinging back to cold is what really happens when the ignition
    # is cut, and it is the one thing this clip must not appear to say.
    for f, on in ((F["engine_off"] + 6, False), (F["engine_off"] + 9, True),
                  (F["engine_off"] + 12, False)):
        show(gauge["root"], f, on)

    # The bonnet, reached for and refused, while the steam is still coming.
    key(hand, F["engine_off"] + 14, loc=(HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]))
    key(hand, F["engine_off"] + 26, loc=(2.00, 0, 1.12))
    show(no_bonnet, F["engine_off"] + 23, False)
    key(no_bonnet, F["engine_off"] + 27, scale=(1, 1, 1))
    key(hand, F["engine_off"] + 34, loc=(2.00, 0, 1.12))
    key(hand, F["engine_off"] + 44, loc=(HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]))
    key(no_bonnet, F["wait"] - 6, scale=(1, 1, 1))
    show(no_bonnet, F["wait"] - 2, False)

    # --- wait: the clock starts, and only once the steam has stopped does the
    # bonnet go up. The order of those two is the whole of step 1.
    show(clock["root"], F["wait"] + 6, False)
    key(clock["root"], F["wait"] + 14, scale=(1, 1, 1))
    clock_f0, clock_f1 = F["wait"] + 14, F["check"] + 16
    for f in list(range(clock_f0, clock_f1, 6)) + [clock_f1]:
        u = (f - clock_f0) / (clock_f1 - clock_f0)
        key(clock["hand"], f, rot=point(math.radians(90 - 180 * u)), interp="LINEAR")

    key(hinge, F["wait"] + 32, rot=(0, 0, 0))
    key(hinge, F["wait"] + 56, rot=(0, -BONNET_OPEN, 0))

    # The cutaway opens with the bonnet rather than at the cut, so that the
    # close framing is only a closer look at a car the viewer has already seen
    # opened. It is a drawing convention, not something happening to the car,
    # which is why it arrives on one frame instead of fading in.
    open_at = F["wait"] + 50
    key_colour(mats["wing"], open_at - 1, INK_SOFT)
    key_colour(mats["wing"], open_at, ROAD)
    show(bay["root"], open_at - 1, False)
    show(bay["root"], open_at, True)

    # --- the cut into the close framing moves the three glyphs that are in
    # both. Each is pinned on the frame before the cut as well as on it: a
    # curve with nothing between frame 93 and frame 173 does not sit still for
    # eighty frames, it slides, and the hand was drifting into the wide shot
    # during the wait with nothing to do there.
    cut = F["no_cap"]
    key(hand, cut - 1, loc=(HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]), rot=(0, 0, 0),
        scale=(WIDE_GLYPH, WIDE_GLYPH, WIDE_GLYPH), interp="CONSTANT")
    key(bottle, cut - 1, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), rot=(0, 0, 0),
        interp="CONSTANT")
    key(clock["place"], cut - 1, loc=(CLOCK_WIDE[0], 0, CLOCK_WIDE[1]),
        scale=(1, 1, 1), interp="CONSTANT")
    key(clock["place"], cut, loc=(CLOCK_CLOSE[0], 0, CLOCK_CLOSE[1]),
        scale=(CLOSE_K, CLOSE_K, CLOSE_K), interp="CONSTANT")
    key(hand, cut, loc=(HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1]), rot=(0, 0, 0),
        scale=(1, 1, 1), interp="CONSTANT")
    key(bottle, cut, loc=(BOTTLE_PARK_CLOSE[0], 0, BOTTLE_PARK_CLOSE[1]),
        rot=point(BOTTLE_CARRY), interp="CONSTANT")

    # --- the cap, reached for and refused. This is the beat the guide shouts
    # about, so it gets the close framing to itself and no other movement.
    key(hand, F["no_cap"] + 5, loc=(HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1]))
    key(hand, F["no_cap"] + 19, loc=(1.64, 0, CAP_POS[1]))
    show(no_cap, F["no_cap"] + 15, False)
    key(no_cap, F["no_cap"] + 20, scale=(1, 1, 1))
    key(hand, F["no_cap"] + 27, loc=(1.64, 0, CAP_POS[1]))
    key(hand, F["no_cap"] + 41, loc=(HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1]))
    key(no_cap, F["no_cap"] + 46, scale=(1, 1, 1))
    show(no_cap, F["no_cap"] + 50, False)

    # --- check: the clock runs out first, and only then does a hand go on the
    # tank. That order is the step — "once it is cool enough to rest your hand
    # on the tank" — so the touch must not happen while the wait is still on
    # screen. Then the level is read against the marks, with the cap still on.
    key(clock["root"], F["check"] + 18, scale=(1, 1, 1))
    show(clock["root"], F["check"] + 22, False)

    key(hand, F["check"] + 26, loc=(HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1]))
    key(hand, F["check"] + 38, loc=(TANK[0] + TANK_W / 2 + HAND_REACH, 0, TANK[1]))
    key(hand, F["check"] + 48, loc=(TANK[0] + TANK_W / 2 + HAND_REACH, 0, TANK[1]))
    key(hand, F["check"] + 57, loc=(HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1]))

    big = True
    for f in range(F["check"] + 34, F["check"] + 56, 5):
        key(bay["marks"], f, scale=(1.0, 1.0, 1.0) if big else (0.72, 1.0, 0.72),
            interp="CONSTANT")
        big = not big
    key(bay["marks"], F["check"] + 56, scale=(1, 1, 1), interp="CONSTANT")

    # --- top up: now, and only now, the cap comes off. The hand is clear of
    # the frame before the bottle arrives and the bottle is gone before the
    # hand comes back, because they both enter from the right and crossing
    # one through the other is the kind of thing a diagram cannot survive.
    hand_hold = 0.18        # where a hand sits to be holding the cap
    park_c = (HAND_PARK_CLOSE[0], 0, HAND_PARK_CLOSE[1])
    park_b = (BOTTLE_PARK_CLOSE[0], 0, BOTTLE_PARK_CLOSE[1])

    key(hand, F["top_up"] + 3, loc=park_c)
    key(hand, F["top_up"] + 12, loc=(1.60, 0, CAP_POS[1]))
    key(bay["cap"], F["top_up"] + 13, loc=(CAP_POS[0], 0, CAP_POS[1]))
    key(bay["cap"], F["top_up"] + 17, loc=(CAP_LIFT[0], 0, CAP_LIFT[1]))
    key(hand, F["top_up"] + 17, loc=(CAP_LIFT[0] + hand_hold, 0, CAP_LIFT[1]))
    key(bay["cap"], F["top_up"] + 23, loc=(CAP_ASIDE[0], 0, CAP_ASIDE[1]))
    key(hand, F["top_up"] + 23, loc=(CAP_ASIDE[0] + hand_hold, 0, CAP_ASIDE[1]))
    key(hand, F["top_up"] + 30, loc=park_c)

    key(bottle, F["top_up"] + 31, loc=park_b, rot=point(BOTTLE_CARRY))
    key(bottle, F["top_up"] + 40, loc=(BOTTLE_POUR[0], 0, BOTTLE_POUR[1]),
        rot=point(BOTTLE_CARRY))
    key(bottle, F["top_up"] + 46, loc=(BOTTLE_POUR[0], 0, BOTTLE_POUR[1]),
        rot=point(BOTTLE_TILT))
    key(stream, F["top_up"] + 45, scale=(1, 1, 0.001))
    key(stream, F["top_up"] + 49, scale=(1, 1, 1.0))
    key(bay["level"], F["top_up"] + 48, scale=(1, 1, LEVEL_LOW))
    key(bay["level"], F["top_up"] + 59, scale=(1, 1, LEVEL_OK))
    key(stream, F["top_up"] + 59, scale=(1, 1, 1.0))
    key(stream, F["top_up"] + 62, scale=(1, 1, 0.001))
    key(bottle, F["top_up"] + 61, loc=(BOTTLE_POUR[0], 0, BOTTLE_POUR[1]),
        rot=point(BOTTLE_TILT))
    key(bottle, F["top_up"] + 68, loc=park_b, rot=point(BOTTLE_CARRY))

    key(hand, F["top_up"] + 68, loc=park_c)
    key(hand, F["top_up"] + 73, loc=(CAP_ASIDE[0] + hand_hold, 0, CAP_ASIDE[1]))
    key(bay["cap"], F["top_up"] + 73, loc=(CAP_ASIDE[0], 0, CAP_ASIDE[1]))
    key(bay["cap"], F["top_up"] + 77, loc=(CAP_LIFT[0], 0, CAP_LIFT[1]))
    key(hand, F["top_up"] + 77, loc=(CAP_LIFT[0] + hand_hold, 0, CAP_LIFT[1]))
    key(bay["cap"], F["top_up"] + 80, loc=(CAP_POS[0], 0, CAP_POS[1]))
    key(hand, F["top_up"] + 80, loc=(1.60, 0, CAP_POS[1]))

    # --- the cut back to the wide shot closes the bay again.
    back = F["watch"]
    key(hand, back, loc=(HAND_PARK_WIDE[0], 0, HAND_PARK_WIDE[1]),
        scale=(WIDE_GLYPH, WIDE_GLYPH, WIDE_GLYPH), interp="CONSTANT")
    key(bottle, back, loc=(BOTTLE_PARK[0], 0, BOTTLE_PARK[1]), rot=(0, 0, 0),
        interp="CONSTANT")

    # --- watch: bonnet down, then the gauge comes back from cold and settles
    # in the band. Nothing is switched on until the bonnet is shut, because an
    # open bonnet and a running engine do not belong in the same frame.
    key(hinge, F["watch"] + 2, rot=(0, -BONNET_OPEN, 0))
    key(hinge, F["watch"] + 22, rot=(0, 0, 0))
    key_colour(mats["wing"], F["watch"] + 19, ROAD)
    key_colour(mats["wing"], F["watch"] + 20, INK_SOFT)
    show(bay["root"], F["watch"] + 19, True)
    show(bay["root"], F["watch"] + 20, False)
    key(gauge["needle"], F["watch"] + 24, rot=point(G_COLD), interp="CONSTANT")
    show(gauge["root"], F["watch"] + 25, True)
    key(gauge["needle"], F["watch"] + 27, rot=point(G_COLD), interp="LINEAR")
    key(gauge["needle"], F["watch"] + 42, rot=point(G_NORMAL), interp="LINEAR")
    key(gauge["needle"], F_END, rot=point(G_NORMAL), interp="LINEAR")
    roll(dashes, wheels, F["watch"] + 34, F_END, 1.1, ease_in,
         start=-3.0, turned=3.0 / TYRE_R)


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
        "red": flat("Red", RED),
        # Its own material: this is the one surface whose colour is animated.
        "wing": flat("Wing", INK_SOFT),
    }

    dashes = build_road(mats)
    rig = build_car(mats)
    bay = build_bay(mats, rig["car"])
    gauge = build_gauge(mats)
    clock = build_clock(mats)
    hand = build_hand(mats)
    no_bonnet = build_no("NoBonnet", 0.22, (1.80, 1.20), mats)
    no_cap = build_no("NoCap", 0.135, (CAP_POS[0] + 0.02, CAP_POS[1]), mats)
    bottle = build_bottle(mats)
    stream = build_stream(mats)
    puffs = build_steam(mats)

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

    animate(rig, bay, gauge, clock, hand, no_bonnet, no_cap, bottle, stream,
            puffs, dashes, cam, mats)
    setup_render(scene)

    if still is not None:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.frame_set(still)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(STILL_DIR, f"overheat_{still:04d}.png")
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
        out = os.path.join(OUT_DIR, "fix-overheating.mp4")
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
        size = os.path.getsize(out) if os.path.exists(out) else -1
        print(f"WROTE {out} {size} bytes crf={crf}")

    if do_save:
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "fix-overheating.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s BEATS {F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
