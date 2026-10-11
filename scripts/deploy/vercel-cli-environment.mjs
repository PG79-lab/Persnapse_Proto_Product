import { readFileSync } from "node:fs";
import { join } from "node:path";

export const vercelCliPackage = "vercel@59.17.0";

export function createVercelCommand(arguments_) {
  // The curl subcommand forwards unknown global flags to native curl.
  // Its already authenticated CLI token is supplied through child env instead.
  const cliArguments =
    process.env.PERSNAPSE_VERCEL_CONFIG_DIR && arguments_[0] !== "curl"
      ? [
          "--global-config",
          process.env.PERSNAPSE_VERCEL_CONFIG_DIR,
          ...arguments_,
        ]
      : arguments_;
  if (process.env.PERSNAPSE_VERCEL_CLI_PATH) {
    return {
      executable: process.execPath,
      arguments: [process.env.PERSNAPSE_VERCEL_CLI_PATH, ...cliArguments],
    };
  }
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return {
      executable: process.execPath,
      arguments: [
        npmCli,
        "exec",
        "--yes",
        `--package=${vercelCliPackage}`,
        "--",
        "vercel",
        ...cliArguments,
      ],
    };
  }

  if (process.platform === "win32") {
    throw new Error(
      "Windows deployment scripts must be started through npm run so npm_execpath is available.",
    );
  }

  return {
    executable: "npx",
    arguments: ["--yes", vercelCliPackage, ...cliArguments],
  };
}

const variablesToRemove = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "CLOVA_OCR_INVOKE_URL",
  "CLOVA_OCR_SECRET",
  "APP_DEFAULT_WORKSPACE_ID",
  "AI_ROUTING_MODE",
  "BUSINESS_CARD_OCR_MODE",
  "BUSINESS_CARD_OCR_PROVIDER",
  "APP_REMOTE_PROTOTYPE_ACCESS",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "OPENAI_TRANSCRIPTION_MODEL",
  "OPENAI_STRUCTURING_MODEL",
  "VOYAGE_EMBEDDING_MODEL",
  "OPENAI_EMBEDDING_FALLBACK_MODEL",
  "VOYAGE_RERANK_MODEL",
  "OPENAI_MAIN_AGENT_MODEL",
  "ANTHROPIC_QUALITY_AGENT_MODEL",
  "OPENAI_QUALITY_BENCHMARK_MODEL",
  "OPENAI_COMPLEX_REASONING_MODEL",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TELEMETRY_DEBUG",
];

export function createSanitizedVercelEnvironment() {
  const environment = { ...process.env };
  for (const name of variablesToRemove) {
    delete environment[name];
  }
  environment.VERCEL_TELEMETRY_DISABLED = "1";
  return environment;
}

export function createVercelCurlEnvironment() {
  const environment = createSanitizedVercelEnvironment();
  const configDir = process.env.PERSNAPSE_VERCEL_CONFIG_DIR;
  if (configDir) {
    // Only the explicit, previously authenticated CLI config is read. Do not
    // copy credentials, include them in arguments, or log the child environment.
    let token;
    try {
      token = JSON.parse(
        readFileSync(join(configDir, "auth.json"), "utf8"),
      ).token;
    } catch {
      throw new Error(
        "The configured Vercel CLI authentication could not be read.",
      );
    }
    if (typeof token !== "string" || !token)
      throw new Error(
        "The configured Vercel CLI authentication is unavailable.",
      );
    environment.VERCEL_TOKEN = token;
  }
  return environment;
}
