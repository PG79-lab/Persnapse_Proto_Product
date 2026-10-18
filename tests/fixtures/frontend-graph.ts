import { test as base, expect } from "@playwright/test";
import {
  fixtureTime,
  frontendGraphSnapshot,
} from "../../src/features/workspace/preview/fixture";

export {
  fixtureId,
  fixtureTime,
  frontendGraphFixture,
} from "../../src/features/workspace/preview/fixture";
export const test = base.extend<{ isolatedGraph: void }>({
  isolatedGraph: [
    async ({ page, baseURL }, use) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(error.message));
      await page.clock.setFixedTime(new Date(fixtureTime));
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) {
          failures.push(`External request: ${url.origin}`);
          return route.abort();
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (
          route.request().method() === "GET" &&
          url.pathname === "/api/workspace"
        )
          return route.fulfill({ json: frontendGraphSnapshot() });
        if (
          route.request().method() === "GET" &&
          url.pathname === "/api/business-cards"
        )
          return route.fulfill({ json: [] });
        failures.push(
          `Unregistered request: ${route.request().method()} ${url.pathname}`,
        );
        return route.abort();
      });
      await use();
      expect(failures).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
