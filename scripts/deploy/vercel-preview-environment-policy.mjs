export const previewVariables = Object.freeze([
  { name: "NEXT_PUBLIC_SUPABASE_URL", visibility: "config" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", visibility: "config" },
  { name: "SUPABASE_SECRET_KEY", visibility: "secret" },
  { name: "DATABASE_URL", visibility: "secret" },
  { name: "CLOVA_OCR_INVOKE_URL", visibility: "secret" },
  { name: "CLOVA_OCR_SECRET", visibility: "secret" },
  { name: "APP_DEFAULT_WORKSPACE_ID", visibility: "config" },
]);

export const previewOverrides = Object.freeze({
  AI_ROUTING_MODE: "mock",
  BUSINESS_CARD_OCR_MODE: "live",
  APP_REMOTE_PROTOTYPE_ACCESS: "vercel_preview",
  NEXT_TELEMETRY_DISABLED: "1",
});

export const expectedPreviewEnvironment = Object.freeze([
  ...previewVariables.map(({ name, visibility }) => ({
    name,
    type: visibility === "secret" ? "sensitive" : "encrypted",
  })),
  ...Object.keys(previewOverrides).map((name) => ({
    name,
    type: "encrypted",
  })),
]);

// Explicit opt-in only. Upload/deploy confirmation guards remain unchanged.
export function previewEnvironmentPolicy(
  liveAssistant = false,
  openAiOcr = false,
) {
  if (!liveAssistant && !openAiOcr)
    return { previewVariables, previewOverrides, expectedPreviewEnvironment };
  const variables = [
    ...previewVariables,
    { name: "OPENAI_API_KEY", visibility: "secret" },
    ...(liveAssistant
      ? [{ name: "VOYAGE_API_KEY", visibility: "secret" }]
      : []),
    ...(openAiOcr
      ? [{ name: "OPENAI_STRUCTURING_MODEL", visibility: "config" }]
      : []),
  ];
  const overrides = {
    ...previewOverrides,
    ...(liveAssistant ? { AI_ROUTING_MODE: "live" } : {}),
    ...(openAiOcr ? { BUSINESS_CARD_OCR_PROVIDER: "openai" } : {}),
  };
  return {
    previewVariables: variables,
    previewOverrides: overrides,
    expectedPreviewEnvironment: [
      ...variables.map(({ name, visibility }) => ({
        name,
        type: visibility === "secret" ? "sensitive" : "encrypted",
      })),
      ...Object.keys(overrides).map((name) => ({ name, type: "encrypted" })),
    ],
  };
}
