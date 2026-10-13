"""Decode and label checks in addition to the Node manifest/hash validator."""

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def validate(root):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    errors = []
    decoded = 0
    rejected_invalid_files = 0
    for row in manifest["images"]:
        path = root / row["file"]
        try:
            image = Image.open(path)
            image.load()
            decoded += 1
            if image.size != (row["width"], row["height"]):
                errors.append(f"dimensions:{row['imageId']}")
        except (OSError, ValueError):
            if row["kind"] == "invalid" and row["tags"][0] in ["unsupported-format", "truncated-image"]:
                rejected_invalid_files += 1
                continue
            errors.append(f"decode:{row['imageId']}")
            continue
        if row["kind"] != "normal":
            continue
        points = np.array(row["corners"], np.float64)
        edges = np.roll(points, -1, axis=0) - points
        following = np.roll(edges, -1, axis=0)
        crosses = edges[:, 0] * following[:, 1] - edges[:, 1] * following[:, 0]
        if not np.isfinite(points).all() or not (crosses > 0).all() or not (points >= 0).all() or not (points <= [row["width"]-1, row["height"]-1]).all():
            errors.append(f"geometry:{row['imageId']}")
        if not 0.25 < row["actualRatio"] < 4:
            errors.append(f"ratio:{row['imageId']}")
        matrix = np.array(row["homography"], np.float64)
        cw, ch = row["designSize"]
        design = np.array([[[0, 0], [cw-1, 0], [cw-1, ch-1], [0, ch-1]]], np.float64)
        projected = cv2.perspectiveTransform(design, matrix)[0]
        # OpenCV's solve takes float32 correspondences. Its measured maximum
        # projection residual is 1.083e-5px; 1e-4px is still far below 0.25px.
        if np.max(np.abs(projected-points)) > 1e-4:
            errors.append(f"homography:{row['imageId']}")
        for region in row["requiredRegions"]:
            mask = Image.open(root / region["mask"])
            if mask.size != image.size or not np.array(mask).any():
                errors.append(f"mask:{row['imageId']}:{region['id']}")
    report = {"status": "FAIL" if errors else "PASS", "decoded": decoded,
              "expectedInvalidFilesRejected": rejected_invalid_files, "errors": errors,
              "manifestSha256": hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()}
    target = Path("output/card-rectification/phase1/dataset-label-validation.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    validate(Path("output/card-rectification/dataset"))
