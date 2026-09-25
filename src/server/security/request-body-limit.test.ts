import { describe, expect, it } from "vitest";

import {
  assertRequestBodyWithinLimit,
  RequestBodyTooLargeError,
} from "./request-body-limit";

describe("request body limit", () => {
  it("accepts missing and bounded content-length headers", () => {
    expect(() =>
      assertRequestBodyWithinLimit(new Request("https://example.test"), 100),
    ).not.toThrow();
    expect(() =>
      assertRequestBodyWithinLimit(
        new Request("https://example.test", {
          headers: { "content-length": "100" },
        }),
        100,
      ),
    ).not.toThrow();
  });

  it("rejects oversized or malformed content-length headers", () => {
    for (const value of ["101", "-1", "not-a-number"]) {
      expect(() =>
        assertRequestBodyWithinLimit(
          new Request("https://example.test", {
            headers: { "content-length": value },
          }),
          100,
        ),
      ).toThrow(RequestBodyTooLargeError);
    }
  });
});
