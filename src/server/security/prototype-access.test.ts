import { describe, expect, it } from "vitest";

import { isPrototypeRequestAllowed } from "./prototype-access-policy";

describe("prototype access boundary", () => {
  it("always allows local development hosts", () => {
    expect(
      isPrototypeRequestAllowed(new Request("http://localhost:3000/capture")),
    ).toBe(true);
    expect(
      isPrototypeRequestAllowed(new Request("http://127.0.0.1:3000/capture")),
    ).toBe(true);
  });

  it("allows only explicitly enabled Vercel preview hosts", () => {
    const request = new Request("https://persnapse-preview.vercel.app/capture");
    const enabled = {
      APP_REMOTE_PROTOTYPE_ACCESS: "vercel_preview",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    };

    expect(isPrototypeRequestAllowed(request, enabled)).toBe(true);
    expect(
      isPrototypeRequestAllowed(request, {
        ...enabled,
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isPrototypeRequestAllowed(request, {
        ...enabled,
        APP_REMOTE_PROTOTYPE_ACCESS: "off",
      }),
    ).toBe(false);
  });

  it("rejects non-Vercel remote hosts even when preview access is enabled", () => {
    expect(
      isPrototypeRequestAllowed(
        new Request("https://preview.example.com/capture"),
        {
          APP_REMOTE_PROTOTYPE_ACCESS: "vercel_preview",
          VERCEL: "1",
          VERCEL_ENV: "preview",
        },
      ),
    ).toBe(false);
  });

  it("prefers the forwarded host supplied by the deployment platform", () => {
    const request = new Request("http://localhost:3000/capture", {
      headers: { "x-forwarded-host": "public.example.com" },
    });

    expect(isPrototypeRequestAllowed(request)).toBe(false);
  });
});
