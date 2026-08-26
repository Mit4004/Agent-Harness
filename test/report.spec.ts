import { describe, expect, it } from "vitest";
import { renderPrBody } from "../src/report.js";
import type { Bump, BumpPlan } from "../src/types.js";

function makeBump(overrides: Partial<Bump>): Bump {
  return {
    id: "B-01",
    package: "lodash",
    current: "4.17.20",
    target: "4.17.21",
    advisory: "GHSA-example",
    severity: "High",
    bumpKind: "patch",
    strategyNote: "",
    branch: "bump/lodash-4.17.21",
    verifyTier: "tests",
    baselineFailures: 0,
    result: "pending",
    failureExcerpt: null,
    diagnosis: null,
    recommendation: null,
    attempts: 0,
    ...overrides,
  };
}

function makePlan(bumps: Bump[]): BumpPlan {
  return {
    repo: "owner/repo",
    baseBranch: "main",
    runId: "run-1",
    baseline: { tier: "tests", failingTests: [], durationMs: 1000 },
    bumps,
  };
}

describe("renderPrBody", () => {
  it("puts green bumps in the included section with their verify tier", () => {
    const plan = makePlan([makeBump({ result: "green", verifyTier: "tests" })]);
    const body = renderPrBody(plan);

    expect(body).toContain("### Included (1)");
    expect(body).toContain("lodash");
    expect(body).toContain("verified: tests pass");
  });

  it("puts failed bumps in the excluded section with the diagnosis", () => {
    const plan = makePlan([
      makeBump({
        package: "node-fetch",
        result: "failed",
        diagnosis: "v3 is ESM-only; this repo uses require().",
        recommendation: "Take 2.7.0 instead.",
      }),
    ]);
    const body = renderPrBody(plan);

    expect(body).toContain("### Excluded — broke verification (1)");
    expect(body).toContain("ESM-only");
    expect(body).toContain("Take 2.7.0 instead.");
  });

  it("never labels a resolves-tier bump as verified by tests", () => {
    const plan = makePlan([makeBump({ result: "green", verifyTier: "resolves" })]);
    const body = renderPrBody(plan);

    expect(body).toContain("unverified");
    expect(body).not.toContain("verified: tests pass");
  });

  it("reports zero included bumps honestly instead of an empty section", () => {
    const plan = makePlan([makeBump({ result: "failed" })]);
    const body = renderPrBody(plan);

    expect(body).toContain("_None verified green._");
  });
});
