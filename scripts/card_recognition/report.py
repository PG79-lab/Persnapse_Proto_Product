"""Summarize all paths, preserving failures and denominators. No private text."""

import csv
import html
import json
import math
from pathlib import Path


def percentile(values, q):
    return sorted(values)[math.ceil(q * len(values)) - 1] if values else None


def summarize(rows):
    normal = [r for r in rows if r["kind"] == "normal"]
    valid = [r["metrics"] for r in normal if r["metrics"]["valid"]]
    return {"inputs": len(rows), "normal": len(normal),
            "success": sum(r["metrics"]["success"] for r in normal),
            "missing": len(normal) - len(valid),
            "Emean": sum(r["meanErrorPercent"] for r in valid) / len(valid) if valid else None,
            "EmeanP95": percentile([r["meanErrorPercent"] for r in valid], 0.95),
            "EmaxP95": percentile([r["maxErrorPercent"] for r in valid], 0.95),
            "EmaxWorst": max((r["maxErrorPercent"] for r in valid), default=None),
            "IoUmedian": percentile([r["metrics"]["iou"] for r in normal], 0.5),
            "IoUp5": percentile([r["metrics"]["iou"] for r in normal], 0.05),
            "clippedCandidates": sum(r["measurement"]["kind"] == "restored" and any(p["preservation"] < 0.999 for p in r["printedRegions"]) for r in normal),
            "falseNormal": sum(r["kind"] != "normal" and r["measurement"]["kind"] == "restored" for r in rows),
            "errors": sum(r["measurement"]["kind"] == "error" for r in rows),
            "p50ms": percentile([r["measurement"]["totalMs"] for r in rows], 0.5),
            "p95ms": percentile([r["measurement"]["totalMs"] for r in rows], 0.95),
            "p99ms": percentile([r["measurement"]["totalMs"] for r in rows], 0.99)}


def main():
    root = Path("output/card-rectification/phase1")
    rows = [json.loads(line) for line in (root / "measurements.jsonl").read_text().splitlines()]
    validation = json.loads((root / "dataset-validation.json").read_text())
    labels = json.loads((root / "dataset-label-validation.json").read_text())
    image_metrics = json.loads((root / "image-metrics-summary.json").read_text())
    groups = []
    for detector in ["legacy", "oracle-corners"]:
        for split in ["development", "tuning", "holdout"]:
            group = [r for r in rows if r["detectorId"] == detector and r["split"] == split]
            groups.append({"detector": detector, "split": split, "condition": "all", **summarize(group)})
            for tag in sorted({tag for row in group for tag in row["tags"]}):
                groups.append({"detector": detector, "split": split, "condition": tag,
                               **summarize([r for r in group if tag in r["tags"]])})
    incomplete = len({r["imageId"] for r in rows}) != 1700 or sum(r["detectorId"] == "oracle-corners" for r in rows) != 1200
    stage1 = "FAIL" if validation["status"] != "PASS" or labels["status"] != "PASS" or image_metrics["metricSelfTest"]["status"] != "PASS" else "INSUFFICIENT_DATA" if incomplete else "PASS"
    report = {"stage1": stage1, "dataset": validation, "labels": labels, "imageMetrics": image_metrics, "groups": groups,
              "stages": [{"stage": 1, "status": stage1, "scope": "data and baseline preparation only"},
                         {"stage": 2, "status": "NOT_RUN", "reason": "T8/LC100 integrity, 30 CPU/WASM tensors per model, 30 preprocessing patterns and analytic postprocessing verified; model-output official corners, DocQuad and mobiles pending"},
                         {"stage": 3, "status": "NOT_RUN", "reason": "new rectifier and geometry gates not implemented"},
                         {"stage": 4, "status": "NOT_RUN", "reason": "source selection and revision guards integrated; full UI/OCR benchmarks pending"},
                         {"stage": 5, "status": "NOT_RUN", "reason": "v2 storage not implemented"},
                         {"stage": 6, "status": "INSUFFICIENT_DATA", "reason": "real photos and reference mobile devices pending"}],
              "worstQuality": sorted([r for r in rows if r["kind"] == "normal" and r["detectorId"] == "legacy"],
                                     key=lambda r: r["metrics"]["iou"])[:10],
              "slowest": sorted(rows, key=lambda r: r["measurement"]["totalMs"], reverse=True)[:10],
              "interpretation": "Baseline timings include local file fetch, result serialization and shared runtime; not warm/cold performance gates. Oracle corners retain estimated aspect. All outcomes retained. No live OCR/DB/AI.",
              "confidence": "No final-model confidence inference; synthetic scenes are not real false-positive samples. Card paired bootstrap belongs to candidate comparison, NOT_RUN."}
    (root / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (root / "conditions.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(groups[0]))
        writer.writeheader()
        writer.writerows(groups)
    columns = list(groups[0])
    table = "<table><thead><tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in columns) + "</tr></thead><tbody>"
    for group in groups:
        table += "<tr>" + "".join(f"<td>{html.escape(str(group[c]))}</td>" for c in columns) + "</tr>"
    table += "</tbody></table>"
    (root / "report.html").write_text("<!doctype html><meta charset='utf-8'><title>Card boundary phase 1</title>"
        "<style>body{font:14px system-ui;margin:30px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}"
        "pre{white-space:pre-wrap}img{width:400px;max-width:100%}</style>"
        f"<h1>Phase 1: {stage1}</h1><p>{html.escape(report['interpretation'])}</p>"
        + table + "<h2>Image metric configuration and result</h2><pre>" + html.escape(json.dumps(image_metrics, indent=2)) + "</pre>"
        + "<h2>Worst boundary results</h2>" + "".join(f"<p>{r['imageId']} IoU={r['metrics']['iou']}</p><img src='../dataset/{r['imageId'].replace('design', 'images/design')}.png' alt='synthetic input'>" for r in report["worstQuality"])
        + "<h2>Slowest 10 paths</h2><pre>" + html.escape(json.dumps([{ "imageId":r["imageId"],"detector":r["detectorId"],"totalMs":r["measurement"]["totalMs"]} for r in report["slowest"]],indent=2)) + "</pre>", encoding="utf-8")
    print(json.dumps({"stage1": stage1, "recordedPaths": len(rows), "report": str(root / "report.html")}))
    if stage1 != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
