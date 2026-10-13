"""Export the measured pilot as one offline HTML, without changing measurements."""
import base64
import io
import json
import re
from pathlib import Path

from PIL import Image

root = Path("output/card-rectification/real-pilot")
html = (root / "report.html").read_text(encoding="utf-8")
match = re.search(r"<script>const DATA=(.*?);</script>", html, re.S)
if not match:
    raise ValueError("Generate card:report-photos first")
data = json.loads(match.group(1))
engine_order = ["docaligner-lc100", "docaligner-t8", "legacy"]
data["summary"]["summaries"].sort(key=lambda row: engine_order.index(row["engine"]))
for image in data["images"]:
    # Retain the measured pixel dimensions; only the embedded display is JPEG.
    with Image.open(root / image["file"]) as source:
        buffer = io.BytesIO()
        source.convert("RGB").save(buffer, format="JPEG", quality=92)
    image["file"] = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()
data["initialLabels"] = {}
if (root / "labels.json").exists():
    saved = json.loads((root / "labels.json").read_text(encoding="utf-8"))
    if saved.get("photoManifestSha256") != data["manifestSha256"]:
        raise ValueError("Saved labels belong to another input manifest")
    data["initialLabels"] = saved["labels"]
encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
html = html[:match.start()] + "<script>const DATA=" + encoded + ";</script>" + html[match.end():]
html = html.replace('<script src="report-metrics.js"></script>', "<script>" + (root / "report-metrics.js").read_text(encoding="utf-8") + "</script>")
html = html.replace('const engines = ["legacy", "docaligner-t8", "docaligner-lc100"];', 'const engines = ["docaligner-lc100", "docaligner-t8", "legacy"];')
html = html.replace('"docaligner-lc100": "DocAligner LC100"', '"docaligner-lc100": "DocAligner LC100 (선택 모델)"')
html = html.replace("let labels = {},", "let labels = DATA.initialLabels,")
html = html.replace("<h1>실제 명함 외곽 검출 비교</h1>", "<h1>명함 외곽 검증 · LC100 선택</h1><p>단일 HTML · 인터넷/서버 없이 사용 · 표시 사진은 동일 해상도 JPEG이며 측정값은 기존 PNG 기준입니다. 편집 결과는 JSON 다운로드로 보관하세요.</p>")
for filename, mime in [("measurements.csv", "text/csv;charset=utf-8"), ("summary.json", "application/json")]:
    uri = "data:" + mime + ";base64," + base64.b64encode((root / filename).read_bytes()).decode()
    html = html.replace('href="' + filename + '" download', 'href="' + uri + '" download="' + filename + '"')
html = html.replace('href="overlays/${row.engine}-${image.imageId}.png" download', 'href="#" data-overlay="${row.engine}" data-image="${image.imageId}"')
start = html.index('      document.querySelector("#save").onclick = async () => {')
end = html.index('      document.querySelector("#import").onchange', start)
html = html[:start] + '''
      function downloadFile(blob, name) {
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      document.querySelector("#save").textContent = "정답·평가 JSON 다운로드";
      document.querySelector("#save").onclick = () => {
        const evaluation = DATA.rows.map(row => ({imageId:row.imageId, engine:row.engine,
          metrics:metric(row, DATA.images.find(i => i.imageId === row.imageId))}));
        downloadFile(new Blob([JSON.stringify({...payload(), evaluation,
          quality: evaluation.some(r => r.metrics) ? "PROVISIONAL_SINGLE_REVIEW" : "NOT_RUN",
          summaryText:document.querySelector("#quality").textContent}, null, 2)],
          {type:"application/json"}), "card-labels-and-evaluation.json");
        document.querySelector("#save-status").textContent = "다운로드한 JSON을 보관하세요. 다시 열 때 불러올 수 있습니다.";
      };
      document.querySelector("#photos").addEventListener("click", async event => {
        const link = event.target.closest("a[data-overlay]");
        if (!link) return;
        event.preventDefault();
        const image = DATA.images.find(i => i.imageId === link.dataset.image);
        const row = DATA.rows.find(r => r.imageId === image.imageId && r.engine === link.dataset.overlay);
        const img = new Image(); img.src = image.file; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const points = row.normalizedCorners ? pixelPoints(row.normalizedCorners,image) : row.points;
        ctx.strokeStyle = row.validQuad ? "#00e676" : "#ff5252"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 6;
        if (points.length) {
          ctx.beginPath(); ctx.moveTo(points[0].x,points[0].y);
          points.slice(1).forEach(p => ctx.lineTo(p.x,p.y));
          if (row.validQuad) ctx.closePath(); ctx.stroke();
          points.forEach(p => {ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.fill();});
        }
        canvas.toBlob(blob => downloadFile(blob,`${row.engine}-${image.imageId}.png`),"image/png");
      });
''' + html[end:]
start = html.index('      fetch("/labels.json")')
end = html.index('      render();', html.index('        .catch(() => {});', start))
html = html[:start] + html[end:]
target = root / "card-boundary-comparison-LC100-2026-10-13.html"
target.write_text(html, encoding="utf-8")
print(json.dumps({"file": str(target.resolve()), "bytes": target.stat().st_size, "images": len(data["images"]), "rows": len(data["rows"])}, ensure_ascii=False))
