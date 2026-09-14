import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  DATABASE_URL: "postgresql://postgres:password@example.com:5432/postgres",
  APP_DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
};

describe("server environment", () => {
  it("uses deterministic mock routing with the accepted model defaults", () => {
    const environment = parseServerEnv(validEnvironment);

    expect(environment.AI_ROUTING_MODE).toBe("mock");
    expect(environment.OPENAI_TRANSCRIPTION_MODEL).toBe("gpt-transcribe");
    expect(environment.OPENAI_STRUCTURING_MODEL).toBe("gpt-5.6-luna");
    expect(environment.VOYAGE_EMBEDDING_MODEL).toBe("voyage-4");
    expect(environment.VOYAGE_RERANK_MODEL).toBe("rerank-3-lite");
    expect(environment.GOOGLE_MAIN_AGENT_MODEL).toBe("gemini-3.8-flash");
    expect(environment.ANTHROPIC_QUALITY_AGENT_MODEL).toBe("claude-sonnet-5");
    expect(environment.OPENAI_COMPLEX_REASONING_MODEL).toBe("gpt-5.6-sol");
  });

  it("treats blank optional provider credentials as unset", () => {
    const environment = parseServerEnv({
      ...validEnvironment,
      OPENAI_API_KEY: "",
      CLOVA_OCR_INVOKE_URL: "",
    });

    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.CLOVA_OCR_INVOKE_URL).toBeUndefined();
  });

  it("rejects an invalid Supabase URL", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      }),
    ).toThrow();
  });
});
