"""Assemble the backup demo video.

Run:
    blender --background --factory-startup --python scripts/build_demo_video.py

Out: docs/pitch-assets/zetway-demo.mp4

This is the submission's backup video: the one that plays if the live demo
fails, the venue wifi dies, or a phone will not cooperate. So it is built
from things that cannot fail on the day — real screenshots of the deployed
app, the 3D crash render, and captions burnt in rather than narrated, so it
needs no sound and no microphone and reads in a noisy room.

Three things make it a film rather than a slideshow, and all three came from
watching the first cut and disliking it:

  Layout. The app is phone-shaped and the frame is 16:9, so the screenshot
  takes the left third and the words get the rest. The first cut centred the
  picture and put the caption under it, which meant shrinking the screenshot
  until its own text was unreadable — and it still overlapped.

  Movement. Every still has a slow push. Nothing is ever quite static, which
  is most of the difference between a video and a deck exported to MP4.

  Softness. Each strip fades in and out over a few frames, so cuts breathe.

Captions carry the argument, because a silent video with no words is just a
slideshow. Every figure in them is one the app actually shows.

Written against Blender 5.2, whose sequencer is not what older scripts
assume: `sequence_editor.strips`, not `sequences`, and `new_effect` takes a
`length` rather than a `frame_end`. Both were checked against this build
before a line was written.
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
DEEP = (0.016, 0.028, 0.055, 1)
BRAND = (0.10, 0.52, 0.86, 1)
WHITE = (1, 1, 1, 1)
DIM = (0.70, 0.75, 0.82, 1)
AMBER = (1.0, 0.72, 0.10, 1)
RED = (0.88, 0.20, 0.20, 1)
GREEN = (0.36, 0.86, 0.47, 1)

FADE = 7  # frames in and out of every strip

# The screenshot column. The captures are 454x983, so 660 tall is 305 wide,
# which leaves two thirds of a 1280 frame for words.
SHOT_H = 660
SHOT_X = -410   # offset from centre, i.e. into the left third
TEXT_X = 0.345  # where the text column starts, as a fraction of the width

FONTS = [
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONTS_BOLD = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def sec(s: float) -> int:
    return int(round(s * FPS))


def load_font(candidates):
    """Blender's built-in font is a monospace stand-in and looks like one.
    Any of these is better; none being present is survivable."""
    for path in candidates:
        if os.path.exists(path):
            try:
                return bpy.data.fonts.load(path)
            except Exception:
                continue
    return None


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Cut:
    """One segment of the film, laid down on stacked channels."""

    font = None
    font_bold = None

    def __init__(self, strips, start: int):
        self.strips = strips
        self.start = start
        self.n = 0

    def _name(self, kind: str) -> str:
        self.n += 1
        return f"{kind}{self.start}_{self.n}"

    def _fade(self, strip, start: int, length: int) -> None:
        end = start + length - 1
        for frame, alpha in (
            (start, 0.0),
            (min(start + FADE, end), 1.0),
            (max(end - FADE, start + 1), 1.0),
            (end, 0.0),
        ):
            strip.blend_alpha = alpha
            strip.keyframe_insert("blend_alpha", frame=frame)

    def bg(self, length: int, colour=INK, channel: int = 1):
        s = self.strips.new_effect(
            name=self._name("bg"), type="COLOR", channel=channel,
            frame_start=self.start, length=length,
        )
        s.color = colour[:3]
        return s

    def image(self, filename: str, length: int, *, height_px: int = SHOT_H,
              x_off: int = SHOT_X, y_off: int = 0, push: float = 0.055,
              channel: int = 2):
        """A screenshot, with a slow push so the frame is never quite still."""
        s = self.strips.new_image(
            name=self._name("img"), filepath=os.path.join(SHOTS, filename),
            channel=channel, frame_start=self.start, fit_method="ORIGINAL",
        )
        s.frame_final_duration = length
        s.blend_type = "ALPHA_OVER"

        base = height_px / s.elements[0].orig_height
        tr = s.transform
        tr.offset_x = x_off
        tr.offset_y = y_off

        end = self.start + length - 1
        tr.scale_x = tr.scale_y = base
        tr.keyframe_insert("scale_x", frame=self.start)
        tr.keyframe_insert("scale_y", frame=self.start)
        tr.scale_x = tr.scale_y = base * (1 + push)
        tr.keyframe_insert("scale_x", frame=end)
        tr.keyframe_insert("scale_y", frame=end)

        self._fade(s, self.start, length)
        return s

    def movie(self, path: str, length: int, channel: int = 2):
        s = self.strips.new_movie(
            name=self._name("mov"), filepath=path, channel=channel,
            frame_start=self.start, fit_method="FIT",
        )
        s.frame_final_duration = min(length, s.frame_final_duration)
        s.blend_type = "ALPHA_OVER"
        self._fade(s, self.start, s.frame_final_duration)
        return s

    def text(self, body: str, length: int, *, size: int, y: float, channel: int,
             colour=WHITE, x: float = 0.5, anchor: str = "CENTER", wrap: float = 0.86,
             bold: bool = False, offset: int = 0):
        start = self.start + offset
        s = self.strips.new_effect(
            name=self._name("txt"), type="TEXT", channel=channel,
            frame_start=start, length=length,
        )
        s.text = body
        s.font_size = size
        s.color = colour
        s.location = (x, y)
        s.anchor_x = anchor
        s.anchor_y = "CENTER"
        s.wrap_width = wrap
        s.use_shadow = True
        s.shadow_color = (0, 0, 0, 0.8)
        font = Cut.font_bold if bold else Cut.font
        if font is not None:
            s.font = font
        self._fade(s, start, length)
        return s

    # ---- the three text roles used beside a screenshot
    def label(self, body: str, length: int, colour=AMBER):
        return self.text(body, length, size=27, y=0.74, channel=5, colour=colour,
                         x=TEXT_X, anchor="LEFT", wrap=0.60, bold=True)

    def caption(self, body: str, length: int, offset: int = 0):
        return self.text(body, length, size=33, y=0.50, channel=4, colour=WHITE,
                         x=TEXT_X, anchor="LEFT", wrap=0.60, offset=offset)

    def footnote(self, body: str, length: int):
        return self.text(body, length, size=21, y=0.245, channel=6, colour=DIM,
                         x=TEXT_X, anchor="LEFT", wrap=0.60)


def build() -> int:
    clear()
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.fps = FPS
    scene.sequence_editor_create()
    strips = scene.sequence_editor.strips

    Cut.font = load_font(FONTS)
    Cut.font_bold = load_font(FONTS_BOLD) or Cut.font

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
    c.text("ZETWAY", d, size=130, y=0.60, channel=3, colour=WHITE, bold=True)
    c.text("Vigilance en route", d, size=42, y=0.45, channel=4, colour=BRAND)
    c.text("Team BackpropPirates    Life Powered by Tech 2026    Theme 2: Powered to Move",
           d, size=23, y=0.28, channel=5, colour=DIM)

    # ------------------------------------------------------------- problem
    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.text("134", d, size=165, y=0.67, channel=3, colour=RED, bold=True)
    c.text("people were killed on Mauritian roads in 2024.",
           d, size=40, y=0.46, channel=4, colour=WHITE)
    c.text("3,029 were injured or killed. Half of them were on two wheels or on foot, "
           "the people with the least information before they set off.",
           d, size=25, y=0.26, channel=5, colour=DIM)

    # ---------------------------------------------------------------- app
    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.image("01-plan.jpg", d)
    c.label("Before you ride", d)
    c.caption("Pick where you are going, how, and when.", d)
    c.footnote("26 towns, positioned from official health-facility coordinates.", d)

    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("02-score.jpg", d)
    c.label("The Corridor Safety Score", d)
    c.caption("Grand Baie to Port Louis, by motorcycle, after dark: 31 out of 100.", d)
    c.footnote("Four measurements, each a ratio between published government figures.", d)

    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("03-advice.jpg", d)
    c.label("Every number names its table", d)
    c.caption("Darkness with no street lighting is 2.2 times as likely to end in a death.", d)
    c.footnote("8.2% of casualties fatal, against 3.7% in daylight. Light conditions, 2018.", d)

    # ----------------------------------------------------------- roadside
    d = sec(9)
    c = seg(d)
    c.bg(d)
    c.image("05-roadside.jpg", d)
    c.label("When it goes wrong", d)
    c.caption("15 roadside guides, written separately for cars and motorcycles.", d)
    c.footnote("Safety check first. On a main road it refuses to show repair steps at all.", d)

    # -------------------------------------------------------------- crash
    d = sec(3)
    c = seg(d)
    c.bg(d, colour=(0.10, 0.012, 0.012, 1))
    c.text("And if the worst happens", d, size=56, y=0.56, channel=3, colour=WHITE, bold=True)
    c.text("Zetway watches the accelerometer while you ride.",
           d, size=27, y=0.40, channel=4, colour=DIM)

    crash = os.path.join(ASSETS, "zetway-crash.mp4")
    d = sec(10)
    c = seg(d)
    c.bg(d)
    if os.path.exists(crash):
        c.movie(crash, d)
    # Two captions across one clip: the impact lands about two seconds in,
    # and the rest is the camera settling on the phone.
    c.text("A car turns across the rider's lane. Impact: 5.3g, over the 3.1g bar.",
           sec(5), size=31, y=0.11, channel=4, colour=WHITE, wrap=0.82)
    c.text("The phone is thrown clear, lands face up, and wakes.",
           sec(5), size=31, y=0.11, channel=4, colour=WHITE, wrap=0.82, offset=sec(5))

    d = sec(7)
    c = seg(d)
    c.bg(d)
    c.image("06-alert.jpg", d)
    c.label("Detected with the screen off, in a pocket", d)
    c.caption("Alarm, vibration, and thirty seconds to answer.", d)
    c.footnote("A foreground service holds the sensor. A web page cannot.", d)

    d = sec(7)
    c = seg(d)
    c.bg(d, colour=(0.10, 0.012, 0.012, 1))
    c.text("No answer.", d, size=70, y=0.73, channel=3, colour=WHITE, bold=True)
    c.text("The Android build texts every contact a map link and rings the first, with no tap.",
           d, size=33, y=0.50, channel=4, colour=WHITE, wrap=0.78)
    c.text("114 stays one tap. Android lets no third-party app dial an emergency number, "
           "so we say so on the screen rather than pretend otherwise.",
           d, size=24, y=0.25, channel=5, colour=DIM, wrap=0.78)

    # ------------------------------------------------------------ offline
    d = sec(4)
    c = seg(d)
    c.bg(d, colour=(0.02, 0.10, 0.05, 1))
    c.text("Surprise card: Offline Mode", d, size=56, y=0.58, channel=3,
           colour=WHITE, bold=True)
    c.text("\u201cYour user suddenly has no internet.\u201d",
           d, size=29, y=0.40, channel=4, colour=DIM)

    d = sec(10)
    c = seg(d)
    c.bg(d, colour=DEEP)
    c.image("04-offline.jpg", d)
    c.label("The score never needed the network", d, colour=GREEN)
    c.caption("It is worked out on the device from 269 KB of government tables.", d)
    c.footnote("In airplane mode: the score, the 48 black spots, the emergency numbers and "
               "every guide. The forecast cannot, so it is not faked.", d)

    # -------------------------------------------------------------- close
    d = sec(6)
    c = seg(d)
    c.bg(d)
    c.text("ZETWAY", d, size=96, y=0.70, channel=3, colour=WHITE, bold=True)
    c.text("backprop-pirates.vercel.app", d, size=42, y=0.52, channel=4, colour=BRAND)
    c.text("Web app and Android APK, from one codebase.    "
           "Every figure from Open Data Mauritius and Statistics Mauritius.",
           d, size=24, y=0.30, channel=5, colour=DIM)

    scene.frame_start = 1
    scene.frame_end = at - 1

    # Standard, not the filmic default. The sources here are sRGB screenshots
    # and flat colour, not rendered light: a tone curve meant for taming
    # highlights turns white text grey and leaves every screenshot looking
    # dim and washed, which is exactly how the first cut looked.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    os.makedirs(ASSETS, exist_ok=True)
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.filepath = OUT

    print(f"FONT {'loaded' if Cut.font else 'built-in fallback'}")
    print(f"ASSEMBLED {scene.frame_end} frames = {scene.frame_end / FPS:.1f}s")
    bpy.ops.render.render(animation=True)
    print(f"WROTE {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
