from pathlib import Path

from PIL import Image, ImageDraw


SCALE = 4
SIZE = 512
CANVAS = SIZE * SCALE

image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

draw.rounded_rectangle(
    (0, 0, CANVAS - 1, CANVAS - 1),
    radius=128 * SCALE,
    fill="#216E65",
)

stroke = 52 * SCALE
left = 144 * SCALE
right = 368 * SCALE
top = 126 * SCALE
bottom = 262 * SCALE
curve_bottom = 386 * SCALE
points = [(left, top), (left, bottom)]
for step in range(1, 65):
    t = step / 64
    x = left + (right - left) * t
    y = bottom + (curve_bottom - bottom) * (4 * t * (1 - t))
    if t > 0.5:
        y = bottom + (curve_bottom - bottom) * (4 * (1 - t) * t)
    points.append((int(x), int(y)))
points.append((right, top))
draw.line(points, fill="#FFFFFF", width=stroke, joint="curve")
radius = stroke // 2
for x, y in ((left, top), (right, top)):
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="#FFFFFF")

dot_radius = 30 * SCALE
dot_x = 256 * SCALE
dot_y = 398 * SCALE
draw.ellipse(
    (
        dot_x - dot_radius,
        dot_y - dot_radius,
        dot_x + dot_radius,
        dot_y + dot_radius,
    ),
    fill="#F1A85A",
)

image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
output = Path("resources")
output.mkdir(parents=True, exist_ok=True)
image.save(output / "icon.png", optimize=True)
image.save(
    output / "icon.ico",
    sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("Generated resources/icon.png and resources/icon.ico")
