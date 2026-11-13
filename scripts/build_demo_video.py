"""Assemble the backup demo video.

Run:
    blender --background --factory-startup --python scripts/build_demo_video.py

Out: docs/pitch-assets/zetway-demo.mp4

This is the submission's backup video: the one that plays if the live demo
fails, the venue wifi dies, or a phone will not cooperate. So it is built
from things that cannot fail on the day — real screenshots of the deployed
app, the 3D crash render, and captions burnt in rather than narrated, so it
needs no sound and no microphone and reads in a noisy room.

Captions carry the argument because a silent video with no words is just a
slideshow. Every figure in them is one the app actually shows.

Written against Blender 5.2, whose sequencer is not what older scripts
assume: `sequence_editor.strips`, not `sequences`, and `new_effect` takes a
`length` rather than a `frame_end`. Both were checked against this build
before anything was written.
"""

from __future__ import annotations

import os
import sys

import bpy

W, H, FPS = 1280, 720, 24
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(_REPO, "docs", "pitch-assets")
SHOTS = os.path.join(ASSETS, "demo")
OUT = os.path.join(ASSETS, "zetway-demo.mp4")

INK = (0.012, 0.015, 0.023, 1)
BRAND = (0.02, 0.33, 0.68, 1)
WHITE = (1, 1, 1, 1)
DIM = (0.72, 0.76, 0.82, 1)
AMBER = (1.0, 0.70, 0.08, 1)
RED = (0.85, 0.16, 0.16, 1)

sec = lambda s: int(round(s * FPS))


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Cut:
    """One segment of the film, laid down on stacked channels."""

    def __init__(self, strips, start: int):
        self.strips = strips
        self.start = start
        self.n = 0

    def _name(self, kind: str) -> str:
        self.n += 1
        return f"{kind}{self.start}_{self.n}"

    def bg(self, length: int, colour=INK, channel: int = 1):
        s = self.strips.new_effect(
            name=self._name("bg"), type="COLOR", channel=channel,
            frame_start=self.start, length=length,
        )
        s.color = colour[:3]
        return s

    def image(self, filename: str, length: int, *, height_px: int, y: float = 0.06,
              channel: int = 2):
        """A screenshot, scaled by height so the caption bar always clears it.

        The captures are portrait phone-shaped and the canvas is 16:9, so they
        are pillarboxed on purpose rather than cropped: cropping a phone screen
        to widescreen throws away the part being talked about.
        """
        path = os.path.join(SHOTS, filename)
        s = self.strips.new_image(
            name=self._name("img"), filepath=path, channel=channel,
            frame_start=self.start, fit_method="ORIGINAL",
        )
        s.frame_final_duration = length
        elem = s.elements[0]
        scale = height_px / elem.orig_height
        s.transform.scale_x = scale
        s.transform.scale_y = scale
        s.transform.offset_y = y * H
        return s

    def movie(self, path: str, length: int, channel: int = 2):
        s = self.strips.new_movie(
            name=self._name("mov"), filepath=path, channel=channel,
            frame_start=self.start, fit_method="FIT",
        )
        s.frame_final_duration = min(length, s.frame_final_duration)
        return s

    def text(self, body: str, length: int, *, size: int, y: float, channel: int,
             colour=WHITE, x: float = 0.5, anchor: str = "CENTER", wrap: float = 0.86,
             box: bool = False, box_colour=(0, 0, 0, 0.55), offset: int = 0):
        s = self.strips.new_effect(
            name=self._name("txt"), type="TEXT", channel=channel,
            frame_start=self.start + offset, length=length,
        )
        s.text = body
        s.font_size = size
        s.color = colour
        s.location = (x, y)
        s.anchor_x = anchor
        s.anchor_y = "CENTER"
        s.wrap_width = wrap
        s.use_shadow = True
        s.shadow_color = (0, 0, 0, 0.85)
        if box:
            s.use_box = True
            s.box_color = box_colour
            s.box_margin = 0.016
        return s

    def caption(self, body: str, length: int, offset: int = 0):
        """The strip along the bottom. Boxed, because it sits over a light
        screenshot as often as a dark one."""
        return self.text(body, length, size=30, y=0.082, channel=4, colour=WHITE,
                         wrap=0.90, box=True, box_colour=(0, 0, 0, 0.78), offset=offset)

    def label(self, body: str, length: int, colour=AMBER):
        """A short kicker above the caption."""
        return self.text(body, length, size=23, y=0.225, channel=5, colour=colour,
                         wrap=0.90, box=True, box_colour=(0, 0, 0, 0.78))


