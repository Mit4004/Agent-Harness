import { describe, expect, it } from "vitest";
import { parseAudit, assertUsableAuditReport } from "../src/audit.js";

describe("parseAudit", () => {
  it("turns a fixable advisory into a candidate bump", () => {
    const auditJson = {
      vulnerabilities: {
        "node-fetch": {
          name: "node-fetch",
          severity: "high",
          range: "<2.6.7",
          fixAvailable: { name: "node-fetch", version: "2.6.7", isSemVerMajor: false },
          via: [
            {
              source: 1,
              title: "node-fetch forwards secure headers to untrusted sites",
              url: "https://github.com/advisories/GHSA-r683-j2x4-v87g",
            },
          ],
        },
      },
    };

    const bumps = parseAudit(auditJson, { "node-fetch": "2.6.0" });

    expect(bumps).toHaveLength(1);
    expect(bumps[0]).toMatchObject({
      package: "node-fetch",
      current: "2.6.0",
      target: "2.6.7",
      severity: "High",
      bumpKind: "patch",
      advisory: "GHSA-r683-j2x4-v87g",
      result: "pending",
    });
  });

  it("classifies a major version bump correctly", () => {
    const auditJson = {
      vulnerabilities: {
        "node-fetch": {
          name: "node-fetch",
          severity: "high",
          range: "<3.0.0",
          fixAvailable: { name: "node-fetch", version: "3.3.2", isSemVerMajor: true },
          via: [{ source: 1, title: "advisory", url: "https://github.com/advisories/GHSA-xxxx" }],
        },
      },
    };

    const bumps = parseAudit(auditJson, { "node-fetch": "2.6.0" });
    expect(bumps[0].bumpKind).toBe("major");
  });

  it("skips advisories with no available fix", () => {
    const auditJson = {
      vulnerabilities: {
        "some-pkg": {
          name: "some-pkg",
          severity: "low",
          range: "*",
          fixAvailable: false,
          via: ["some-other-pkg"],
        },
      },
    };

    expect(parseAudit(auditJson, {})).toHaveLength(0);
  });

  it("returns an empty list for a clean audit", () => {
    expect(parseAudit({ vulnerabilities: {} }, {})).toEqual([]);
  });
});

describe("assertUsableAuditReport", () => {
  // Qodo flagged this on PR #5: npm audit exits non-zero both when it finds
  // advisories (normal here) and when it fails operationally, and some
  // failures still print JSON. Because parseAudit reads `vulnerabilities ?? {}`,
  // an error payload would otherwise be reported as a clean, zero-bump plan --
  // claiming more safety than the run actually established.
  it("rejects an npm error payload instead of treating it as zero vulnerabilities", () => {
    expect(() =>
      assertUsableAuditReport({ error: { code: "ENEEDAUTH", summary: "auth required" } }),
    ).toThrow(/reported an error/);
  });

  it("rejects a payload with no vulnerabilities map", () => {
    expect(() => assertUsableAuditReport({ metadata: {} })).toThrow(
      /no 'vulnerabilities' map/,
    );
  });

  it("rejects non-object output", () => {
    expect(() => assertUsableAuditReport("not json")).toThrow(/did not return a JSON object/);
    expect(() => assertUsableAuditReport(null)).toThrow(/did not return a JSON object/);
  });

  it("accepts a genuine report, including one with zero vulnerabilities", () => {
    const empty = { vulnerabilities: {} };
    expect(assertUsableAuditReport(empty)).toBe(empty);
  });
});
