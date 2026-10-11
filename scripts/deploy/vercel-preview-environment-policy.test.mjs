import { expect, it } from "vitest";
import { previewEnvironmentPolicy } from "./vercel-preview-environment-policy.mjs";
it("deploys the explicitly selected OpenAI OCR provider and model with its server-only key", () => {
  const policy = previewEnvironmentPolicy(true, true);
  expect(policy.previewOverrides.BUSINESS_CARD_OCR_PROVIDER).toBe("openai");
  expect(policy.previewOverrides.AI_ROUTING_MODE).toBe("live");
  expect(policy.expectedPreviewEnvironment).toContainEqual({
    name: "OPENAI_API_KEY",
    type: "sensitive",
  });
  expect(policy.expectedPreviewEnvironment).toContainEqual({
    name: "OPENAI_STRUCTURING_MODEL",
    type: "encrypted",
  });
  expect(
    new Set(policy.expectedPreviewEnvironment.map((v) => v.name)).size,
  ).toBe(policy.expectedPreviewEnvironment.length);
});
it("keeps existing Preview in mock mode without explicit opt-in", () => {
  const policy = previewEnvironmentPolicy();
  expect(policy.previewOverrides.AI_ROUTING_MODE).toBe("mock");
  expect(policy.previewVariables.some((v) => v.name === "OPENAI_API_KEY")).toBe(
    false,
  );
});
it("adds only required AI keys without cumulative limits for an explicitly selected live assistant", () => {
  const policy = previewEnvironmentPolicy(true);
  expect(policy.previewOverrides.AI_ROUTING_MODE).toBe("live");
  expect(policy.previewOverrides.APP_REMOTE_PROTOTYPE_ACCESS).toBe(
    "vercel_preview",
  );
  expect(
    policy.expectedPreviewEnvironment.find((v) => v.name === "OPENAI_API_KEY")
      ?.type,
  ).toBe("sensitive");
  expect(
    policy.previewVariables.some((v) => v.name === "AI_LIVE_DAILY_CALL_LIMIT"),
  ).toBe(false);
  expect(
    policy.previewVariables.some((v) => v.name === "ANTHROPIC_API_KEY"),
  ).toBe(false);
});
