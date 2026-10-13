"""Local-only oriented pilot inputs. Originals remain untouched."""
import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageOps


def prepare(source, output):
    output.mkdir(parents=True, exist_ok=True)
    inputs = output / "inputs"
    inputs.mkdir(exist_ok=True)
    rows = []
    for path in sorted(source.iterdir()):
        if not path.is_file() or path.suffix.lower() not in [".jpg", ".jpeg", ".png", ".webp"]:
            continue
        row = {"imageId": f"photo-{len(rows)+1:03d}", "filename": path.name,
               "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "sourceBytes": path.stat().st_size}
        try:
            with Image.open(path) as raw:
                row["exifOrientation"] = raw.getexif().get(274, 1)
                image = ImageOps.exif_transpose(raw).convert("RGB")
                row["orientedWidth"], row["orientedHeight"] = image.size
                scale = min(1, math.sqrt(2_000_000 / (image.width * image.height)))
                if scale < 1:
                    image = image.resize((math.floor(image.width*scale), math.floor(image.height*scale)), Image.Resampling.LANCZOS)
                row["width"], row["height"] = image.size
                row["file"] = f"inputs/{row['imageId']}.png"
                image.save(output / row["file"])
                row["inputSha256"] = hashlib.sha256((output / row["file"]).read_bytes()).hexdigest()
                row["status"] = "ready"
        except (OSError, ValueError) as error:
            row["status"] = "unsupported-image"
            row["reason"] = str(error)
        rows.append(row)
    manifest = {"schemaVersion": "real-card-pilot-v1", "scope": "single-card boundary, not internal text/layout zones",
                "inputPolicy": "EXIF transpose, RGB, LANCZOS max 2MP, lossless PNG; same input for each engine",
                "groundTruth": "NOT_RUN: no verified human corners provided", "images": rows}
    (output / "photos.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"images": len(rows), "ready": sum(r["status"] == "ready" for r in rows), "output": str(output)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("card_test_image"))
    parser.add_argument("--output", type=Path, default=Path("output/card-rectification/real-pilot"))
    args = parser.parse_args()
    prepare(args.input, args.output)
