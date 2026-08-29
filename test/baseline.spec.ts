import { describe, expect, it } from "vitest";
import { runTier } from "../src/baseline.js";
import type { VerifyTier } from "../src/types.js";

describe("runTier tier validation", () => {
  // Qodo flagged this class of bug on PR #3: the CLI cast its raw positional
  // argument straight to VerifyTier, and runTier's `tests ? … : build` ternary
  // then treated any unrecognised value as the build tier. A near-miss like
  // "test" (singular) would therefore verify a bump by *building* it, return
  // no failing-test names, and let the bump be reported green under a plan
  // claiming test-backed evidence. Overstating evidence is the one failure
  // mode this tool exists to prevent, so it must throw.
  it("rejects a near-miss tier rather than silently running the build", () => {
    expect(() => runTier("/nonexistent", "test" as VerifyTier)).toThrow(
      /Unsupported verification tier: test/,
    );
  });

  it("rejects an arbitrary unknown tier", () => {
    expect(() => runTier("/nonexistent", "definitely-not-a-tier" as VerifyTier)).toThrow(
      /Unsupported verification tier/,
    );
  });

  // The guard must sit ahead of the npm ci calls so an invalid tier costs
  // nothing and cannot half-mutate the target repo. The "none" tier is the
  // cheapest proof of that ordering: it returns without running anything.
  it("still handles the 'none' tier without running anything", () => {
    expect(runTier("/nonexistent", "none")).toEqual({
      passed: false,
      failures: [],
      output: "",
    });
  });
});
