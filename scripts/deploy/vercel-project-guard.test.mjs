import { describe, expect, it } from "vitest";

import {
  validatePreviewEnvironmentInventory,
  validateProductionDeploymentHistory,
  validateReviewedPreviewDeployment,
  validateVercelProjectProtection,
} from "./vercel-project-guard.mjs";

const link = {
  projectId: "prj_reviewed",
  orgId: "team_reviewed",
};

describe("Vercel project guard", () => {
  it("requires the exact protected project and team", () => {
    expect(() =>
      validateVercelProjectProtection(
        link,
        {
          id: link.projectId,
          accountId: link.orgId,
          ssoProtection: { deploymentType: "all" },
        },
        "test",
      ),
    ).not.toThrow();

    expect(() =>
      validateVercelProjectProtection(
        link,
        {
          id: link.projectId,
          accountId: "team_wrong",
          ssoProtection: { deploymentType: "all" },
        },
        "test",
      ),
    ).toThrow(/outside the linked project or team/u);

    expect(() =>
      validateVercelProjectProtection(
        link,
        {
          id: link.projectId,
          accountId: link.orgId,
          ssoProtection: { deploymentType: "preview" },
        },
        "test",
      ),
    ).toThrow(/All Deployments/u);
  });

  it("requires READY Production deployment history", () => {
    expect(() =>
      validateProductionDeploymentHistory(
        {
          deployments: [{ target: "production", readyState: "READY" }],
        },
        "test",
      ),
    ).not.toThrow();

    expect(() =>
      validateProductionDeploymentHistory(
        {
          deployments: [{ target: null, readyState: "READY" }],
        },
        "test",
      ),
    ).toThrow(/no READY Production/u);
  });

  it("binds the exact immutable READY Preview URL", () => {
    const deployment = {
      id: "dpl_reviewed",
      projectId: link.projectId,
      url: "reviewed-team.vercel.app",
      readyState: "READY",
      target: null,
    };

    expect(
      validateReviewedPreviewDeployment(
        link,
        "https://reviewed-team.vercel.app",
        deployment,
      ),
    ).toEqual({
      id: deployment.id,
      url: "https://reviewed-team.vercel.app",
    });

    expect(() =>
      validateReviewedPreviewDeployment(
        link,
        "https://alias.vercel.app",
        deployment,
      ),
    ).toThrow(/does not belong/u);

    expect(() =>
      validateReviewedPreviewDeployment(link, `https://${deployment.url}`, {
        ...deployment,
        target: "production",
      }),
    ).toThrow(/not a Preview/u);

    expect(() =>
      validateReviewedPreviewDeployment(link, `https://${deployment.url}`, {
        ...deployment,
        readyState: "BUILDING",
      }),
    ).toThrow(/not READY/u);
  });

  it("requires an exact Preview-only environment allowlist", () => {
    const expected = [
      { name: "PUBLIC_CONFIG", type: "encrypted" },
      { name: "SERVER_SECRET", type: "sensitive" },
    ];
    const valid = {
      envs: [
        {
          key: "PUBLIC_CONFIG",
          type: "encrypted",
          target: ["preview"],
        },
        {
          key: "SERVER_SECRET",
          type: "sensitive",
          target: ["preview"],
        },
      ],
    };

    expect(() =>
      validatePreviewEnvironmentInventory(valid, expected),
    ).not.toThrow();
    expect(() =>
      validatePreviewEnvironmentInventory(
        {
          envs: [
            ...valid.envs,
            { key: "UNKNOWN", type: "sensitive", target: ["preview"] },
          ],
        },
        expected,
      ),
    ).toThrow(/outside the reviewed Preview allowlist/u);
    expect(() =>
      validatePreviewEnvironmentInventory(
        {
          envs: [
            valid.envs[0],
            {
              ...valid.envs[1],
              target: ["preview", "production"],
            },
          ],
        },
        expected,
      ),
    ).toThrow(/outside the reviewed Preview allowlist/u);
    expect(() =>
      validatePreviewEnvironmentInventory({ envs: [valid.envs[0]] }, expected),
    ).toThrow(/incomplete/u);
  });
});
