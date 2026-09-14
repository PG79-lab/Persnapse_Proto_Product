import { describe, expect, it } from "vitest";

import { aiModelDefaults, aiTaskRouting } from "./model-routing";

describe("AI task routing", () => {
  it("keeps high-volume structuring on GPT-5.6 Luna", () => {
    expect(aiTaskRouting.informationStructuring.primary).toEqual({
      provider: "openai",
      target: aiModelDefaults.informationStructuring,
    });
    expect(aiTaskRouting.taggingClassification.primary.target).toBe(
      "gpt-5.6-luna",
    );
  });

  it("uses Voyage for the primary retrieval quality path", () => {
    expect(aiTaskRouting.embedding.primary.target).toBe("voyage-4");
    expect(aiTaskRouting.reranking.primary.target).toBe("rerank-3-lite");
  });

  it("does not use the complex reasoner as the main agent", () => {
    expect(aiTaskRouting.mainAgent.primary.target).toBe("gemini-3.8-flash");
    expect(aiTaskRouting.complexReasoning.primary.target).toBe("gpt-5.6-sol");
    expect(aiTaskRouting.mainAgent.primary.target).not.toBe(
      aiTaskRouting.complexReasoning.primary.target,
    );
  });
});
