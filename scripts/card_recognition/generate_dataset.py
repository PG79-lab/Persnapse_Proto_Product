"""Deterministic public synthetic fixtures; private inputs never enter this script."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VERSION = "card-synthetic-v1"
SEED = 20261012
TAGS = ["small-card", "near-full-frame", "white-on-white", "dark-card",
        "complex-background", "strong-perspective", "rotated", "rounded-corners",
        "shadow", "reflection", "blur", "flat-scan"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project(points, matrix):
    return cv2.perspectiveTransform(np.array([points], dtype=np.float64), matrix)[0].tolist()


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    fonts = {size: ImageFont.truetype(str(font_path), size) for size in [18, 22, 30]}
    rows = []
    rng = np.random.default_rng(SEED)

    def save(row, pixels):
        path = output / row["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(pixels, bytes):
            path.write_bytes(pixels)
        else:
            Image.fromarray(pixels).save(path)
        row["sha256"] = digest(path)
        rows.append(row)

    for design in range(60):
        card_id = f"design-{design:02d}"
        split = "development" if design < 36 else "tuning" if design < 48 else "holdout"
        cw, ch = 600, 340 + (design % 3) * 20
        for view in range(20):
            tag = TAGS[view % len(TAGS)]
            dark = tag == "dark-card"
            bg_color = (32, 38, 47) if dark else (250, 249, 245)
            ink = (245, 239, 228) if dark else (20, 30, 48)
            card = Image.new("RGB", (cw, ch), bg_color)
            draw = ImageDraw.Draw(card)
            elements = [
                ("name", (35, 108), f"SYNTHETIC PERSON {design:02d}", 30),
                ("phone", (35, 192), f"+00 000 000 {design:04d}", 22),
                ("email", (35, 240), f"person{design:02d}@example.invalid", 18),
            ]
            masks = []
            regions = []
            accent = (30 + design * 3 % 160, 80 + design * 5 % 130, 110 + design * 7 % 110)
            draw.rectangle((35, 30, 135, 70), fill=accent)
            logo = Image.new("L", (cw, ch))
            ImageDraw.Draw(logo).rectangle((35, 30, 135, 70), fill=255)
            masks.append(("logo", logo))
            regions.append({"id": "logo", "polygon": [[35, 30], [136, 30], [136, 71], [35, 71]]})
            for name, pos, text, size in elements:
                draw.text(pos, text, font=fonts[size], fill=ink)
                mask = Image.new("L", (cw, ch))
                ImageDraw.Draw(mask).text(pos, text, font=fonts[size], fill=255)
                masks.append((name, mask))
                x0, y0, x1, y1 = draw.textbbox(pos, text, font=fonts[size])
                regions.append({"id": name, "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]})

            # Each view has its own seed-independent mathematical homography.
            w, h = 1000, 760
            corners = np.array([[180, 150], [820, 125], [850, 590], [160, 610]], np.float32)
            jitter = rng.uniform(-25, 25, (4, 2)).astype(np.float32)
            corners += jitter
            if tag == "small-card":
                corners = (corners - [500, 380]) * 0.34 + [500, 380]
            elif tag == "near-full-frame":
                corners = np.array([[8, 8], [991, 8], [991, 751], [8, 751]], np.float32)
            elif tag == "strong-perspective":
                corners = np.array([[320, 160], [780, 80], [925, 660], [70, 620]], np.float32)
            elif tag == "rotated":
                corners = np.roll(corners, 2 if view < 12 else 1, axis=0)
            elif tag == "flat-scan":
                corners = np.array([[80, 160], [920, 160], [920, 160 + ch * 1.4], [80, 160 + ch * 1.4]], np.float32)
            corners = corners.astype(np.float32)
            source = np.array([[0, 0], [cw - 1, 0], [cw - 1, ch - 1], [0, ch - 1]], np.float32)
            transform = cv2.getPerspectiveTransform(source, corners)
            if tag == "white-on-white":
                background = np.full((h, w, 3), 250, np.uint8)
            else:
                base_color = rng.integers(40, 170, 3)
                background = np.broadcast_to(base_color, (h, w, 3)).copy().astype(np.uint8)
                if tag == "complex-background":
                    noise = rng.integers(-30, 31, (h, w, 3))
                    background = np.clip(background.astype(int) + noise, 0, 255).astype(np.uint8)
                    for _ in range(12):
                        x, y = rng.integers(0, [w, h])
                        cv2.rectangle(background, (int(x), int(y)), (int(x + 130), int(y + 70)), (220, 190, 120), 2)
            alpha = np.full((ch, cw), 255, np.uint8)
            if tag == "rounded-corners":
                alpha_image = Image.new("L", (cw, ch))
                ImageDraw.Draw(alpha_image).rounded_rectangle((0, 0, cw - 1, ch - 1), radius=20, fill=255)
                alpha = np.array(alpha_image)
            warped = cv2.warpPerspective(np.array(card), transform, (w, h), flags=cv2.INTER_LINEAR)
            mask = cv2.warpPerspective(alpha, transform, (w, h), flags=cv2.INTER_LINEAR) / 255
            image = (background * (1 - mask[..., None]) + warped * mask[..., None]).astype(np.uint8)
            if tag == "shadow":
                image = np.clip(image * np.linspace(0.65, 1, w)[None, :, None], 0, 255).astype(np.uint8)
            elif tag == "reflection":
                image = np.clip(image + 16 * np.exp(-((np.arange(w) - 650) / 100) ** 2)[None, :, None], 0, 255).astype(np.uint8)
            elif tag == "blur":
                image = cv2.GaussianBlur(image, (3, 3), 0.6)
            image_id = f"{card_id}-view-{view:02d}"
            region_labels = []
            for region, (name, printed_mask) in zip(regions, masks):
                # Store exact glyph/logo masks as well as predeclared polygon ROIs.
                mask_path = output / "masks" / f"{image_id}-{name}.png"
                mask_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(cv2.warpPerspective(np.array(printed_mask), transform, (w, h), flags=cv2.INTER_NEAREST)).save(mask_path)
                region_labels.append({**region, "polygon": project(region["polygon"], transform),
                                      "mask": str(mask_path.relative_to(output)).replace("\\", "/"), "maskSha256": digest(mask_path)})
            save({"imageId": image_id, "cardId": card_id, "split": split, "kind": "normal", "tags": [tag],
                  "file": f"images/{image_id}.png", "width": w, "height": h,
                  "coordinateSpace": "oriented-image-pixels", "orientationApplied": True,
                  "corners": corners.tolist(), "actualRatio": (cw - 1) / (ch - 1),
                  "designSize": [cw, ch], "homography": transform.tolist(), "requiredRegions": region_labels}, image)

    for i in range(300):
        w, h = 1000, 760
        image = np.full((h, w, 3), rng.integers(40, 190), np.uint8)
        kind = ["monitor", "desk", "notebook", "frame"][i % 4]
        for j in range(1 + i % 4):
            x, y = rng.integers(20, [500, 300])
            cv2.rectangle(image, (int(x), int(y)), (int(x + 380), int(y + 300)), (200, 205, 210), 8 if kind == "frame" else -1)
            if kind == "notebook":
                for line in range(12):
                    cv2.line(image, (int(x + 10), int(y + 20 + line * 20)), (int(x + 370), int(y + 20 + line * 20)), (100, 100, 100), 1)
        save({"imageId": f"negative-{i:03d}", "cardId": f"scene-{i:03d}", "split": "holdout", "kind": "negative",
              "tags": [kind], "file": f"images/negative-{i:03d}.png", "width": w, "height": h,
              "corners": None, "actualRatio": None, "requiredRegions": [], "expected": "fallback-or-review"}, image)

    reasons = ["crossed-corners", "outside-frame", "truncated-image", "insufficient-resolution", "unsupported-format"]
    for i in range(200):
        reason = reasons[i % 5]
        row = {"imageId": f"invalid-{i:03d}", "cardId": f"invalid-scene-{i:03d}", "split": "holdout",
               "kind": "invalid", "tags": [reason], "file": f"images/invalid-{i:03d}.png", "width": 480, "height": 280,
               "corners": None, "actualRatio": None, "requiredRegions": [], "expected": "fallback-or-review", "recaptureReason": reason}
        image = np.full((280, 480, 3), 230, np.uint8)
        cv2.rectangle(image, (50, 40), (430, 240), (255, 255, 255), -1)
        cv2.putText(image, f"INVALID {i:03d}", (90, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (15, 15, 15), 2)
        if reason == "crossed-corners":
            row["manualCorners"] = [[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]
        elif reason == "outside-frame":
            row["manualCorners"] = [[-0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        elif reason == "truncated-image":
            save(row, b"\x89PNG\r\n\x1a\ntruncated")
            continue
        elif reason == "insufficient-resolution":
            image = cv2.resize(image, (48, 28))
            row.update(width=48, height=28)
        else:
            save(row, b"This is not a supported image file.")
            continue
        save(row, image)
    manifest = {"schemaVersion": VERSION, "seed": SEED, "generatorSha256": digest(Path(__file__)),
                "font": {"file": font_path.name, "sha256": digest(font_path)},
                "tools": {"opencv": cv2.__version__, "numpy": np.__version__, "pillow": Image.__version__},
                "images": rows}
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(path), "sha256": digest(path), "normal": 1200, "negative": 300, "invalid": 200}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("output/card-rectification/dataset"))
    generate(parser.parse_args().output)
