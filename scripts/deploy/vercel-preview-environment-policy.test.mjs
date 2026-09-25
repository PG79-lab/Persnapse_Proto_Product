import { expect, it } from "vitest";
import { previewEnvironmentPolicy } from "./vercel-preview-environment-policy.mjs";
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
