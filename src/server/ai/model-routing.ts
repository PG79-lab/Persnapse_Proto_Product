export const aiModelDefaults = {
  transcription: "gpt-transcribe",
  informationStructuring: "gpt-5.6-luna",
  taggingClassification: "gpt-5.6-luna",
  embedding: "voyage-4",
  embeddingFallback: "text-embedding-3-small",
  reranking: "rerank-3-lite",
  mainAgent: "gemini-3.8-flash",
  qualityAgent: "claude-sonnet-5",
  qualityBenchmark: "gpt-5.6-terra",
  complexReasoning: "gpt-5.6-sol",
} as const;

export const aiProviderIds = [
  "naver_clova",
  "google",
  "openai",
  "mistral",
  "voyage",
  "together",
  "anthropic",
  "fireworks",
] as const;

export const aiTaskRouting = {
  businessCardOcr: {
    primary: { provider: "naver_clova", target: "clova-ocr" },
    fallback: { provider: "google", target: "cloud-vision-ocr" },
  },
  transcription: {
    primary: { provider: "openai", target: aiModelDefaults.transcription },
    fallback: { provider: "mistral", target: "voxtral-mini-transcribe-2" },
  },
  informationStructuring: {
    primary: {
      provider: "openai",
      target: aiModelDefaults.informationStructuring,
    },
    fallback: { provider: "mistral", target: "mistral-small-4" },
  },
  taggingClassification: {
    primary: {
      provider: "openai",
      target: aiModelDefaults.taggingClassification,
    },
    fallback: { provider: "together", target: "gpt-oss-20b" },
  },
  embedding: {
    primary: { provider: "voyage", target: aiModelDefaults.embedding },
    fallback: {
      provider: "openai",
      target: aiModelDefaults.embeddingFallback,
    },
  },
  reranking: {
    primary: { provider: "voyage", target: aiModelDefaults.reranking },
    fallback: { provider: "voyage", target: "rerank-3" },
  },
  mainAgent: {
    primary: { provider: "google", target: aiModelDefaults.mainAgent },
    benchmark: {
      provider: "openai",
      target: aiModelDefaults.qualityBenchmark,
    },
  },
  qualityAgent: {
    primary: { provider: "anthropic", target: aiModelDefaults.qualityAgent },
    benchmark: {
      provider: "openai",
      target: aiModelDefaults.qualityBenchmark,
    },
  },
  complexReasoning: {
    primary: {
      provider: "openai",
      target: aiModelDefaults.complexReasoning,
    },
    fallback: { provider: "anthropic", target: "claude-sonnet-5" },
  },
  openModelExperiment: {
    primary: { provider: "together", target: "task-specific-open-model" },
    fallback: { provider: "fireworks", target: "task-specific-open-model" },
  },
} as const;

export type AiTaskId = keyof typeof aiTaskRouting;
export type AiProviderId = (typeof aiProviderIds)[number];
