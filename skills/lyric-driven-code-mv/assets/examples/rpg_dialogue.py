"""Draw the reference RPG dialogue HUD on a project's unscaled Pillow RGB(A) frame."""
from PIL import Image, ImageDraw

INK = "#492915"
EDGE = "#995325"
LIGHT = "#F1AF58"
PAPER = "#F8D599"


def _panel(draw, box, unit):
    x, y, w, h = box
    for inset, color in enumerate((INK, EDGE, LIGHT, EDGE, PAPER)):
        pad = inset * unit
        draw.rectangle((x + pad, y + pad, x + w - 1 - pad, y + h - 1 - pad), fill=color)


def draw_dialogue(frame, text, font, *, portrait=None, bottom_safe=0.09, expanded=False):
    """Paint timed text once, optionally with project-owned square portrait. Return occupied boxes.

    Render to the virtual canvas before nearest-neighbour scaling. Supply a font for
    this canvas and split long text across authored cues. Blank cues clear the HUD
    when called on a fresh scene frame.
    """
    if not text.strip():
        return []
    w, h = frame.size
    if w < 240 or h < 135 or not 0 <= bottom_safe <= 0.3:
        raise ValueError("Use a virtual canvas >=240x135 and bottom_safe in [0, 0.3].")
    u = max(1, round(h / 216))
    height = round(h * (0.32 if expanded else 0.23))
    left, right = round(w * 0.155), round(w * 0.845)
    top = h - round(h * bottom_safe) - height
    portrait_side = min(height, round(w * 0.155))
    if portrait is not None and portrait.width != portrait.height:
        raise ValueError("Prepare a square front-view portrait at the project's pixel scale.")
    text_width = right - left - (portrait_side + 3*u if portrait is not None else 0)
    draw = ImageDraw.Draw(frame)
    pad = 7*u
    lines = []
    for paragraph in text.split('\n'):
        line = ""
        for character in paragraph:
            if line and draw.textlength(line + character, font=font) > text_width - 2*pad:
                lines.append(line)
                line = ""
            line += character
        lines.append(line)
    ascent, descent = font.getmetrics()
    advance = ascent + descent + u
    if advance * len(lines) - u > height - 2*pad or any(
        draw.textlength(line, font=font) > text_width - 2*pad for line in lines
    ):
        raise ValueError("Cue exceeds panel capacity; expand the panel or split the timed cue.")
    boxes = [(left, top, text_width, height)]
    _panel(draw, boxes[0], u)
    for i, line in enumerate(lines):
        draw.text((left + pad, top + pad + ascent + i*advance), line, font=font, fill=INK, anchor="ls")
    if portrait is not None:
        side = portrait_side
        x = right - side
        boxes.append((x, top, side, height))
        _panel(draw, boxes[-1], u)
        size = side - 10*u
        sprite = portrait.convert("RGBA").resize((size, size), Image.Resampling.NEAREST)
        frame.paste(sprite, (x + 5*u, top + (height - size)//2), sprite)
    return boxes
