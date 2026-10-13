import json
from pathlib import Path

from PIL import Image, ImageDraw

root = Path("output/card-rectification/real-pilot")
images = {r["imageId"]: r for r in json.loads((root / "photos.json").read_text(encoding="utf-8"))["images"]}
rows = [json.loads(line) for line in (root / "measurements.jsonl").read_text().splitlines()]
dest = root / "overlays"
dest.mkdir(exist_ok=True)
for row in rows:
    info = images[row["imageId"]]
    image = Image.open(root / info["file"]).convert("RGB")
    draw = ImageDraw.Draw(image)
    if row["normalizedCorners"]:
        points = [(p["x"]*image.width, p["y"]*image.height) for p in row["normalizedCorners"]]
        draw.line(points + [points[0]], fill="#10b981", width=7)
    else:
        points = [(p["x"], p["y"]) for p in row["points"]]
    for i, (x, y) in enumerate(points):
        draw.ellipse((x-9, y-9, x+9, y+9), fill="#ef4444")
        draw.text((x+12, y+5), str(i+1), fill="red")
    image.save(dest / f"{row['engine']}-{row['imageId']}.png")
for engine in ["legacy", "docaligner-lc100", "docaligner-t8"]:
    selected = [r for r in rows if r["engine"] == engine]
    sheet = Image.new("RGB", (1080, ((len(selected)+3)//4)*320), "#e8edf5")
    draw = ImageDraw.Draw(sheet)
    for index, row in enumerate(selected):
        image = Image.open(dest / f"{engine}-{row['imageId']}.png")
        image.thumbnail((260, 285))
        x = index % 4 * 270 + (270-image.width)//2
        y = index // 4 * 320 + 25
        sheet.paste(image, (x, y))
        draw.text((index % 4 * 270+8, index // 4 * 320+5), f"{row['imageId']} {row['status']}", fill="black")
    sheet.save(root / f"contact-{engine}.jpg")
print(json.dumps({"overlayImages": len(rows)}))
