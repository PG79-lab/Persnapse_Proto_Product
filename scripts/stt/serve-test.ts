import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { mutationSchema } from "../../src/domain/workspace/contracts";

// Use the isolated production build, leaving the card session's .next untouched.
const root = process.cwd();
const buildDir = resolve(
  readFileSync(
    resolve(root, "output/stt-integration/validation-path.txt"),
    "utf8",
  ).trim(),
);
const withinRoot = relative(root, buildDir);
if (
  !withinRoot ||
  withinRoot.startsWith("..") ||
  isAbsolute(withinRoot) ||
  !existsSync(resolve(buildDir, ".next/BUILD_ID"))
)
  throw new Error(
    "Isolated STT build is missing. See docs/operations/stt-integration-2026-10-13.md.",
  );
const port = 3200;
const backendPort = 3201;
const backend = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(backendPort),
  ],
  { cwd: buildDir, stdio: "inherit", windowsHide: true },
);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:3200");
  const json = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === "/api/business-cards" && req.method === "GET")
    return json(200, []);
  if (
    url.pathname.startsWith("/api/") &&
    !(
      url.pathname === "/api/workspace" &&
      ["GET", "POST"].includes(req.method ?? "")
    ) &&
    url.pathname !== "/api/stt/transcribe" &&
    url.pathname !== "/api/stt/realtime-session"
  )
    return json(405, {
      error:
        "STT 테스트에서는 인맥 메모 저장과 음성 전사 API만 사용할 수 있습니다.",
    });
  let workspaceBody: Buffer | undefined;
  if (url.pathname === "/api/workspace" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1_000_000)
          return json(413, { error: "메모 요청이 너무 큽니다." });
        chunks.push(Buffer.from(chunk));
      }
      workspaceBody = Buffer.concat(chunks);
      const mutation = mutationSchema.safeParse(
        JSON.parse(workspaceBody.toString("utf8")),
      );
      if (
        !mutation.success ||
        mutation.data.operations.some(
          (operation) => operation.type !== "note.add",
        )
      )
        return json(405, {
          error: "이 테스트 환경에서는 인맥 메모 추가만 저장할 수 있습니다.",
        });
    } catch {
      return json(400, { error: "메모 요청을 읽지 못했습니다." });
    }
  }
  // Preserve the browser Host/Origin so the STT endpoint's same-origin check works.
  const proxy = request(
    {
      hostname: "127.0.0.1",
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent)
      json(503, {
        error: "STT 테스트 서버 준비 중입니다. 잠시 후 새로고침하세요.",
      });
    else res.end();
  });
  req.on("aborted", () => proxy.destroy());
  if (workspaceBody) proxy.end(workspaceBody);
  else req.pipe(proxy);
});
function close() {
  server.close();
  backend.kill();
}
server.on("error", (error) => {
  console.error(error.message);
  close();
  process.exitCode = 1;
});
backend.on("error", (error) => {
  console.error(error.message);
  close();
  process.exitCode = 1;
});
backend.on("exit", (code) => {
  server.close();
  process.exitCode = code ?? 1;
});
process.on("SIGINT", close);
process.on("SIGTERM", close);
server.listen(port, "127.0.0.1", () =>
  console.log(
    "STT TEST: http://127.0.0.1:3200/#recordings (STT live; workspace persistence enabled)",
  ),
);
