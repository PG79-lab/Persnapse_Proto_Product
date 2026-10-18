import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(
  "output/card-rectification/optimization-quality-2026-10-13",
);
const { rows } = JSON.parse(await readFile(resolve(root, "rows.json"), "utf8"));
const summary = JSON.parse(
  await readFile(resolve(root, "summary.json"), "utf8"),
);
let ui = null,
  ocr = null;
try {
  ui = JSON.parse(
    await readFile(resolve(root, "rotation-ui-summary.json"), "utf8"),
  );
} catch {}
try {
  ocr = JSON.parse(await readFile(resolve(root, "ocr-live.json"), "utf8"));
} catch {}
const esc = (s) =>
  String(s).replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
  );
const polygon = (points, color) =>
  points
    ? `<polygon points="${points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="6"/>`
    : "";
const html = `<!doctype html><meta charset="utf-8"><title>LC100 20분 개선 검증</title><style>body{font:16px sans-serif;max-width:1200px;margin:30px auto}article{border-top:1px solid #ccc;padding:20px}img{max-width:45%;max-height:600px;object-fit:contain;vertical-align:top}.source{position:relative;display:inline-block;width:45%;vertical-align:top}.source img{width:100%;max-width:100%;max-height:none;display:block}.source svg{position:absolute;inset:0;width:100%;height:100%}pre{white-space:pre-wrap}</style><h1>LC100 속도·기울기·회전 탐색</h1><p>녹색: 감지 테두리 / 파란색: 잠정 정답. 단일 작성자의 대략적 GT이며 정식 품질 평가가 아닙니다.</p><pre>${esc(JSON.stringify(summary, null, 2))}</pre><h2>회전 UI → Mock OCR 전달</h2><pre>${esc(JSON.stringify(ui, null, 2))}</pre><h2>실제 OCR 전후</h2><pre>${esc(JSON.stringify(ocr ? { ...ocr, rows: ocr.rows.map(({ payload, ...r }) => ({ ...r, identity: payload.draft?.identity })) } : "NOT_RUN", null, 2))}</pre>${rows.map((r) => `<article><h2>${esc(r.imageId)} · ${r.angle}° · ${r.manual ? "수동" : "자동"}</h2><div class="source"><img src="${r.source}" alt="입력 ${esc(r.imageId)}">${r.width ? `<svg viewBox="0 0 ${r.width} ${r.height}">${polygon(r.points, "#00e676")}${polygon(r.truth, "#2299ff")}</svg>` : ""}</div>${r.output ? `<img src="${r.output}" alt="보정 ${esc(r.imageId)}">` : "<p>보정 미실행</p>"}<pre>${esc(JSON.stringify(r.metrics ?? {}, null, 2))}</pre></article>`).join("")}`;
await writeFile(resolve(root, "comparison.html"), html);
console.log(`Offline comparison: ${rows.length} cases`);
