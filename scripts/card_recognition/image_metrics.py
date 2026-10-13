"""Fixed image metrics and same-source oracle reference, without real photos."""

import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import skimage
from skimage.metrics import structural_similarity


def metrics(reference, result):
    if reference.shape != result.shape:
        raise ValueError("Image size mismatch; resizing is prohibited")
    mse = float(np.mean((reference.astype(np.float64) - result.astype(np.float64)) ** 2))
    return {"ssim": float(structural_similarity(reference, result, data_range=255, channel_axis=-1,
                 gaussian_weights=True, sigma=1.5, win_size=11, use_sample_covariance=False, K1=0.01, K2=0.03)),
            "psnrDb": "Infinity" if mse == 0 else 10 * math.log10(255 ** 2 / mse)}


def self_test():
    a = np.full((32, 32, 3), 128, np.uint8)
    same = metrics(a, a)
    shifted = metrics(a, np.full_like(a, 129))
    assert same == {"ssim": 1.0, "psnrDb": "Infinity"}
    assert abs(shifted["psnrDb"] - 20 * math.log10(255)) < 1e-10
    try:
        metrics(a, a[:16])
    except ValueError:
        pass
    else:
        raise AssertionError("Size mismatch was hidden")
    return {"status": "PASS", "identity": same, "oneLevelError": shifted, "sizeMismatch": "rejected"}


def evaluate(dataset, run):
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    images = {r["imageId"]: r for r in manifest["images"]}
    rows = [json.loads(line) for line in (run / "measurements.jsonl").read_text().splitlines()]
    output = []
    for row in rows:
        if row["detectorId"] != "oracle-corners" or row["split"] != "holdout":
            continue
        sample = images[row["imageId"]]
        if not row["outputFile"]:
            output.append({"imageId": row["imageId"], "status": "FAIL", "reason": "no-jpeg"})
            continue
        result = np.array(Image.open(run / row["outputFile"]).convert("RGB"))
        source = np.array(Image.open(dataset / sample["file"]).convert("RGB"))
        h, w = result.shape[:2]
        # The oracle path changes only boundary selection, retaining legacy estimated sizing.
        # Match the legacy cyclic starting corner to avoid a content rotation comparison.
        corners = np.array(sample["corners"], np.float32)
        predicted = np.array([[p["x"], p["y"]] for p in row["measurement"]["corners"]], np.float32)
        variants = [np.roll(corners, shift, axis=0) for shift in range(4)]
        truth = min(variants, key=lambda points: np.sum((points - predicted) ** 2))
        transform = cv2.getPerspectiveTransform(truth, np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], np.float32))
        reference = cv2.warpPerspective(source, transform, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # Same decoder/ICC path: official OpenCV warp then JPEG encode once at fixed 0.94.
        # OpenCV expects BGR for encode; Pillow decodes both reference and browser result.
        success, encoded = cv2.imencode(".jpg", cv2.cvtColor(reference, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 94])
        assert success
        reference_path = run / f"{row['imageId']}-reference.jpg"
        reference_path.write_bytes(encoded.tobytes())
        decoded = np.array(Image.open(reference_path).convert("RGB"))
        full = metrics(decoded, result)
        regions = []
        for region in sample["requiredRegions"]:
            polygon = cv2.perspectiveTransform(np.array([region["polygon"]], np.float32), transform)[0]
            lo = np.floor(polygon.min(axis=0)).astype(int) - 5
            hi = np.ceil(polygon.max(axis=0)).astype(int) + 5
            x0, y0 = max(0, lo[0]), max(0, lo[1])
            x1, y1 = min(w, hi[0]), min(h, hi[1])
            regions.append({"id": region["id"], **metrics(decoded[y0:y1, x0:x1], result[y0:y1, x0:x1])})
        passed = full["ssim"] >= 0.990 and (full["psnrDb"] == "Infinity" or full["psnrDb"] >= 38) and all(r["ssim"] >= 0.980 for r in regions)
        output.append({"imageId": row["imageId"], "status": "PASS" if passed else "FAIL", **full, "regions": regions,
                       "referenceSha256": hashlib.sha256(reference_path.read_bytes()).hexdigest(),
                       "aspectSource": "estimated", "comparison": "same-source same-output-size JPEG", "alignmentPixels": [0, 0]})
    summary = {"metricSelfTest": self_test(), "tools": {"opencv": cv2.__version__, "numpy": np.__version__,
               "skimage": skimage.__version__, "decoder": f"Pillow {Image.__version__}", "icc": "RGB synthetic, no ICC profile"},
               "evaluated": len(output), "passed": sum(r["status"] == "PASS" for r in output),
               "status": "NOT_RUN" if not output else "PASS" if all(r["status"] == "PASS" for r in output) else "FAIL",
               "aspectQuality": "NOT_RUN: baseline estimated ratio is not measured ratio",
               "colorDeltaE00": "NOT_RUN: no predeclared flat color ROIs in v1 dataset"}
    (run / "image-metrics.jsonl").write_text("\n".join(json.dumps(r) for r in output) + "\n", encoding="utf-8")
    (run / "image-metrics-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--dataset", type=Path, default=Path("output/card-rectification/dataset"))
    parser.add_argument("--run", type=Path, default=Path("output/card-rectification/phase1"))
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()))
    else:
        evaluate(args.dataset, args.run)
