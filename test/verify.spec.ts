import { describe, expect, it } from "vitest";
import { isVersionGreater } from "../src/verify.js";

describe("isVersionGreater", () => {
  it("returns true when the major version is higher", () => {
    expect(isVersionGreater("3.0.0", "2.6.0")).toBe(true);
  });

  it("returns false when the candidate is lower — the exact regression this guards", () => {
    // A "latest" dist-tag at or below the audit-required fix must never be
    // treated as an opportunistic upgrade — doing so could silently accept
    // a still-vulnerable downgrade as if it were a bonus improvement.
    expect(isVersionGreater("2.5.0", "2.6.0")).toBe(false);
  });

  it("returns false for equal versions", () => {
    expect(isVersionGreater("2.7.0", "2.7.0")).toBe(false);
  });

  it("compares minor and patch segments correctly", () => {
    expect(isVersionGreater("2.7.0", "2.6.9")).toBe(true);
    expect(isVersionGreater("2.6.10", "2.6.9")).toBe(true);
    expect(isVersionGreater("2.6.8", "2.6.9")).toBe(false);
  });
});
