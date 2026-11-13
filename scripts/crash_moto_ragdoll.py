"""Render a simulated motorcycle crash with an articulated rider.

Run:
    blender --background --factory-startup --python scripts/crash_moto_ragdoll.py -- --render
    blender --background --factory-startup --python scripts/crash_moto_ragdoll.py -- --still 96
    blender --background --factory-startup --python scripts/crash_moto_ragdoll.py -- --render --crf LOW
    blender --background --factory-startup --python scripts/crash_moto_ragdoll.py -- --probe

    --still N   frames to docs/pitch-assets/moto_NNNN.png, for checking
                framing. Takes a comma-separated list: the bake costs far
                more than a frame does, so checking eight of them should be
                one run, not eight.
    --render    the whole thing to public/guides/crash-moto.mp4
    --crf NAME  Blender's constant_rate_factor; a lower setting is a smaller file
    --probe     bake only, print where every body came to rest, render nothing
    --save      also write the .blend, so it can be opened and nudged by hand

WHAT THIS IS FOR, because it governs every choice below.

Zetway's crash detection now measures rotation and change of speed, not just
peak acceleration. The reason that matters is that a real impact throws a body
through a sequence of orientations and speeds that a phone sliding off a seat
never produces. This clip is the picture of that claim, so the motion has to be
*found*, not drawn: every body here is a rigid body under Bullet, and nobody
keyframed where the rider lands. If the tumble were animated by hand it would
be an illustration of our own assumption, and the one thing it could not be is
evidence.

TONE. The figure is an abstract articulated mannequin: plain matte capsules and
boxes in one flat slate, no face, no clothing, no blood, no deformation. The
helmet is the single exception to the one-colour rule, in the brand blue,
because every road-safety point this app makes about riders runs through the
helmet and it has to be the thing the eye finds. This is shown to a jury.
Restraint is the point; spectacle would undo the argument.

Written against Blender 5.2.1 LTS. Six things on this build are not what the
tutorials say, each one checked here rather than assumed:

  - preferences.edit.keyframe_new_interpolation_type does nothing. Keys are
    born BEZIER whatever it says, so interpolation is corrected on the
    keyframe_points after insertion (see _set_interp).
  - Action.fcurves raises AttributeError: actions are slotted, so the curves
    live under action.layers[].strips[].channelbags[].fcurves.
  - image_settings.media_type must be set to VIDEO *before* FFMPEG can be
    assigned, or the enum assignment fails claiming FFMPEG is not a member.
  - view_transform is Standard. AgX washes these flat matte greys out.
  - Render paths resolve against the .blend, not the shell's directory, so
    every path here is absolute and derived from __file__.
  - rigidbody_world.point_cache.frame_end defaults to 250 regardless of
    scene.frame_end. Left alone, a longer clip freezes mid-tumble.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

R = math.radians

# ------------------------------------------------------------------- timing
FPS = 24
F_START = 1
F_FREE = 40           # the rig stops being driven and becomes physics
F_END = 240           # 240 frames at 24 fps = 10.0 s

# The bike is driven in a straight line up to F_FREE and then let go. Bullet
# carries the velocity of a kinematic body across the handover, which is how
# an "initial velocity" is expressed here: there is no API to set one
# directly. Verified on this build before the scene was written.
APPROACH_M = 18.2     # metres covered between F_START and F_FREE
Y_RELEASE = -3.5      # bike centre at the handover; the car is 2.5 m ahead
SPEED = APPROACH_M / ((F_FREE - F_START) / float(FPS))   # ~11.2 m/s, 40 km/h

# ----------------------------------------------------------------- geometry
# The car is parked across the lane, offset in X so the bike strikes it off
# centre. A square hit would stop the bike dead and drop the rider straight
# down; the offset is what makes the machine yaw and the rider leave it.
CAR_X, CAR_Y = 0.75, 0.9
CAR_L, CAR_W = 4.3, 1.8

# Where the footpegs are, and so where the rider's feet are. Shared because
# the two have to agree to within a couple of centimetres: closer and the
# shin starts the clip inside the peg, wider and the rider is doing the
# splits. Worked out against the engine's half-width, not guessed.
PEG_X = 0.30

# Every constrained pair, with the distance between the two bodies at build
# time. A 6DOF constraint in Bullet is a strong suggestion, not a weld: under
# a big enough impulse it stretches, and a limb that drifts far enough from
# its neighbour reads as having come off. On a road-safety slide that is not
# a glitch, it is a dismemberment, so the stretch is measured and reported
# rather than left to be noticed in the final render.
JOINTS = []

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MP4 = os.path.join(_REPO, "public", "guides", "crash-moto.mp4")
STILL_DIR = os.path.join(_REPO, "docs", "pitch-assets")

# ------------------------------------------------------------------ palette
# Linear-ish values under a Standard view transform, so what is written here
# is very close to what lands in the file. Nothing is above 0.66: Standard
# clips at 1.0 and a clipped highlight on a matte diagram reads as a mistake.
TARMAC = (0.150, 0.155, 0.165, 1)
VERGE = (0.175, 0.205, 0.155, 1)
LINE = (0.560, 0.555, 0.520, 1)
FIGURE = (0.330, 0.350, 0.395, 1)   # the mannequin, one flat colour throughout
HELMET = (0.055, 0.260, 0.560, 1)   # the deliberate exception; see module docstring
VISOR = (0.045, 0.055, 0.070, 1)
BIKE = (0.185, 0.195, 0.215, 1)
BIKE_DARK = (0.055, 0.058, 0.066, 1)
CAR_PAINT = (0.480, 0.495, 0.520, 1)
CAR_GLASS = (0.105, 0.120, 0.145, 1)
CAR_TRIM = (0.070, 0.074, 0.082, 1)


# ------------------------------------------------------------------ plumbing
def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, colour, *, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = colour
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def _curves(holder):
    """Every fcurve on an ID, whichever way this Blender stores them.

    Blender 4.4 made actions slotted and 5.2 dropped Action.fcurves outright,
    so the only route to the curves is through the layer/strip/channelbag
    chain. The getattr on fcurves is kept so this file still works if it is
    ever run on an older build.
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


