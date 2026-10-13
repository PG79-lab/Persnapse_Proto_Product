import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { emptyWorkspace } from "../../src/features/workspace/store";
import { mockCardApi } from "./mock-card-api";

const port = Number(process.env.CARD_TEST_PORT ?? 3100),
  backendPort = Number(process.env.CARD_TEST_BACKEND_PORT ?? 3101);
if (
  !Number.isInteger(port) ||
  !Number.isInteger(backendPort) ||
  port === backendPort
)
  throw new Error("Invalid local test ports");
const backend = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(backendPort),
  ],
  { stdio: "inherit", windowsHide: true },
);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (await mockCardApi(req, res)) return;
  const json = (status: number, data: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(405, {
      error:
        "로컬 테스트에서는 서버 저장과 외부 AI 호출을 실행하지 않습니다. 명함 외곽·복원 테스트 패널을 사용하세요.",
    });
    return;
  }
  if (url.pathname === "/api/workspace") {
    json(200, {
      state: emptyWorkspace(),
      loadedAt: new Date().toISOString(),
      capabilities: { storage: "server", aiMode: "mock", ocrMode: "mock" },
    });
    return;
  }
  if (url.pathname === "/api/business-cards") {
    json(200, []);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    json(404, { error: "이 API는 로컬 테스트에서 실행하지 않습니다." });
    return;
  }
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
    res.statusCode = 503;
    res.end("Starting local card test server. Refresh shortly.");
  });
  req.pipe(proxy);
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `CARD TEST: http://127.0.0.1:${port}/?cardTest=1#cards (local processing; API writes disabled)`,
  ),
);
function close() {
  server.close();
  backend.kill();
}
server.on("error", (error) => {
  console.error(error);
  close();
  process.exitCode = 1;
});
backend.on("exit", (code) => {
  server.close();
  if (code) process.exitCode = code;
});
process.on("SIGINT", () => {
  close();
  process.exit();
});
process.on("SIGTERM", () => {
  close();
  process.exit();
});
