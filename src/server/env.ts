import { z } from "zod";

import { aiModelDefaults } from "./ai/model-routing";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  AI_ROUTING_MODE: z.enum(["mock", "live"]).default("mock"),
  CLOVA_OCR_INVOKE_URL: optionalUrl,
  CLOVA_OCR_SECRET: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  VOYAGE_API_KEY: optionalSecret,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  TOGETHER_API_KEY: optionalSecret,
  OPENAI_TRANSCRIPTION_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.transcription),
  OPENAI_STRUCTURING_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.informationStructuring),
  VOYAGE_EMBEDDING_MODEL: z.string().min(1).default(aiModelDefaults.embedding),
  OPENAI_EMBEDDING_FALLBACK_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.embeddingFallback),
  VOYAGE_RERANK_MODEL: z.string().min(1).default(aiModelDefaults.reranking),
  GOOGLE_MAIN_AGENT_MODEL: z.string().min(1).default(aiModelDefaults.mainAgent),
  ANTHROPIC_QUALITY_AGENT_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.qualityAgent),
  OPENAI_QUALITY_BENCHMARK_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.qualityBenchmark),
  OPENAI_COMPLEX_REASONING_MODEL: z
    .string()
    .min(1)
    .default(aiModelDefaults.complexReasoning),
  APP_DEFAULT_WORKSPACE_ID: z.uuid(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  environment: Readonly<Record<string, string | undefined>>,
): ServerEnv {
  return serverEnvSchema.parse(environment);
}

let cachedEnvironment: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnvironment ??= parseServerEnv(process.env);
  return cachedEnvironment;
}