def _set_interp(holder, frame, kind, only=None):
    """Force the interpolation of keys this ID has at `frame`.

    preferences.edit.keyframe_new_interpolation_type is the documented way and
    on this build it does nothing: the preference reads back changed and the
    key is still born BEZIER. The handover from driven to dynamic depends on
    a CONSTANT key, so the curves are corrected after insertion instead.

    `only` restricts the change to one data_path, and it is not optional
    where it is used. Without it this walks *every* curve at that frame: the
    CONSTANT wanted on the kinematic boolean also landed on location, the
    approach froze for 39 frames and then teleported 18.2 m in one, and
    Bullet released the rider at the 437 m/s that implies. The ragdoll left
    the county. Keep the filter.
    """
    if kind == "BEZIER":
        return
    for curve in _curves(holder):
        if only is not None and curve.data_path != only:
            continue
        for point in curve.keyframe_points:
            if abs(point.co[0] - frame) < 0.5:
                point.interpolation = kind


def key(obj, frame, *, loc=None, rot=None, interp="BEZIER"):
    """Key location and rotation. LINEAR here is load-bearing, not taste.

    The approach has to arrive at the release frame travelling at full speed,
    because that speed *is* the crash. A Bezier key eases out, so the bike
    would reach the car having decelerated to nothing and simply topple over.
    """
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
        _set_interp(obj, frame, interp, only="location")
    if rot is not None:
        obj.rotation_euler = Euler(rot)
        obj.keyframe_insert("rotation_euler", frame=frame)
        _set_interp(obj, frame, interp, only="rotation_euler")


def _new(obj, loc, rot=(0, 0, 0), scale=None, material=None, parent=None):
    """Place an object. With `parent`, `loc` is in the PARENT's local space.

    No matrix_parent_inverse: it is computed from parent.matrix_world, which
    is stale until the depsgraph runs, so a child placed that way lands
    wherever the parent happened to be one evaluation ago. Local coordinates
    need no such reading. The caller's side of the bargain is never to parent
    anything to a scaled object - the child would inherit the scale, which is
    how the phone in crash_scene.py once rendered as a speck.
    """
    obj.location = loc
    obj.rotation_euler = Euler(rot)
    if scale:
        obj.scale = scale
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj


def cube(name, loc, scale, material=None, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    return _new(o, loc, rot, scale, material, parent)


def cyl(name, r, d, loc, rot=(0, 0, 0), material=None, parent=None, verts=14):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, vertices=verts)
    o = bpy.context.object
    o.name = name
    return _new(o, loc, rot, None, material, parent)


def ball(name, r, loc, material=None, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=20, ring_count=12)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    return _new(o, loc, (0, 0, 0), None, material, parent)


def torus(name, major, minor, loc, rot, material=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=20, minor_segments=8)
    o = bpy.context.object
    o.name = name
    return _new(o, loc, rot, None, material, parent)


