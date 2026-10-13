"""Summarize the integrated UI pilot and export original/rectified comparisons."""
import base64
import html
import io
import json
import math
import re
from pathlib import Path

from PIL import Image

root = Path("output/card-rectification/real-pilot")
output = root / "pipeline-2026-10-13"
rows = json.loads((output / "rows.json").read_text(encoding="utf-8"))
summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
images = json.loads((root / "photos.json").read_text(encoding="utf-8"))["images"]
if len(rows) != len(images):
    raise ValueError("The integrated pilot must finish before generating the report")
for row in rows:
    row["timingValues"] = {key: float(value) for key, value in re.findall(r"(\w+): ([\d.]+)ms", row.get("timings", ""))}

def percentile(values, q):
    return sorted(values)[math.ceil(len(values) * q) - 1] if values else None

summary["successfulImageStageMs"] = {}
for stage in ["modelLoadMs", "decodeMs", "preprocessMs", "inferenceMs", "postprocessMs", "warpEncodeMs", "totalMs"]:
    values = [row["timingValues"][stage] for row in rows if row["detected"]]
    summary["successfulImageStageMs"][stage] = {"p50": percentile(values, .5), "p95": percentile(values, .95)}
summary["timingScope"] = "23 valid images only; new browser/worker per photo; model and OpenCV load included; excludes OCR and upload; PC pilot, not mobile acceptance"
(output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
(output / "rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

def image_uri(path):
    with Image.open(path) as image:
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()

panels = []
for row in rows:
    image = next(image for image in images if image["imageId"] == row["imageId"])
    crop = output / (row["imageId"] + "-rectified.jpg")
    preview = f'<img src="{image_uri(crop)}" alt="2D 보정 이미지">' if row["detected"] else '<p>자동 보정 없음 · 수동 네 점 지정 필요</p>'
    panels.append(f'<article><h2>{row["imageId"]} · {"자동 감지/보정 및 Mock OCR 전달 PASS" if row["detected"] else "수동 보정 필요"}</h2><p>{html.escape(row.get("timings", ""))}</p><div class="pair"><figure><figcaption>방향 보정된 촬영 원본</figcaption><img src="{image_uri(root / image["file"])}" alt="촬영 원본"></figure><figure><figcaption>원근 보정된 2D 명함</figcaption>{preview}</figure></div></article>')
report = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LC100 통합 명함 파이프라인 결과</title><style>body{font:15px/1.6 system-ui;margin:0;background:#f5f6fa;color:#182336}main{max-width:1300px;margin:auto;padding:24px}article{background:white;border:1px solid #dde2ed;border-radius:18px;padding:20px;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;text-align:center}img{max-width:100%;max-height:650px;object-fit:contain}pre{white-space:pre-wrap}h2{font-size:19px}@media(max-width:650px){.pair{grid-template-columns:1fr}}</style><main><h1>LC100 → 원근 보정 → 2D 명함 → OCR 입력</h1><p>실제 사진 27장 · 실제 LC100/warp · OCR은 Mock 전달 시험 · 외부 OCR 호출 0회. 이름·전화번호의 실제 OCR 정확도는 NOT_RUN입니다. 비율은 추정이며 글자 방향은 자동 회전하지 않습니다. 사진별 독립 브라우저/Worker, 모델 및 OpenCV 로드 포함 PC 파일럿으로 모바일 성능 통과를 의미하지 않습니다.</p>'''
report += '<pre>' + html.escape(json.dumps(summary, ensure_ascii=False, indent=2)) + '</pre>' + "".join(panels) + "</main></html>"
target = output / "pipeline-comparison.html"
target.write_text(report, encoding="utf-8")
print(json.dumps({"report": str(target.resolve()), "summary": summary}, ensure_ascii=False))
