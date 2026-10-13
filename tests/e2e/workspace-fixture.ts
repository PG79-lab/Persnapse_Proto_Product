import type { Page } from "@playwright/test";
import type { WorkspaceState } from "../../src/domain/workspace/contracts";
import { emptyWorkspace } from "../../src/features/workspace/store";

export async function mockWorkspace(
  page: Page,
  state: WorkspaceState = emptyWorkspace(),
) {
  await page.route("**/api/workspace", (route) => {
    if (route.request().method() !== "GET")
      throw new Error("Browser fixtures must not write shared workspace data");
    return route.fulfill({
      json: {
        state,
        loadedAt: "2026-10-12T00:00:00Z",
        capabilities: { storage: "server", aiMode: "mock", ocrMode: "live" },
      },
    });
  });
  await page.route("**/api/business-cards", (route) => {
    if (route.request().method() !== "GET")
      throw new Error("Card writes require an explicit browser fixture");
    return route.fulfill({ json: [] });
  });
}
