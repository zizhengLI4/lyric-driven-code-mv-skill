#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render silent, original demos for readable, lyric-driven pixel scenes.

The captions are original examples, not lyrics from a released song. No music,
web service, model, downloaded asset, or extra Python package is used.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

VIRTUAL = (480, 270)
OUTPUT = (960, 540)
FPS = 24
INK = (30, 28, 25)
CREAM = (241, 226, 190)
RUST = (167, 68, 47)
SKIN = (218, 169, 126)
COATS = [(150, 63, 48), (77, 96, 80), (91, 111, 129), (176, 148, 88), (109, 77, 62)]
FONT_CANDIDATES = [
    Path('C:/Windows/Fonts/msyhbd.ttc'), Path('C:/Windows/Fonts/msyh.ttc'),
    Path('/System/Library/Fonts/PingFang.ttc'),
    Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'),
    Path('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
]
FONT_CACHE = {}


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def smooth(value: float) -> float:
    value = clamp01(value)
    return value * value * (3 - 2 * value)


def font(size: int, bold: bool = False):
    key = (size, bold)
    if key in FONT_CACHE:
        return FONT_CACHE[key]
    paths = FONT_CANDIDATES if bold else [FONT_CANDIDATES[1], *FONT_CANDIDATES[2:]]
    for path in paths:
        if path.exists():
            try:
                FONT_CACHE[key] = ImageFont.truetype(str(path), size)
                return FONT_CACHE[key]
            except OSError:
                continue
    raise SystemExit('No Chinese-capable system font found. Add one to FONT_CANDIDATES.')


def tone(color: tuple[int, int, int], amount: int) -> tuple[int, int, int]:
    return tuple(max(0, min(255, channel + amount)) for channel in color)


def draw_person(draw: ImageDraw.ImageDraw, x: int, ground: int, index: int, scale: int = 2, reaching: bool = False) -> None:
    """Render five consistent silhouettes with pixel-sized face and cloth detail."""
    s = scale
    coat = COATS[index]
    shade = tone(coat, -34)
    light = tone(coat, 28)
    head = ground - 29 * s
    draw.ellipse((x - 14 * s, ground - 2 * s, x + 14 * s, ground + 3 * s), fill=(34, 29, 25))
    draw.rectangle((x - 5 * s, head, x + 5 * s, head + 8 * s), fill=SKIN, outline=INK)
    draw.rectangle((x + 3 * s, head + 2 * s, x + 5 * s, head + 7 * s), fill=(184, 132, 99))
    eye_y = head + 3 * s
    draw.rectangle((x + 2 * s, eye_y, x + 3 * s, eye_y + s), fill=(34, 31, 28))
    draw.line((x + 1 * s, head + 6 * s, x + 4 * s, head + 6 * s), fill=(139, 83, 66), width=max(1, s // 2))
    if index == 0:
        draw.rectangle((x - 8 * s, head - 4 * s, x + 8 * s, head), fill=(45, 38, 31), outline=INK)
        draw.rectangle((x + 2 * s, head - 1 * s, x + 10 * s, head + 2 * s), fill=(45, 38, 31))
        draw.line((x - 7 * s, head - 2 * s, x + 5 * s, head - 2 * s), fill=(98, 76, 56), width=max(1, s))
    elif index == 1:
        draw.rectangle((x - 6 * s, head + 6 * s, x - 2 * s, head + 17 * s), fill=(222, 190, 127))
        draw.rectangle((x + 2 * s, head + 7 * s, x + 5 * s, head + 23 * s), fill=(222, 190, 127))
        draw.line((x + 3 * s, head + 11 * s, x + 3 * s, head + 19 * s), fill=(244, 220, 167), width=max(1, s))
    elif index == 2:
        draw.rectangle((x - 7 * s, head - 5 * s, x - 2 * s, head + 12 * s), fill=(43, 38, 32))
        draw.rectangle((x - 2 * s, head - 8 * s, x + 3 * s, head + 14 * s), fill=(43, 38, 32))
        draw.rectangle((x + 3 * s, head - 4 * s, x + 7 * s, head + 11 * s), fill=(43, 38, 32))
        draw.line((x + 3 * s, head - 4 * s, x + 3 * s, head + 8 * s), fill=(105, 76, 54), width=max(1, s))
    elif index == 3:
        draw.rectangle((x - 7 * s, head - 2 * s, x + 7 * s, head + 5 * s), fill=(45, 47, 43), outline=INK)
        draw.line((x - 6 * s, head + 12 * s, x - 10 * s, ground - 7 * s), fill=(42, 45, 42), width=2 * s)
        draw.rectangle((x - 8 * s, head + 12 * s, x - 4 * s, head + 16 * s), fill=(183, 157, 112))
    else:
        draw.rectangle((x - 6 * s, head - 3 * s, x + 6 * s, head), fill=(43, 38, 32), outline=INK)
        draw.line((x - 7 * s, head + 11 * s, x + 8 * s, ground - 10 * s), fill=(204, 66, 50), width=2 * s)
        draw.rectangle((x - 12 * s, head + 15 * s, x - 6 * s, head + 21 * s), fill=(49, 49, 44), outline=(224, 203, 157))
        draw.rectangle((x - 11 * s, head + 16 * s, x - 8 * s, head + 17 * s), fill=(238, 218, 177))
    torso = head + 8 * s
    if index == 0:
        body = [(x - 10 * s, torso), (x + 10 * s, torso), (x + 10 * s, ground - 8 * s), (x - 10 * s, ground - 8 * s)]
    elif index == 2:
        body = [(x - 7 * s, torso), (x + 7 * s, torso), (x + 11 * s, ground - 8 * s), (x - 11 * s, ground - 8 * s)]
    else:
        body = [(x - 6 * s, torso), (x + 6 * s, torso), (x + 9 * s, ground - 8 * s), (x - 9 * s, ground - 8 * s)]
    draw.polygon(body, fill=coat, outline=INK)
    draw.polygon([(x + 2 * s, torso + s), (x + 8 * s, torso + s), (x + 8 * s, ground - 10 * s), (x + 2 * s, ground - 10 * s)], fill=shade)
    draw.line((x - 5 * s, torso + 3 * s, x + 4 * s, torso + 3 * s), fill=light, width=max(1, s))
    draw.line((x, torso + 5 * s, x, ground - 12 * s), fill=shade, width=max(1, s))
    draw.line((x - 4 * s, torso + 12 * s, x - 7 * s, torso + 17 * s), fill=light, width=max(1, s))
    draw.line((x + 5 * s, torso + 13 * s, x + 7 * s, torso + 17 * s), fill=light, width=max(1, s))
    for button_y in (torso + 10 * s, torso + 19 * s):
        draw.rectangle((x - s, button_y, x, button_y + s), fill=(218, 193, 145))
    left_elbow = x - 10 * s
    left_hand = x - 14 * s if reaching else x - 8 * s
    right_elbow = x + 10 * s
    right_hand = x + 16 * s if reaching else x + 8 * s
    draw.line((x - 5 * s, torso + 5 * s, left_elbow, ground - 17 * s, left_hand, ground - 14 * s), fill=shade, width=3 * s)
    draw.line((x + 5 * s, torso + 5 * s, right_elbow, ground - 17 * s, right_hand, ground - 14 * s), fill=coat, width=3 * s)
    draw.line((left_hand - 2 * s, ground - 14 * s, left_hand + 2 * s, ground - 14 * s), fill=(205, 158, 117), width=max(1, s))
    draw.line((right_hand - 2 * s, ground - 14 * s, right_hand + 2 * s, ground - 14 * s), fill=(205, 158, 117), width=max(1, s))
    draw.rectangle((x - 7 * s, ground - 9 * s, x - 2 * s, ground - 4 * s), fill=shade)
    draw.rectangle((x + 2 * s, ground - 9 * s, x + 7 * s, ground - 4 * s), fill=shade)
    draw.line((x - 5 * s, ground - 8 * s, x - 4 * s, ground), fill=INK, width=3 * s)
    draw.line((x + 4 * s, ground - 8 * s, x + 4 * s, ground), fill=INK, width=3 * s)
    draw.polygon([(x - 8 * s, ground - 2 * s), (x - 3 * s, ground - 2 * s), (x - 2 * s, ground + s), (x - 10 * s, ground + s)], fill=(42, 37, 34), outline=INK)
    draw.polygon([(x + 2 * s, ground - 2 * s), (x + 7 * s, ground - 2 * s), (x + 10 * s, ground + s), (x + s, ground + s)], fill=(42, 37, 34), outline=INK)
    draw.line((x - 8 * s, ground, x - 3 * s, ground), fill=(198, 180, 145), width=max(1, s // 2))
    draw.line((x + 3 * s, ground, x + 8 * s, ground), fill=(198, 180, 145), width=max(1, s // 2))


def draw_fist(draw: ImageDraw.ImageDraw, center_x: int, center_y: int, direction: int, sleeve: tuple[int, int, int]) -> None:
    """Draw a readable closed hand with a tapered cuff, four knuckles and thumb."""
    if direction > 0:
        arm = [(0, center_y - 30), (center_x - 28, center_y - 22), (center_x - 28, center_y + 17), (0, center_y + 35)]
        hand = [(center_x - 30, center_y - 19), (center_x + 13, center_y - 19), (center_x + 31, center_y - 8), (center_x + 29, center_y + 11), (center_x + 17, center_y + 20), (center_x - 22, center_y + 18)]
        thumb = [(center_x - 22, center_y + 3), (center_x - 4, center_y + 2), (center_x + 4, center_y + 10), (center_x - 3, center_y + 18), (center_x - 19, center_y + 15)]
        cuff = (center_x - 32, center_y - 23, center_x - 24, center_y + 20)
        knuckles = [center_x - 14, center_x - 4, center_x + 6, center_x + 16]
        highlights = (center_x - 23, center_x + 17)
    else:
        arm = [(480, center_y - 30), (center_x + 28, center_y - 22), (center_x + 28, center_y + 17), (480, center_y + 35)]
        hand = [(center_x + 30, center_y - 19), (center_x - 13, center_y - 19), (center_x - 31, center_y - 8), (center_x - 29, center_y + 11), (center_x - 17, center_y + 20), (center_x + 22, center_y + 18)]
        thumb = [(center_x + 22, center_y + 3), (center_x + 4, center_y + 2), (center_x - 4, center_y + 10), (center_x + 3, center_y + 18), (center_x + 19, center_y + 15)]
        cuff = (center_x + 24, center_y - 23, center_x + 32, center_y + 20)
        knuckles = [center_x + 14, center_x + 4, center_x - 6, center_x - 16]
        highlights = (center_x + 23, center_x - 17)
    draw.polygon(arm, fill=sleeve, outline=INK)
    draw.rectangle(cuff, fill=tone(sleeve, -26), outline=INK, width=2)
    draw.line((cuff[0] + 2, center_y - 15, cuff[2] - 2, center_y - 15), fill=tone(sleeve, 32), width=2)
    draw.polygon(hand, fill=(220, 169, 126), outline=INK)
    draw.polygon(thumb, fill=(226, 177, 133), outline=INK)
    for x in knuckles:
        draw.line((x, center_y - 16, x, center_y - 6), fill=(163, 116, 88), width=2)
    draw.line((highlights[0], center_y - 16, highlights[1], center_y - 16), fill=(246, 205, 160), width=3)
    draw.line((center_x - 18, center_y + 18, center_x + 16, center_y + 18), fill=(177, 127, 95), width=2)


def draw_camera(time: float) -> Image.Image:
    image = Image.new('RGB', VIRTUAL, (43, 39, 33))
    draw = ImageDraw.Draw(image)
    for y in (42, 88, 224):
        draw.line((0, y, 479, y+4), fill=(74, 62, 46), width=3)
    draw.rectangle((0, 232, 479, 269), fill=(62, 53, 42))
    enter = smooth(time / 0.72)
    x, y = int(18 + 68*(1-enter)), int(90 + 3*math.sin(time*8)*(1-enter))
    draw.ellipse((x-8, 190, x+244, 238), fill=(25, 23, 21))
    draw.rectangle((x, y, x+244, y+116), fill=(37, 39, 36), outline=(17, 18, 16), width=4)
    draw.rectangle((x+20, y-17, x+147, y+2), fill=(54, 54, 47), outline=INK, width=2)
    draw.rectangle((x+30, y+12, x+66, y+37), fill=(94, 111, 103), outline=(16, 17, 16), width=3)
    draw.rectangle((x+161, y-25, x+192, y-9), fill=(86, 81, 65), outline=INK, width=2)
    draw.rectangle((x+201, y+20, x+229, y+91), fill=(50, 51, 45), outline=(20, 21, 19), width=2)
    lens_x, lens_y = x+118, y+62
    aperture = 0.42 + 0.58*smooth((time-0.55)/0.95)
    for radius, color in ((44,(109,99,77)),(36,(23,25,24)),(28,(76,91,91)),(int(19*aperture),(25,35,39)),(8,(138,157,145))):
        draw.ellipse((lens_x-radius,lens_y-radius,lens_x+radius,lens_y+radius), fill=color, outline=(183,158,111), width=2)
    draw.ellipse((lens_x-3,lens_y-3,lens_x+3,lens_y+3), fill=(232,219,181))
    pressed = 1 if 1.05 <= time < 1.2 else (0.5 if 1.2 <= time < 1.32 else 0)
    draw.rectangle((x+174,y-22+int(5*pressed),x+188,y-15+int(5*pressed)),fill=(177,57,43),outline=INK,width=1)
    if 0.98 <= time < 1.38:
        amount = clamp01(1-abs(time-1.12)/0.26)*0.2
        image = Image.blend(image, Image.new('RGB',VIRTUAL,(255,244,206)),amount)
        draw = ImageDraw.Draw(image)
    feed = smooth((time-1.55)/0.85)
    if feed > 0:
        strip_x = int(-225+300*feed)
        draw.rectangle((strip_x,40,strip_x+230,66),fill=(193,160,102),outline=INK,width=2)
        for hole in range(strip_x+5,strip_x+226,18): draw.rectangle((hole,43,hole+7,48),fill=(31,29,25))
        for slot in range(3): draw.rectangle((strip_x+17+slot*70,50,strip_x+62+slot*70,61),fill=(67,75,66))
    eject=smooth((time-2.65)/1.15)
    if eject>0:
        px,py=int(x+197+70*eject),int(y+76+18*eject)
        draw.rectangle((px,py,px+80,py+66),fill=(236,226,199),outline=INK,width=2)
        reveal=smooth((time-3.2)/1.1)
        draw.rectangle((px+6,py+6,px+74,py+46),fill=(78+int(20*reveal),92+int(17*reveal),78))
        for index in range(5):
            if reveal>index*0.1:
                cx=px+13+index*13
                draw.ellipse((cx-3,py+15,cx+3,py+21),fill=SKIN,outline=INK)
                draw.rectangle((cx-4,py+22,cx+4,py+37),fill=COATS[index],outline=INK,width=1)
        draw.line((px+14,py+55,px+65,py+55),fill=RUST,width=2)
    return image


def draw_amp_room(local: float, beat_index: int) -> Image.Image:
    image = Image.new('RGB', VIRTUAL, (43, 40, 40))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 479, 184), fill=(54, 51, 51))
    for x in range(12, 480, 30):
        draw.line((x, 0, x, 183), fill=(72, 65, 62), width=1)
    draw.rectangle((0, 184, 479, 269), fill=(78, 57, 42))
    draw.line((0, 184, 479, 184), fill=(194, 145, 87), width=2)

    if beat_index == 0:
        # Wide establishing shot: the cabinet is physically carried offstage.
        move = smooth(local / 0.85)
        amp_x = int(258 - 98 * move)
        draw.rectangle((22, 38, 34, 184), fill=(34, 31, 31))
        draw.rectangle((36, 44, 68, 184), fill=(74, 31, 29))
        draw.rectangle((407, 44, 439, 184), fill=(74, 31, 29))
        draw.rectangle((440, 38, 452, 184), fill=(34, 31, 31))
        draw.ellipse((amp_x + 2, 200, amp_x + 146, 226), fill=(25, 22, 20))
        draw.rectangle((amp_x, 83, amp_x + 144, 210), fill=(41, 42, 39), outline=INK, width=4)
        draw.rectangle((amp_x + 12, 98, amp_x + 132, 198), fill=(67, 67, 59), outline=(174, 147, 101), width=2)
        for x in range(amp_x + 18, amp_x + 128, 7):
            draw.line((x, 104, x, 192), fill=(43, 47, 44), width=1)
        draw.ellipse((amp_x + 47, 121, amp_x + 98, 172), fill=(48, 48, 44), outline=(185, 156, 105), width=3)
        draw.rectangle((amp_x + 42, 70, amp_x + 104, 85), fill=(32, 34, 32), outline=(155, 130, 91), width=2)
        draw_person(draw, int(119 + 31 * move), 236, 0, 2, True)
        draw_person(draw, 407, 236, 2, 2, True)
        draw.line((amp_x + 100, 207, amp_x + 120, 225, 184, 232), fill=(28, 25, 22), width=2)
        return image

    if beat_index == 1:
        # Close side view: two hands carry the amp across the stage lip.
        draw.rectangle((0, 188, 279, 269), fill=(75, 55, 40))
        draw.rectangle((280, 164, 479, 269), fill=(54, 45, 38))
        draw.line((0, 187, 280, 187), fill=(210, 167, 102), width=4)
        draw.line((280, 164, 479, 164), fill=(210, 167, 102), width=4)
        draw.rectangle((295, 166, 315, 187), fill=(93, 68, 46))
        draw.rectangle((329, 166, 349, 208), fill=(93, 68, 46))
        move = smooth(local / 0.75)
        amp_x = int(116 + 35 * move)
        amp_y = int(48 + 32 * move)
        draw.ellipse((amp_x - 7, amp_y + 130, amp_x + 148, amp_y + 157), fill=(25, 22, 20))
        draw.rectangle((amp_x, amp_y, amp_x + 144, amp_y + 137), fill=(41, 42, 39), outline=INK, width=4)
        draw.rectangle((amp_x + 12, amp_y + 15, amp_x + 132, amp_y + 121), fill=(67, 67, 59), outline=(174, 147, 101), width=2)
        for x in range(amp_x + 18, amp_x + 128, 7):
            draw.line((x, amp_y + 21, x, amp_y + 115), fill=(43, 47, 44), width=1)
        draw.ellipse((amp_x + 47, amp_y + 39, amp_x + 98, amp_y + 91), fill=(48, 48, 44), outline=(185, 156, 105), width=3)
        draw.rectangle((amp_x + 42, amp_y - 13, amp_x + 104, amp_y + 2), fill=(32, 34, 32), outline=(155, 130, 91), width=2)
        # Sleeves and hands reach for the cabinet's side handles.
        draw.line((amp_x - 38, amp_y + 42, amp_x + 5, amp_y + 48), fill=COATS[0], width=18)
        draw.ellipse((amp_x - 3, amp_y + 41, amp_x + 18, amp_y + 57), fill=SKIN, outline=INK, width=2)
        draw.line((amp_x + 179, amp_y + 52, amp_x + 139, amp_y + 60), fill=COATS[2], width=18)
        draw.ellipse((amp_x + 127, amp_y + 52, amp_x + 149, amp_y + 68), fill=SKIN, outline=INK, width=2)
        return image

    if beat_index == 2:
        # Insert shot: coil the microphone cable by hand, leaving the plug visible.
        draw.rectangle((0, 0, 479, 269), fill=(57, 44, 35))
        for y in range(44, 269, 28):
            draw.line((0, y, 479, y + 9), fill=(74, 57, 43), width=2)
        coil_x, coil_y = 228, 146
        radius = int(36 + 7 * math.sin(local * math.pi))
        for loop in range(4):
            offset = loop * 10
            draw.ellipse((coil_x - radius + offset, coil_y - radius + offset, coil_x + radius - offset, coil_y + radius - offset), outline=(24, 24, 23), width=5)
            draw.arc((coil_x - radius + offset + 2, coil_y - radius + offset + 2, coil_x + radius - offset - 2, coil_y + radius - offset - 2), 196, 346, fill=(91, 86, 75), width=2)
        plug_x = int(77 + 61 * smooth(local / 0.7))
        draw.line((plug_x + 20, 179, 154, 197, 176, 172), fill=(23, 23, 22), width=5)
        draw.rectangle((plug_x, 168, plug_x + 23, 180), fill=(178, 181, 171), outline=INK, width=2)
        draw.rectangle((plug_x - 8, 170, plug_x + 2, 178), fill=(208, 209, 195), outline=INK)
        draw.line((210, 87, 271, 48, 329, 57), fill=(24, 24, 23), width=5)
        draw.ellipse((320, 43, 339, 65), fill=(61, 65, 64), outline=(224, 215, 196), width=3)
        draw.line((286, 175, 342, 215), fill=SKIN, width=14)
        draw.ellipse((267, 162, 295, 187), fill=SKIN, outline=INK, width=2)
        for index in range(4):
            draw.line((275 + index * 4, 169 + index * 2, 287 + index * 5, 183 + index * 2), fill=(166, 119, 88), width=2)
        return image

    # Group shot: the same wired microphone passes down a visible line of five bandmates.
    draw.rectangle((30, 34, 450, 184), fill=(50, 46, 46))
    for x in (57, 423):
        draw.rectangle((x, 35, x + 18, 184), fill=(122, 48, 43))
    positions = (72, 156, 240, 324, 408)
    active = min(4, int(local * 5))
    for index, x in enumerate(positions):
        draw_person(draw, x, 236, index, 2, index == active)
    mic_x = int(positions[active] + 19 * smooth((local * 5) % 1))
    mic_y = 135
    draw.line((mic_x, mic_y + 18, mic_x - 12, 208, mic_x - 26, 220), fill=(24, 23, 22), width=3)
    draw.line((mic_x - 7, mic_y + 4, mic_x + 7, mic_y + 4), fill=(154, 157, 150), width=4)
    draw.ellipse((mic_x - 7, mic_y - 13, mic_x + 7, mic_y + 8), fill=(57, 62, 61), outline=(228, 216, 192), width=2)
    draw.rectangle((183, 39, 297, 68), fill=(32, 30, 29), outline=(194, 158, 102), width=2)
    draw.text((204, 43), 'CHECK 1 2 3', font=font(12, True), fill=(237, 215, 171))
    return image


def draw_kitchen(local: float, beat_index: int) -> Image.Image:
    image = Image.new('RGB', VIRTUAL, (69, 58, 47))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 479, 269), fill=(75, 64, 53))
    draw.rectangle((36, 28, 444, 200), fill=(76, 65, 54))
    # Large quiet kitchen tiles establish a real place without competing with the lyric object.
    for x in range(47, 444, 54):
        draw.line((x, 35, x - 8, 178), fill=(91, 77, 61), width=2)
    for y in (71, 118, 165):
        draw.line((39, y, 441, y + 2), fill=(91, 77, 61), width=2)
    draw.rectangle((31, 188, 448, 211), fill=(139, 99, 59), outline=INK, width=3)
    draw.rectangle((34, 191, 445, 197), fill=(172, 124, 73))
    draw.line((49, 202, 429, 202), fill=(100, 69, 45), width=2)
    for x in (48, 416):
        draw.rectangle((x, 211, x + 15, 260), fill=(72, 51, 36), outline=INK)
    draw.line((240, 0, 240, 15), fill=(34, 31, 28), width=4)
    draw.polygon([(207, 15), (273, 15), (260, 28), (220, 28)], fill=(48, 42, 35), outline=INK, width=2)
    draw.line((212, 17, 267, 17), fill=(170, 128, 73), width=2)
    draw.ellipse((229, 26, 251, 33), fill=(235, 193, 117), outline=(67, 54, 38), width=1)
    draw.polygon([(226, 32), (254, 32), (390, 179), (90, 179)], fill=(82, 71, 55))
    draw.polygon([(232, 33), (248, 33), (334, 179), (144, 179)], fill=(91, 76, 55))

    def bottle(x: int, y: int, width: int, height: int, color: tuple[int, int, int], kind: str) -> None:
        neck = max(12, width // 4)
        shoulder_y = y + height // 3
        # Cast shadow grounds the glass or plastic on the wood tabletop.
        draw.ellipse((x - 9, y + height - 4, x + width + 10, y + height + 9), fill=(65, 47, 34))
        outline = INK
        silhouette = [
            (x + width // 2 - neck // 2, y + 13), (x + width // 2 + neck // 2, y + 13),
            (x + width // 2 + neck // 2, shoulder_y), (x + width - 6, shoulder_y + 12),
            (x + width, y + height - 7), (x + width - 5, y + height),
            (x + 5, y + height), (x, y + height - 7), (x + 6, shoulder_y + 12),
            (x + width // 2 - neck // 2, shoulder_y),
        ]
        draw.polygon(silhouette, fill=color, outline=outline)
        draw.polygon([(x + 4, shoulder_y + 13), (x + 12, shoulder_y + 16), (x + 15, y + height - 8), (x + 8, y + height - 5)], fill=tone(color, -24))
        draw.polygon([(x + width - 11, shoulder_y + 15), (x + width - 6, shoulder_y + 13), (x + width - 9, y + height - 10), (x + width - 14, y + height - 7)], fill=tone(color, 28))
        cap_x1 = x + width // 2 - neck // 2 - 2
        cap_x2 = x + width // 2 + neck // 2 + 2
        draw.rectangle((cap_x1, y, cap_x2, y + 17), fill=(69, 55, 38), outline=INK, width=2)
        for cap_y in (y + 4, y + 8, y + 12):
            draw.line((cap_x1 + 2, cap_y, cap_x2 - 2, cap_y), fill=(157, 123, 77), width=1)
        draw.line((x + width // 2 - 2, y + 20, x + width // 2 - 2, shoulder_y + 4), fill=tone(color, 32), width=2)
        if kind == 'alcohol':
            label = (x + 12, y + height // 2, x + width - 12, y + height // 2 + 31)
            draw.rectangle(label, fill=(227, 216, 183), outline=(57, 51, 43), width=2)
            draw.line((label[0] + 5, label[1] + 6, label[2] - 5, label[1] + 6), fill=(107, 78, 49), width=2)
            draw.text((label[0] + 7, label[1] + 7), '酒', font=font(max(11, width // 4), True), fill=(70, 52, 37))
            draw.rectangle((label[0] + 4, label[3] - 5, label[2] - 4, label[3] - 2), fill=(165, 67, 49))
        else:
            fill_height = int((height - 34) * (0.58 + 0.04 * math.sin(local * math.pi * 2)))
            liquid_top = y + height - 12 - fill_height
            draw.rectangle((x + 9, liquid_top, x + width - 9, y + height - 12), fill=(225, 163, 61))
            draw.line((x + 10, liquid_top, x + width - 10, liquid_top), fill=(251, 215, 128), width=3)
            draw.line((x + 10, liquid_top + 4, x + width - 10, liquid_top + 4), fill=(190, 127, 42), width=1)
            draw.line((x + width - 16, y + 45, x + width - 13, y + height - 19), fill=(255, 224, 151), width=2)
            label_y = liquid_top + min(20, max(8, (y + height - 20 - liquid_top) // 2))
            draw.rectangle((x + width // 2 - 15, label_y, x + width // 2 + 15, label_y + 19), fill=(226, 196, 127), outline=(102, 72, 37), width=1)
            draw.text((x + width // 2 - 8, label_y + 1), '油', font=font(max(10, width // 5), True), fill=(64, 49, 31))

    if beat_index == 0:
        x = 194
        bottle_y = int(48 + 52 * smooth(local / 0.7))
        bottle(x, bottle_y, 88, 134, (47, 83, 59), 'alcohol')
        draw.line((x - 52, 92, x + 4, 122), fill=SKIN, width=13)
        draw.ellipse((x - 8, 109, x + 22, 128), fill=SKIN, outline=INK, width=2)
        draw.ellipse((x + 35, 219, x + 55, 225), fill=(229, 192, 131))
        return image

    if beat_index == 1:
        sack_x = int(143 + 43 * smooth(local / 0.75))
        draw.ellipse((sack_x - 8, 183, sack_x + 168, 202), fill=(65, 47, 34))
        draw.polygon([(sack_x, 188), (sack_x + 9, 119), (sack_x + 35, 93), (sack_x + 127, 93), (sack_x + 158, 123), (sack_x + 153, 188)], fill=(216, 196, 151), outline=INK, width=3)
        draw.polygon([(sack_x + 7, 180), (sack_x + 16, 127), (sack_x + 37, 103), (sack_x + 52, 103), (sack_x + 41, 180)], fill=(232, 213, 171))
        draw.polygon([(sack_x + 123, 105), (sack_x + 145, 128), (sack_x + 143, 180), (sack_x + 123, 180)], fill=(187, 166, 124))
        draw.line((sack_x + 42, 102, sack_x + 116, 102), fill=(141, 118, 82), width=4)
        draw.line((sack_x + 44, 108, sack_x + 113, 108), fill=(247, 230, 191), width=2)
        for stitch_x in range(sack_x + 14, sack_x + 32, 5):
            draw.line((stitch_x, 126, stitch_x - 2, 172), fill=(158, 135, 99), width=1)
        draw.text((sack_x + 53, 126), '米', font=font(27, True), fill=(78, 66, 48), stroke_width=1, stroke_fill=(235, 216, 174))
        for index in range(8):
            x = sack_x + 21 + index * 17
            y = 157 + (index % 3) * 7
            draw.ellipse((x, y, x + 6, y + 4), fill=(249, 238, 211), outline=(138, 119, 87))
        draw.line((34, 149, sack_x + 12, 149), fill=SKIN, width=11)
        draw.ellipse((sack_x + 2, 142, sack_x + 22, 157), fill=SKIN, outline=INK, width=2)
        return image

    if beat_index == 2:
        bottle_x = 178
        bottle_y = int(61 + 42 * smooth(local / 0.65))
        bottle(bottle_x, bottle_y, 116, 132, (135, 93, 42), 'oil')
        draw.text((bottle_x + 35, bottle_y + 62), '油', font=font(21, True), fill=(48, 42, 34), stroke_width=1, stroke_fill=(235, 193, 105))
        draw.line((96, 133, bottle_x + 18, 154), fill=SKIN, width=11)
        draw.ellipse((bottle_x + 5, 147, bottle_x + 25, 163), fill=SKIN, outline=INK, width=2)
        return image

    exchange = smooth(local / 0.82)
    alcohol_x = int(52 + 228 * exchange)
    rice_x = int(350 - 175 * exchange)
    oil_x = int(414 - 74 * exchange)
    bottle(alcohol_x, 116, 65, 96, (47, 83, 59), 'alcohol')
    draw.polygon([(rice_x, 199), (rice_x + 6, 149), (rice_x + 20, 132), (rice_x + 73, 132), (rice_x + 92, 151), (rice_x + 89, 199)], fill=(216, 196, 151), outline=INK, width=3)
    draw.line((rice_x + 22, 140, rice_x + 68, 140), fill=(141, 118, 82), width=4)
    draw.text((rice_x + 34, 155), '米', font=font(20, True), fill=(78, 66, 48))
    bottle(oil_x, 115, 58, 98, (135, 93, 42), 'oil')
    draw.text((oil_x + 16, 154), '油', font=font(16, True), fill=(48, 42, 34))
    left_hand = int(20 + 118 * exchange)
    right_hand = int(460 - 118 * exchange)
    draw.line((left_hand - 29, 157, left_hand, 157), fill=SKIN, width=12)
    draw.ellipse((left_hand - 7, 149, left_hand + 12, 165), fill=SKIN, outline=INK, width=2)
    draw.line((right_hand, 169, right_hand + 27, 169), fill=SKIN, width=12)
    draw.ellipse((right_hand - 10, 161, right_hand + 8, 178), fill=SKIN, outline=INK, width=2)
    draw.line((95, 225, 387, 225), fill=(91, 72, 51), width=2)
    return image


def draw_locket_scene(local: float, beat_index: int) -> Image.Image:
    image = Image.new('RGB', VIRTUAL, (30, 34, 35))
    draw = ImageDraw.Draw(image)
    draw.polygon([(0, 0), (140, 0), (223, 72), (166, 269), (0, 269)], fill=(63, 72, 66))
    draw.polygon([(480, 0), (340, 0), (256, 72), (316, 269), (480, 269)], fill=(49, 58, 56))
    draw.line((0, 248, 480, 260), fill=(24, 25, 24), width=5)

    def group_photo(box: tuple[int, int, int, int]) -> None:
        x1, y1, x2, y2 = box
        width, height = x2 - x1, y2 - y1
        draw.rectangle((x1 + 3, y1 + 4, x2 + 3, y2 + 4), fill=(22, 25, 23))
        draw.rectangle(box, fill=(238, 226, 198), outline=INK, width=2)
        ix1, iy1, ix2, iy2 = x1 + 6, y1 + 6, x2 - 6, y2 - 15
        draw.rectangle((ix1, iy1, ix2, iy2), fill=(104, 122, 100), outline=(174, 154, 112), width=1)
        draw.rectangle((ix1 + 2, iy1 + 5, ix2 - 2, iy1 + 8), fill=(205, 163, 105))
        draw.line((ix1 + 2, iy2 - 9, ix2 - 2, iy2 - 9), fill=(76, 91, 77), width=2)
        slot = (ix2 - ix1) / 5
        hair_colors = [(45, 38, 31), (53, 43, 34), (38, 37, 34), (63, 45, 32), (44, 39, 35)]
        for index in range(5):
            center_x = int(ix1 + slot * (index + 0.5))
            head_y = iy1 + 15 + index % 2
            skin = tone(SKIN, [-6, 4, 0, -10, 6][index])
            draw.ellipse((center_x - 5, head_y - 1, center_x + 5, head_y + 10), fill=skin, outline=INK, width=1)
            if index == 0:
                draw.rectangle((center_x - 6, head_y - 3, center_x + 5, head_y + 2), fill=hair_colors[index], outline=INK)
                draw.rectangle((center_x + 2, head_y, center_x + 7, head_y + 3), fill=hair_colors[index])
            elif index == 1:
                draw.ellipse((center_x - 6, head_y - 5, center_x + 5, head_y + 4), fill=hair_colors[index], outline=INK)
                draw.rectangle((center_x - 6, head_y + 2, center_x - 3, head_y + 11), fill=hair_colors[index])
            elif index == 2:
                draw.rectangle((center_x - 7, head_y - 3, center_x + 6, head_y + 2), fill=hair_colors[index], outline=INK)
                draw.rectangle((center_x - 7, head_y - 2, center_x - 3, head_y + 12), fill=hair_colors[index])
            elif index == 3:
                draw.rectangle((center_x - 6, head_y - 4, center_x + 6, head_y), fill=hair_colors[index], outline=INK)
                draw.rectangle((center_x + 3, head_y, center_x + 6, head_y + 9), fill=hair_colors[index])
            else:
                draw.ellipse((center_x - 5, head_y - 4, center_x + 5, head_y + 2), fill=hair_colors[index], outline=INK)
                draw.ellipse((center_x + 3, head_y - 7, center_x + 8, head_y - 2), fill=hair_colors[index])
            draw.point((center_x + 2, head_y + 5), fill=(34, 31, 28))
            shoulder_y = head_y + 12
            coat = COATS[index]
            draw.polygon([(center_x - 8, shoulder_y), (center_x - 4, shoulder_y - 3), (center_x + 4, shoulder_y - 3), (center_x + 8, shoulder_y), (center_x + 9, iy2 - 2), (center_x - 9, iy2 - 2)], fill=coat, outline=INK)
            draw.line((center_x - 4, shoulder_y, center_x - 1, shoulder_y + 5), fill=tone(coat, 32), width=1)
        draw.line((x1 + 10, y2 - 8, x2 - 10, y2 - 8), fill=(167, 73, 52), width=2)
        draw.rectangle((x1 + 4, y1 + 4, x1 + 7, y1 + 7), fill=(255, 247, 221))

    def chain(top: int = 0) -> None:
        points = []
        for index in range(31):
            x = 169 + index * 2.1
            y = top + 2 + 0.025 * (x - 201) ** 2
            points.append((int(x), int(y)))
        draw.line(points, fill=(111, 78, 43), width=5)
        draw.line([(x, y - 1) for x, y in points], fill=(231, 199, 133), width=2)
        for index in range(2, len(points) - 2, 4):
            x, y = points[index]
            draw.point((x, y + 2), fill=(249, 224, 164))

    def pendant_base(cx: int, cy: int, photo: bool) -> int:
        draw.ellipse((cx - 83, cy - 98, cx + 83, cy + 100), fill=(23, 25, 23))
        draw.ellipse((cx - 78, cy - 94, cx + 78, cy + 93), fill=(105, 76, 44), outline=(245, 216, 155), width=3)
        draw.ellipse((cx - 70, cy - 86, cx + 70, cy + 85), fill=(192, 151, 87), outline=(117, 83, 47), width=3)
        draw.arc((cx - 68, cy - 84, cx + 68, cy + 83), 195, 322, fill=(255, 232, 175), width=4)
        draw.arc((cx - 64, cy - 79, cx + 64, cy + 79), 18, 151, fill=(137, 97, 52), width=3)
        draw.ellipse((cx - 59, cy - 75, cx + 59, cy + 75), fill=(48, 43, 35), outline=(92, 68, 42), width=3)
        draw.ellipse((cx - 52, cy - 68, cx + 52, cy + 68), outline=(174, 134, 76), width=3)
        draw.ellipse((cx + 61, cy - 18, cx + 76, cy - 2), fill=(213, 171, 99), outline=INK, width=2)
        draw.ellipse((cx + 65, cy - 14, cx + 72, cy - 6), fill=(72, 52, 33), outline=(239, 208, 139), width=1)
        draw.line((cx + 63, cy - 10, cx + 79, cy - 10), fill=(242, 211, 146), width=3)
        if photo:
            group_photo((cx - 48, cy - 46, cx + 48, cy + 49))
            # Retaining lips overlap the paper to prove it is inside, not floating above.
            draw.rectangle((cx - 53, cy - 50, cx - 48, cy + 54), fill=(206, 164, 96), outline=(91, 65, 40))
            draw.rectangle((cx + 48, cy - 50, cx + 53, cy + 54), fill=(206, 164, 96), outline=(91, 65, 40))
            draw.line((cx - 46, cy + 52, cx + 46, cy + 52), fill=(250, 222, 157), width=3)
        return cx + 69

    def open_lid(hinge_x: int, hinge_y: int) -> None:
        # Inner cover is a raised plane, with its rim and hinge oriented consistently.
        draw.polygon([(hinge_x - 2, hinge_y - 78), (hinge_x + 111, hinge_y - 58), (hinge_x + 124, hinge_y + 75), (hinge_x + 2, hinge_y + 80)], fill=(105, 76, 44), outline=INK, width=3)
        draw.polygon([(hinge_x + 7, hinge_y - 69), (hinge_x + 101, hinge_y - 52), (hinge_x + 113, hinge_y + 65), (hinge_x + 8, hinge_y + 71)], fill=(196, 157, 101), outline=(244, 215, 153), width=3)
        draw.polygon([(hinge_x + 17, hinge_y - 55), (hinge_x + 91, hinge_y - 43), (hinge_x + 101, hinge_y + 49), (hinge_x + 19, hinge_y + 54)], fill=(79, 68, 52), outline=(126, 93, 52), width=2)
        draw.line((hinge_x + 19, hinge_y - 52, hinge_x + 81, hinge_y - 42), fill=(239, 211, 155), width=2)
        draw.ellipse((hinge_x - 7, hinge_y - 21, hinge_x + 9, hinge_y - 4), fill=(230, 190, 114), outline=INK, width=2)
        draw.line((hinge_x - 4, hinge_y - 12, hinge_x + 5, hinge_y - 12), fill=(255, 228, 166), width=2)

    def pinching_hand(tip_x: int, tip_y: int, progress: float) -> None:
        sleeve_x = int(458 - 37 * progress)
        draw.polygon([(480, tip_y - 23), (sleeve_x, tip_y - 18), (sleeve_x + 8, tip_y + 22), (480, tip_y + 31)], fill=(74, 78, 71), outline=INK)
        draw.line((sleeve_x + 1, tip_y - 14, sleeve_x + 1, tip_y + 20), fill=(160, 132, 90), width=3)
        # Thumb and index finger meet on the paper edge; neither crosses the portrait.
        draw.line((sleeve_x + 3, tip_y - 7, tip_x + 2, tip_y - 5), fill=(151, 106, 77), width=11)
        draw.line((sleeve_x + 3, tip_y - 9, tip_x + 2, tip_y - 7), fill=(235, 184, 139), width=7)
        draw.ellipse((tip_x - 5, tip_y - 12, tip_x + 8, tip_y), fill=(237, 187, 143), outline=INK, width=1)
        draw.line((sleeve_x + 5, tip_y + 11, tip_x - 1, tip_y + 4), fill=(170, 121, 88), width=9)
        draw.line((sleeve_x + 5, tip_y + 10, tip_x - 1, tip_y + 3), fill=(244, 196, 151), width=5)
        draw.ellipse((tip_x - 6, tip_y - 1, tip_x + 7, tip_y + 10), fill=(222, 169, 127), outline=INK, width=1)

    if beat_index == 0:
        # Fold a real five-person print along its crease; retain perspective and finger contact.
        progress = smooth(local / 0.78)
        x1, x2 = 60, 420
        crease = 240
        projected_width = int(180 * max(0.035, math.cos(progress * math.pi / 2)))
        folded_edge = crease + projected_width
        draw.polygon([(x1, 61), (crease, 74), (crease, 194), (x1, 209)], fill=(239, 226, 198), outline=INK, width=2)
        draw.polygon([(crease, 74), (folded_edge, 61), (folded_edge, 209), (crease, 194)], fill=(231, 217, 188), outline=INK, width=2)
        # Distinct portrait heads, hair shapes and shoulder silhouettes span both halves.
        for index in range(5):
            home_x = int(97 + index * 57)
            projected_x = home_x if home_x < crease else crease + int((home_x - crease) * max(0.035, math.cos(progress * math.pi / 2)))
            head_y = 110 + index % 2 * 4
            draw.ellipse((projected_x - 9, head_y, projected_x + 9, head_y + 18), fill=tone(SKIN, (index - 2) * 4), outline=INK, width=1)
            draw.rectangle((projected_x - 10, head_y - 4, projected_x + 8, head_y + 4), fill=[(42, 37, 32), (52, 43, 36), (37, 36, 34), (65, 48, 35), (45, 39, 34)][index], outline=INK)
            draw.polygon([(projected_x - 15, head_y + 24), (projected_x - 9, head_y + 18), (projected_x + 9, head_y + 18), (projected_x + 15, head_y + 24), (projected_x + 17, 184), (projected_x - 17, 184)], fill=COATS[index], outline=INK)
            draw.line((projected_x - 6, head_y + 28, projected_x - 2, head_y + 39), fill=tone(COATS[index], 35), width=2)
        draw.line((crease, 74, folded_edge, 61), fill=(181, 147, 97), width=3)
        draw.line((crease + 1, 80, crease + 1, 190), fill=(155, 121, 78), width=2)
        # The thumb presses the crease as the right half folds over the left.
        draw.polygon([(210, 52), (234, 60), (252, 83), (241, 98), (225, 81)], fill=(178, 124, 91), outline=INK)
        draw.polygon([(213, 51), (234, 58), (248, 79), (240, 86), (224, 70)], fill=(239, 185, 139), outline=(135, 90, 68))
        draw.ellipse((232, 70, 250, 86), fill=(246, 198, 152), outline=INK, width=1)
        draw.line((crease - 26, 204, crease - 4, 201), fill=(248, 237, 213), width=2)
        return image

    if beat_index == 1:
        cx, cy = 202, 146
        chain()
        hinge_x = pendant_base(cx, cy, photo=False)
        open_lid(hinge_x, cy - 1)
        # Finger on the clasp moves the lid open around the visible hinge.
        open_progress = smooth(local / 0.78)
        finger_x = int(cx + 68 + 30 * open_progress)
        draw.line((337, 220, finger_x + 2, 167), fill=(140, 100, 73), width=15)
        draw.line((337, 218, finger_x + 2, 165), fill=(233, 180, 136), width=10)
        draw.ellipse((finger_x - 7, 155, finger_x + 9, 172), fill=(242, 190, 146), outline=INK, width=2)
        draw.line((finger_x - 1, 158, finger_x + 3, 165), fill=(255, 218, 171), width=2)
        draw.arc((cx - 39, cy - 44, cx + 39, cy + 46), 205, 322, fill=(93, 74, 52), width=2)
        return image

    if beat_index == 2:
        cx, cy = 202, 146
        chain()
        hinge_x = pendant_base(cx, cy, photo=False)
        open_lid(hinge_x, cy - 1)
        progress = smooth(local / 0.76)
        photo_x = int(368 - 166 * progress)
        group_photo((photo_x - 48, 101, photo_x + 48, 196))
        # Two fingers pinch the right edge and release only when the paper meets the bezel.
        pinching_hand(photo_x + 42, 145, progress)
        if progress > 0.72:
            draw.line((cx - 34, 203, cx + 29, 203), fill=(246, 218, 156), width=2)
            draw.ellipse((cx + 47, 183, cx + 54, 190), fill=(255, 233, 175))
        draw.ellipse((cx - 85, cy - 100, cx + 85, cy + 102), outline=(239, 208, 143), width=2)
        return image

    # Return to the collar: the lid rotates shut and the pendant settles on fabric.
    draw.polygon([(0, 0), (125, 0), (220, 84), (150, 269), (0, 269)], fill=(80, 86, 75))
    draw.polygon([(480, 0), (353, 0), (261, 83), (335, 269), (480, 269)], fill=(57, 65, 59))
    draw.line((20, 220, 148, 269), fill=(108, 111, 92), width=3)
    draw.line((461, 213, 333, 269), fill=(92, 101, 89), width=3)
    swing = int(4 * math.sin(local * 5) * (1 - smooth(local / 0.86)))
    cx, cy = 202 + swing, 145
    chain(2)
    hinge_x = pendant_base(cx, cy, photo=True)
    close = smooth((local - 0.08) / 0.67)
    cover_width = max(4, int(158 * close))
    draw.ellipse((hinge_x - cover_width, cy - 88, hinge_x, cy + 88), fill=(178, 136, 73), outline=(240, 209, 146), width=4)
    if cover_width > 70:
        draw.ellipse((hinge_x - cover_width + 9, cy - 74, hinge_x - 9, cy + 74), fill=(156, 116, 63), outline=(210, 169, 105), width=3)
        draw.arc((hinge_x - cover_width + 13, cy - 71, hinge_x - 13, cy + 70), 200, 315, fill=(251, 222, 155), width=3)
    # A thumb presses the clasp after the cover seats, then releases.
    press = 1 - smooth((local - 0.61) / 0.18)
    if press > 0:
        finger_x = int(hinge_x + 32 - 36 * close)
        draw.line((398, 218, finger_x + 5, cy + 22), fill=(125, 88, 65), width=18)
        draw.line((398, 215, finger_x + 5, cy + 19), fill=(232, 177, 132), width=12)
        draw.ellipse((finger_x - 2, cy + 10, finger_x + 18, cy + 29), fill=(243, 192, 148), outline=INK, width=2)
        draw.point((finger_x + 8, cy + 15), fill=(255, 222, 174))
    if close > 0.91:
        draw.line((hinge_x - 5, cy + 2, hinge_x + 3, cy + 2), fill=(255, 228, 164), width=3)
        draw.ellipse((cx + 53, cy - 6, cx + 59, cy), fill=(255, 233, 175))
    draw.ellipse((cx - 80, cy - 98, cx + 80, cy + 101), fill=None, outline=(126, 139, 113), width=2)
    return image


def draw_fist_scene(local: float, beat_index: int) -> Image.Image:
    image = Image.new('RGB', VIRTUAL, (32, 38, 43))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 479, 195), fill=(35, 43, 49))
    draw.rectangle((0, 195, 479, 269), fill=(70, 57, 44))
    # A recognizable street lamp replaces the floating moon-like disk.
    draw.line((418, 18, 418, 192), fill=(26, 30, 31), width=6)
    draw.line((417, 23, 374, 23), fill=(26, 30, 31), width=5)
    draw.polygon([(368, 21), (391, 21), (397, 29), (364, 29)], fill=(42, 43, 40), outline=INK, width=2)
    draw.ellipse((369, 27, 391, 36), fill=(232, 185, 103), outline=(76, 57, 37), width=2)
    draw.polygon([(368, 34), (391, 34), (315, 195), (447, 195)], fill=(53, 59, 54))
    draw.polygon([(372, 36), (387, 36), (354, 195), (409, 195)], fill=(62, 66, 58))
    draw.line((415, 191, 421, 191), fill=(196, 151, 88), width=3)

    if beat_index == 0:
        # Wide shot: five distinct silhouettes close the distance from both sides.
        approach = smooth(local / 0.78)
        positions = [int(42 + 46 * approach), int(112 + 29 * approach), 240, int(368 - 29 * approach), int(438 - 46 * approach)]
        for index, x in enumerate(positions):
            draw_person(draw, x, 222, index, 2, index in (1, 3))
        for x in range(18, 480, 61):
            draw.line((x, 228, x + 9, 268), fill=(94, 73, 53), width=2)
        return image

    if beat_index == 1:
        # Ground-level insert: two different trouser cuffs and shoes stop at the same pavement seam.
        draw.rectangle((0, 44, 479, 177), fill=(39, 48, 52))
        draw.rectangle((0, 178, 479, 269), fill=(77, 62, 47))
        draw.line((0, 174, 479, 174), fill=(215, 174, 99), width=4)
        stop = smooth(local / 0.65)
        left_x = int(56 + 118 * stop)
        right_x = int(424 - 118 * stop)
        # Crop at the knees, not at the ankles: wide trouser silhouettes read as legs, not poles.
        draw.polygon([(left_x - 32, 64), (left_x + 30, 64), (left_x + 24, 172), (left_x + 8, 190), (left_x - 29, 182)], fill=COATS[0], outline=INK, width=2)
        draw.polygon([(right_x - 30, 64), (right_x + 32, 64), (right_x + 29, 182), (right_x - 8, 190), (right_x - 24, 172)], fill=COATS[2], outline=INK, width=2)
        draw.line((left_x - 19, 81, left_x - 22, 140), fill=tone(COATS[0], 35), width=4)
        draw.line((left_x + 16, 121, left_x + 8, 173), fill=tone(COATS[0], -24), width=3)
        draw.line((right_x + 18, 79, right_x + 21, 140), fill=tone(COATS[2], 35), width=4)
        draw.line((right_x - 16, 121, right_x - 8, 173), fill=tone(COATS[2], -24), width=3)
        draw.line((left_x - 26, 167, left_x + 22, 174), fill=(201, 176, 133), width=2)
        draw.line((right_x - 22, 174, right_x + 26, 167), fill=(182, 190, 194), width=2)
        left_shoe = [(left_x - 26, 178), (left_x + 13, 178), (left_x + 31, 195), (left_x + 37, 211), (left_x - 32, 211), (left_x - 38, 203)]
        right_shoe = [(right_x - 13, 178), (right_x + 26, 178), (right_x + 38, 203), (right_x + 32, 211), (right_x - 37, 211), (right_x - 31, 195)]
        draw.polygon(left_shoe, fill=(54, 43, 37), outline=INK, width=2)
        draw.polygon(right_shoe, fill=(45, 50, 55), outline=INK, width=2)
        draw.line((left_x - 24, 191, left_x + 12, 191), fill=(214, 198, 161), width=3)
        draw.line((right_x - 12, 191, right_x + 24, 191), fill=(194, 198, 195), width=3)
        for offset in (0, 6, 12):
            draw.line((left_x - 2 + offset // 2, 183 + offset, left_x + 5 + offset // 2, 186 + offset), fill=(182, 157, 125), width=1)
            draw.line((right_x - 5 - offset // 2, 186 + offset, right_x + 2 - offset // 2, 183 + offset), fill=(172, 180, 184), width=1)
        draw.line((left_x - 17, 213, left_x + 31, 213), fill=(180, 151, 113), width=2)
        draw.line((right_x - 31, 213, right_x + 17, 213), fill=(161, 170, 175), width=2)
        for x in range(18, 480, 61):
            draw.line((x, 227, x + 8, 269), fill=(93, 74, 55), width=2)
        return image

    if beat_index == 2:
        # Tight insert: two closed fists rise into frame but do not touch yet.
        meet = smooth(local / 0.8)
        left_x, right_x = int(187 - 8 * meet), int(293 + 8 * meet)
        cy = int(158 - 31 * meet)
        draw_fist(draw, left_x, cy, 1, COATS[0])
        draw_fist(draw, right_x, cy, -1, COATS[2])
        draw.line((240, 68, 240, 94), fill=(229, 185, 106), width=3)
        return image

    # Impact insert, then a fast visual payoff showing all five together.
    meet = smooth(local / 0.28)
    if local < 0.52:
        draw_fist(draw, 221, 129, 1, COATS[0])
        draw_fist(draw, 259, 129, -1, COATS[2])
        if local > 0.27:
            draw.line((239, 92, 239, 73), fill=(245, 222, 156), width=3)
            draw.line((218, 128, 199, 119), fill=(245, 222, 156), width=3)
            draw.line((262, 128, 281, 119), fill=(245, 222, 156), width=3)
    else:
        settle = smooth((local - 0.52) / 0.3)
        draw.rectangle((0, 177, 479, 269), fill=(66, 54, 43))
        for index, x in enumerate((126, 183, 240, 297, 354)):
            draw_person(draw, int(x + (240 - x) * 0.35 * settle), 225, index, 2, False)
        draw.line((175, 158, 199, 136, 225, 156), fill=(239, 206, 142), width=3)
        draw.line((255, 156, 281, 136, 305, 158), fill=(239, 206, 142), width=3)
    return image


LEDGER_PATH = Path(__file__).with_name('visual-ledger-demo.json')
LEDGER = json.loads(LEDGER_PATH.read_text(encoding='utf-8'))
SCENE_RENDERERS = {
    'backstage-rehearsal': draw_amp_room,
    'rice-and-oil': draw_kitchen,
    'photo-locket': draw_locket_scene,
    'reunion-fist-bump': draw_fist_scene,
}


def visual_frame(time: float, kind: str) -> tuple[Image.Image, dict | None, dict | None]:
    if kind == 'opening':
        return draw_camera(time), None, None
    scenes = LEDGER['scenes']
    scene_index = min(len(scenes) - 1, int(time // 4))
    scene = scenes[scene_index]
    local = time - scene_index * 4
    beat_index = min(len(scene['beats']) - 1, int(local))
    beat_progress = local - beat_index
    frame = SCENE_RENDERERS[scene['id']](beat_progress, beat_index)
    return frame, scene, scene['beats'][beat_index]


def make_frame(time: float, captions: bool, kind: str) -> Image.Image:
    small, scene, beat = visual_frame(time, kind)
    frame = small.resize(OUTPUT, Image.Resampling.NEAREST)
    if captions:
        draw = ImageDraw.Draw(frame)
        label_font = font(18, True)
        caption_font = font(28, True)
        if kind == 'opening':
            draw.rounded_rectangle((30, 22, 490, 58), radius=6, fill=(24, 23, 21), outline=(224, 202, 157), width=2)
            draw.text((43, 28), '开场钩子 · 相机装片到显影', font=label_font, fill=(238, 223, 185))
        else:
            label = f"{scene['title']} · {beat['shot']}"
            draw.rounded_rectangle((30, 22, 628, 58), radius=6, fill=(24, 23, 21), outline=(218, 191, 144), width=2)
            draw.text((43, 28), label, font=label_font, fill=(242, 225, 187))
            draw.rounded_rectangle((132, 466, 828, 524), radius=8, fill=(26, 25, 23), outline=(217, 187, 131), width=2)
            draw.rectangle((148, 478, 156, 512), fill=RUST)
            cue = beat['cue']
            box = draw.textbbox((0, 0), cue, font=caption_font, stroke_width=1)
            draw.text(((OUTPUT[0] - (box[2] - box[0])) // 2, 477), cue, font=caption_font, fill=(248, 239, 214), stroke_width=1, stroke_fill=(28, 24, 21))
    return frame


def encode_video(output: Path, duration: float, ffmpeg: str, captions: bool, kind: str) -> None:
    command=[ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{OUTPUT[0]}x{OUTPUT[1]}','-r',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    try:
        for index in range(round(duration*FPS)):
            process.stdin.write(make_frame(index/FPS,captions,kind).tobytes())
        process.stdin.close()
        stderr=process.stderr.read()
        status=process.wait()
        if status:
            raise RuntimeError(stderr.decode('utf-8','replace'))
    except Exception:
        if process.stdin and not process.stdin.closed: process.stdin.close()
        process.kill();process.wait();raise


def make_contact(path: Path, captions: bool, kind: str) -> None:
    times = ([0.0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.5] if kind == 'opening'
             else [scene * 4 + beat + 0.2 for scene in range(4) for beat in range(4)])
    sheet = Image.new('RGB', (384 * 4, 216 * 4 if kind == 'scenes' else 216 * 3), (18, 18, 17))
    for index,time in enumerate(times):
        frame=make_frame(time,captions,kind).resize((384,216),Image.Resampling.LANCZOS)
        draw=ImageDraw.Draw(frame)
        draw.rectangle((338,0,383,22),fill=(20,19,18))
        draw.text((343,3),f'{time:04.1f}s',font=font(12,True),fill=(244,231,199))
        sheet.paste(frame,((index%4)*384,(index//4)*216))
    sheet.save(path)


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=Path('work/visual-quality-demos'))
    parser.add_argument('--ffmpeg',default='ffmpeg')
    args=parser.parse_args()
    destination=args.output_dir.resolve()
    skill_root=Path(__file__).resolve().parents[2]
    try:
        destination.relative_to(skill_root)
    except ValueError:
        pass
    else:
        raise SystemExit('输出目录不能位于 Skill 安装目录；请改用视频工程的 work/ 目录。')
    destination.mkdir(parents=True,exist_ok=True)
    names=['opening-hook-demo.mp4','four-cue-scene-change-demo.mp4','four-cue-scene-change-no-captions.mp4','opening-hook-contact.png','four-scene-contact.png']
    existing=[name for name in names if (destination/name).exists()]
    if existing:
        raise SystemExit(f'输出文件已存在：{", ".join(existing)}；请改用新的 --output-dir。')
    encode_video(destination/'opening-hook-demo.mp4',5,args.ffmpeg,True,'opening')
    encode_video(destination/'four-cue-scene-change-demo.mp4',16,args.ffmpeg,True,'scenes')
    encode_video(destination/'four-cue-scene-change-no-captions.mp4',16,args.ffmpeg,False,'scenes')
    make_contact(destination/'opening-hook-contact.png',True,'opening')
    make_contact(destination/'four-scene-contact.png',True,'scenes')
    print(f'Created silent, original visual demos in {args.output_dir}')


if __name__=='__main__':
    main()
