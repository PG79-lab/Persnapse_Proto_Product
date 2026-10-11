// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => JSON.stringify({ token: "synthetic-cli-token" })),
}));
import {
  createVercelCommand,
  createSanitizedVercelEnvironment,
  createVercelCurlEnvironment,
} from "./vercel-cli-environment.mjs";
afterEach(() => vi.unstubAllEnvs());
describe("Vercel CLI configuration boundary", () => {
  it("does not forward global config or a credential to native curl arguments", () => {
    vi.stubEnv("PERSNAPSE_VERCEL_CONFIG_DIR", "synthetic-config");
    vi.stubEnv("PERSNAPSE_VERCEL_CLI_PATH", "synthetic-cli.js");
    const command = createVercelCommand([
      "curl",
      "/api/workspace",
      "--deployment",
      "https://synthetic.vercel.app",
      "--",
      "--silent",
    ]);
    expect(command.arguments).not.toContain("--global-config");
    expect(command.arguments).not.toContain("synthetic-cli-token");
    expect(command.arguments[1]).toBe("curl");
  });
  it("retains explicit global configuration for ordinary project checks", () => {
    vi.stubEnv("PERSNAPSE_VERCEL_CONFIG_DIR", "synthetic-config");
    vi.stubEnv("PERSNAPSE_VERCEL_CLI_PATH", "synthetic-cli.js");
    expect(createVercelCommand(["api", "/v9/projects"]).arguments).toEqual([
      "synthetic-cli.js",
      "--global-config",
      "synthetic-config",
      "api",
      "/v9/projects",
    ]);
  });
  it("passes only configured CLI auth to curl and strips unrelated application secrets", () => {
    vi.stubEnv("PERSNAPSE_VERCEL_CONFIG_DIR", "synthetic-config");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("DATABASE_URL", "synthetic-database-url");
    vi.stubEnv("VERCEL_TOKEN", "unreviewed-inherited-token");
    expect(createSanitizedVercelEnvironment().VERCEL_TOKEN).toBeUndefined();
    const env = createVercelCurlEnvironment();
    expect(env.VERCEL_TOKEN).toBe("synthetic-cli-token");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
