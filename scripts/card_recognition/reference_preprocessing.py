"""Independent NumPy/OpenCV reproduction of pinned DocAligner/Capybara steps."""

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

root = Path("output/card-rectification/phase2/preprocessing")
root.mkdir(parents=True, exist_ok=True)
rows = []
for i in range(30):
    w, h = 37 + i * 11, 29 + i * 7
    x, y = np.meshgrid(np.arange(w), np.arange(h))
    rgb = np.stack([(x * (i % 5 + 1) + y * 2) % 256, (x * 7 + y * (i % 7 + 1)) % 256,
                    (x * 13 + y * 3 + i * 19) % 256], axis=-1).astype(np.uint8)
    rgba = np.concatenate([rgb, np.full((h, w, 1), 255, np.uint8)], axis=-1)
    bgr = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)
    resized = cv2.resize(bgr, (256, 256), interpolation=cv2.INTER_LINEAR)
    tensor = np.transpose(resized, (2, 0, 1)).astype(np.float32)[None] / 255.0
    (root / f"{i}-rgba.bin").write_bytes(rgba.tobytes())
    (root / f"{i}-tensor.f32").write_bytes(tensor.tobytes())
    # Independent reference heatmaps include separated peaks and ties.
    yy, xx = np.mgrid[:128, :128]
    peaks = [(19 + i % 6, 21), (108, 17 + i % 9), (103, 108), (23, 106)]
    heatmap = np.stack([np.exp(-((xx-px)**2+(yy-py)**2)/(2*(2+i % 4)**2)) for px, py in peaks]).astype(np.float32)
    points = []
    for channel in heatmap:
        full = cv2.resize(channel, (w, h), interpolation=cv2.INTER_LINEAR)
        full[full < 0.3] = 0
        mask = np.uint8(full * 255)
        _, mask = cv2.threshold(mask, 0, 255, cv2.THRESH_OTSU | cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = [c for c in contours if len(c) >= 3]
        if contours:
            areas = [cv2.contourArea(c) for c in contours]
            largest = [c for c, a in zip(contours, areas) if a == max(areas)]
            if len(largest) == 1:
                moments = cv2.moments(largest[0])
                points.append({"x": moments["m10"]/(moments["m00"]+1e-5), "y": moments["m01"]/(moments["m00"]+1e-5)})
    (root / f"{i}-heatmap.f32").write_bytes(heatmap.tobytes())
    rows.append({"id": i, "width": w, "height": h, "points": points, "tensorSha256": hashlib.sha256(tensor.tobytes()).hexdigest()})
(root / "manifest.json").write_text(json.dumps({"docalignerCommit": "3275b0f07f8e99d8c01cb0774dea2549be1416b6",
    "capybaraCommit": "85a0d2638f895b39f82965b137320c8aa92c517b", "cv2": cv2.__version__, "patterns": rows}, indent=2), encoding="utf-8")
print(json.dumps({"patterns": len(rows)}))