def empty(name, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return o


# ------------------------------------------------------------------- physics
def rb(obj, kind, *, shape="CONVEX_HULL", mass=1.0, friction=0.7,
       bounce=0.02, lin_damp=0.06, ang_damp=0.14, margin=0.004):
    """Make `obj` a rigid body. Returns the rigid_body settings."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.rigidbody.object_add()
    body = obj.rigid_body
    body.type = kind
    body.collision_shape = shape
    if kind == "ACTIVE":
        body.mass = mass
        body.linear_damping = lin_damp
        body.angular_damping = ang_damp
    body.friction = friction
    body.restitution = bounce
    # The default 40 mm collision margin is larger than a forearm is thick, so
    # limbs would float a visible finger's width above the road and never
    # quite touch each other. Shrunk deliberately; Bullet is stable here
    # because the substep count below is high.
    body.use_margin = True
    body.collision_margin = margin
    return body


def joint(name, a, b, at, *, ang_x, ang_y, ang_z):
    """A GENERIC constraint between two bodies, with angular limits.

    Angles are degrees, given as (lower, upper) and measured as *deviation
    from the pose the rider is built in*: Bullet stores each body's frame
    relative to this empty at bind time, so zero is the seated posture, not
    some anatomical neutral. A knee that is already folded at the start can
    therefore be allowed to straighten and barely allowed to fold further,
    which is what the limits below say.

    Linear motion is locked to zero on all three axes, so these are joints
    and not springs. Without that the figure comes apart on the first hit.
    """
    e = empty(name, at)
    e.empty_display_size = 0.06
    bpy.ops.object.select_all(action="DESELECT")
    e.select_set(True)
    bpy.context.view_layer.objects.active = e
    bpy.ops.rigidbody.constraint_add()
    c = e.rigid_body_constraint
    c.type = "GENERIC"
    c.object1 = a
    c.object2 = b
    for axis in "xyz":
        setattr(c, f"use_limit_lin_{axis}", True)
        setattr(c, f"limit_lin_{axis}_lower", 0.0)
        setattr(c, f"limit_lin_{axis}_upper", 0.0)
    for axis, (lo, hi) in zip("xyz", (ang_x, ang_y, ang_z)):
        setattr(c, f"use_limit_ang_{axis}", True)
        setattr(c, f"limit_ang_{axis}_lower", R(lo))
        setattr(c, f"limit_ang_{axis}_upper", R(hi))
    # Neighbouring limbs overlap at every joint by design. Left colliding,
    # Bullet spends the first frame shoving them apart and the figure
    # detonates before the bike has moved.
    c.disable_collisions = True
    JOINTS.append((name, e, a, b, (a.location - b.location).length))
    return e


def two_bone(root: Vector, tip: Vector, l1: float, l2: float,
             bend: Vector) -> Vector:
    """Where the knee or elbow sits, given the two ends and the bone lengths.

    Plain circle intersection rather than an IK solver: the limb is placed
    once, at build time, and never solved again. `bend` only has to point
    roughly the way the joint should break; it is orthogonalised here.
    """
    d = tip - root
    dist = min(d.length, (l1 + l2) * 0.999)
    along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    out = math.sqrt(max(l1 * l1 - along * along, 0.0))
    axis = d.normalized()
    side = bend - axis * bend.dot(axis)
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    return root + axis * along + side * out


def bone(name, a: Vector, b: Vector, radius, material, *, mass, shrink=0.0):
    """A limb segment: a cylinder from a to b, as a capsule rigid body.

    CAPSULE takes its axis from the object's local Z, which is why the
    cylinder is built along Z and then rotated into place rather than being
    positioned directly.
    """
    d = b - a
    length = max(d.length - shrink, 0.05)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    o = cyl(name, radius, length, tuple((a + b) / 2.0),
            rot=(rot.x, rot.y, rot.z), material=material)
    rb(o, "ACTIVE", shape="CAPSULE", mass=mass)
    return o


# --------------------------------------------------------------------- world
def build_ground():
    # Two slabs. The road is the only collider the action ever touches; the
    # shoulder sits 2 cm lower so the two never z-fight, and exists so that
    # anything thrown wide lands on something instead of falling for ever.
    shoulder = cube("Shoulder", (0, 20, -0.52), (90, 320, 1.0),
                    mat("Verge", VERGE, rough=0.97))
    rb(shoulder, "PASSIVE", shape="BOX", friction=0.8, margin=0.02)

    road = cube("Road", (0, 20, -0.5), (16, 320, 1.0),
                mat("Tarmac", TARMAC, rough=0.93))
    rb(road, "PASSIVE", shape="BOX", friction=0.72, margin=0.004)

    line_m = mat("Line", LINE, rough=0.8)
    for i in range(-10, 48):
        cube(f"Dash{i}", (0, i * 6.0, 0.004), (0.22, 2.6, 0.008), line_m)
    for sx in (-1, 1):
        cube(f"EdgeLine{sx}", (sx * 7.4, 20, 0.004), (0.16, 640, 0.008), line_m)
    return road


def build_car():
    """The parked car the rider strikes. Passive: it is scenery with mass.

    Deliberately pale against a dark road. The eye has to find the obstacle
    in the first second or the rest of the clip is just a figure falling over.
    """
    paint = mat("CarPaint", CAR_PAINT, rough=0.38, metal=0.25)
    glass = mat("CarGlass", CAR_GLASS, rough=0.12)
    trim = mat("CarTrim", CAR_TRIM, rough=0.7)

    # Nothing here is parented. The body is a cube scaled 4.3 x 1.8 x 1.3, and
    # a child of it would inherit that scale - the trap crash_scene.py hit
    # with the phone screen. The car never moves, so siblings at world
    # positions are simpler than a rig and cannot be scaled by accident.
    # The collider is the body slab alone, and it reaches down to 0.30 so the
    # bike's front wheel strikes it rather than ducking under the sill into
    # a gap the eye cannot see.
    body = cube("Car", (CAR_X, CAR_Y, 0.70), (CAR_L, CAR_W, 0.80), paint)
    rb(body, "PASSIVE", shape="BOX", friction=0.6, margin=0.006)

    cube("CarCabin", (CAR_X - 0.30, CAR_Y, 1.30), (2.4, 1.64, 0.46), glass)
    cube("CarSill", (CAR_X, CAR_Y, 0.37), (4.34, 1.84, 0.14), trim)
    for sx in (-1, 1):
        for i, x in enumerate((CAR_X - 1.4, CAR_X + 1.4)):
            cyl(f"CarWheel{i}{sx}", 0.33, 0.22, (x, CAR_Y + sx * 0.84, 0.33),
                rot=(R(90), 0, 0), material=trim)
    return body


def build_bike():
    """One rigid body, built from primitives and joined.

    A motorcycle made of separately simulated parts would need a suspension
    rig and would spend the clip arguing with itself. Joined, it is a single
    convex hull with the mass and the silhouette of a bike, which is all this
    shot asks of it. Built with its centre at (0, Y_RELEASE) so the handover
    needs no offset arithmetic.
    """
    body_m = mat("BikeBody", BIKE, rough=0.42, metal=0.35)
    dark_m = mat("BikeDark", BIKE_DARK, rough=0.6, metal=0.2)
    y0 = Y_RELEASE
    parts = []
    for nm, dy in (("WheelRear", -0.68), ("WheelFront", 0.68)):
        parts.append(torus(nm, 0.32, 0.085, (0, y0 + dy, 0.32),
                           (0, R(90), 0), dark_m))
        parts.append(cyl(nm + "Rim", 0.15, 0.08, (0, y0 + dy, 0.32),
                         rot=(0, R(90), 0), material=body_m))
    # The engine and tank are kept narrow, and the pegs wide, so the rider's
    # shins clear the machine. Limbs that start a frame inside the bike are
    # not a cosmetic problem: Bullet resolves the overlap by firing them
    # apart, and the clip opens with the figure already coming to pieces.
    parts.append(cube("Engine", (0, y0 - 0.02, 0.46), (0.26, 0.60, 0.34), dark_m))
    parts.append(cube("Tank", (0, y0 + 0.14, 0.76), (0.28, 0.56, 0.24), body_m))
    parts.append(cube("Seat", (0, y0 - 0.34, 0.74), (0.27, 0.50, 0.13), dark_m))
    parts.append(cyl("Fork", 0.05, 0.80, (0, y0 + 0.56, 0.70),
                     rot=(R(15), 0, 0), material=dark_m))
    parts.append(cyl("Bars", 0.030, 0.64, (0, y0 + 0.40, 1.00),
                     rot=(0, R(90), 0), material=dark_m))
    parts.append(cube("Headlamp", (0, y0 + 0.62, 0.86), (0.22, 0.1, 0.18), body_m))
    for sx in (-1, 1):
        parts.append(cube(f"Peg{sx}", (sx * PEG_X, y0 - 0.08, 0.36),
                          (0.12, 0.16, 0.05), dark_m))

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    bike = bpy.context.object
    bike.name = "Bike"
    # join() hands the result the active part's transform - here a wheel,
    # rotated 90 degrees and sitting at the back of the machine. Blender
    # treats the object origin as the body's centre of mass, so left alone
    # the bike would pivot about its rear hub. Baked flat, then re-centred.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    # 170 kg is a mid-size machine with fuel. It matters: the mass ratio
    # between bike and rider is what decides whether the rider is flung or
    # merely tipped over, and that ratio is the whole claim of this clip.
    rb(bike, "ACTIVE", shape="CONVEX_HULL", mass=170.0,
       friction=0.5, bounce=0.04, lin_damp=0.05, ang_damp=0.10)
    return bike


def build_rider():
    """Eleven bodies and ten joints, sitting on the bike, restrained by nothing.

    That last clause is the difference from the car clip. A belted occupant
    stays with the vehicle and decelerates with it; a rider is a separate
    mass travelling at the same speed with nothing holding the two together,
    so the machine stops and the rider does not. There is no constraint
    anywhere between this figure and the bike: the only thing keeping it on
    the seat before the impact is that both are being driven along the same
    path, and the only thing keeping it there after is friction.
    """
    skin = mat("Figure", FIGURE, rough=0.9)
    lid = mat("Helmet", HELMET, rough=0.45)
    vis = mat("Visor", VISOR, rough=0.2, metal=0.5)
    y0 = Y_RELEASE
    LEAN = R(26)        # forward, over the tank
    sin_l, cos_l = math.sin(LEAN), math.cos(LEAN)

    bodies = {}

    # --- trunk
    pelvis_c = Vector((0, y0 - 0.33, 0.90))
    pelvis = cube("Pelvis", tuple(pelvis_c), (0.28, 0.24, 0.17), skin)
    rb(pelvis, "ACTIVE", shape="BOX", mass=11.0)
    bodies["pelvis"] = pelvis

    chest_c = pelvis_c + Vector((0, 0.20 * sin_l, 0.085 + 0.20 * cos_l))
    chest = cube("Chest", tuple(chest_c), (0.32, 0.24, 0.40), skin,
                 rot=(-LEAN, 0, 0))
    rb(chest, "ACTIVE", shape="BOX", mass=17.0)
    bodies["chest"] = chest

    neck_top = chest_c + Vector((0, 0.20 * sin_l, 0.20 * cos_l))
    head_c = neck_top + Vector((0, 0.02, 0.155))
    head = ball("Head", 0.145, tuple(head_c), skin)
    rb(head, "ACTIVE", shape="SPHERE", mass=4.8)
    bodies["head"] = head

    # The helmet rides the head as a child mesh rather than as its own body.
    # A separately simulated helmet needs a neck joint stiff enough to be
    # indistinguishable from welding it on, and then it can still be knocked
    # askew by a graze, which on a safety slide would say the opposite of
    # what we mean. The collision sphere is the helmet's size, not the skull's.
    # Local coordinates, because these are children; see _new().
    ball("HelmetShell", 0.152, (0, 0, 0), lid, parent=head)
    cube("Visor", (0, 0.108, 0.018), (0.20, 0.10, 0.105), vis, parent=head)
    cube("ChinBar", (0, 0.088, -0.088), (0.21, 0.14, 0.075), lid, parent=head)

    # --- arms, reaching to the bars
    # 0.32 + 0.31 is a touch longer than the 0.59 m the shoulders are from
    # the grips, which is the point: at exactly the reach the solver clamps
    # the elbow straight and the hands stop short of the bars in mid-air.
    shoulder_half = 0.19
    for sx, tag in ((-1, "L"), (1, "R")):
        sh = chest_c + Vector((sx * shoulder_half, 0.145 * sin_l, 0.145 * cos_l))
        # Just above the bar, not through it: a hand starting inside the
        # handlebar is the same detonation as a shin inside the engine.
        grip = Vector((sx * 0.26, y0 + 0.40, 1.095))
        elbow = two_bone(sh, grip, 0.32, 0.31, Vector((sx * 0.5, -0.4, -0.8)))
        bodies[f"upperarm{tag}"] = bone(f"UpperArm{tag}", sh, elbow, 0.058,
                                        skin, mass=2.1, shrink=0.02)
        bodies[f"forearm{tag}"] = bone(f"Forearm{tag}", elbow, grip, 0.048,
                                       skin, mass=1.5, shrink=0.02)
        bodies[f"elbow{tag}"] = elbow
        bodies[f"shoulder{tag}"] = sh

    # --- legs, knees up and forward, feet on the pegs
    for sx, tag in ((-1, "L"), (1, "R")):
        hip = pelvis_c + Vector((sx * 0.155, 0.0, -0.05))
        foot = Vector((sx * PEG_X, y0 - 0.08, 0.47))
        # The bend is thrown hard outboard so the knee breaks wide of the
        # tank rather than through it, which is also how a rider actually
        # sits on a machine this size.
        knee = two_bone(hip, foot, 0.37, 0.35, Vector((sx * 1.0, 0.9, 0.3)))
        bodies[f"thigh{tag}"] = bone(f"Thigh{tag}", hip, knee, 0.078,
                                     skin, mass=7.0, shrink=0.02)
        bodies[f"shin{tag}"] = bone(f"Shin{tag}", knee, foot, 0.062,
                                    skin, mass=3.4, shrink=0.02)
        bodies[f"knee{tag}"] = knee
        bodies[f"hip{tag}"] = hip

    # --- joints. Limits are deviation from this seated pose; see joint().
    joint("JSpine", pelvis, chest, tuple(pelvis_c + Vector((0, 0, 0.09))),
          ang_x=(-30, 30), ang_y=(-18, 18), ang_z=(-22, 22))
    joint("JNeck", chest, head, tuple(neck_top),
          ang_x=(-40, 40), ang_y=(-25, 25), ang_z=(-40, 40))
    for tag in ("L", "R"):
        joint(f"JShoulder{tag}", chest, bodies[f"upperarm{tag}"],
              tuple(bodies[f"shoulder{tag}"]),
              ang_x=(-75, 75), ang_y=(-55, 55), ang_z=(-55, 55))
        # The elbow starts slightly bent on the bars, so it has a long way to
        # straighten and almost none to fold further.
        joint(f"JElbow{tag}", bodies[f"upperarm{tag}"], bodies[f"forearm{tag}"],
              tuple(bodies[f"elbow{tag}"]),
              ang_x=(-130, 20), ang_y=(-14, 14), ang_z=(-14, 14))
        joint(f"JHip{tag}", pelvis, bodies[f"thigh{tag}"],
              tuple(bodies[f"hip{tag}"]),
              ang_x=(-60, 70), ang_y=(-28, 28), ang_z=(-28, 28))
        # Same story as the elbow: folded at the start, free to open out.
        joint(f"JKnee{tag}", bodies[f"thigh{tag}"], bodies[f"shin{tag}"],
              tuple(bodies[f"knee{tag}"]),
              ang_x=(-140, 22), ang_y=(-12, 12), ang_z=(-12, 12))

    return [v for v in bodies.values() if isinstance(v, bpy.types.Object)]


def build_lights():
    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = 2.6
    sun.angle = R(6)            # a soft edge; a razor shadow looks like CG
    sun.color = (1.0, 0.98, 0.94)
    so = bpy.data.objects.new("SunObj", sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = Euler((R(52), 0, R(-36)))

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Pale and flat. Under Standard this is the backdrop colour exactly, and
    # it doubles as the ambient fill that keeps the shadow side readable.
    bg.inputs[0].default_value = (0.345, 0.400, 0.480, 1)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world


# ------------------------------------------------------------------ the ride
def drive_in(bodies):
    """Carry everything to the release point, then hand it to Bullet.

    Every body is kinematic until F_FREE and dynamic after. Bullet keeps the
    velocity a kinematic body had on the frame it is released, so this is how
    the bike gets its initial velocity: there is no API to set one directly.

    The location key at F_START is not optional. A fcurve extrapolates its
    first key back to frame 1, so an object that is only keyed from F_FREE
    onwards silently loses the transform it was built with and starts the
    clip at the release point.

    The joint empties are carried too, and that is not cosmetic. Blender
    binds each constraint's frames from the empty's position relative to the
    two bodies at the frame the cache starts. Left behind at the build
    position while the bodies are keyed 18.2 m back, every pivot sat 18.2 m
    from the limbs it joined; a joint with an 18 m lever arm turns a
    fractional angular error into metres of linear error, and the figure
    tore itself apart - hips pulled 20 m open by frame 114. Measured, not
    guessed: run with --probe and read the JOINT STRETCH table.
    """
    back = Vector((0, -APPROACH_M, 0))
    for _n, pivot, _a, _b, _r in JOINTS:
        rest = pivot.location.copy()
        key(pivot, F_START, loc=tuple(rest + back), interp="LINEAR")
        key(pivot, F_FREE, loc=tuple(rest), interp="LINEAR")
    for o in bodies:
        rest_loc = o.location.copy()
        rest_rot = tuple(o.rotation_euler)
        key(o, F_START, loc=tuple(rest_loc + back), rot=rest_rot, interp="LINEAR")
        key(o, F_FREE, loc=tuple(rest_loc), rot=rest_rot, interp="LINEAR")
        o.rigid_body.kinematic = True
        o.rigid_body.keyframe_insert("kinematic", frame=F_START)
        o.rigid_body.kinematic = False
        o.rigid_body.keyframe_insert("kinematic", frame=F_FREE)
        # CONSTANT, and on this curve only. A boolean that ramps is a body
        # that is half simulated; a CONSTANT that leaks onto the location
        # curves is the teleport described in _set_interp.
        _set_interp(o, F_START, "CONSTANT", only="rigid_body.kinematic")
        _set_interp(o, F_FREE, "CONSTANT", only="rigid_body.kinematic")


def setup_world(scene):
    bpy.ops.rigidbody.world_add()
    rw = scene.rigidbody_world
    # A ragdoll is a loop of ten constraints closed around two heavy bodies,
    # and the mass ratio across the worst of them is a 1.5 kg forearm against
    # a 170 kg machine. Bullet resolves that iteratively, so the joints are
    # only as rigid as the iteration count: at the defaults they stretch
    # centimetres on the hit. Raised until the JOINT STRETCH table from
    # --probe stayed under a centimetre everywhere.
    rw.substeps_per_frame = 30
    rw.solver_iterations = 120
    # The cache ignores scene.frame_end and defaults to 250. Any clip past
    # that frame freezes mid-air with no warning printed.
    rw.point_cache.frame_start = F_START
    rw.point_cache.frame_end = F_END
    return rw


def bake(scene):
    """Fill the point cache for every frame, in order.

    ptcache.bake_all is the operator for this and needs a context it does not
    have in --background, so it is tried and then stepped by hand. Stepping
    the frames in order is what actually populates the cache; without it the
    render writes frame 1 over and over because every frame is evaluated from
    a cold cache.
    """
    done = False
    try:
        with bpy.context.temp_override(
                scene=scene,
                point_cache=scene.rigidbody_world.point_cache):
            bpy.ops.ptcache.bake_all(bake=True)
        done = True
    except Exception as exc:               # noqa: BLE001 - reported, not hidden
        print(f"BAKE operator unavailable ({exc.__class__.__name__}); stepping instead")
    for f in range(F_START, F_END + 1):
        scene.frame_set(f)
    print(f"BAKE {'operator + ' if done else ''}stepped {F_END - F_START + 1} frames")


def report_joints(scene):
    """How far each joint was pulled apart, and when. Prints the worst first.

    The distance between two jointed bodies should not change: these are
    6DOF constraints with all three linear limits pinned to zero. Any growth
    is the solver giving up, and past a couple of centimetres it is visible
    as a gap between a limb and the body it belongs to.
    """
    worst = []
    for name, _e, a, b, rest in JOINTS:
        peak, at = 0.0, F_START
        for f in range(F_START, F_END + 1):
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            pa = a.evaluated_get(dg).matrix_world.translation
            pb = b.evaluated_get(dg).matrix_world.translation
            stretch = (pa - pb).length - rest
            if stretch > peak:
                peak, at = stretch, f
        worst.append((peak, name, at))
    worst.sort(reverse=True)
    print("JOINT STRETCH (metres beyond rest, worst first)")
    for peak, name, at in worst:
        flag = "  <-- VISIBLE" if peak > 0.02 else ""
        print("  %-12s %+.4f at frame %3d%s" % (name, peak, at, flag))
    return worst[0][0] if worst else 0.0


def sample(scene, objs):
    """World positions of `objs` at every frame, read back from the bake."""
    out = []
    for f in range(F_START, F_END + 1):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        out.append([o.evaluated_get(dg).matrix_world.translation.copy()
                    for o in objs])
    return out


def smooth(points, window):
    """Centred moving average, clamped at both ends."""
    n = len(points)
    out = []
    for i in range(n):
        lo, hi = max(0, i - window), min(n - 1, i + window)
        acc = Vector((0, 0, 0))
        for j in range(lo, hi + 1):
            acc += points[j]
        out.append(acc / float(hi - lo + 1))
    return out


def aim_camera(scene, cam, target, anchor, bike, pelvis, head):
    """Hang the camera off the simulation instead of guessing where to point it.

    Nobody knows where a ragdoll lands until it has landed, so the camera is
    built after the bake from the positions the bake produced: it cannot miss
    the action, and it does not have to be re-tuned when a mass or a limit
    changes. Two empties, because one cannot do both jobs - `target` is
    lightly smoothed so the subject stays centred, `anchor` heavily smoothed
    so the camera body does not inherit the tumble's jitter.
    """
    tracks = sample(scene, [bike, pelvis, head])
    # Weighted toward the rider: the rider is the subject, the bike is context.
    raw = [(b * 0.34 + p * 0.40 + h * 0.26) for (b, p, h) in tracks]
    tight = smooth(raw, 5)
    loose = smooth(raw, 16)

    # The camera swings from alongside and high during the approach to lower
    # and nearer once everything is down, so the shot ends at the eye level
    # of someone standing over the scene rather than flying above it.
    near, far = Vector((5.6, -1.6, 1.75)), Vector((10.2, -3.4, 3.40))
    span = float(F_END - F_FREE)
    for i in range(0, len(raw), 4):
        f = F_START + i
        t = 0.0 if f <= F_FREE else min(1.0, (f - F_FREE) / span)
        # Hold the wide offset through the impact, then ease in over the rest.
        ease = t * t * (3 - 2 * t)
        off = far.lerp(near, ease)
        key(target, f, loc=tuple(tight[i] + Vector((0, 0, 0.25))), interp="LINEAR")
        key(anchor, f, loc=tuple(loose[i] + off), interp="LINEAR")
    key(target, F_END, loc=tuple(tight[-1] + Vector((0, 0, 0.25))), interp="LINEAR")
    key(anchor, F_END, loc=tuple(loose[-1] + near), interp="LINEAR")

    cam.parent = anchor
    cam.location = (0, 0, 0)
    trk = cam.constraints.new("TRACK_TO")
    trk.target = target
    trk.track_axis = "TRACK_NEGATIVE_Z"
    trk.up_axis = "UP_Y"
    return tracks


# -------------------------------------------------------------------- render
def setup_render(scene, samples=24):
    scene.render.engine = "BLENDER_EEVEE"      # 5.2 calls it this again
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = F_START, F_END
    scene.eevee.taa_render_samples = samples
    scene.eevee.use_shadows = True
    try:
        # Off: it buys reflections in tarmac nobody looks at, and costs the
        # whole render budget on a clip that is mostly matte grey.
        scene.eevee.use_raytracing = False
    except Exception:
        pass
    # Standard, not AgX. These are flat matte greys chosen by value; a film
    # curve lifts the shadows and mutes the helmet, which is the one thing in
    # frame that has to stay saturated.
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    stills = ([int(n) for n in argv[argv.index("--still") + 1].split(",")]
              if "--still" in argv else [])
    crf = argv[argv.index("--crf") + 1] if "--crf" in argv else "MEDIUM"
    do_render = "--render" in argv
    do_save = "--save" in argv
    do_probe = "--probe" in argv

    clear()
    scene = bpy.context.scene
    setup_world(scene)

    build_ground()
    build_car()
    build_lights()
    bike = build_bike()
    rider = build_rider()
    drive_in([bike] + rider)

    by_name = {o.name: o for o in rider}
    pelvis, head = by_name["Pelvis"], by_name["Head"]

    target = empty("CamTarget")
    anchor = empty("CamAnchor")
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 38
    cam_data.clip_end = 400.0
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    setup_render(scene)
    bake(scene)
    tracks = aim_camera(scene, cam, target, anchor, bike, pelvis, head)

    print("SPEED %.2f m/s (%.1f km/h) release f%d" % (SPEED, SPEED * 3.6, F_FREE))
    for label, idx in (("bike", 0), ("pelvis", 1), ("head", 2)):
        a, b = tracks[F_FREE - 1][idx], tracks[-1][idx]
        print("TRAVEL %-7s release (%.2f, %.2f, %.2f) -> rest (%.2f, %.2f, %.2f)"
              % (label, a.x, a.y, a.z, b.x, b.y, b.z))
    sep = (tracks[-1][1] - tracks[-1][0]).length
    print("SEPARATION pelvis to bike at rest: %.2f m" % sep)
    report_joints(scene)

    # The trajectory, so the event can be read as numbers as well as frames:
    # where the bike stopped, where the rider went on to, and how far apart
    # the two ended up. That gap is the claim this clip exists to make.
    print("FRAME   bike_y  rider_y  rider_z   gap")
    for f in range(F_START, F_END + 1, 16):
        b, p, _h = tracks[f - F_START]
        print("  %3d  %7.2f  %7.2f  %7.2f  %5.2f"
              % (f, b.y, p.y, p.z, (p - b).length))

    if do_probe:
        return 0

    if stills:
        os.makedirs(STILL_DIR, exist_ok=True)
        scene.render.image_settings.file_format = "PNG"
        for f in stills:
            scene.frame_set(f)
            scene.render.filepath = os.path.join(STILL_DIR, "moto_%04d.png" % f)
            bpy.ops.render.render(write_still=True)
            print("WROTE " + scene.render.filepath)
    elif do_render:
        # Blender 5 split still and movie output behind media_type. Assigning
        # FFMPEG before switching it raises "enum not found" with a list that
        # omits every video format, so the media type is set first.
        scene.render.image_settings.media_type = "VIDEO"
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = crf
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.audio_codec = "NONE"
        os.makedirs(os.path.dirname(OUT_MP4), exist_ok=True)
        scene.render.filepath = OUT_MP4
        bpy.ops.render.render(animation=True)
        size = os.path.getsize(OUT_MP4)
        print("WROTE %s %d bytes (%.2f MB, %.2f s, %d fps)"
              % (OUT_MP4, size, size / 1048576.0,
                 (F_END - F_START + 1) / float(FPS), FPS))

    if do_save:
        os.makedirs(STILL_DIR, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(STILL_DIR, "crash-moto.blend"))
        print("WROTE blend")

    return 0


if __name__ == "__main__":
    sys.exit(main())