def build() -> int:
    clear()
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.fps = FPS
    scene.sequence_editor_create()
    strips = scene.sequence_editor.strips

    at = 1

    def seg(length):
        nonlocal at
        c = Cut(strips, at)
        at += length
        return c

    # ---------------------------------------------------------------- open
    d = sec(5)
    c = seg(d)
    c.bg(d)
    c.text("ZETWAY", d, size=118, y=0.60, channel=3, colour=WHITE)
    c.text("Vigilance en route", d, size=40, y=0.47, channel=4, colour=BRAND)
    c.text("Team BackpropPirates  ·  Life Powered by Tech 2026  ·  Theme 2: Powered to Move",
           d, size=24, y=0.30, channel=5, colour=DIM)

    # ------------------------------------------------------------- problem
    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.text("134", d, size=150, y=0.66, channel=3, colour=RED)
    c.text("people were killed on Mauritian roads in 2024.", d, size=38, y=0.47,
           channel=4, colour=WHITE)
    c.text("3,029 were injured or killed. Half of them were on two wheels or on foot —\n"
           "the people with the least information before they set off.",
           d, size=28, y=0.26, channel=5, colour=DIM)

    # ---------------------------------------------------------------- app
    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.image("01-plan.jpg", d, height_px=455, y=0.115)
    c.label("Before you ride", d)
    c.caption("Pick where you are going, how, and when.", d)

    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("02-score.jpg", d, height_px=455, y=0.115)
    c.label("The Corridor Safety Score", d)
    c.caption("Grand Baie to Port Louis, by motorcycle, after dark: 31 out of 100.", d)

    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("03-advice.jpg", d, height_px=455, y=0.115)
    c.label("Every number traces to a government table", d)
    c.caption("Darkness with no street lighting is 2.2 times as likely to end in a death: 8.2% of casualties fatal, against 3.7% in daylight.", d)

    # ----------------------------------------------------------- roadside
    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("05-roadside.jpg", d, height_px=455, y=0.115)
    c.label("When it goes wrong", d)
    c.caption("15 guides, written separately for cars and motorcycles. Safety check first, and on a main road it refuses to show repair steps at all.", d)

    # -------------------------------------------------------------- crash
    d = sec(3)
    c = seg(d)
    c.bg(d, colour=(0.10, 0.012, 0.012, 1))
    c.text("And if the worst happens", d, size=54, y=0.56, channel=3, colour=WHITE)
    c.text("Zetway watches the accelerometer while you ride.", d, size=28, y=0.40,
           channel=4, colour=DIM)

    crash = os.path.join(ASSETS, "zetway-crash.mp4")
    d = sec(10)
    c = seg(d)
    c.bg(d)
    if os.path.exists(crash):
        c.movie(crash, d)
    # Two captions across the one clip: the impact lands about two seconds
    # in, and the rest is the camera settling on the phone.
    c.caption("A car turns across the rider's lane. Impact: 5.3g, over the 3.1g bar.", sec(5))
    c.caption("The phone is thrown clear, lands face up, and wakes.", sec(5), offset=sec(5))

    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.image("06-alert.jpg", d, height_px=455, y=0.115)
    c.label("Detected, with the screen off and the phone in a pocket", d)
    c.caption("Alarm, vibration, and thirty seconds to answer.", d)

    d = sec(7)
    c = seg(d)
    c.bg(d, colour=(0.10, 0.012, 0.012, 1))
    c.text("No answer.", d, size=64, y=0.72, channel=3, colour=WHITE)
    c.text("The Android build texts every contact a map link\nand rings the first of them — with no tap.",
           d, size=34, y=0.50, channel=4, colour=WHITE)
    c.text("114 stays one tap. Android lets no third-party app dial an emergency\n"
           "number, so we say so on the screen rather than pretend.",
           d, size=26, y=0.24, channel=5, colour=DIM)

    # ------------------------------------------------------------ offline
    d = sec(4)
    c = seg(d)
    c.bg(d, colour=(0.02, 0.09, 0.05, 1))
    c.text("Surprise card: Offline Mode", d, size=54, y=0.58, channel=3, colour=WHITE)
    c.text("“Your user suddenly has no internet.”", d, size=30, y=0.40,
           channel=4, colour=DIM)

    d = sec(10)
    c = seg(d)
    c.bg(d)
    c.image("04-offline.jpg", d, height_px=455, y=0.115)
    c.label("The score never needed the network", d, colour=(0.35, 0.85, 0.45, 1))
    c.caption("Worked out on the device from 269 KB of government tables. In airplane mode the score, the black spots and every guide still work.", d)

    # -------------------------------------------------------------- close
    d = sec(6)
    c = seg(d)
    c.bg(d)
    c.text("ZETWAY", d, size=86, y=0.70, channel=3, colour=WHITE)
    c.text("backprop-pirates.vercel.app", d, size=40, y=0.52, channel=4, colour=BRAND)
    c.text("Web app and Android APK, from one codebase.\n"
           "Every figure from Open Data Mauritius and Statistics Mauritius.",
           d, size=26, y=0.30, channel=5, colour=DIM)

    scene.frame_start = 1
    scene.frame_end = at - 1

    os.makedirs(ASSETS, exist_ok=True)
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.filepath = OUT

    print(f"ASSEMBLED {scene.frame_end} frames = {scene.frame_end / FPS:.1f}s")
    bpy.ops.render.render(animation=True)
    print(f"WROTE {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
