import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const here = dirname(fileURLToPath(import.meta.url));
const original = await readFile(resolve(here, "report-source.txt"), "utf8");
const lines = original.replace(/\r\n/g, "\n").split("\n");
const screenCatalog = JSON.parse(
  await readFile(resolve(here, "screenshots.json"), "utf8"),
);
const screenshots = [];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const expected = [],
  sourceLinks = [],
  figures = [],
  sections = [];
const shortTitles = [
  "조사 기준·저장소",
  "제품 개념·현재 기능",
  "전체 구조·기술 스택",
  "프론트·상태 저장",
  "데이터 모델·저장 원칙",
  "텍스트·명함 파이프라인",
  "Recall·AI 어시스턴트",
  "관계 지도·음성",
  "주요 API",
  "환경·배포·운영",
  "개발 이력·검증",
  "혼동 지점·남은 작업",
];
function inline(value) {
  const tokens = [];
  const hold = (html) => "\uE000" + (tokens.push(html) - 1) + "\uE001";
  let s = value.replace(/`([^`]+)`/g, (_, v) =>
    hold("<code>" + esc(v) + "</code>"),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    let href = url;
    const prefix = "D:/Persnapse/persnapse-mvp/";
    if (href.startsWith(prefix)) {
      href = "../../" + href.slice(prefix.length);
      sourceLinks.push(href);
    } else if (!/^https:\/\//.test(href)) return label;
    return hold(
      `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`,
    );
  });
  s = esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return s.replace(/\uE000(\d+)\uE001/g, (_, n) => tokens[n]);
}
function plain(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
async function screenFigure(screen) {
  const bytes = await readFile(resolve(here, "screenshots", screen.file));
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  const url = new URL(screen.route, screenCatalog.deployment).href;
  screenshots.push({
    ...screen,
    url,
    width,
    height,
    capturedOn: screenCatalog.capturedOn,
    dataMode: screenCatalog.dataMode,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  return `<figure class="screen-figure" id="screen-${esc(screen.id)}"><button class="figure-open" data-image-open aria-label="${esc(screen.title)} 화면 크게 보기"><img src="data:image/png;base64,${bytes.toString("base64")}" width="${width}" height="${height}" alt="${esc(screen.title)} 합성 데이터 예시 화면" loading="lazy"></button><figcaption><div class="screen-caption-row"><strong>${esc(screen.title)}</strong><a class="screen-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(screen.linkLabel || "기능 화면 열기 ↗")}</a></div><span class="screen-description">${esc(screen.caption)}</span>${screen.entry ? `<span class="screen-entry">진입: ${esc(screen.entry)}</span>` : ""}</figcaption></figure>`;
}
function wrap(s, budget = 16) {
  const out = [];
  const measure = (value) =>
    [...value].reduce(
      (total, ch) =>
        total + (/\s/.test(ch) ? 0.35 : /[\u0000-\u007f]/.test(ch) ? 0.55 : 1),
      0,
    );
  let line = "";
  for (const word of s.split(/\s+/)) {
    const candidate = line ? line + " " + word : word;
    if (line && measure(candidate) > budget) {
      out.push(line);
      line = word;
    } else line = candidate;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
function svg(width, height, nodes, edges) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font-family:'Segoe UI','Malgun Gothic',Arial,sans-serif;fill:#233e53}.box{fill:#f5f8fa;stroke:#8da6b8;stroke-width:1.2}.edge{fill:none;stroke:#738b9d;stroke-width:1.6}.label{font-size:20px;font-weight:600}.sub{font-size:17px;fill:#526d80}.number{font-size:12px;fill:#6c8394}</style><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><polygon points="0,0 7,4 0,8" fill="#738b9d"/></marker></defs>${edges.map((points) => `<polyline class="edge" points="${points.map((p) => p.join(",")).join(" ")}" marker-end="url(#arrow)"/>`).join("")}${nodes
    .map((n) => {
      const rows = wrap(n.title, n.budget || 13),
        font = n.font || 20,
        dy = font + 6,
        first = n.sub
          ? rows.length === 1
            ? 37
            : 28
          : n.h / 2 - ((rows.length - 1) * dy) / 2 + font * 0.35;
      return `<g transform="translate(${n.x},${n.y})"><rect class="box" width="${n.w}" height="${n.h}"/>${n.number ? `<text class="number" x="12" y="20">${n.number}</text>` : ""}<text class="label" style="font-size:${font}px" text-anchor="middle" x="${n.w / 2}" y="${first}">${rows.map((row, i) => `<tspan x="${n.w / 2}" dy="${i ? dy : 0}">${esc(row)}</tspan>`).join("")}</text>${n.sub ? `<text class="sub" text-anchor="middle" x="${n.w / 2}" y="${n.h - 18}">${esc(n.sub)}</text>` : ""}</g>`;
    })
    .join("")}</svg>`;
}
function architecture(source) {
  const names = Object.fromEntries(
    [...source.matchAll(/^\s*(\w+)\["([^"\n]+)"\]/gm)].map((m) => [
      m[1],
      m[2].split(/<br\s*\/?>/),
    ]),
  );
  const positions = {
    UI: [500, 20],
    CARD: [20, 190],
    AUDIO: [340, 190],
    API: [660, 190],
    APP: [660, 350],
    WORKER: [980, 350],
    DOMAIN: [20, 550],
    STORAGE: [340, 550],
    DB: [660, 550],
    AI: [980, 550],
    VECTOR: [660, 700],
  };
  const nodes = Object.entries(names).map(([id, [title, sub]]) => ({
    id,
    title,
    sub,
    budget: 14,
    ...{ x: positions[id][0], y: positions[id][1], w: 280, h: 100 },
  }));
  const edges = [
    [
      [540, 120],
      [540, 155],
      [160, 155],
      [160, 190],
    ],
    [
      [640, 120],
      [640, 175],
      [480, 175],
      [480, 190],
    ],
    [
      [740, 120],
      [740, 155],
      [800, 155],
      [800, 190],
    ],
    [
      [800, 290],
      [800, 350],
    ],
    [
      [690, 450],
      [690, 480],
      [160, 480],
      [160, 550],
    ],
    [
      [750, 450],
      [750, 505],
      [480, 505],
      [480, 550],
    ],
    [
      [810, 450],
      [810, 550],
    ],
    [
      [900, 450],
      [900, 480],
      [1030, 480],
      [1030, 550],
    ],
    [
      [1070, 450],
      [1070, 525],
      [920, 525],
      [920, 550],
    ],
    [
      [1200, 450],
      [1200, 550],
    ],
    [
      [800, 650],
      [800, 700],
    ],
  ];
  return {
    body: svg(1280, 820, nodes, edges),
    text: nodes.map((n) => n.title + (n.sub ? " — " + n.sub : "")).join("\n"),
  };
}
function pipeline(source) {
  const steps = source
    .split("\n")
    .map((l) => l.trim().replace(/^→\s*/, ""))
    .filter((l) => l && l !== "↓");
  const cols = 3,
    w = 920,
    cellW = 300,
    cellH = 132;
  const nodes = steps.map((title, i) => {
    const row = Math.floor(i / cols),
      col = row % 2 ? cols - 1 - (i % cols) : i % cols;
    return {
      id: "n" + i,
      title,
      x: 20 + col * cellW,
      y: 20 + row * cellH,
      w: 260,
      h: 92,
      font: 17,
      budget: 14,
      number: String(i + 1).padStart(2, "0"),
    };
  });
  const edges = nodes.slice(1).map((b, i) => {
    const a = nodes[i];
    if (a.y === b.y) {
      const right = b.x > a.x;
      return [
        [right ? a.x + a.w : a.x, a.y + a.h / 2],
        [right ? b.x : b.x + b.w, b.y + b.h / 2],
      ];
    }
    return [
      [a.x + a.w / 2, a.y + a.h],
      [b.x + b.w / 2, b.y],
    ];
  });
  return {
    body: svg(w, Math.ceil(steps.length / cols) * cellH, nodes, edges),
    text: source,
  };
}
await mkdir(resolve(here, "figures"), { recursive: true });
async function figure(name, caption, source, isArchitecture = false) {
  const { body, text } = isArchitecture
    ? architecture(source)
    : pipeline(source);
  await writeFile(resolve(here, "figures", name + ".svg"), body);
  const number = figures.length + 1;
  figures.push({ name, caption, text });
  const encoded = Buffer.from(body).toString("base64");
  return `<figure><button class="figure-open" data-image-open aria-label="${esc(caption)} 크게 보기"><img src="data:image/svg+xml;base64,${encoded}" alt="${esc(caption)}" loading="lazy"></button><figcaption>그림 ${number}. ${esc(caption)} <span>그림을 누르면 원본 크기로 볼 수 있습니다.</span></figcaption><details class="figure-text"><summary>그림 내용을 텍스트로 보기</summary><pre>${esc(text)}</pre></details></figure>`;
}
let html = "",
  i = 0,
  sectionOpen = false,
  paragraphs = 0,
  tables = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) {
    i++;
    continue;
  }
  const heading = line.match(/^\*\*(\d+)\. (.+)\*\*$/);
  if (heading) {
    if (sectionOpen) html += "</section>";
    const n = Number(heading[1]);
    sections.push({
      id: "section-" + n,
      title: heading[2],
      short: shortTitles[n - 1],
    });
    html += `<section id="section-${n}"><h2><span>${String(n).padStart(2, "0")}</span>${esc(heading[2])}</h2>`;
    expected.push(heading[2]);
    sectionOpen = true;
    i++;
    continue;
  }
  if (line.startsWith("```")) {
    const language = line.slice(3).trim(),
      block = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```"))
      block.push(lines[i++]);
    i++;
    const value = block.join("\n").trim();
    if (language === "mermaid")
      html += await figure(
        "system-architecture",
        "전체 시스템 아키텍처",
        value,
        true,
      );
    else if (value.startsWith("촬영 / 업로드")) {
      html += await figure(
        "card-pipeline",
        "명함 촬영부터 관계 기억 확정까지",
        value,
      );
      expected.push(value);
    } else if (value.startsWith("질문 + 세션")) {
      html += await figure(
        "recall-pipeline",
        "질문에서 근거 기반 답변까지",
        value,
      );
      expected.push(value);
    } else {
      html += `<pre class="flow-text">${esc(value)}</pre>`;
      expected.push(value);
    }
    continue;
  }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      const cells = lines[i]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      i++;
    }
    tables++;
    expected.push(...rows.flat().map(plain));
    html += `<div class="table-wrap"><table><thead><tr>${rows[0].map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
      .slice(1)
      .map(
        (row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`;
    continue;
  }
  if (/^\s*(- |\d+\. )/.test(line)) {
    const ordered = /^\d+\. /.test(line),
      items = [];
    while (
      i < lines.length &&
      new RegExp(ordered ? "^\\d+\\. " : "^- ").test(lines[i])
    ) {
      const item = lines[i++].replace(ordered ? /^\d+\. / : /^- /, "");
      items.push(item);
      expected.push(plain(item));
    }
    const tag = ordered ? "ol" : "ul";
    html += `<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`;
    continue;
  }
  const parts = [line];
  i++;
  while (
    i < lines.length &&
    lines[i].trim() &&
    !/^\*\*\d+\. |^\||^```|^- |^\d+\. /.test(lines[i])
  )
    parts.push(lines[i++]);
  const p = parts.join(" ");
  expected.push(plain(p));
  paragraphs++;
  html += `<p>${inline(p)}</p>`;
  for (const group of screenCatalog.groups.filter((group) => group.after === p))
    for (const screen of group.images) html += await screenFigure(screen);
}
if (sectionOpen) html += "</section>";
if (sections.length !== 12 || figures.length !== 3)
  throw new Error("Unexpected report structure");
if (
  screenshots.length !==
  screenCatalog.groups.flatMap((group) => group.images).length
)
  throw new Error("A screenshot placement does not match the document source");
const css = await readFile(resolve(here, "styles.css"), "utf8"),
  js = await readFile(resolve(here, "app.js"), "utf8");
const page = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Persnapse MVP 최초 조사 보고서 기반 기술 인수인계 문서"><title>Persnapse MVP · 기술 인수인계</title><style>${css}</style></head><body><a href="#report" class="skip">본문으로 이동</a><div class="layout"><aside><a class="doc-name" href="#top">Persnapse MVP<span>기술 인수인계</span></a><details class="toc" open><summary>목차</summary><nav aria-label="문서 목차">${sections.map((s, k) => `<a href="#${s.id}"><span>${String(k + 1).padStart(2, "0")}</span>${s.short}</a>`).join("")}</nav></details><button class="print" data-print>인쇄 / PDF 저장</button></aside><main id="top"><header><p class="eyebrow">개발 인수인계 문서</p><h1>Persnapse MVP</h1><p class="subtitle">시스템 구조 · 처리 파이프라인 · 구현 현황</p><div class="meta"><span>최초 조사 2026.10.24</span><span>소스 기준 <code>main / fa732fa</code></span><span>합성 예시 화면 촬영 ${esc(screenCatalog.capturedOn.replaceAll("-", "."))}</span></div><p class="scope">내용과 수치는 2026년 10월 24일 조사 기준입니다. 구현 상태와 기존 검증 기록을 구분해 정리했습니다. 화면은 개인정보 없는 합성 데이터로 로컬 제품 UI를 촬영했습니다. 기능 링크는 별도 배포 환경을 엽니다. 준비본의 설치·검증 변경은 저장소의 docs/handoff 문서를 참조하세요.</p></header><article id="report">${html}</article><footer>Persnapse MVP · 기술 인수인계<br><a href="#top">문서 처음으로 ↑</a></footer></main></div><dialog class="image-dialog" aria-label="그림 크게 보기"><div class="image-toolbar"><strong id="image-title">구조도</strong><button data-image-close aria-label="그림 닫기">닫기 ×</button></div><div class="image-scroll"><img alt=""></div><p>가로·세로로 스크롤할 수 있습니다. ESC로 닫습니다.</p></dialog><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await writeFile(resolve(here, "index.html"), page);
const manifest = {
  version: 3,
  sourceSHA256: createHash("sha256").update(original).digest("hex"),
  htmlSHA256: createHash("sha256").update(page).digest("hex"),
  sections,
  paragraphs,
  tables,
  figures: figures.map(({ name, caption }) => ({ name, caption })),
  screenshots,
  sourceLinks: [...new Set(sourceLinks)],
  expected,
};
await writeFile(
  resolve(here, "report-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    sections: sections.length,
    tables,
    figures: figures.length,
    screenshots: screenshots.length,
    bytes: Buffer.byteLength(page),
    sourceSHA256: manifest.sourceSHA256,
  }),
);
