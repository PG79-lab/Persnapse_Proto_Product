import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  boundaryMetrics,
  isClockwiseConvex,
  percentile,
} from "../../card_recognition/benchmark-metrics";
import type { CardCorners } from "../../card_recognition/geometry";
import { containedPath, sha256 } from "./dataset";

const root = resolve("output/card-rectification/real-pilot");
const raw = await readFile(resolve(root, "photos.json"));
const manifest = JSON.parse(raw.toString()) as {
  images: {
    imageId: string;
    sourceSha256: string;
    width: number;
    height: number;
  }[];
};
const manifestHash = sha256(raw);
type Label = {
  status: "confirmed" | "unusable";
  sourceSha256: string;
  corners?: CardCorners;
  labelQuality?: string;
};
const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/api/labels" && req.method === "POST") {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 100_000) {
          json(413, { error: "정답 파일이 너무 큽니다." });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString()) as {
        schemaVersion: string;
        photoManifestSha256: string;
        labels: Record<string, Label>;
      };
      if (
        data.schemaVersion !== "real-card-labels-v1" ||
        data.photoManifestSha256 !== manifestHash ||
        !data.labels ||
        Array.isArray(data.labels)
      )
        throw new Error("입력 집합·정답 형식이 다릅니다.");
      for (const [id, label] of Object.entries(data.labels)) {
        const image = manifest.images.find((row) => row.imageId === id);
        if (
          !image ||
          label.sourceSha256 !== image.sourceSha256 ||
          !["confirmed", "unusable"].includes(label.status)
        )
          throw new Error("정답 소스가 다릅니다.");
        if (
          label.status === "confirmed" &&
          (!label.corners ||
            !isClockwiseConvex(label.corners) ||
            label.corners.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1))
        )
          throw new Error("유효한 네 모서리를 지정하세요.");
      }
      await mkdir(resolve(root, "label-history"), { recursive: true });
      const prior = await readFile(resolve(root, "labels.json")).catch(
        () => null,
      );
      if (prior)
        await writeFile(
          resolve(root, "label-history", `${Date.now()}.json`),
          prior,
        );
      // Every browser-supplied label remains a single-pass provisional reference.
      for (const label of Object.values(data.labels))
        label.labelQuality = "single-pass-provisional";
      await writeFile(
        resolve(root, "labels.json"),
        JSON.stringify(data, null, 2),
      );
      const rows = (await readFile(resolve(root, "measurements.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const metrics = rows.flatMap((row) => {
        const label = data.labels[row.imageId];
        if (label?.status !== "confirmed") return [];
        const image = manifest.images.find((i) => i.imageId === row.imageId)!;
        const pixel = (points: CardCorners) =>
          points.map((p) => ({
            x: p.x * image.width,
            y: p.y * image.height,
          })) as CardCorners;
        return [
          {
            imageId: row.imageId,
            engine: row.engine,
            ...boundaryMetrics(
              row.normalizedCorners ? pixel(row.normalizedCorners) : null,
              pixel(label.corners!),
            ),
          },
        ];
      });
      const summaries = ["legacy", "docaligner-lc100", "docaligner-t8"].map(
        (engine) => {
          const values = metrics.filter((row) => row.engine === engine),
            errors = values.flatMap((row) =>
              row.meanErrorPercent === null ? [] : [row.meanErrorPercent],
            );
          return {
            engine,
            evaluated: values.length,
            success: values.filter((v) => v.success).length,
            iouMedian: percentile(
              values.map((v) => v.iou),
              0.5,
            ),
            meanCornerErrorPercent: errors.length
              ? errors.reduce((s, v) => s + v, 0) / errors.length
              : null,
            meanCornerErrorP95: percentile(errors, 0.95),
            missingPredictions: values.filter((v) => !v.valid).length,
          };
        },
      );
      await writeFile(
        resolve(root, "label-evaluation.json"),
        JSON.stringify(
          {
            quality: Object.values(data.labels).some(
              (label) => label.status === "confirmed",
            )
              ? "PROVISIONAL_SINGLE_PASS"
              : "NOT_RUN",
            labelled: Object.values(data.labels).filter(
              (l) => l.status === "confirmed",
            ).length,
            unusable: Object.values(data.labels).filter(
              (l) => l.status === "unusable",
            ).length,
            manifestSha256: manifestHash,
            summaries,
            metrics,
          },
          null,
          2,
        ),
      );
      json(200, { status: "saved", summaries });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(405, { error: "지원하지 않는 요청입니다." });
      return;
    }
    const file = containedPath(
      root,
      decodeURIComponent(path === "/" ? "report.html" : path.slice(1)),
    );
    const buffer = await readFile(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : file.endsWith(".json")
            ? "application/json; charset=utf-8"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".jpg")
                ? "image/jpeg"
                : "text/csv; charset=utf-8",
    );
    res.end(req.method === "HEAD" ? undefined : buffer);
  } catch (error) {
    if (req.method === "POST")
      json(400, {
        error: error instanceof Error ? error.message : "정답 저장 오류",
      });
    else {
      res.statusCode = 404;
      res.end("Not found");
    }
  }
});
server.listen(
  Number(process.env.CARD_PHOTO_REPORT_PORT ?? 3103),
  "127.0.0.1",
  () =>
    console.log(
      "PHOTO REPORT: http://127.0.0.1:3103/ (private local files only)",
    ),
);
