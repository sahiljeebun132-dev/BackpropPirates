"""Simulate and render a car collision with a restrained occupant.

Run:
    blender --background --factory-startup --python scripts/crash_car_ragdoll.py -- --render
    blender --background --factory-startup --python scripts/crash_car_ragdoll.py -- --still 72
    blender --background --factory-startup --python scripts/crash_car_ragdoll.py -- --stills 1,40,70
    blender --background --factory-startup --python scripts/crash_car_ragdoll.py -- --render --crf LOW

    --still N      one frame to docs/pitch-assets/crashcar_NNNN.png, for checking framing
    --stills A,B,C several frames in one run, so the sim is only baked once
    --render       the whole thing to public/guides/crash-car.mp4
    --crf NAME     Blender's constant_rate_factor; a lower setting is a smaller file
    --save         also write the .blend, so it can be opened and nudged by hand
    --trace        print where the car and the occupant actually went, per frame

WHAT THIS CLIP IS FOR, because it governs every choice below.

Zetway measures rotation and speed change to tell a crash apart from a dropped
phone. The argument is that a real impact throws a body around in a way a
dropped phone does not. So the occupant here is simulated, not animated: the
motion has to be a consequence of the collision rather than a drawing of one,
or the clip is not evidence of anything.

It is a road-safety pitch, not a crash test. The figure is an abstract
articulated mannequin - plain matte capsules and boxes in one flat colour, no
face, no clothing, no blood, no damage to the body. The belt is the only thing
picked out in brand colour, because surviving the crash is the point. Restraint
reads as seriousness here; anything more graphic would be tasteless in front of
a jury and would also be making a different argument.

HOW THE PHYSICS IS SET UP, and why it is not obvious.

Blender has no API for "give this rigid body an initial velocity". The way to
do it is to keyframe the body as kinematic along the approach and switch
kinematic off a few frames before contact: Bullet saves the velocity implied by
the kinematic motion, so the body enters the collision already moving. Measured
on this build before anything else was written - a box keyframed at 0.41 u per
frame kept travelling at 0.41 u per frame after the handoff. Every occupant
part is handed off on the same frame, so the whole car-plus-occupant system
arrives at the barrier with one shared velocity, which is what makes the
occupant carry on forward when the car stops.

The occupant lives on collision collection 1 and the road, barrier and car
shell live on collection 0. That is not a trick to hide interpenetration, it is
the only way to have an occupant INSIDE a car: a car whose shell is a solid box
has no interior, and an active concave mesh collider is slow and unstable in
Bullet. What the occupant can actually touch - seat pan, seat back, floor,
dash - are separate passive colliders parented to the car, also on collection
1. Checked on this build: a passive kinematic body parented to a simulated
active body follows it exactly, so the seat stays under the occupant while the
car is being thrown about.

Written against Blender 5.2.1 LTS. Four things this build does that older
scripts in this repo found the hard way, all re-checked here:
  - preferences.edit.keyframe_new_interpolation_type does nothing. Keyframe
    interpolation has to be set on keyframe_points after insertion.
  - Action.fcurves does not exist at all on 5.2 (scripts/fix_tyre.py still
    guards for it; here it always raises). Curves come from the slotted
    action's layers -> strips -> channelbags.
  - image_settings.media_type must be "VIDEO" before FFMPEG can be assigned.
  - render.filepath must be absolute, or it resolves against the .blend.
And one that is specific to simulation: the point cache must be baked before
rendering, and the cache keeps its own frame range which defaults to 250
regardless of the scene range, so it is set explicitly.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

R = math.radians

# ------------------------------------------------------------------ timeline
FPS = 24

F_START = 1
F_RELEASE = 62     # kinematic off: the solver owns everything from here
F_END = 240        # 10.0 s

# The approach, in metres of road per frame. 0.5164 m/frame at 24 fps is
# 12.4 m/s, about 45 km/h - an urban speed, and survivable belted, which is
# the whole reason this clip is worth showing.
CAR_START_Y = -37.5
CAR_RELEASE_Y = -6.0
SPEED_PER_FRAME = (CAR_RELEASE_Y - CAR_START_Y) / (F_RELEASE - F_START)

# ------------------------------------------------------------------- palette
# The hex values are src/index.css, so this clip and the app agree. They are
# converted to linear below rather than eyeballed, because the view transform
# is Standard and a wrong conversion would show up as the wrong brand blue.
BG = "#eef2f7"
ROAD = "#dfe5ec"
VERGE = "#cbd5e1"
CAR_SHELL = "#aebccd"
CAR_DARK = "#64748b"
GLASS = "#c7d6e4"
TYRE = "#1e2430"
FIGURE = "#334155"   # the mannequin, one flat colour throughout
BELT = "#189edb"     # the only brand-coloured thing in the frame
BARRIER = "#475569"
HAZARD = "#f0c000"
LINE = "#f8fafc"


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_string: str, alpha: float = 1.0):
    h = hex_string.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (alpha,)


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def matte(name: str, hex_string: str, *, rough=0.85, metal=0.0):
    """Every surface here is matte. Specular highlights under the Standard
    view transform clip straight to white, and a blown highlight on a safety
    diagram reads as a rendering mistake rather than as shine."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba(hex_string)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def _activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def box(name, dims, loc=(0, 0, 0), rot=(0, 0, 0), material=None):
    """A cube at a real size, with its scale applied.

    Scale is applied rather than left on the object for two reasons: a rigid
    body's collision shape is read from the evaluated dimensions, and a child
    inherits its parent's scale, so an unapplied scale on the car would shrink
    or stretch every panel bolted to it.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = dims
    o.rotation_euler = Euler(rot)
    _activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    return o


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), material=None, verts=20):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = Euler(rot)
    if material:
        o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def sphere(name, radius, loc=(0, 0, 0), material=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=20, ring_count=12, location=loc)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    if material:
        o.data.materials.append(material)
    return o


def rigid(obj, *, kind="ACTIVE", shape="BOX", mass=1.0, layer=0,
          friction=0.6, bounce=0.05, kinematic=False):
    _activate(obj)
    bpy.ops.rigidbody.object_add(type=kind)
    rb = obj.rigid_body
    rb.collision_shape = shape
    rb.friction = friction
    rb.restitution = bounce
    rb.kinematic = kinematic
    # Blender's default 0.04 m collision margin is the single most dangerous
    # number in this scene. Sixteen bodies are kinematic through the approach,
    # which means Bullet ignores every overlap between them, and then they all
    # go dynamic on one frame. Any pair whose margins overlap has to be pushed
    # apart inside one substep - 1/(24*30) s - and clearing 0.08 m in 1.4 ms
    # takes about 57 m/s. Measured: with the default margin the car left the
    # road and was 274 m in the air by the end of the clip.
    rb.use_margin = True
    rb.collision_margin = 0.005
    if kind == "ACTIVE":
        rb.mass = mass
        # Damping keeps the settled ragdoll from twitching through the last
        # seconds of the clip, which looks like a bug rather than like a body.
        rb.linear_damping = 0.08
        rb.angular_damping = 0.22
    collections = [False] * 20
    collections[layer] = True
    rb.collision_collections = collections
    return obj


# ------------------------------------------------------------------ keyframes
def _curves(holder):
    """Every fcurve on an ID.

    On 5.2 Action.fcurves is gone outright - not empty, absent - so the only
    route is the slotted action's layers -> strips -> channelbags.
    """
    anim = getattr(holder, "animation_data", None)
    if anim is None or anim.action is None:
        return []
    curves = list(getattr(anim.action, "fcurves", ()) or [])
    if curves:
        return curves
    for layer in anim.action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


def set_interp(holder, frame, kind):
    """Force the interpolation of every key this ID has at `frame`.

    preferences.edit.keyframe_new_interpolation_type is the documented way and
    it does nothing on this build - keys are born BEZIER whatever it is set to.
    A bezier key on a boolean like rigid_body.kinematic eases through 0.5,
    which means the handoff happens on a frame nobody chose, so this is not
    cosmetic.
    """
    if kind == "BEZIER":
        return
    for curve in _curves(holder):
        for point in curve.keyframe_points:
            if abs(point.co[0] - frame) < 0.5:
                point.interpolation = kind


def key(obj, frame, *, loc=None, rot=None, interp="BEZIER"):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = Euler(rot)
        obj.keyframe_insert("rotation_euler", frame=frame)
    set_interp(obj, frame, interp)


# ------------------------------------------------------------------- the road
def build_road():
    box("Road", (16.0, 110.0, 0.06), (0, -25.0, -0.03), material=matte("Road", ROAD))
    verge = matte("Verge", VERGE, rough=0.95)
    for side in (-1, 1):
        box(f"Verge{side}", (14.0, 110.0, 0.10), (side * 15.0, -25.0, -0.05), material=verge)
    dash = matte("Dash", LINE, rough=0.8)
    for i in range(22):
        box(f"Dash{i}", (0.22, 2.6, 0.02), (0, -4.0 - i * 5.2, 0.005), material=dash)
    # The ground collider is one flat plate under all of it. The road meshes
    # above are decoration; giving each its own collider would only add seams
    # for the car to catch on as it slides.
    ground = box("Ground", (90.0, 140.0, 0.4), (0, -25.0, -0.2))
    ground.hide_render = True
    rigid(ground, kind="PASSIVE", shape="BOX", layer=0, friction=0.85)
    return ground


def build_barrier():
    """A plain concrete barrier, not a second car.

    A second vehicle would put a second person in the frame and invite the
    question of who was at fault, which is not what this clip is arguing. A
    wall is unambiguous: the car stopped, and what happened next happened to
    the body inside it.
    """
    body = matte("BarrierBody", BARRIER, rough=0.92)
    stripe = matte("BarrierStripe", HAZARD, rough=0.9)
    wall = box("Barrier", (8.0, 0.70, 0.95), (0, 0.35, 0.475), material=body)
    rigid(wall, kind="PASSIVE", shape="BOX", layer=0, friction=0.8)
    for i in range(6):
        box(f"BarrierStripe{i}", (0.42, 0.02, 0.30),
            (-2.6 + i * 1.05, -0.01, 0.62), rot=(0, R(22), 0), material=stripe)
    return wall


# -------------------------------------------------------------------- the car
# Car-local coordinates: origin on the road surface at the centre of the car,
# +Y the direction of travel, +X to the car's right, +Z up.
CAR_LEN, CAR_WID = 4.30, 1.78
# Mauritius drives on the left, so the driver sits on the right of the car.
# The camera therefore has to look in from the left, across the cabin, which
# is why the near side is the one left open below.
DRIVER_X = 0.38


def build_car():
    shell = matte("CarShell", CAR_SHELL, rough=0.78)
    dark = matte("CarDark", CAR_DARK, rough=0.8)
    glass = matte("CarGlass", GLASS, rough=0.5)
    tyre = matte("Tyre", TYRE, rough=0.95)

    # The collider is a single box the size of the car, hidden from the render.
    # Built centred, then its origin dropped to the road, so that every panel
    # coordinate below reads as a height above the ground rather than as an
    # offset from the middle of an invisible box.
    car = box("CarCollider", (CAR_WID, CAR_LEN, 1.30), (0, 0, 0.65))
    car.hide_render = True
    _activate(car)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    rigid(car, kind="ACTIVE", shape="BOX", mass=1250.0, layer=0,
          friction=0.7, bounce=0.03)

    def panel(name, dims, loc, rot=(0, 0, 0), material=shell):
        o = box(name, dims, loc, rot, material=material)
        o.parent = car
        return o

    # A cutaway body: floor, far side, roof, ends. The near (-X) side is left
    # open and only outlined, because a closed car is an opaque box and the
    # occupant - the entire subject of the clip - would be invisible.
    panel("Floor", (CAR_WID, 3.0, 0.06), (0, -0.10, 0.26))
    panel("FarSide", (0.07, CAR_LEN - 0.3, 1.00), (0.855, -0.05, 0.72))
    panel("Roof", (CAR_WID, 1.95, 0.06), (0, -0.38, 1.55))
    panel("Bonnet", (CAR_WID, 1.35, 0.52), (0, 1.47, 0.60))
    panel("Boot", (CAR_WID, 0.75, 0.70), (0, -1.77, 0.62))
    panel("Dash", (CAR_WID, 0.22, 0.42), (0, 0.66, 0.70), material=dark)
    panel("Windscreen", (CAR_WID - 0.1, 0.06, 0.95), (0, 0.72, 1.08),
          rot=(R(-26), 0, 0), material=glass)
    panel("RearGlass", (CAR_WID - 0.1, 0.05, 0.72), (0, -1.38, 1.22),
          rot=(R(28), 0, 0), material=glass)
    # Near-side outline: sill, two pillars and a roof rail. Enough edge for the
    # eye to close the shape into a car without closing the view into it.
    for name, dims, loc, rot in (
        ("SillNear", (0.07, 2.3, 0.14), (-0.855, -0.20, 0.33), (0, 0, 0)),
        ("PillarA", (0.07, 0.10, 1.00), (-0.855, 0.70, 1.06), (R(-26), 0, 0)),
        ("PillarB", (0.07, 0.11, 1.20), (-0.855, -1.30, 0.95), (R(22), 0, 0)),
        ("RailNear", (0.07, 1.95, 0.08), (-0.855, -0.38, 1.52), (0, 0, 0)),
    ):
        panel(name, dims, loc, rot, material=dark)

    for sx in (-1, 1):
        for y in (1.45, -1.45):
            w = cylinder(f"Wheel{sx}_{y}", 0.32, 0.22,
                         (sx * 0.82, y, 0.32), rot=(0, R(90), 0), material=tyre)
            w.parent = car

    seat_vis = matte("SeatVis", CAR_DARK, rough=0.9)
    for name, dims, loc in (
        ("SeatPanVis", (0.50, 0.50, 0.08), (DRIVER_X, -0.42, 0.56)),
        ("SeatBackVis", (0.50, 0.10, 0.62), (DRIVER_X, -0.70, 0.91)),
    ):
        panel(name, dims, loc, material=seat_vis)
    wheel = cylinder("SteeringWheel", 0.17, 0.035, (DRIVER_X, 0.12, 0.95),
                     rot=(R(74), 0, 0), material=dark, verts=24)
    wheel.parent = car

    # Interior colliders: the seat, floor and dash, which are the only parts
    # of the car the occupant can actually touch. On collection 1 so they meet
    # the occupant and nothing else.
    #
    # They are bolted to the car with FIXED constraints rather than parented to
    # it. Parenting a rigid body to a simulated rigid body is a dependency
    # cycle - Blender prints four of them and resolves each by reading the
    # parent one step stale, which at 12 m/s is half a metre of lag in the seat
    # under the occupant. A constraint lives inside the solver, so there is no
    # cycle and no lag.
    interior = []
    for name, dims, loc in (
        ("SeatPanCol", (0.52, 0.52, 0.08), (DRIVER_X, -0.42, 0.535)),
        ("SeatBackCol", (0.52, 0.12, 0.60), (DRIVER_X, -0.70, 0.94)),
        ("FloorCol", (CAR_WID - 0.2, 2.9, 0.06), (0, -0.10, 0.235)),
        ("DashCol", (CAR_WID - 0.2, 0.24, 0.42), (0, 0.66, 0.70)),
    ):
        col = box(name, dims, loc)
        col.hide_render = True
        rigid(col, kind="ACTIVE", shape="BOX", mass=40.0, layer=1, friction=0.7)
        interior.append(col)

    return car, interior


# --------------------------------------------------------------- the occupant
# Joint positions in car-local coordinates, seated at the wheel.
JOINTS = {
    "pelvis":    (DRIVER_X, -0.42, 0.70),
    "spine":     (DRIVER_X, -0.44, 0.82),
    "chest":     (DRIVER_X, -0.46, 1.02),
    "neck":      (DRIVER_X, -0.44, 1.25),
    "head":      (DRIVER_X, -0.42, 1.38),
    "shoulderL": (DRIVER_X - 0.17, -0.44, 1.16),
    "shoulderR": (DRIVER_X + 0.17, -0.44, 1.16),
    "elbowL":    (DRIVER_X - 0.19, -0.28, 0.98),
    "elbowR":    (DRIVER_X + 0.19, -0.28, 0.98),
    "wristL":    (DRIVER_X - 0.09, 0.06, 0.94),
    "wristR":    (DRIVER_X + 0.09, 0.06, 0.94),
    "hipL":      (DRIVER_X - 0.11, -0.42, 0.70),
    "hipR":      (DRIVER_X + 0.11, -0.42, 0.70),
    "kneeL":     (DRIVER_X - 0.11, 0.06, 0.70),
    "kneeR":     (DRIVER_X + 0.11, 0.06, 0.70),
    "ankleL":    (DRIVER_X - 0.11, 0.20, 0.35),
    "ankleR":    (DRIVER_X + 0.11, 0.20, 0.35),
}


def build_occupant():
    """Eleven capsules and boxes, one flat colour, no face.

    Deliberately abstract. A recognisable person being thrown about would be
    the kind of image that makes a jury look away, and it would also be a
    claim this simulation cannot support. A mannequin says only what is being
    claimed: a body is a jointed mass, and an impact moves it.
    """
    skin = matte("Figure", FIGURE, rough=0.9)
    belt_m = matte("Belt", BELT, rough=0.7)
    parts: dict[str, object] = {}

    def at(name) -> Vector:
        return Vector(JOINTS[name])

    def limb(name, a, b, radius, mass):
        """A capsule spanning two joints.

        The cylinder is shortened by a radius at each end so that the CAPSULE
        collider - which is the cylinder plus a hemisphere on each cap - comes
        out exactly the length of the bone. Getting this wrong makes every
        limb slightly too long, and eleven slightly-too-long bones is a figure
        that cannot sit in its own seat.
        """
        pa, pb = at(a), at(b)
        axis = pb - pa
        span = axis.length
        o = cylinder(name, radius, max(span - 2 * radius, 0.02),
                     tuple((pa + pb) / 2), material=skin)
        o.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
        rigid(o, shape="CAPSULE", mass=mass, layer=1, friction=0.5)
        parts[name] = o
        return o

    def block(name, dims, centre_key, mass, shape="BOX"):
        o = box(name, dims, tuple(at(centre_key)), material=skin)
        rigid(o, shape=shape, mass=mass, layer=1, friction=0.5)
        parts[name] = o
        return o

    block("pelvis", (0.30, 0.26, 0.20), "pelvis", 14.0)
    block("chest", (0.34, 0.24, 0.42), "chest", 25.0)

    head = sphere("head", 0.115, tuple(at("head")), material=skin)
    rigid(head, shape="SPHERE", mass=5.0, layer=1, friction=0.5)
    parts["head"] = head

    limb("upperArmL", "shoulderL", "elbowL", 0.052, 2.5)
    limb("upperArmR", "shoulderR", "elbowR", 0.052, 2.5)
    limb("forearmL", "elbowL", "wristL", 0.045, 1.8)
    limb("forearmR", "elbowR", "wristR", 0.045, 1.8)
    limb("thighL", "hipL", "kneeL", 0.072, 8.0)
    limb("thighR", "hipR", "kneeR", 0.072, 8.0)
    limb("shinL", "kneeL", "ankleL", 0.058, 4.0)
    limb("shinR", "kneeR", "ankleR", 0.058, 4.0)

    # Ball joints at the pivots, so the gaps the shortened capsules leave read
    # as an articulated mannequin instead of as a modelling mistake. Visual
    # only, parented to the body above them in the chain.
    for jname, radius, parent_key in (
        ("shoulderL", 0.058, "chest"), ("shoulderR", 0.058, "chest"),
        ("elbowL", 0.050, "upperArmL"), ("elbowR", 0.050, "upperArmR"),
        ("hipL", 0.078, "pelvis"), ("hipR", 0.078, "pelvis"),
        ("kneeL", 0.066, "thighL"), ("kneeR", 0.066, "thighR"),
        ("neck", 0.062, "chest"),
    ):
        ball = sphere(f"Joint_{jname}", radius, tuple(at(jname)), material=skin)
        ball.parent = parts[parent_key]
        ball.matrix_parent_inverse = parts[parent_key].matrix_world.inverted()

    # The belt. Drawn as two bands parented to the body they cross, so it
    # tracks the torso instead of staying behind as the torso moves and
    # passing through it. It is the only brand-coloured object in the frame:
    # the clip is about surviving the crash, so the restraint is what the eye
    # should find.
    sash = box("BeltSash", (0.07, 0.26, 0.42),
               tuple(at("chest") + Vector((-0.14, 0.015, 0.0))),
               rot=(0, R(-18), 0), material=belt_m)
    sash.parent = parts["chest"]
    sash.matrix_parent_inverse = parts["chest"].matrix_world.inverted()

    lap = box("BeltLap", (0.33, 0.08, 0.08),
              tuple(at("pelvis") + Vector((0.0, 0.11, 0.02))), material=belt_m)
    lap.parent = parts["pelvis"]
    lap.matrix_parent_inverse = parts["pelvis"].matrix_world.inverted()

    return parts


# ----------------------------------------------------------------- the joints
def constraint(name, a, b, pivot: Vector, *, lin=None, ang=None, disable_collisions=True):
    """A GENERIC rigid body constraint between two bodies.

    The empty is left unrotated, so the limit axes are world axes in the
    seated pose: X is the car's left-right axis, and therefore rotation about
    X is the forward nod that a frontal impact actually produces. That is the
    axis worth being careful about; the other two are held near zero to stop
    joints spinning.

    `lin` and `ang` are {axis: (lower, upper)} in metres and degrees. Any axis
    left out is locked at zero, which is what a joint is.
    """
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = pivot
    e.empty_display_size = 0.08
    _activate(e)
    bpy.ops.rigidbody.constraint_add(type="GENERIC")
    c = e.rigid_body_constraint
    c.object1, c.object2 = a, b
    c.disable_collisions = disable_collisions
    lin = lin or {}
    ang = ang or {}
    for axis in "xyz":
        lo, hi = lin.get(axis, (0.0, 0.0))
        setattr(c, f"use_limit_lin_{axis}", True)
        setattr(c, f"limit_lin_{axis}_lower", lo)
        setattr(c, f"limit_lin_{axis}_upper", hi)
        # Bullet's generic 6DOF reads its angles through an Euler
        # decomposition that degenerates at a quarter turn, so a limit asking
        # for more than that does not produce a wider joint, it produces a
        # joint that flips. Clamped rather than trusted.
        alo, ahi = (max(v, -88.0) if v < 0 else min(v, 88.0)
                    for v in ang.get(axis, (0.0, 0.0)))
        setattr(c, f"use_limit_ang_{axis}", True)
        setattr(c, f"limit_ang_{axis}_lower", R(alo))
        setattr(c, f"limit_ang_{axis}_upper", R(ahi))
    JOINT_EMPTIES.append(e)
    return e


# Every constraint empty made below, so the approach can carry them along
# with the bodies they anchor. Blender captures each constraint's pivot from
# the empty's transform relative to the two bodies at the simulation's first
# frame. Leave the empties behind and the pivots are captured tens of metres
# out: measured on a two-body test, a joint that should have held its bodies
# 0.500 m apart collapsed them to 0.111 m instead.
JOINT_EMPTIES: list = []


def fixed_joint(name, a, b, pivot: Vector):
    """Bolt two bodies together, with no give on any axis.

    Used for the car's own interior, which is one rigid object in reality and
    is only modelled as separate bodies so the occupant can have something to
    sit on without the car shell being solid.
    """
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = pivot
    e.empty_display_size = 0.08
    _activate(e)
    bpy.ops.rigidbody.constraint_add(type="FIXED")
    c = e.rigid_body_constraint
    c.object1, c.object2 = a, b
    c.disable_collisions = True
    JOINT_EMPTIES.append(e)
    return e


def build_joints(parts, car):
    """Ten joints plus two belt anchors.

    The angular ranges are roughly anatomical rather than exactly so. What has
    to be true is that no joint can spin freely - a free joint is what makes a
    figure read as a rag doll rather than as a body, and the whole point being
    made is about a body.
    """
    def at(name) -> Vector:
        return Vector(JOINTS[name])

    hinge = {"y": (-6, 6), "z": (-6, 6)}

    constraint("J_spine", parts["pelvis"], parts["chest"], at("spine"),
               ang={"x": (-30, 20), "y": (-16, 16), "z": (-20, 20)})
    constraint("J_neck", parts["chest"], parts["head"], at("neck"),
               ang={"x": (-55, 40), "y": (-25, 25), "z": (-35, 35)})

    for side in ("L", "R"):
        constraint(f"J_shoulder{side}", parts["chest"], parts[f"upperArm{side}"],
                   at(f"shoulder{side}"),
                   ang={"x": (-88, 70), "y": (-45, 45), "z": (-55, 55)})
        # Elbows and knees are hinges: one axis with a wide range, the other
        # two pinned. Without this the forearms counter-rotate on impact and
        # the figure looks broken rather than thrown.
        constraint(f"J_elbow{side}", parts[f"upperArm{side}"], parts[f"forearm{side}"],
                   at(f"elbow{side}"), ang={"x": (-88, 15), **hinge})
        constraint(f"J_hip{side}", parts["pelvis"], parts[f"thigh{side}"],
                   at(f"hip{side}"),
                   ang={"x": (-75, 35), "y": (-20, 20), "z": (-25, 25)})
        constraint(f"J_knee{side}", parts[f"thigh{side}"], parts[f"shin{side}"],
                   at(f"knee{side}"), ang={"x": (-10, 88), **hinge})

    # The restraint. A lap belt stops the pelvis translating and lets it
    # rotate; a sash pays out a little and then holds, which is why the torso
    # pitches forward and stops rather than continuing into the wheel. The
    # forward give is the +Y allowance on the sash, and it is the single
    # number that decides how violent this looks.
    constraint("Belt_lap", car, parts["pelvis"], at("pelvis") + Vector((0, 0.10, -0.02)),
               lin={"x": (-0.03, 0.03), "y": (-0.02, 0.05), "z": (-0.04, 0.04)},
               ang={"x": (-45, 30), "y": (-15, 15), "z": (-20, 20)})
    constraint("Belt_sash", car, parts["chest"], at("chest") + Vector((-0.10, 0.10, 0.04)),
               lin={"x": (-0.05, 0.05), "y": (-0.02, 0.16), "z": (-0.06, 0.09)},
               ang={"x": (-55, 20), "y": (-22, 22), "z": (-28, 28)})


# ----------------------------------------------------------------- the handoff
def animate_approach(bodies):
    """Keyframe every body along the approach, then hand it to the solver.

    Frame 1 is keyed explicitly for all of them. The first key extrapolates
    backwards, so an object whose earliest key is at frame 62 is already in
    its frame-62 position at frame 1 and the approach never happens.

    All of them release on the same frame. Releasing the car first would leave
    the occupant hanging in mid-air for those frames; releasing the occupant
    first would drop them through a car that is still kinematic.

    Everything is authored with the car at the origin, which is the barrier's
    own position - so the approach has to put the car at CAR_RELEASE_Y when it
    is handed over, not back at where it was modelled. Keying the modelled
    position as the release position parks the car's front half inside the
    barrier on the handoff frame, and Bullet answers a 1250 kg interpenetration
    by throwing the whole scene several hundred metres down the road.
    """
    # The constraint empties ride along too. They carry no rigid body, so they
    # only need the two location keys, and after the handoff they are ignored.
    for obj in bodies + JOINT_EMPTIES:
        rest = Vector(obj.location)
        key(obj, F_START, loc=tuple(rest + Vector((0, CAR_START_Y, 0))))
        key(obj, F_RELEASE, loc=tuple(rest + Vector((0, CAR_RELEASE_Y, 0))))
        for curve in _curves(obj):
            if curve.data_path == "location":
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"
        if obj.rigid_body is None:
            continue
        obj.rigid_body.kinematic = True
        obj.rigid_body.keyframe_insert("kinematic", frame=F_START)
        obj.rigid_body.keyframe_insert("kinematic", frame=F_RELEASE - 1)
        obj.rigid_body.kinematic = False
        obj.rigid_body.keyframe_insert("kinematic", frame=F_RELEASE)
        # CONSTANT on the boolean, or it eases through 0.5 across those frames
        # and the handoff happens on a frame nobody chose. LINEAR on the
        # location, or a bezier ease-out has the car slowing into the barrier
        # of its own accord - exactly the lie this clip cannot afford.
        for frame in (F_START, F_RELEASE - 1, F_RELEASE):
            set_interp(obj, frame, "CONSTANT")
        for curve in _curves(obj):
            if curve.data_path == "location":
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"



# ---------------------------------------------------------------------- bake
def bake(scene):
    world = scene.rigidbody_world
    # The cache keeps its own frame range and it defaults to 250 whatever the
    # scene says. Left alone it silently stops simulating at its own end.
    world.point_cache.frame_start = F_START
    world.point_cache.frame_end = F_END
    try:
        bpy.ops.ptcache.free_bake_all()
    except Exception:
        pass
    bpy.ops.ptcache.bake_all(bake=True)


def sample(objs, frames):
    """Read the simulated world position of each object, per frame.

    The camera is aimed from this rather than from guessed coordinates. Where
    the car and the occupant end up is an output of the solver, so framing
    them by hand would mean re-guessing every time a mass or a limit changes.
    """
    scene = bpy.context.scene
    out = {o.name: {} for o in objs}
    for f in frames:
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        for o in objs:
            m = o.evaluated_get(dg).matrix_world
            out[o.name][f] = m.translation.copy()
            out.setdefault("_rot", {}).setdefault(o.name, {})[f] = m.to_euler()
    return out


# -------------------------------------------------------------------- camera
def build_camera(scene):
    target = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(target)
    data = bpy.data.cameras.new("Cam")
    data.lens = 38
    cam = bpy.data.objects.new("Camera", data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    trk = cam.constraints.new("TRACK_TO")
    trk.target = target
    trk.track_axis = "TRACK_NEGATIVE_Z"
    trk.up_axis = "UP_Y"
    return cam, target


def animate_camera(cam, target, car_track, chest_track, impact):
    """Approach, impact, then in on the occupant.

    Fixed positions, a tracked aim. The camera does not travel with the car
    during the approach: if it did, the car would sit still in frame and the
    speed - which is the thing the clip has to establish before the impact
    means anything - would be invisible.
    """
    hold = F_END
    push = impact + 26
    close = impact + 92

    key(cam, F_START, loc=(-12.5, -9.5, 5.0))
    key(cam, impact, loc=(-10.6, -6.4, 3.9))
    key(cam, push, loc=(-8.2, -4.9, 3.0))
    key(cam, close, loc=(-5.0, -3.0, 1.95))
    # Arrive before the end and hold. A push that runs to the last frame puts
    # the shot the whole clip builds to on screen for an instant.
    key(cam, hold, loc=(-4.75, -2.85, 1.88))

    def aim(frame, vec):
        key(target, frame, loc=tuple(vec))

    # Through the approach and impact, aim at the car. Afterwards, slide the
    # aim onto the occupant's chest, which is where the story is.
    for f in (F_START, impact - 24, impact, impact + 10):
        aim(f, car_track[f] + Vector((0, 0, 0.55)))
    mid = impact + 40
    aim(mid, (car_track[mid] + chest_track[mid]) / 2 + Vector((0, 0, 0.35)))
    for f in (close, hold):
        aim(f, chest_track[f] + Vector((0, 0, 0.02)))


# ------------------------------------------------------------------ lighting
def build_lighting(scene):
    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = 2.6
    sun.color = (1.0, 0.98, 0.94)
    sun.angle = R(3.5)        # a soft edge; a razor shadow reads as CGI
    so = bpy.data.objects.new("SunObj", sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = Euler((R(52), R(6), R(-128)))

    fill = bpy.data.lights.new("Fill", type="AREA")
    fill.energy = 450
    fill.size = 14
    fill.color = (0.90, 0.94, 1.0)
    fo = bpy.data.objects.new("FillObj", fill)
    bpy.context.collection.objects.link(fo)
    fo.location = (-16, -12, 9)
    fo.rotation_euler = Euler((R(52), 0, R(-52)))

    world = bpy.data.worlds.new("Daylight")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = rgba(BG)
    bg.inputs[1].default_value = 1.0
    scene.world = world


# -------------------------------------------------------------------- render
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(_REPO, "public", "guides")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")


def setup_render(scene, *, samples=32):
    scene.render.engine = "BLENDER_EEVEE"   # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = F_START, F_END
    scene.eevee.taa_render_samples = samples
    scene.eevee.use_shadows = True
    try:
        scene.eevee.use_raytracing = False
    except Exception:
        pass
    # Standard, as in the other two guides: the brand blue on the belt has to
    # come out the hex value it went in, and AgX would desaturate it.
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    still = int(argv[argv.index("--still") + 1]) if "--still" in argv else None
    stills = argv[argv.index("--stills") + 1] if "--stills" in argv else None
    crf = argv[argv.index("--crf") + 1] if "--crf" in argv else "MEDIUM"
    do_render = "--render" in argv
    do_save = "--save" in argv
    do_trace = "--trace" in argv

    clear()
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = F_START, F_END

    bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    # The default 10 substeps lets a 1250 kg body at 12 m/s tunnel a little
    # into the barrier before Bullet notices, and lets the belt constraints
    # stretch visibly on the impact frame. Both go away at 30.
    rbw.substeps_per_frame = 30
    rbw.solver_iterations = 30

    build_road()
    build_barrier()
    car, interior = build_car()
    for col in interior:
        fixed_joint(f"Bolt_{col.name}", car, col, Vector(col.location))

    # The occupant is built in car-local coordinates with the car at the
    # origin, which is where it will be at the moment of release, and then
    # walked backwards along the approach with it. So the seated pose is
    # authored once, in the frame where it has to be right.
    parts = build_occupant()
    build_joints(parts, car)

    bodies = [car] + interior + [parts[k] for k in sorted(parts)]
    animate_approach(bodies)

    build_lighting(scene)
    cam, target = build_camera(scene)
    setup_render(scene)

    bake(scene)

    frames = list(range(F_START, F_END + 1))
    watched = [car, parts["chest"], parts["head"], parts["pelvis"], parts["forearmR"]]
    tracks = sample(watched, frames)
    car_track, chest_track = tracks["CarCollider"], tracks["chest"]

    # The impact frame is read out of the simulation rather than asserted: it
    # is the first frame on which the car has lost a tenth of its speed.
    impact = F_END
    for f in range(F_RELEASE + 1, F_END):
        step = car_track[f].y - car_track[f - 1].y
        if step < abs(SPEED_PER_FRAME) * 0.9:
            impact = f
            break

    animate_camera(cam, target, car_track, chest_track, impact)
    # Adding camera keys can flag the point cache as outdated, so bake again.
    # It is the same deterministic solve, and it is cheap next to the render.
    bake(scene)

    settle = car_track[F_END] - car_track[impact]
    lunge = chest_track[min(impact + 14, F_END)] - chest_track[impact]
    print(f"SPEED {abs(SPEED_PER_FRAME) * FPS:.2f} m/s  IMPACT frame {impact}  "
          f"car travelled {settle.y:+.2f} m after it")
    print(f"CHEST moved {lunge.y:+.3f} m forward, {lunge.z:+.3f} m vertically, "
          f"in the 14 frames after impact")

    if do_trace:
        # Positions relative to the car, which is the only way to see whether
        # the occupant moved inside the cabin or merely rode along in it.
        print("  frame |   car.y | chest rel car (y,z) |  head rel car (y,z) | fore.y")
        for f in list(range(F_RELEASE - 2, min(impact + 40, F_END), 3)) + [F_END]:
            c = car_track[f]
            ch = tracks["chest"][f] - c
            hd = tracks["head"][f] - c
            fr = tracks["forearmR"][f] - c
            cr = tracks["_rot"]["CarCollider"][f]
            print(f"  {f:5d} | {c.y:7.2f} | {ch.y:8.3f} {ch.z:8.3f}   | "
                  f"{hd.y:8.3f} {hd.z:8.3f}   | {fr.y:7.3f} | car z={c.z:6.2f} "
                  f"rot=({math.degrees(cr.x):6.1f},{math.degrees(cr.y):6.1f},{math.degrees(cr.z):6.1f})")

    targets = []
    if stills is not None:
        targets = [int(p) for p in stills.split(",")]
    elif still is not None:
        targets = [still]

    if targets:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        for f in targets:
            scene.frame_set(f)
            scene.render.filepath = os.path.join(STILL_DIR, f"crashcar_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"WROTE {scene.render.filepath}")
    elif do_render:
        os.makedirs(OUT_DIR, exist_ok=True)
        # media_type first: the file_format enum lists FFMPEG but refuses the
        # assignment until the media type says VIDEO.
        scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = crf
        scene.render.ffmpeg.audio_codec = "NONE"
        scene.render.filepath = os.path.join(OUT_DIR, "crash-car.mp4")
        bpy.ops.render.render(animation=True)
        print(f"WROTE {scene.render.filepath}")

    if do_save:
        os.makedirs(STILL_DIR, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(STILL_DIR, "crash-car.blend"))
        print("WROTE blend")

    print(f"FRAMES {F_END} DURATION {F_END / FPS:.2f}s FPS {FPS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
